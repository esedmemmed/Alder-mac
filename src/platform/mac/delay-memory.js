/*
 * Mac subtitle delay memory: the delay the viewer set (Z / X, the options stepper) is started again when the same release shows the same subtitle.
 * Wired by anchored patches in scripts/build.mjs (SUBTITLE_DELAY_MEMORY_PATCHES; the session hangs it on the memory as `memory.delays`); the Tizen
 * build never contains this file.
 *
 * What is kept: key `delay/<release>/<subtitle>`, value { ms } (a whole number, -10000..10000); 0 removes the key.
 *   release  = the file name (behaviorHints.filename), else the 1.4 signature (release-memory.js), else none: nothing is kept or applied.
 *   subtitle = file track `file:<lang>:<index>:<label>`; add-on `addon:<add-on name>:<id>`; an add-on subtitle without an id is not kept.
 * Never a link, host or token: a part that looks like one (`://`, `?`, `@`, a host name) is refused (a file name falls back to the signature,
 * a subtitle gives no key); `/` inside a part becomes `_`.
 * Each case is one line the engine hands to decide() and the shell's report (the Air's ui-report prints it):
 *   delay: applied <s> s   delay: remembered <s> s   delay: forgotten (back to 0)
 *   delay: not remembered (add-on subtitle without id)   delay: none (no release identity)
 * Safari 14: no lookbehind, no class fields. Nothing here sorts.
 */
import { macBridge } from './bridge.js';
import { signature } from './release-memory.js';

const LIMIT = 10000;
const URLISH = /:\/\/|\?|@|(?:^|[^a-z0-9])(?:www\.|[a-z0-9-]+\.(?:com|net|org|io|tv|me|cc|xyz|info|to)(?![a-z0-9]))/i;

const safe = (v) => (v === null || v === undefined ? '' : String(v).trim());
const part = (v) => { const s = safe(v); return s && !URLISH.test(s) ? s.replace(/\//g, '_') : null; };
const seconds = (ms) => (ms / 1000).toFixed(1);

function bridgeLog(line) {
  const b = macBridge();
  if (!b || !b.log) return;
  try { const p = b.log(line); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no shell */ }
}

/** The release's key part: its file name, else the 1.4 signature, else null. */
export function releaseKey(stream) {
  if (!stream) return null;
  const name = part(stream.filename || (stream.behaviorHints && stream.behaviorHints.filename));
  if (name) return name.toLowerCase();
  let sig = null;
  try { sig = signature({ title: stream.title, description: stream.description }); } catch (e) { sig = null; }
  return sig ? part(sig) : null;
}

/** The subtitle's key part: sel = { kind: 'file', track } | { kind: 'addon', sub }; null when it cannot be told apart. */
export function subtitleKey(sel) {
  if (!sel) return null;
  if (sel.kind === 'file') {
    const t = sel.track;
    if (!t) return null;
    const lang = part(t.language || '') || '';
    const label = part(t.label || t.title || t.name || '') || '';
    return 'file:' + lang + ':' + t.index + ':' + label;
  }
  if (sel.kind === 'addon') {
    const s = sel.sub;
    const name = s && part(s.addon);
    const id = s && part(s.id);
    return name && id ? 'addon:' + name + ':' + id : null;
  }
  return null;
}

/** store: the app's store (get / set / remove); report(line): the shell's log (default: the bridge). */
export function createDelayMemory(store, { report = bridgeLog } = {}) {
  const keyOf = (rel, sub) => 'delay/' + rel + '/' + sub;
  const mem = {
    get(rel, sub) {
      if (!rel || !sub) return 0;
      const v = store.get(keyOf(rel, sub));
      const ms = v && typeof v === 'object' ? Math.round(Number(v.ms)) : 0;
      return isFinite(ms) ? Math.max(-LIMIT, Math.min(LIMIT, ms)) : 0;
    },
    remember(rel, sub, ms) {
      if (!rel || !sub) return;
      const n = Math.max(-LIMIT, Math.min(LIMIT, Math.round(Number(ms)))) || 0;
      if (n === 0) store.remove(keyOf(rel, sub));
      else store.set(keyOf(rel, sub), { ms: n });
    },
    /** A new subtitle shows: { ms, line } (nothing kept: "none kept, 0.0 s"). Never stores. */
    apply(stream, sel) {
      const rel = releaseKey(stream);
      if (!rel) return { ms: 0, line: 'delay: none (no release identity)' };
      const sub = subtitleKey(sel);
      if (!sub) return { ms: 0, line: 'delay: not remembered (add-on subtitle without id)' };
      const ms = mem.get(rel, sub);
      return { ms, line: ms ? 'delay: applied ' + seconds(ms) + ' s' : 'delay: none kept, 0.0 s' };
    },
    /** A hand change: stores it; the line to say. */
    store(stream, sel, ms) {
      const rel = releaseKey(stream);
      if (!rel) return 'delay: none (no release identity)';
      const sub = subtitleKey(sel);
      if (!sub) return 'delay: not remembered (add-on subtitle without id)';
      mem.remember(rel, sub, ms);
      return Math.round(Number(ms)) ? 'delay: remembered ' + seconds(Math.max(-LIMIT, Math.min(LIMIT, Math.round(Number(ms))))) + ' s' : 'delay: forgotten (back to 0)';
    },
    report,
  };
  return mem;
}
