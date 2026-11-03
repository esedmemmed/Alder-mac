/*
 * Posters and backgrounds (port of Alder's Images.kt): loaded a few at a time, the newest request first, kept in
 * memory as "already loaded", and asked for at the size the screen shows.
 *
 * Alder decodes on background threads and keeps bitmaps in LruCaches. Here the browser decodes and caches, so what is
 * ported is what decides which picture loads when:
 *  - lanes: normal (6 at a time: PLAN.md's budget for the TV), urgent (the picture that fills the screen right now,
 *    a logo; its own 2 slots so it never waits behind a row of cards) and ahead (prefetch for where the remote may
 *    go next; 2 slots)
 *  - newest first (LIFO): after racing along a row, the cards the remote stopped on load before the ones it passed,
 *    which by then mostly want a different picture and are skipped (Images.newestFirst)
 *  - one load per URL however many elements ask (Images.inFlight)
 *  - a request whose element has moved on (scrolled away, another title) is dropped when its turn comes
 */
import { devRewrite, fixtureOrigin } from './http.js';

const TMDB = /(image\.tmdb\.org\/t\/p\/)(original|w1280)\//;
const METAHUB = /(images\.metahub\.space\/(?:poster|background)\/)(small|medium)\//;

/** Logos straight from MetaHub (Stremio's image server) by IMDb id, so a card's logo doesn't wait for its details. */
export function logoFor(id) {
  return typeof id === 'string' && id.indexOf('tt') === 0 ? 'https://images.metahub.space/logo/medium/' + id.split(':')[0] + '/img' : null;
}

/** The 16:9 art MetaHub keeps for an IMDb title, for places that have no art of their own. */
export function backgroundFor(id) {
  return typeof id === 'string' && id.indexOf('tt') === 0 ? 'https://images.metahub.space/background/large/' + id.split(':')[0] + '/img' : null;
}

/**
 * MetaHub serves small, medium and large copies, and Stremio's catalogs and library point at the small poster (about
 * 150 px) and medium background (about 1000 px): soft on a TV once stretched. Alder asks for the large copy always
 * (its TV has the memory for it); on this TV the copy follows the width it is shown at, which keeps PLAN.md's
 * "small/medium" budget: up to 150 px as given, up to 1280 px medium (a 176 px poster card gets medium), wider
 * large (full-screen art only). See DECISIONS.md.
 */
export function sharp(url, widthPx = 0) {
  return url.replace(METAHUB, (m, head, size) => head + (widthPx > 1280 ? 'large' : widthPx > 150 ? 'medium' : size) + '/');
}

/** TMDB serves every picture in a few widths: a card needs the 780 px copy, not the 4K original (a tenth of the bytes). */
export function sized(url, widthPx) {
  if (widthPx > 1280) return sharp(url, widthPx);
  const size = widthPx <= 780 ? 'w780' : 'w1280';
  return sharp(url, widthPx).replace(TMDB, '$1' + size + '/');
}

export function createImageLoader({
  normal = 6, urgent = 2, ahead = 2, createImage = () => new Image(), rewrite = null,
  timeoutMs = 20000, maxLoaded = 400, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
} = {}) {
  const lanes = {
    normal: { max: normal, running: 0, queue: [] },
    urgent: { max: urgent, running: 0, queue: [] },
    ahead: { max: ahead, running: 0, queue: [] },
  };
  const wants = new WeakMap();     // element -> the URL it currently wants
  const loaded = new Set();        // resolved URLs known to be in the browser's cache, oldest first
  const inFlight = new Map();      // resolved URL -> Promise<boolean>

  const resolve = (url) => (rewrite ? rewrite(url) : url);

  function remember(src) {
    loaded.delete(src);
    loaded.add(src);
    if (loaded.size > maxLoaded) loaded.delete(loaded.values().next().value);
  }

  /** Downloads and decodes [src] once. Resolves true when it is usable. */
  function fetchOnce(src) {
    if (inFlight.has(src)) return inFlight.get(src);
    const p = new Promise((done) => {
      const pic = createImage();
      let finished = false;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        timers.clearTimeout(timer);
        pic.onload = pic.onerror = null;
        if (ok) remember(src);
        done(ok);
      };
      const timer = timers.setTimeout(() => finish(false), timeoutMs);
      pic.onload = () => {
        // decode() (M64) moves the decode off the frame that first shows the picture, as Alder decodes straight to GPU.
        if (typeof pic.decode === 'function') pic.decode().then(() => finish(true), () => finish(true));
        else finish(true);
      };
      pic.onerror = () => finish(false);
      pic.src = src;
    });
    inFlight.set(src, p);
    const clear = () => inFlight.delete(src);
    p.then(clear, clear);
    return p;
  }

  function pump(lane) {
    while (lane.running < lane.max && lane.queue.length) {
      const job = lane.queue.shift(); // newest first: jobs are unshifted in
      if (job.el && wants.get(job.el) !== job.url) continue; // the view moved on while this waited
      lane.running++;
      job.run().then(() => { lane.running--; pump(lane); }, () => { lane.running--; pump(lane); });
    }
  }

  function enqueue(laneName, job) {
    const lane = lanes[laneName];
    lane.queue.unshift(job);
    pump(lane);
  }

  const api = {
    /**
     * Shows [url] in <img> [el]. opts: urgent (own lane), orElse (shown instead when [url] is missing or fails),
     * onDone() once it is showing (immediately when cached), onFail() when there is nothing to show.
     */
    load(el, url, opts = {}) {
      const { urgent: isUrgent = false, orElse = null, onDone = null, onFail = null } = opts;
      if (!url) {
        if (orElse) return api.load(el, orElse, { urgent: isUrgent, onDone, onFail });
        wants.delete(el);
        if (el.removeAttribute) el.removeAttribute('src');
        if (onFail) onFail();
        return;
      }
      wants.set(el, url);
      const src = resolve(url);
      if (loaded.has(src)) { el.src = src; remember(src); if (onDone) onDone(); return; }
      if (el.removeAttribute) el.removeAttribute('src');
      enqueue(isUrgent ? 'urgent' : 'normal', {
        el, url,
        run: () => fetchOnce(src).then((ok) => {
          if (wants.get(el) !== url) return; // moved on while downloading
          if (ok) { el.src = src; if (onDone) onDone(); }
          else if (orElse) api.load(el, orElse, { urgent: isUrgent, onDone, onFail });
          else { wants.delete(el); if (onFail) onFail(); }
        }),
      });
    },
    /** Fetches [url] ahead of time so the next card's art is ready the moment it is focused. */
    prefetch(url, { urgent: isUrgent = false } = {}) {
      if (!url) return;
      const src = resolve(url);
      if (loaded.has(src) || inFlight.has(src)) return;
      enqueue(isUrgent ? 'urgent' : 'ahead', { el: null, url, run: () => fetchOnce(src) });
    },
    /** The element no longer wants its picture (its card was unmounted). */
    cancel(el) { wants.delete(el); },
    cached(url) { return loaded.has(resolve(url)); },
    stats() {
      return { loaded: loaded.size, inFlight: inFlight.size,
        queued: lanes.normal.queue.length + lanes.urgent.queue.length + lanes.ahead.queue.length,
        running: { normal: lanes.normal.running, urgent: lanes.urgent.running, ahead: lanes.ahead.running } };
    },
  };
  return api;
}

let shared = null;
/** The app's loader: in a dev build, pictures come from the fixture server (placeholder art for any URL). */
export function appImages() {
  if (shared) return shared;
  const opts = {};
  if (typeof __ALDER_DEV__ !== 'undefined' && __ALDER_DEV__) { const origin = fixtureOrigin(); opts.rewrite = (u) => devRewrite(u, origin); }
  shared = createImageLoader(opts);
  return shared;
}
