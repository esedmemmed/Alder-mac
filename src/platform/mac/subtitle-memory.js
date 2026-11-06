/*
 * Mac subtitle memory: the language the viewer last picked for a title (the menu's Off, a file track, or an add-on subtitle) is started again
 * for the next episode and on a rewatch. The Tizen build keeps its own start rule untouched; the Mac build (build.mjs: SUBTITLE_SESSION_PATCHES,
 * SUBTITLE_MEMORY_PATCHES) builds this in the session and the engine asks it.
 *
 * What is kept, per series or movie id (key `subs/<metaId>`): { kind: 'off' } or { kind: 'lang', language: <ISO 639-1>, addon?: <add-on name> }.
 * A later pick overwrites it. Written only by a menu pick (engine selectSubtitle), never by the start rule. Never a link, a file name or a token.
 *
 * Start: off -> none; lang -> the file's track in that language, else the first add-on subtitle in that language as the answers arrive (the
 * remembered add-on first, then the add-on order of the list); nothing found -> the normal start rule, and the reason. Each start is one decide()
 * line and one `memory:` line to the shell's report (the Air's ui-report prints it with the source memory's):
 *   memory: found by=sub_off | sub_file source=<track> | sub_addon source=<n>
 *   memory: not offered                                  nothing in that language: the normal start rule
 * Safari 14: no lookbehind, no class fields. Nothing here sorts.
 */
import { macBridge } from './bridge.js';

const keyOf = (metaId) => 'subs/' + metaId;

function bridgeLog(line) {
  const b = macBridge();
  if (!b || !b.log) return;
  try { const p = b.log(line); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no shell */ }
}

/** store: the app's store (get / set / remove); report(line): the shell's log (default: the bridge). */
export function createSubtitleMemory(store, { report = bridgeLog } = {}) {
  return {
    get(metaId) {
      const v = store.get(keyOf(metaId));
      if (!v || typeof v !== 'object') return null;
      if (v.kind === 'off') return { kind: 'off' };
      if (v.kind === 'lang' && typeof v.language === 'string' && v.language) return typeof v.addon === 'string' && v.addon ? { kind: 'lang', language: v.language, addon: v.addon } : { kind: 'lang', language: v.language };
      return null;
    },
    remember(metaId, choice) {
      if (!choice) return;
      if (choice.kind === 'off') store.set(keyOf(metaId), { kind: 'off' });
      else if (choice.kind === 'lang' && choice.language) store.set(keyOf(metaId), choice.addon ? { kind: 'lang', language: choice.language, addon: choice.addon } : { kind: 'lang', language: choice.language });
    },
    report,
  };
}

/**
 * What the remembered choice means for this start: { kind: 'off' } | { kind: 'file', track } | { kind: 'addon', sub, index } |
 * { kind: 'wait' } (nothing yet, add-ons still answering) | { kind: 'none' } (add-ons are done and none has it).
 * textTracks: the file's (tracks.js parseTextTracks); addonSubs: the add-on subtitles so far (Subtitle: lang, addon); lang: toIso1.
 */
export function subtitlePlan(choice, { textTracks, addonSubs, addonsDone, lang }) {
  if (choice.kind === 'off') return { kind: 'off' };
  const mine = textTracks.filter((t) => t.language && t.language === choice.language);
  const track = mine.find((t) => !t.forced) || mine[0];
  if (track) return { kind: 'file', track };
  let index = -1;
  if (choice.addon) index = addonSubs.findIndex((s) => s.addon === choice.addon && lang(s.lang) === choice.language);
  if (index < 0) index = addonSubs.findIndex((s) => lang(s.lang) === choice.language);
  if (index >= 0) return { kind: 'addon', sub: addonSubs[index], index };
  return { kind: addonsDone ? 'none' : 'wait' };
}
