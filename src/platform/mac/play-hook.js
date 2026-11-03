/*
 * Play-check hook (1.3 T6). The only source is the shell's --page "index.html?play=<urlenc>[&play=<urlenc>][&fs=1]" (the air/ play
 * check): the UI never sets it. After startup the real player screen opens with those sources, in the engine's failover order, and
 * fs=1 asks the shell for fullscreen over the bridge. The links are the page's query, never logged or emitted here.
 */
import { macBridge } from './bridge.js';
import { macNoteFullscreen } from './lifecycle.js';

/** playRequest(search) -> { sources: [url], fullscreen }. Only http(s) values count; no `play` parameter is no request. */
export function playRequest(search) {
  const q = new URLSearchParams(search || '');
  const sources = q.getAll('play').filter((u) => /^https?:\/\/./i.test(u));
  return { sources, fullscreen: q.get('fs') === '1' };
}

/** installPlayHook({ router, win, bridge, log }) -> whether a play request was there. Call once, after the first screen is pushed. */
export function installPlayHook({ router, win = typeof window !== 'undefined' ? window : undefined, bridge = macBridge, log = null, noteFullscreen = macNoteFullscreen } = {}) {
  const req = playRequest(win && win.location ? win.location.search : '');
  if (!req.sources.length) return false;
  if (log) log.info('mac', 'play check: ' + req.sources.length + ' source(s)' + (req.fullscreen ? ', fullscreen' : ''));
  router.push('player', {
    type: 'movie', metaId: 'play-check', videoId: 'play-check', name: 'Play check',
    sources: req.sources.map((url) => ({ name: 'Play check', description: '', url, headers: {} })),
  });
  if (req.fullscreen) {
    const b = bridge();
    if (b) { noteFullscreen(true); b.fullscreen(true).catch(() => noteFullscreen(false)); } // the lifecycle must know, or the first F asks again
  }
  return true;
}
