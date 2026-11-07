/*
 * Mac release memory: the source the viewer watched is led again, on a rewatch and for the next episode, even when it is outside the Mac's
 * auto-play filter (HEVC, 4K, > 30 fps: the profile's autoOk). The Tizen build keeps the shared createSourceMemory untouched; the Mac build
 * (build.mjs: SESSION_PATCHES, RANKING_PATCHES, ENGINE_MEMORY_PATCHES) wraps it with this.
 *
 * What is kept, per video id and per series id: the file name and bingeGroup (the shared memory's own keys) and a signature, the release's
 * group, resolution, source, codec and HDR with the episode markers and title left out, so another add-on's listing of the same release (no
 * file name) and the next episode's release (a different file name) both match. Never a link, a host, a header or a token.
 *
 * Match order, best first: file name (4), the video's signature (3), bingeGroup (2), the series' signature (1), none (0).
 * Each case is one decide() line on the Diagnostics screen and one `memory:` line to the shell's report (the Air's ui-report prints them):
 *   memory: found by=file|signature|group source=<n>      the remembered release is among the sources the player was given
 *   memory: not offered                                    something was remembered, no source matches it: the normal ranking
 *   memory: failed, falling back by=<how>                  the remembered source failed: the failover goes on as always
 *   memory: waiting for add-ons                            the sources page held the start for the other add-ons: the first answers had none of it (T8)
 * Safari 14: no lookbehind, no class fields. The sort stays stable (core/util.js); nothing here sorts.
 */
import { macBridge } from './bridge.js';

const sigKey = (videoId) => 'sources/sig:' + videoId;
const sigSeriesKey = (metaId) => 'sources/bsig:' + metaId;

const GROUP_NOISE = /^(dl|rip|ray|hd|web|mkv|mp4)$/;

/** The release's identity without the episode: "2160p|web|hevc|dv|grp", or null when the name says too little (fewer than two parts). */
export function signature(s) {
  const raw = s.filename || ((s.title || '') + ' ' + (s.description || '')).split('\n')[0] || '';
  const text = String(raw).toLowerCase().replace(/\.(mkv|mp4|avi|m4v|ts)$/, '').replace(/[\s_.]+/g, ' ');
  const parts = [];
  const res = /\b(2160|1080|720|576|480)p/.exec(text) || (/\b(4k|uhd)\b/.test(text) ? [0, '2160'] : null);
  if (res) parts.push(res[1] + 'p');
  if (/\bremux\b/.test(text)) parts.push('remux');
  else if (/blu ?ray|\bbd ?rip|\bbr ?rip/.test(text)) parts.push('bluray');
  else if (/web ?-?(dl|rip)|\bweb\b/.test(text)) parts.push('web');
  else if (/\bhdtv\b/.test(text)) parts.push('hdtv');
  if (/hevc|\b[xh] ?265\b/.test(text)) parts.push('hevc');
  else if (/\b[xh] ?264\b|\bavc\b/.test(text)) parts.push('avc');
  else if (/\bav1\b/.test(text)) parts.push('av1');
  if (/\b(dv|dovi|dolby ?vision)\b/.test(text)) parts.push('dv');
  else if (/\bhdr/.test(text)) parts.push('hdr');
  const g = /-([a-z0-9]+)$/.exec(text.trim());
  if (g && !GROUP_NOISE.test(g[1])) parts.push(g[1]);
  return parts.length >= 2 ? parts.join('|') : null;
}

const cleanReason = (r) => String(r).replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[link]').replace(/[\r\n]+/g, ' ').slice(0, 80);

function bridgeLog(line) {
  const b = macBridge();
  if (!b || !b.log) return;
  try { const p = b.log(line); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no shell */ }
}

/**
 * store: the app's store (get / set / remove); base: the shared createSourceMemory(store); report(line): the shell's log (default: the bridge).
 * Returns the shared memory's surface (file, binge, remember) plus level / match for the ranker and noteLoad / noteFailed for the engine.
 */
export function createReleaseMemory(store, base, { report = bridgeLog } = {}) {
  const read = (key) => { const v = store.get(key); return typeof v === 'string' ? v : null };
  const sigs = new WeakMap(); // stream -> signature, worked out once per stream (a sort asks many times)
  const sigOf = (s) => { if (!sigs.has(s)) sigs.set(s, signature(s)); return sigs.get(s); };
  const seen = new WeakSet(); // source lists already noted, one load line per list
  const failedNoted = new WeakSet();
  const LABEL = ['', 'signature', 'group', 'signature', 'file'];

  /** 4 file, 3 video signature, 2 group, 1 series signature, 0 none. */
  function level(videoId, metaId, s, file) {
    const f = file === undefined ? base.file(videoId) : file;
    if (f !== null && s.filename === f) return 4;
    const sig = sigOf(s);
    if (sig !== null && sig === read(sigKey(videoId))) return 3;
    const binge = base.binge(metaId);
    if (binge !== null && s.bingeGroup === binge) return 2;
    if (sig !== null && sig === read(sigSeriesKey(metaId))) return 1;
    return 0;
  }
  const how = (n) => LABEL[n];
  const anyRemembered = (videoId, metaId) => base.file(videoId) !== null || base.binge(metaId) !== null || read(sigKey(videoId)) !== null || read(sigSeriesKey(metaId)) !== null;

  return {
    file: base.file,
    binge: base.binge,
    level,
    match: (videoId, metaId, s) => how(level(videoId, metaId, s)) || null,

    /** The sources page asks (build.mjs FINDER_MEMORY_PATCHES): something is remembered for this video and none of the answers so far is it. */
    pending: (videoId, metaId, streams) => anyRemembered(videoId, metaId) && !streams.some(s => level(videoId, metaId, s) > 0),
    noteHeld() { report('memory: waiting for add-ons'); },

    /** Called by the player once a source shows a picture: the shared memory's file and group, and the signatures. */
    remember(videoId, metaId, s) {
      base.remember(videoId, metaId, s);
      const sig = sigOf(s);
      if (sig !== null) { store.set(sigKey(videoId), sig); store.set(sigSeriesKey(metaId), sig); } else { store.remove(sigKey(videoId)); store.remove(sigSeriesKey(metaId)); }
    },

    /** The first source of a list is about to open (engine load()): was the remembered release offered? Nothing remembered, nothing said. */
    noteLoad({ videoId, metaId, sources, at, picked = false, decide }) {
      if (picked || at !== 0 || seen.has(sources)) return;
      seen.add(sources);
      if (!anyRemembered(videoId, metaId)) return;
      let best = 0, index = -1;
      sources.forEach((s, i) => { const n = level(videoId, metaId, s); if (n > best) { best = n; index = i; } });
      if (best === 0) {
        decide('memory: remembered source not offered, normal ranking');
        report('memory: not offered');
        return;
      }
      decide('memory: remembered source found by ' + how(best) + ' (source ' + (index + 1) + '/' + sources.length + ')');
      report('memory: found by=' + how(best) + ' source=' + (index + 1));
    },

    /** The engine's next() ran: when the source that failed was the remembered one, say so once; the failover itself is untouched. */
    noteFailed({ videoId, metaId, sources, at, reason, picked = false, decide }) {
      if (picked || !sources[at] || failedNoted.has(sources)) return;
      const n = level(videoId, metaId, sources[at]);
      if (n === 0) return;
      failedNoted.add(sources);
      decide('memory: remembered source failed (' + cleanReason(reason) + '), falling back');
      report('memory: failed, falling back by=' + how(n));
    },
  };
}
