/*
 * Subtitle timing against an English reference tied to the playing file (1.12). A Turkish (or any non-English) add-on subtitle that was made for
 * another release is moved onto an English subtitle whose OpenSubtitles match type is 'h' (the moviehash matched this very file; see
 * core/addon.js Subtitle.matchedBy) with the linear aligner of core/subtitle-align.js: target * ratio + offset. Applied only at checked 'high'
 * (gain >= CHECKED.highGain); a 'low' or 'none' result is never applied.
 *
 * The aligner is heavy (about 150 ms in node on the biggest corpus pair, the TV is about 10x slower), so createAligner runs it in a Web Worker
 * built from this same module (scripts/build.mjs bundles src/player/subtitle-sync-worker.js into the string __ALDER_ALIGN_WORKER__ and starts it
 * from a Blob URL); without a Worker (node tests, a refused Blob) it runs in the page after a timer, never before the first picture.
 *
 * Lines for decide() (AUDIO AND SOURCE DECISIONS and the report): 'timing: ...'. No link, host or token in any of them.
 * Plain ES module, Chromium 69 / Safari 14 syntax (no optional chaining, no nullish coalescing).
 */
import { alignChecked, pickBest, mapTime, CHECKED } from '../core/subtitle-align.js';
import { releaseKey, subtitleKey } from '../core/delay-memory.js';

/** How many other subtitles of the language may be tried when the chosen one does not fit. */
export const MAX_OTHERS = 6;

/** The first English add-on subtitle whose file hash matched the playing file, or null. */
export function referenceFor(addonSubs) {
  const list = addonSubs || [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s && s.matchedBy === 'hash' && typeof s.isEnglish === 'function' && s.isEnglish()) return s;
  }
  return null;
}

/** Plain {start, end} times of parsed cues (what crosses to the worker). */
export function timesOf(cues) {
  const out = [];
  for (let i = 0; i < cues.length; i++) out.push({ start: cues[i].start, end: cues[i].end });
  return out;
}

/** The cues with every start and end moved by [t] = { ratio, offset } (mapTime); start never below 0, cues ending at or before 0 dropped; other fields kept. */
export function mapCues(cues, t) {
  const out = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const end = mapTime(c.end, t);
    if (end <= 0) continue;
    out.push({ start: Math.max(0, mapTime(c.start, t)), end, lines: c.lines });
  }
  return out;
}

/** Pure: [cands] = [{ id, cues }] against [ref] -> [{ id, ratio, offset, gain, checked }], best gain first. Runs in the worker or the page. */
export function analyse(ref, cands) {
  return pickBest(ref, cands).map((x) => ({ id: x.id, ratio: x.result.ratio, offset: x.result.offset, gain: x.result.gain, checked: x.result.checked }));
}

const secondsText = (ms) => (ms < 0 ? '-' : '+') + (Math.abs(ms) / 1000).toFixed(1) + ' s';
/** The status line of the subtitle timing group for a state ('hash' | 'aligned' | 'remembered' | 'noref' | 'nochange'); t = { ratio, offset } where it applies. */
export function timingText(state, t) {
  const shift = () => secondsText(t.offset) + (Math.abs(t.ratio - 1) > 0.0005 ? ', speed ' + t.ratio.toFixed(3) : '');
  if (state === 'hash') return 'Timed to this file';
  if (state === 'aligned' && t) return 'Aligned to English: ' + shift();
  if (state === 'remembered' && t) return 'Remembered alignment: ' + shift();
  if (state === 'noref') return 'Not checked: no English subtitle matched to this file';
  if (state === 'nochange') return 'Not changed: no confident fit';
  return '';
}
/** The line for a fresh alignment. */
export function alignedLine(t) { return 'timing: aligned to English (file match): ' + secondsText(t.offset) + ', speed ' + t.ratio.toFixed(4) + ', gain ' + t.gain.toFixed(2); }

/**
 * The aligner: compute(ref, cands) -> promise of analyse()'s list. A Worker from [workerSource] when it can be made, else in the page after
 * defer(fn) (a timer). Any worker trouble falls back to the page.
 */
export function createAligner({ workerSource = (typeof __ALDER_ALIGN_WORKER__ !== 'undefined' ? __ALDER_ALIGN_WORKER__ : null), defer = (fn) => setTimeout(fn, 0) } = {}) {
  const inPage = (ref, cands) => new Promise((resolve, reject) => { defer(() => { try { resolve(analyse(ref, cands)); } catch (e) { reject(e); } }); });
  return {
    compute(ref, cands) {
      if (!workerSource || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return inPage(ref, cands);
      return new Promise((resolve, reject) => {
        let worker = null;
        let url = null;
        const done = (fn, v) => { try { if (worker) worker.terminate(); if (url) URL.revokeObjectURL(url); } catch (e) { /* gone already */ } fn(v); };
        try {
          url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
          worker = new Worker(url);
          worker.onmessage = (e) => { if (e.data && e.data.results) done(resolve, e.data.results); else done(reject, new Error((e.data && e.data.error) || 'worker failed')); };
          worker.onerror = () => done(reject, new Error('worker failed'));
          worker.postMessage({ ref, cands });
        } catch (e) { done(reject, e); }
      }).catch(() => inPage(ref, cands));
    },
  };
}

/** The remembered alignment per release and subtitle: store key `align/<release>/<subtitle>` = { ratio, offset, gain } (same key parts as the delay memory). */
export function createAlignMemory(store) {
  const keyOf = (stream, sub) => { const rel = releaseKey(stream); const s = subtitleKey({ kind: 'addon', sub }); return rel && s ? 'align/' + rel + '/' + s : null; };
  return {
    get(stream, sub) {
      const k = keyOf(stream, sub);
      const v = k ? store.get(k) : null;
      if (!v || typeof v !== 'object' || !isFinite(v.ratio) || !isFinite(v.offset) || v.ratio < 0.5 || v.ratio > 2) return null;
      return { ratio: Number(v.ratio), offset: Number(v.offset), gain: Number(v.gain) || 0 };
    },
    remember(stream, sub, t) {
      const k = keyOf(stream, sub);
      if (k) store.set(k, { ratio: t.ratio, offset: Math.round(t.offset), gain: Math.round(t.gain * 100) / 100 });
    },
  };
}

/**
 * One run for the add-on subtitle [sub] (its parsed [cues]). c: { sub, cues, addonSubs, sameLanguage(sub), http, parse(text, format), compute, decide,
 * current() -> still the chosen one and the engine alive, apply(result, sub, switched) }. Resolves when done; never throws.
 */
export async function syncSubtitle(c) {
  try {
    const ref = referenceFor(c.addonSubs);
    const say = (line, state) => { c.decide(line); if (c.state) c.state(state); };
    if (!ref) { say('timing: no English reference matched to this file' + (c.suffix ? c.suffix() : ''), 'noref'); return; }
    let refCues = null;
    try { refCues = c.parse(await c.http.get(ref.url), ref.format); } catch (e) { refCues = null; }
    if (!c.current()) return;
    if (!refCues || !refCues.length) { say('timing: the English reference did not load', 'noref'); return; }
    const refTimes = timesOf(refCues);
    const mine = (await c.compute(refTimes, [{ id: 'self', cues: timesOf(c.cues) }]))[0];
    if (!c.current()) return;
    if (mine.checked === 'high') {
      const m = c.minChange; // a subtitle already timed to this file moves only for a clear difference
      if (!m || Math.abs(mine.offset) > m.offset || Math.abs(mine.ratio - 1) > m.ratio) c.apply(mine, c.sub, false);
      return;
    }
    if (c.noSwitch) return;
    let bestGain = mine.gain;
    const others = c.addonSubs.filter((s) => s !== c.sub && s.url !== c.sub.url && c.sameLanguage(s)).slice(0, MAX_OTHERS);
    if (others.length) {
      const got = await Promise.all(others.map((s) => Promise.resolve().then(() => c.http.get(s.url)).then((t) => c.parse(t, s.format), () => null)));
      if (!c.current()) return;
      const cands = [];
      got.forEach((cues, i) => { if (cues && cues.length) cands.push({ id: i, cues: timesOf(cues) }); });
      if (cands.length) {
        const ranked = await c.compute(refTimes, cands);
        if (!c.current()) return;
        const top = ranked[0];
        if (top.gain > bestGain) bestGain = top.gain;
        if (top.checked === 'high') { c.apply(top, others[top.id], true); return; }
      }
    }
    say('timing: not changed (best gain ' + Math.max(0, bestGain).toFixed(2) + ' below ' + CHECKED.highGain.toFixed(2) + ')', 'nochange');
  } catch (e) {
    try { c.decide('timing: not changed (failed)'); if (c.state) c.state('nochange'); } catch (e2) { /* nothing to say it to */ }
  }
}

export { alignChecked };
