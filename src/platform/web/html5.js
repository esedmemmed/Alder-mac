/*
 * The web player adapter, for the module swap in scripts/build.mjs (npm run build:web): replaces src/player/avplay.js with the
 * same exports and the same surface, in AVPlay's units (milliseconds) and states, over one <video> element in the browser.
 *
 * How an AVPlay call maps:
 *   open(url)      src on the <video>; no promise, like AVPlay. Request headers cannot be set on a <video>: they are reported the way
 *                  the TV reports headers AVPlay cannot send (the returned { unsupportedHeaders } and a log line); the source is still tried
 *   prepare()      resolves at loadedmetadata (the file's length and tracks are known), rejects with the error code
 *   play / pause   video.play() / video.pause(); stop() pauses; close() empties the element
 *   seekTo(ms)     currentTime, resolves at 'seeked'
 *   buffering      waiting -> onBufferingStart, playing (or canplay) -> onBufferingComplete
 *   onTime         timeupdate, and a 250 ms timer while playing; onCompleted: ended
 *   onError        MediaError 2 (network) -> PLAYER_ERROR_CONNECTION_FAILED, 3 (decode) and 4 (not supported) ->
 *                  PLAYER_ERROR_NOT_SUPPORTED_FORMAT, 1 (aborted) -> PLAYER_ERROR_UNKNOWN
 *   tracks         video.audioTracks where the browser has it (Safari), else one audio track 'und'; no text tracks (a browser
 *                  cannot read a file's text tracks), so the engine's own subtitle overlay is used; no setSubDelay, no addSubtitle
 * The <video> sits full-window behind the page (z-index -1 on the <html> element: the body is scaled by platform/mac/layout.js, so
 * the video is not inside it); the shared player screen makes the page transparent (html.av-live) wherever the picture shows.
 */

/** Kept for the shared name: the page is laid out 1920 x 1080 and scaled to the window. */
export const SCREEN = Object.freeze({ width: 1920, height: 1080 });

/** Fit: the whole frame, never cropped. */
export const FIT_METHOD = 'object-fit: contain';
const FILL_METHOD = 'object-fit: cover'; // Fill: the window covered, the overflow cropped, never stretched

/** CSS object-fit crops, so Fill is always on offer. */
export const FILL_ENABLED = true;
export function fillOffered() { return true; }

/** The text of whatever a call threw or an error event carried, preferring a PLAYER_ERROR_ name. Same as avplay.js. */
export function errorCode(e) {
  if (e === null || e === undefined) return 'UNKNOWN';
  if (typeof e === 'string') return e;
  const message = e.message ? String(e.message) : '';
  const named = /PLAYER_ERROR_[A-Z_]+/.exec(message);
  if (named) return named[0];
  if (e.name && e.name !== 'Error') return e.name + (message ? ': ' + message : '');
  return message || String(e);
}

/** A <video> can set no request header at all: every one is unsupported. */
export function splitHeaders(headers) {
  return { supported: {}, unsupported: Object.keys(headers || {}) };
}

/** scheme://... and ?query never reach a log line. */
export function stripUrls(text) {
  return String(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '[link]').replace(/\?[^\s"'<>]+/g, '?[query]');
}

const CONNECTION_FAILED = 'PLAYER_ERROR_CONNECTION_FAILED';
const NOT_SUPPORTED = 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT';

/** MediaError.code -> { code, text }. 2 network, 3 decode and 4 source not supported; 1 (aborted) and anything else is UNKNOWN. */
export function mapMediaError(err) {
  const n = err && Number(err.code);
  const text = 'MediaError ' + (n || '?') + (err && err.message ? ': ' + stripUrls(err.message) : '');
  if (n === 2) return { code: CONNECTION_FAILED, text };
  if (n === 3 || n === 4) return { code: NOT_SUPPORTED, text };
  return { code: 'PLAYER_ERROR_UNKNOWN', text };
}

let sharedVideo = null;

const STYLE = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;margin:0;padding:0;border:0;background:#000;object-fit:contain;pointer-events:none;display:none;';

function makeVideo(doc) {
  const v = doc.createElement('video');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('aria-hidden', 'true');
  v.setAttribute('class', 'av-video');
  v.controls = false;
  v.preload = 'auto';
  v.style.cssText = STYLE;
  return v;
}

/**
 * Puts the one <video> the player draws into on the <html> element, behind #app (the AVPlay <object> of avplay.js does the same job
 * on the TV). [host] is the player screen, unused here: a video inside the scaled body would be scaled with it.
 */
export function attachVideoObject(host, doc = document) {
  if (!sharedVideo) sharedVideo = makeVideo(doc);
  if (sharedVideo.parentNode !== doc.documentElement) doc.documentElement.appendChild(sharedVideo);
  return sharedVideo;
}

/**
 * createAvplay({ log, video, timers, fill })
 *   log     the app logger: log.info('html5', message)
 *   video   the <video> to drive (default: the shared one attachVideoObject placed); tests pass a fake
 *   timers  { setInterval, clearInterval } for the 250 ms time timer (default: the globals)
 *   fill    ignored (Fill is always offered)
 */
export function createAvplay({ log = null, video = null, timers = null } = {}) {
  const T = timers || { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (id) => clearInterval(id) };
  let session = 0; // each open() starts a new one: events of an earlier one are dropped
  let handlers = {};
  let off = [];
  let opened = false;
  let ready = false; // loadedmetadata seen
  let buffering = false;
  let wasPlaying = false;
  let fit = null; // the object-fit last written (null: none yet, so the first setPicture always writes)
  let timer = null;
  let resolveReady = null;
  let rejectReady = null;
  let readyPromise = null;

  const el = () => video || (video = sharedVideo || attachVideoObject(null));
  const say = (message) => { if (log) log.info('html5', message); };
  const call = (name, ...args) => handlers[name] && handlers[name](...args);
  const safe = (label, fn, fallback) => {
    try { return fn(); } catch (e) { say(label + ' failed: ' + stripUrls(errorCode(e))); return fallback; }
  };

  function listen(v, name, fn) {
    v.addEventListener(name, fn);
    off.push(() => v.removeEventListener(name, fn));
  }
  function unlisten() { off.forEach((fn) => fn()); off = []; }

  function stopTimer() { if (timer !== null) { T.clearInterval(timer); timer = null; } }
  function tickTime() {
    const v = el();
    if (ready && Number.isFinite(v.currentTime)) call('onTime', Math.round(v.currentTime * 1000));
  }
  function startTimer() { if (timer === null) timer = T.setInterval(tickTime, 250); }

  /** The audio tracks the browser lists (Safari's video.audioTracks), as plain objects; [] when it lists none. */
  function browserAudio() {
    const list = el().audioTracks;
    const out = [];
    if (list && Number.isFinite(list.length)) for (let i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  /** getTotalTrackInfo's shape: the video (its size, for Fill), then each audio track; 'und' alone when the browser lists none. */
  function tracks() {
    const v = el();
    const out = [];
    if (v.videoWidth > 0 && v.videoHeight > 0) out.push({ index: 0, type: 'VIDEO', extra_info: JSON.stringify({ Width: String(v.videoWidth), Height: String(v.videoHeight), fourCC: '' }) });
    const audio = browserAudio();
    if (audio.length) {
      audio.forEach((t, i) => out.push({ index: i, type: 'AUDIO', extra_info: JSON.stringify({ language: t.language || 'und', fourCC: '', name: t.label || '' }) }));
    } else {
      out.push({ index: 0, type: 'AUDIO', extra_info: JSON.stringify({ language: 'und', fourCC: '', name: '' }) });
    }
    return out;
  }

  function onMediaError(mine) {
    if (mine !== session) return;
    const m = mapMediaError(el().error);
    say('media error: ' + m.text);
    if (!ready && rejectReady) { const reject = rejectReady; resolveReady = rejectReady = null; reject(new Error(m.code)); return; }
    call('onError', m.code, m.text);
  }

  const api = {
    get available() { return true; },

    /** 'NONE' (no session), 'IDLE' (loading), 'PLAYING', 'PAUSED'. */
    state() {
      if (!opened) return 'NONE';
      if (!ready) return 'IDLE';
      return el().paused ? 'PAUSED' : 'PLAYING';
    },

    /**
     * Starts a new session on [url] (handlers as avplay.js: onBufferingStart, onBufferingComplete, onTime(ms), onCompleted,
     * onError(code, text)). A load the browser refuses rejects prepare(). Returns { unsupportedHeaders }: the request headers,
     * which a <video> cannot send (the source is tried anyway, like the TV's headers AVPlay cannot send).
     */
    open(url, { headers = null } = {}, h = {}) {
      api.close();
      const v = el();
      const mine = ++session;
      handlers = h;
      opened = true;
      ready = false;
      buffering = false;
      fit = null;
      readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      readyPromise.catch(() => {}); // prepare() may never be called
      listen(v, 'loadedmetadata', () => {
        if (mine !== session || ready) return;
        ready = true;
        const done = resolveReady;
        resolveReady = rejectReady = null;
        if (done) done();
      });
      listen(v, 'error', () => onMediaError(mine));
      listen(v, 'waiting', () => {
        if (mine !== session || buffering) return;
        buffering = true;
        call('onBufferingStart');
      });
      const unbuffer = () => {
        if (mine !== session || !buffering) return;
        buffering = false;
        call('onBufferingComplete');
      };
      listen(v, 'playing', () => { if (mine !== session) return; startTimer(); unbuffer(); });
      listen(v, 'canplay', unbuffer); // a seek while paused buffers too, and no 'playing' follows it
      listen(v, 'play', () => { if (mine === session) startTimer(); });
      listen(v, 'pause', () => { if (mine === session) stopTimer(); });
      listen(v, 'timeupdate', () => { if (mine === session) tickTime(); });
      listen(v, 'ended', () => { if (mine !== session) return; stopTimer(); call('onCompleted'); });
      v.style.display = '';
      v.src = url;
      const unsupported = splitHeaders(headers).unsupported;
      if (unsupported.length) say('request headers a browser cannot send, stream may not play: ' + unsupported.join(', '));
      return { unsupportedHeaders: unsupported };
    },

    get fillSupported() { return true; },

    /**
     * Fit (the whole frame) or Fill (the window covered, the overflow cropped) for the session open now. Fill needs the file's
     * shape (the engine hands it in); a file that does not say its shape stays Fit. Returns { mode, method, roi: null, reason }.
     */
    setPicture(mode, shape) {
      const set = (value) => {
        if (value !== fit) { fit = value; safe('object-fit', () => { el().style.objectFit = value; }); }
      };
      if (mode !== 'fill') { set('contain'); return { mode: 'fit', method: FIT_METHOD, roi: null, reason: '' }; }
      if (!shape) { set('contain'); return { mode: 'fit', method: FIT_METHOD, roi: null, reason: "this file doesn't say its shape" }; }
      set('cover');
      say('object-fit cover');
      return { mode: 'fill', method: FILL_METHOD, roi: null, reason: '' };
    },

    /** Resolves when the file's metadata is loaded, rejects with the error code (PLAYER_ERROR_...). */
    prepare() {
      return readyPromise || Promise.reject(new Error('PLAYER_ERROR_INVALID_STATE'));
    },

    play() {
      if (!opened) return false;
      return safe('play', () => {
        const p = el().play();
        if (p && typeof p.catch === 'function') p.catch((e) => say('play refused: ' + stripUrls(errorCode(e))));
        return true;
      }, false);
    },
    pause() { return api.state() === 'PLAYING' ? safe('pause', () => { el().pause(); return true; }, false) : false; },
    stop() { return opened ? safe('stop', () => { el().pause(); return true; }, false) : false; },

    /** The session ends first, so nothing the element still fires reaches anyone; the element is emptied and hidden. */
    close() {
      session++;
      unlisten();
      stopTimer();
      resolveReady = rejectReady = null;
      if (opened) {
        const v = el();
        safe('close', () => {
          v.pause();
          v.removeAttribute('src');
          if (typeof v.load === 'function') v.load();
          v.style.display = 'none';
        });
      }
      opened = false;
      ready = false;
      buffering = false;
    },

    /** seekTo as a promise: resolves at 'seeked', rejects (PLAYER_ERROR_SEEK_FAILED) when the element refuses. Never settles if the session closes first. */
    seekTo(ms) {
      const mine = session;
      return new Promise((resolve, reject) => {
        if (!opened || !ready) { reject(new Error('PLAYER_ERROR_SEEK_FAILED')); return; }
        const v = el();
        let remove = null;
        const done = () => { if (remove) remove(); if (mine === session) resolve(); };
        v.addEventListener('seeked', done);
        remove = () => v.removeEventListener('seeked', done);
        off.push(remove);
        try { v.currentTime = Math.max(0, Math.round(ms)) / 1000; } catch (e) { remove(); reject(new Error('PLAYER_ERROR_SEEK_FAILED')); }
      });
    },

    /** Current time in ms, or null before the metadata is there. */
    time() { return ready && Number.isFinite(el().currentTime) ? Math.round(el().currentTime * 1000) : null; },
    duration() { const d = el().duration; return opened && Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0; },

    /** Live streams have no length (duration Infinity). */
    isLive() { return ready && !(Number.isFinite(el().duration) && el().duration > 0); },

    totalTracks() { return opened ? tracks() : []; },
    currentStreams() {
      if (!opened) return [];
      const all = tracks();
      const audio = browserAudio();
      const at = audio.findIndex((t) => t && t.enabled);
      return all.filter((t) => t.type === 'VIDEO' || (t.type === 'AUDIO' && t.index === (at < 0 ? 0 : at)));
    },
    currentIndex(type) {
      const found = api.currentStreams().find((s) => s.type === type);
      return found ? found.index : null;
    },

    /** AUDIO: enables that one of video.audioTracks (and no other). Anything else, and a browser that lists no audio tracks: false. */
    selectTrack(type, index) {
      if (type !== 'AUDIO' || !opened) return false;
      const audio = browserAudio();
      if (!audio.length || !(index >= 0 && index < audio.length)) return false;
      say('select AUDIO ' + index);
      audio.forEach((t, i) => { t.enabled = i === index; });
      return true;
    },

    /** The file's own subtitles: a browser cannot read them, so there is nothing to switch. */
    subtitlesOn() { return true; },

    /** Output volume 0..100 (the player's volume keys and buttons use it where the Mac adapter has it too). */
    setVolume(v) {
      return safe('volume', () => { el().volume = Math.max(0, Math.min(100, Number(v))) / 100; return true; }, false);
    },

    /** Suspend pauses (remembering whether it was playing); restore puts it back as it was found. */
    suspend() {
      wasPlaying = api.state() === 'PLAYING';
      return opened ? safe('suspend', () => { el().pause(); return true; }, false) : false;
    },
    restore() {
      if (wasPlaying) api.play();
      wasPlaying = false;
      return true;
    },
  };
  return api;
}
