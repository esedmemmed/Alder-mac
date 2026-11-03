/*
 * The Mac player adapter, for the module swap in scripts/build.mjs (npm run build:mac): replaces src/player/avplay.js, so
 * the shared engine (failover, retries, resume, progress, picture size) runs unchanged. Same exports and same surface as
 * avplay.js, in Tizen's units (milliseconds) and states, over the native bridge (mac/web/bridge.js): mpv in the shell plays.
 *
 * How a Tizen call maps:
 *   open(url)      load over the bridge (the headers go to mpv whole), observe the properties below; no promise, like AVPlay
 *   prepare()      resolves at the first playbackRestart (the file is loaded and rendering), then pauses: mpv starts playing at
 *                  once, AVPlay waits for play(), and the engine decides audio and subtitles in between
 *   play / pause   pause {paused}; stop() and close() pause too (the wire has no unload)
 *   seekTo(ms)     seek {seconds}
 *   buffering      paused-for-cache -> onBufferingStart / onBufferingComplete, cache-buffering-state -> onBufferingProgress
 *   onTime         time-pos, onCompleted: endFile eof, onError: endFile error (ERROR_TABLE)
 *   tracks         track-list -> getTotalTrackInfo's shape ({ index (per type, from 0), type, extra_info: JSON }), so audio.js,
 *                  tracks.js and picture.js read them as they read AVPlay's
 * Bridge events never carry a link; error text is stripped of links here as well.
 */

import { macBridge } from './bridge.js';

/** The page is always laid out 1920 x 1080 (the shell scales it); kept for the shared name. */
export const SCREEN = Object.freeze({ width: 1920, height: 1080 });

/** Fit: the whole frame, never cropped (mpv panscan 0). */
export const FIT_METHOD = 'panscan 0';
const FILL_METHOD = 'panscan 1'; // Fill: scaled until the window is covered, the overflow cropped, never stretched

/** mpv crops with panscan, so Fill is always on offer. */
export const FILL_ENABLED = true;
export function fillOffered() { return true; }

/** The text of whatever a bridge call threw or an error event carried, preferring a PLAYER_ERROR_ name. Same as avplay.js. */
export function errorCode(e) {
  if (e === null || e === undefined) return 'UNKNOWN';
  if (typeof e === 'string') return e;
  const message = e.message ? String(e.message) : '';
  const named = /PLAYER_ERROR_[A-Z_]+/.exec(message);
  if (named) return named[0];
  if (e.name && e.name !== 'Error') return e.name + (message ? ': ' + message : '');
  return message || String(e);
}

/** mpv takes every request header (the shell passes them on), so none is unsupported. */
export function splitHeaders(headers) {
  const supported = {};
  Object.keys(headers || {}).forEach((name) => { supported[name] = String(headers[name]); });
  return { supported, unsupported: [] };
}

/** There is no AVPlay <object> on the Mac: mpv draws on the layer behind the transparent page. */
export function attachVideoObject() { return null; }

/** Same rule as the bridge and the shell: scheme://... and ?query never leave the adapter. */
export function stripUrls(text) {
  return String(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '[link]').replace(/\?[^\s"'<>]+/g, '?[query]');
}

const CONNECTION_FAILED = 'PLAYER_ERROR_CONNECTION_FAILED';
const NOT_SUPPORTED = 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT';

/**
 * mpv's endFile error text (ffmpeg's wording, with mpv's own) -> the AVPlay code the engine acts on. First match wins.
 * `http`: the row carries the status (capture 1), sent first as PLAYER_MSG_HTTP_ERROR_CODE (engine.js reads \d{3} from it) so
 * the engine can tell a dead link (4xx, not retried) from a blip (5xx, retried). CONNECTION_FAILED is the only retryable code;
 * NOT_SUPPORTED_FORMAT is the decode error that drops the audio track in use. Anything unlisted is UNKNOWN: not retried, not
 * a track's fault, so the next source is tried.
 */
export const ERROR_TABLE = [
  { name: 'HTTP 4xx/5xx', re: /(?:HTTP error|Server returned|HTTP status|status code)\D{0,3}([45]\d\d)\b/i, code: CONNECTION_FAILED, http: true },
  { name: 'host unreachable', re: /could not resolve|name or service not known|nodename nor servname|no route to host|network is unreachable|host is down|unreachable/i, code: CONNECTION_FAILED },
  { name: 'connection refused', re: /connection refused|connection reset|broken pipe|failed to connect|could not connect/i, code: CONNECTION_FAILED },
  { name: 'timeout', re: /timed out|timeout/i, code: CONNECTION_FAILED },
  { name: 'unrecognized format', re: /unrecogni[sz]ed file format|failed to recogni[sz]e file format|invalid data found|moov atom not found|unsupported/i, code: NOT_SUPPORTED },
  { name: 'no streams', re: /no video or audio streams|no (?:audio|video) streams?|nothing to play/i, code: NOT_SUPPORTED },
  { name: 'decoder failure', re: /decod(?:er|ing)|could not open codec|failed to initiali[sz]e (?:audio|video)/i, code: NOT_SUPPORTED },
];

/** -> { code, status (0 when none), text (links stripped) } */
export function mapError(message) {
  const text = stripUrls(message === undefined || message === null ? '' : message);
  for (const row of ERROR_TABLE) {
    const m = row.re.exec(text);
    if (m) return { code: row.code, status: row.http ? Number(m[1]) : 0, text };
  }
  return { code: 'PLAYER_ERROR_UNKNOWN', status: 0, text };
}

const OBSERVED = ['time-pos', 'duration', 'pause', 'paused-for-cache', 'cache-buffering-state', 'track-list', 'aid', 'sid', 'video-params'];
const observedBridges = new WeakSet(); // observe once per bridge: a second observe could double every event

const TYPES = { video: 'VIDEO', audio: 'AUDIO', sub: 'TEXT' };

/**
 * mpv's audio codec (+ codec-profile) -> one name audio.js classifyCodecId reads: DTS-HD MA/HRA and DTS:X are mpv codec 'dts' with
 * the flavour in the profile, TrueHD (Atmos too) is 'truehd'. Anything else passes through as mpv names it.
 */
export function audioCodecName(codec, profile) {
  const c = String(codec || '').toLowerCase();
  const p = String(profile || '').toLowerCase();
  if (c === 'dts') {
    if (/dts[ :._-]?x/.test(p)) return 'dts:x';
    if (/hd|ma|hra/.test(p)) return 'dts-hd';
    return 'dts';
  }
  if (c === 'truehd' || c === 'mlp') return 'truehd';
  if (c === 'eac3' || c === 'ac3' || c === 'aac') return c;
  if (/^pcm_/.test(c)) return 'pcm';
  return c;
}

/**
 * createAvplay({ bridge, log, fill })
 *   bridge   the page's alder bridge (default: platform/mac/bridge.js macBridge()); tests pass one on the mock
 *   log      the app logger: log.info('mpv', message)
 *   fill     ignored (Fill is always offered); kept so callers need not differ
 */
export function createAvplay({ bridge = null, log = null } = {}) {
  let b = bridge;
  let session = 0; // each open() starts a new one: events of an earlier one are dropped
  let handlers = {};
  let off = [];
  let cache = {};
  let ready = false; // playbackRestart seen: the file is loaded
  let opened = false;
  let paused = true;
  let panscan = 0;
  let wasPlaying = false;
  let resolveReady = null;
  let rejectReady = null;
  let readyPromise = null;
  let lastOpen = null; // { url, headers } of the session open now, for reload()

  const say = (message) => { if (log) log.info('mpv', message); };
  const send = (label, promise) => { Promise.resolve(promise).catch((e) => say(label + ' failed: ' + stripUrls(errorCode(e)))); };
  const bridgeOrThrow = () => {
    if (!b) b = macBridge();
    if (!b) throw new Error('the native bridge is not available');
    return b;
  };
  const call = (name, ...args) => handlers[name] && handlers[name](...args);

  function unlisten() { off.forEach((fn) => fn()); off = []; }

  /** Tizen-shaped track list from mpv's track-list. Per-type indexes from 0; ids[type][index] is mpv's id. */
  function tracks() {
    const list = Array.isArray(cache['track-list']) ? cache['track-list'] : [];
    const params = cache['video-params'] || {};
    const counters = { VIDEO: 0, AUDIO: 0, TEXT: 0 };
    const ids = { VIDEO: [], AUDIO: [], TEXT: [] };
    const out = [];
    list.forEach((t) => {
      const type = TYPES[t.type];
      if (!type) return;
      if (type === 'TEXT' && t.external) return; // add-on subtitles (addSubtitle) are the engine's own list, not the file's
      const index = counters[type]++;
      ids[type].push(t.id);
      let info;
      if (type === 'VIDEO') {
        info = { Width: String(t.selected && params.w ? params.w : t['demux-w'] || 0), Height: String(t.selected && params.h ? params.h : t['demux-h'] || 0), fourCC: String(t.codec || '') };
        if (t.selected && Number.isFinite(params.par) && params.par > 0 && params.par !== 1) info.pixel_aspect_ratio = String(params.par);
      } else if (type === 'AUDIO') {
        info = { language: t.lang || 'und', channels: String(Number.isFinite(t['audio-channels']) ? t['audio-channels'] : 2), fourCC: audioCodecName(t.codec, t['codec-profile']), name: t.title || '' };
      } else {
        info = { track_lang: t.lang || 'und', track_name: (t.title || '') + (t.forced ? ' (forced)' : '') };
      }
      out.push({ index, type, extra_info: JSON.stringify(info), selected: !!t.selected });
    });
    return { out, ids };
  }

  function failOpen(code, text, status) {
    if (status) call('onEvent', 'PLAYER_MSG_HTTP_ERROR_CODE', String(status));
    if (!ready && rejectReady) { const reject = rejectReady; resolveReady = rejectReady = null; reject(new Error(code)); return; }
    call('onError', code, text);
  }

  function onProp(e, mine) {
    if (mine !== session) return;
    const was = cache[e.name];
    cache[e.name] = e.value;
    if (e.name === 'time-pos' && Number.isFinite(e.value)) call('onTime', Math.round(e.value * 1000));
    else if (e.name === 'pause') paused = !!e.value;
    else if (e.name === 'paused-for-cache') {
      if (e.value === true && was !== true) call('onBufferingStart');
      else if (e.value === false && was === true) call('onBufferingComplete');
    } else if (e.name === 'cache-buffering-state' && Number.isFinite(e.value)) call('onBufferingProgress', Number(e.value));
  }

  function onRestart(mine) {
    if (mine !== session || ready) return;
    ready = true;
    // mpv plays at once: hold it until the engine has chosen the tracks and says play()
    paused = true;
    const done = resolveReady;
    resolveReady = rejectReady = null;
    Promise.resolve(b.pause(true)).catch(() => {}).then(() => { if (mine === session && done) done(); });
  }

  function onEnd(e, mine) {
    if (mine !== session) return;
    if (e.reason === 'eof') { call('onCompleted'); return; }
    if (e.reason !== 'error') return; // stop, quit, redirect: our own doing or not an end
    const m = mapError(e.message);
    say('endFile error: ' + m.text);
    failOpen(m.code, m.text, m.status);
  }

  const api = {
    get available() { return !!(b || macBridge()); },

    /** 'NONE' (no session), 'IDLE' (loading), 'PLAYING', 'PAUSED'. */
    state() {
      if (!opened) return 'NONE';
      if (!ready) return 'IDLE';
      return paused ? 'PAUSED' : 'PLAYING';
    },

    /**
     * Starts a new session on [url] (handlers as avplay.js: onBufferingStart, onBufferingProgress(percent), onBufferingComplete,
     * onTime(ms), onCompleted, onError(code, text), onEvent(id, data)). A load the shell refuses rejects prepare().
     * Returns { unsupportedHeaders } (always empty).
     */
    open(url, { headers = null } = {}, h = {}) {
      api.close();
      const br = bridgeOrThrow();
      const mine = ++session;
      handlers = h;
      lastOpen = { url, headers: headers && Object.keys(headers).length ? headers : undefined };
      cache = {};
      ready = false;
      opened = true;
      paused = true;
      readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      readyPromise.catch(() => {}); // prepare() may never be called
      off = [
        br.on('prop', (e) => onProp(e, mine)),
        br.on('playbackRestart', () => onRestart(mine)),
        br.on('endFile', (e) => onEnd(e, mine)),
      ];
      if (!observedBridges.has(br)) { observedBridges.add(br); send('observe', br.observe(OBSERVED)); }
      br.load(url, { headers: headers && Object.keys(headers).length ? headers : undefined }).catch((e) => {
        if (mine !== session) return;
        const m = mapError(errorCode(e));
        failOpen(m.code, m.text, m.status);
      });
      return { unsupportedHeaders: [] };
    },

    get fillSupported() { return true; },

    /**
     * Fit (panscan 0) or Fill (panscan 1.0) for the session open now. Fill is the whole window covered and the overflow
     * cropped; it needs the file's shape (picture.js parseVideoShape, handed in by the engine) to say what is cut, and a file
     * that does not say its shape stays Fit. Returns { mode, method, roi: null (mpv crops itself), reason }.
     */
    setPicture(mode, shape) {
      const set = (value) => {
        if (value !== panscan) { panscan = value; send('panscan', bridgeOrThrow().setProp('panscan', value)); }
      };
      if (mode !== 'fill') { set(0); return { mode: 'fit', method: FIT_METHOD, roi: null, reason: '' }; }
      if (!shape) { set(0); return { mode: 'fit', method: FIT_METHOD, roi: null, reason: "this file doesn't say its shape" }; }
      set(1.0);
      say('panscan 1');
      return { mode: 'fill', method: FILL_METHOD, roi: null, reason: '' };
    },

    /** Resolves when the file is loaded and held paused, rejects with the error code (PLAYER_ERROR_...). */
    prepare() {
      return readyPromise || Promise.reject(new Error('PLAYER_ERROR_INVALID_STATE'));
    },

    play() {
      if (!opened) return false;
      paused = false;
      send('play', bridgeOrThrow().pause(false));
      return true;
    },
    pause() {
      if (api.state() !== 'PLAYING') return false;
      paused = true;
      send('pause', bridgeOrThrow().pause(true));
      return true;
    },
    stop() {
      if (!opened) return false;
      paused = true;
      send('stop', bridgeOrThrow().pause(true));
      return true;
    },

    /** The session ends first, so nothing mpv still delivers for it reaches anyone; the picture is paused (the wire has no unload). */
    close() {
      session++;
      unlisten();
      if (resolveReady || rejectReady) { resolveReady = rejectReady = null; }
      if (opened && b) send('close', b.pause(true));
      opened = false;
      ready = false;
      cache = {};
    },

    /** seek as a promise: resolves when the shell took the command, rejects (PLAYER_ERROR_SEEK_FAILED) when it did not. Never settles if the session closes first. */
    seekTo(ms) {
      const mine = session;
      return new Promise((resolve, reject) => {
        let p;
        try { p = bridgeOrThrow().seek(Math.max(0, Math.round(ms)) / 1000); } catch (e) { reject(e); return; }
        p.then(() => { if (mine === session) resolve(); }, () => { if (mine === session) reject(new Error('PLAYER_ERROR_SEEK_FAILED')); });
      });
    },

    /** Current time in ms, or null while mpv has none. */
    time() { return ready && Number.isFinite(cache['time-pos']) ? Math.round(cache['time-pos'] * 1000) : null; },
    duration() { return Number.isFinite(cache.duration) && cache.duration > 0 ? Math.round(cache.duration * 1000) : 0; },

    /** Live streams have no length. */
    isLive() { return ready && !(Number.isFinite(cache.duration) && cache.duration > 0); },

    totalTracks() { return tracks().out.map((t) => ({ index: t.index, type: t.type, extra_info: t.extra_info })); },
    currentStreams() { return tracks().out.filter((t) => t.selected).map((t) => ({ index: t.index, type: t.type, extra_info: t.extra_info })); },
    currentIndex(type) {
      const found = api.currentStreams().find((s) => s.type === type);
      return found ? found.index : null;
    },

    selectTrack(type, index) {
      const id = (tracks().ids[type] || [])[index];
      if (id === undefined) return false;
      say('select ' + type + ' ' + index);
      send('select ' + type, bridgeOrThrow().setProp(type === 'TEXT' ? 'sid' : 'aid', id));
      return true;
    },

    /**
     * An add-on subtitle: the page fetched [text] (the shell never fetches), mpv adds it and selects it (bridge subAdd, native
     * `sub-add <file> select <title> <lang>`). sub = { language, addon } as the engine has it. Not in totalTracks().
     */
    addSubtitle(text, sub) {
      const s = sub || {};
      if (!text) return false;
      send('subAdd', bridgeOrThrow().subAdd(String(text), s.language || '', [s.language, s.addon].filter(Boolean).join(' - ')));
      return true;
    },

    /** Output volume 0..100 (the player's volume keys and buttons). The wire has no `mute`: mute is 0 here, the level is kept by the caller. */
    setVolume(v) {
      send('volume', bridgeOrThrow().setProp('volume', Math.max(0, Math.min(100, Math.round(v)))));
      return true;
    },

    /** The file's own subtitles: mpv draws them (sub-visibility). */
    subtitlesOn(on) {
      send('sub-visibility', bridgeOrThrow().setProp('sub-visibility', !!on));
      return true;
    },

    /**
     * The audio device changed (headphones out, AirPods in): load the same file again at [ms] so mpv opens the new device. Playing
     * stays playing, paused stays paused, the audio track is kept. False when nothing is loaded. The engine never notices: same session.
     */
    reload(ms) {
      if (!opened || !ready || !lastOpen) return false;
      const mine = session;
      const playing = api.state() === 'PLAYING';
      const aid = cache.aid;
      ready = false;
      paused = true;
      readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      readyPromise.then(() => {
        if (mine !== session) return;
        if (Number.isFinite(aid)) send('aid', bridgeOrThrow().setProp('aid', aid));
        if (playing) api.play();
      }, (e) => { if (mine === session) call('onError', e.message, e.message); });
      const start = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
      bridgeOrThrow().load(lastOpen.url, { headers: lastOpen.headers, start }).catch((e) => {
        if (mine !== session) return;
        const m = mapError(errorCode(e));
        failOpen(m.code, m.text, m.status);
      });
      return true;
    },

    /** Suspend pauses (remembering whether it was playing); restore puts it back as it was found. */
    suspend() {
      wasPlaying = api.state() === 'PLAYING';
      paused = true;
      send('suspend', bridgeOrThrow().pause(true));
      return true;
    },
    restore() {
      if (wasPlaying) { paused = false; send('restore', bridgeOrThrow().pause(false)); }
      wasPlaying = false;
      return true;
    },
  };
  return api;
}
