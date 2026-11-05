/*
 * Mac add-on subtitle loading, in place of the body of engine.js's loadAddonSubtitles (build.mjs anchored patch on src/player/engine.js; the
 * Tizen build keeps the original). What it changes:
 *   every subtitle add-on is asked at once, from the add-on list in memory right away and again from the refreshed list (an add-on installed
 *   since the app started is still asked); none waits for another, and nothing here is awaited by playback (start() does not await it)
 *   the options menu fills as each add-on answers: the rows are rebuilt from the answers so far (set + changed after every answer)
 *   an answer is kept per add-on and video id for CACHE_MS, so reopening the title or switching source asks nobody twice; a failure is not kept
 *   each request logs `subs-addon: start|done|fail name="..." ms=.. count=..` to the shell's report (the Air's ui-report turns it into a line per
 *   add-on and a "slow add-on" line); names only, never links
 * The subtitle text itself is still fetched by the page (src/lib/http.js) when a file is chosen; this module only asks for the lists.
 */
import { macBridge } from './bridge.js';

export const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map(); // key -> { at, promise }

/** Test hook: forget every kept answer. */
export function clearSubtitleCache() { cache.clear(); }

const cleanName = (name) => String(name).replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[link]').replace(/["\r\n]/g, ' ').slice(0, 40);

function bridgeLog(line) {
  const b = macBridge();
  if (!b || !b.log) return;
  try { const p = b.log(line); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no shell */ }
}

/**
 * Asks every subtitle add-on for [videoId]; returns a promise that settles when all have answered (the caller does not wait for it).
 * set(list): the chosen rows so far (engine's addonSubs); changed(): the options menu rebuilds; choose(entries, language): core chooseAddonSubtitles.
 */
export async function macLoadAddonSubtitles({ stremio, authKey, type, videoId, tvLanguage, choose, set, changed, say = () => {}, warn = () => {}, diag = null,
  isShut = () => false, now = Date.now, report = bridgeLog }) {
  const asked = new Map(); // add-on identity -> slot
  const entries = [];      // { addon, subs, done } in the order the add-ons were first seen (stable rows)
  const runs = [];
  if (diag) diag.subtitleAddon(null);

  const publish = () => {
    if (isShut()) return;
    set(choose(entries.filter((e) => e.done).map((e) => ({ addon: e.addon, subs: e.subs })), tvLanguage()));
    changed();
  };

  function fetchList(a) {
    const key = (a.base || a.name) + '|' + type + '|' + videoId;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return { promise: hit.promise, cached: true };
    const promise = Promise.resolve().then(() => a.subtitles(type, videoId));
    const kept = { at: now(), promise };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, kept);
    promise.catch(() => { if (cache.get(key) === kept) cache.delete(key); });
    return { promise, cached: false };
  }

  function ask(list) {
    for (const a of list) {
      if (!a.serves('subtitles', type, videoId)) continue;
      const id = a.base || a.name;
      if (asked.has(id)) continue;
      const entry = { addon: a.name, subs: [], done: false };
      asked.set(id, entry);
      entries.push(entry);
      const name = cleanName(a.name);
      const t0 = now();
      const { promise, cached } = fetchList(a);
      if (!cached) report('subs-addon: start name="' + name + '"');
      runs.push(promise.then((subs) => {
        const ms = now() - t0;
        say('subtitles from ' + a.name + ' (' + type + ' ' + videoId + '): ' + subs.length + ' in ' + ms + ' ms' + (cached ? ' (kept)' : ''));
        report('subs-addon: done name="' + name + '" ms=' + ms + ' count=' + subs.length + (cached ? ' cached=1' : ''));
        if (diag) diag.subtitleAddon(a.name, subs.length);
        entry.subs = subs; entry.done = true;
        publish();
      }, (e) => {
        const ms = now() - t0;
        warn('subtitles from ' + a.name + ' (' + type + ' ' + videoId + ') failed: ' + (e && e.message ? e.message : e));
        report('subs-addon: fail name="' + name + '" ms=' + ms + ' count=0');
        if (diag) diag.subtitleAddon(a.name, e);
        entry.done = false;
      }));
    }
  }

  try {
    // the list in memory answers at once and starts the first requests; the refreshed list adds whatever is new; the cached one is the fallback
    const first = Promise.resolve().then(() => stremio.addons(authKey)).then(ask, () => {});
    let refreshed = false;
    try { ask(await stremio.addons(authKey, true)); refreshed = true; } catch (e) { warn('add-on list refresh failed, using the cached one: ' + (e && e.message ? e.message : e)); }
    await first;
    if (!refreshed && !asked.size) ask(await stremio.addons(authKey));
    await Promise.all(runs);
    say('add-on subtitles: ' + entries.reduce((n, e) => n + e.subs.length, 0));
  } catch (e) {
    warn('add-on subtitles unavailable: ' + (e && e.message ? e.message : e));
  }
}
