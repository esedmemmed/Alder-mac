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
export function analyse(ref, cands, opts) {
  return pickBest(ref, cands, opts).map((x) => ({ id: x.id, ratio: x.result.ratio, offset: x.result.offset, gain: x.result.gain, checked: x.result.checked }));
}

const secondsText = (ms) => (ms < 0 ? '-' : '+') + (Math.abs(ms) / 1000).toFixed(1) + ' s';
/** The status line of the subtitle timing group for a state ('hash' | 'aligned' | 'remembered' | 'noref' | 'nochange'); t = { ratio, offset } where it applies. */
export function timingText(state, t) {
  const shift = () => secondsText(t.offset) + (Math.abs(t.ratio - 1) > 0.0005 ? ', speed ' + t.ratio.toFixed(3) : '');
  if (state === 'hash') return 'Timed to this file';
  if (state === 'aligned' && t) return 'Aligned to English: ' + shift();
  if (state === 'remembered' && t) return 'Remembered alignment: ' + shift();
  if (state === 'aligned-release' && t) return 'Aligned to English (same release): ' + shift();
  if (state === 'listening') return "Checking against the file's English subtitles…";
  if (state === 'aligned-file' && t) return "Aligned to the file's English track: " + shift();
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
  const inPage = (ref, cands, opts) => new Promise((resolve, reject) => { defer(() => { try { resolve(analyse(ref, cands, opts)); } catch (e) { reject(e); } }); });
  return {
    compute(ref, cands, opts) {
      if (!workerSource || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return inPage(ref, cands, opts);
      return new Promise((resolve, reject) => {
        let worker = null;
        let url = null;
        const done = (fn, v) => { try { if (worker) worker.terminate(); if (url) URL.revokeObjectURL(url); } catch (e) { /* gone already */ } fn(v); };
        try {
          url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));
          worker = new Worker(url);
          worker.onmessage = (e) => { if (e.data && e.data.results) done(resolve, e.data.results); else done(reject, new Error((e.data && e.data.error) || 'worker failed')); };
          worker.onerror = () => done(reject, new Error('worker failed'));
          worker.postMessage({ ref, cands, opts: opts || null });
        } catch (e) { done(reject, e); }
      }).catch(() => inPage(ref, cands, opts));
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
      return { ratio: Number(v.ratio), offset: Number(v.offset), gain: Number(v.gain) || 0, source: typeof v.source === 'string' ? v.source : null };
    },
    remember(stream, sub, t, source) {
      const k = keyOf(stream, sub);
      const v = { ratio: t.ratio, offset: Math.round(t.offset), gain: Math.round(t.gain * 100) / 100 };
      if (source) v.source = source; // 'file track': timed against the file's own English subtitles
      if (k) store.set(k, v);
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
    let refCues = null;
    let via = null; // set when the reference is English made for the same release (releaseReference)
    if (!ref) {
      say('timing: no English reference matched to this file' + (c.suffix ? c.suffix() : ''), 'noref');
      if (!c.release) return;
      const found = await c.release();
      if (!c.current()) return;
      if (!found) { c.decide('timing: no English for the same release'); return; }
      refCues = found.cues; via = found;
    } else {
      try { refCues = c.parse(await c.http.get(ref.url), ref.format); } catch (e) { refCues = null; }
      if (!c.current()) return;
      if (!refCues || !refCues.length) { say('timing: the English reference did not load', 'noref'); return; }
    }
    const refTimes = timesOf(refCues);
    const mine = (await c.compute(refTimes, [{ id: 'self', cues: timesOf(c.cues) }], c.opts))[0];
    if (!c.current()) return;
    if (mine.checked === 'high') {
      const m = c.minChange; // a subtitle already timed to this file moves only for a clear difference
      if (!m || Math.abs(mine.offset) > m.offset || Math.abs(mine.ratio - 1) > m.ratio) c.apply(mine, c.sub, false, via);
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
        const ranked = await c.compute(refTimes, cands, c.opts);
        if (!c.current()) return;
        const top = ranked[0];
        if (top.gain > bestGain) bestGain = top.gain;
        if (top.checked === 'high') { c.apply(top, others[top.id], true, via); return; }
      }
    }
    say('timing: not changed (best gain ' + Math.max(0, bestGain).toFixed(2) + ' below ' + CHECKED.highGain.toFixed(2) + ')', via ? undefined : 'nochange');
  } catch (e) {
    try { c.decide('timing: not changed (failed)'); if (c.state) c.state('nochange'); } catch (e2) { /* nothing to say it to */ }
  }
}

export { alignChecked };

// ---- English made for the same release (0.7.1) ----

/** Two English files agree when the aligner says 'high' with the same time (300 ms) and no stretch. */
export function agrees(r) { return !!r && r.checked === 'high' && Math.abs(r.offset) <= 300 && Math.abs(r.ratio - 1) < 0.0005; }

/**
 * The English reference for a file with no hash match and no usable track: an English subtitle of the same group alone, else English subtitles of the same
 * source of which two agree (the first up to 4 are compared pairwise, in the worker); at most 5 files are fetched.
 * c: { english: [Subtitle], want: { source, group }, releaseOf(sub), fetchCues(sub) -> [{ start, end }] | null, compute(ref, cands) }.
 * Returns { cues, how: 'group' | 'source', source, group, agree } or null.
 */
export async function releaseReference(c) {
  const want = c.want || {};
  if (want.group) {
    const g = c.english.find((s) => c.releaseOf(s).group === want.group);
    if (g) {
      const cues = await c.fetchCues(g);
      if (cues && cues.length) return { cues, how: 'group', source: want.source || c.releaseOf(g).source, group: want.group, agree: 1 };
    }
  }
  if (!want.source) return null;
  const same = c.english.filter((s) => c.releaseOf(s).source === want.source).slice(0, 4);
  const loaded = [];
  const got = await Promise.all(same.map((s) => c.fetchCues(s)));
  got.forEach((cues) => { if (cues && cues.length) loaded.push(cues); });
  for (let i = 0; i + 1 < loaded.length; i++) {
    const cands = loaded.slice(i + 1).map((cues, j) => ({ id: j, cues }));
    const ranked = await c.compute(loaded[i], cands);
    if (ranked.some(agrees)) return { cues: loaded[i], how: 'source', source: want.source, group: null, agree: 2 };
  }
  return null;
}

// ---- the file's own English track, collected while playing (0.7.0) ----

/** The English text track to listen to, or null: not forced (flag or name), Signs / Songs only when nothing else, then the first in track order. */
export function pickEnglishTrack(textTracks) {
  const english = (textTracks || []).filter((t) => t && t.language === 'en' && !t.forced && !/forced/i.test(String(t.label || '')));
  const full = english.filter((t) => !/sign|song/i.test(String(t.label || '')));
  return (full.length ? full : english)[0] || null;
}

/** The English cues heard so far, as sorted { start, end } in media milliseconds; the same cue twice (same start within 100 ms) counts once. */
export function createCollector() {
  const cues = [];
  return {
    add(start, end) {
      if (!isFinite(start) || !isFinite(end) || end <= start || start < 0) return false;
      let i = cues.length;
      while (i > 0 && cues[i - 1].start > start) i--;
      if ((i > 0 && Math.abs(cues[i - 1].start - start) < 100) || (i < cues.length && Math.abs(cues[i].start - start) < 100)) return false;
      cues.splice(i, 0, { start: Math.round(start), end: Math.round(end) });
      return true;
    },
    list() { return cues.slice(); },
    count() { return cues.length; },
    span() { return cues.length ? cues[cues.length - 1].end - cues[0].start : 0; },
    clear() { cues.length = 0; },
  };
}

/** The measured rules of the live fit (GENERATION_PLAN 1.12): all milliseconds of media time except the counts and the ratio. */
export const LIVE = { minSpan: 120000, minCues: 20, offsetOnlyBelow: 600000, firstEvery: 60000, laterEvery: 120000, agreeOffset: 300, agreeRatio: 0.0003, stopAfterApply: 900000, giveUp: 1800000 };

/**
 * The fitting of the collected English against the Turkish cues. tick(position) is called every few seconds; a fit runs every 60 s of playback
 * (120 s once applied) from 120 s / 20 cues of English on; offset only (ratio 1) while the collected span is under 600 s. A fit applies only when it and
 * the one before are both 'high' and agree (300 ms, ratio 0.0003); once applied, a later agreeing pair that differs from the applied one by more than 300 ms
 * applies again (a cut). It stops 15 minutes after the first apply, or 30 minutes after the start with nothing applied.
 * deps: collector, target() -> Turkish cues, compute(ref, cands, opts), apply(fit, again), finish(reason, { applied, count, last }).
 */
export function createLiveFit({ collector, target, compute, apply, finish }) {
  let token = 0;
  let prev = null;
  let applied = null;
  let firstApplyAt = null;
  let startedAt = null;
  let lastAt = null;
  let busy = false;
  let stopped = false;
  let last = null;
  const near = (a, b) => Math.abs(a.offset - b.offset) <= LIVE.agreeOffset && Math.abs(a.ratio - b.ratio) <= LIVE.agreeRatio;
  const stop = (reason) => { if (stopped) return; stopped = true; token++; if (finish) finish(reason, { applied, count: collector.count(), last }); };
  return {
    /** Forget the fits (a new Turkish file, a new run); the collected English stays with the collector. */
    reset() { token++; prev = null; applied = null; firstApplyAt = null; startedAt = null; lastAt = null; busy = false; stopped = false; last = null; },
    stop,
    get last() { return last; },
    get applied() { return applied; },
    get stopped() { return stopped; },
    async tick(pos) {
      if (stopped || busy) return;
      if (startedAt === null) startedAt = pos;
      if (applied && Math.abs(pos - firstApplyAt) >= LIVE.stopAfterApply) { stop('done'); return; }
      if (!applied && Math.abs(pos - startedAt) >= LIVE.giveUp) { stop('giveup'); return; }
      if (collector.span() < LIVE.minSpan || collector.count() < LIVE.minCues) return;
      if (lastAt !== null && Math.abs(pos - lastAt) < (applied ? LIVE.laterEvery : LIVE.firstEvery)) return;
      lastAt = pos;
      busy = true;
      const mine = token;
      let res = null;
      try { res = (await compute(collector.list(), [{ id: 'live', cues: target() }], collector.span() < LIVE.offsetOnlyBelow ? { ratios: [1] } : undefined))[0]; } catch (e) { res = null; }
      if (mine !== token) return;
      busy = false;
      if (!res) return;
      last = res;
      const agree = prev && prev.checked === 'high' && res.checked === 'high' && near(prev, res);
      prev = res;
      if (!agree) return;
      if (!applied) { applied = res; firstApplyAt = pos; apply(res, false); }
      else if (!near(applied, res)) { applied = res; apply(res, true); }
    },
  };
}
