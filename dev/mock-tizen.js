/*
 * A desktop stand-in for what Samsung's TV runtime gives a web app: `tizen.tvinputdevice`, `tizen.application`,
 * `webapis.productinfo`, `webapis.avinfo` and, above all, `webapis.avplay` (AVPlay), shaped after Samsung's API
 * reference (developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html):
 *
 *   states      NONE -> (open) IDLE -> (prepareAsync) READY -> (play) PLAYING <-> (pause) PAUSED; stop() -> IDLE; close() -> NONE
 *   methods     open close prepare prepareAsync play pause stop seekTo jumpForward jumpBackward getState getSubState
 *               getDuration getCurrentTime getTotalTrackInfo getCurrentStreamInfo setSelectTrack setDisplayRect
 *               setDisplayMethod setListener setStreamingProperty getStreamingProperty setSilentSubtitle
 *               setExternalSubtitlePath setSubtitlePosition setTimeoutForBuffering setBufferingParam setSpeed
 *               suspend restore restoreAsync getVersion getVideoSize getCodecInfo
 *   listener    onbufferingstart onbufferingprogress(percent) onbufferingcomplete oncurrentplaytime(ms)
 *               onstreamcompleted onevent(eventid, data) onerror(AVPlayError) onerrormsg onsubtitlechange(duration, text, type, attrs)
 *   tracks      getTotalTrackInfo() -> [{ index, type: 'VIDEO'|'AUDIO'|'TEXT', extra_info: '<JSON string>' }]
 *
 * It is a model, not a player: time advances on a clock (a fake one in tests, the real one in a browser, optionally
 * with a hidden <video> behind it), and what "plays" is decided by a per-URL scenario. See dev/README.md for the
 * scenario syntax. What it cannot know is what a real TU8000 reports: the exact `extra_info` fields and codec strings
 * (it varies them on purpose, see `style`), which AVPlay state errors are thrown versus ignored, and what happens when
 * an unsupported audio track is selected. Those are the things the first run on the TV has to confirm (docs/TV-TEST.md).
 */
import { realClock } from './fake-clock.js';

// ---------------------------------------------------------------------------------------------------------------
// tracks
// ---------------------------------------------------------------------------------------------------------------

/** Per codec: the strings an AVPlay `fourCC` might carry, by container style. Which one a real file gives is unknown. */
export const CODEC_STRINGS = {
  AAC: { matroska: 'A_AAC', mime: 'audio/mp4a-latm', fourcc: 'mp4a' },
  AC3: { matroska: 'A_AC3', mime: 'audio/ac3', fourcc: 'ac-3' },
  EAC3: { matroska: 'A_EAC3', mime: 'audio/eac3', fourcc: 'ec-3' },
  DTS: { matroska: 'A_DTS', mime: 'audio/vnd.dts', fourcc: 'dtsc' },
  DTSHD: { matroska: 'A_DTS', mime: 'audio/vnd.dts.hd', fourcc: 'dtsh' },
  TRUEHD: { matroska: 'A_TRUEHD', mime: 'audio/true-hd', fourcc: 'mlpa' },
  MP3: { matroska: 'A_MPEG/L3', mime: 'audio/mpeg', fourcc: 'mp3 ' },
  FLAC: { matroska: 'A_FLAC', mime: 'audio/flac', fourcc: 'fLaC' },
  OPUS: { matroska: 'A_OPUS', mime: 'audio/opus', fourcc: 'Opus' },
  VORBIS: { matroska: 'A_VORBIS', mime: 'audio/vorbis', fourcc: 'vorb' },
  PCM: { matroska: 'A_PCM/INT/LIT', mime: 'audio/raw', fourcc: 'sowt' },
  HEVC: { matroska: 'V_MPEGH/ISO/HEVC', mime: 'video/hevc', fourcc: 'hvc1' },
  H264: { matroska: 'V_MPEG4/ISO/AVC', mime: 'video/avc', fourcc: 'avc1' },
  AV1: { matroska: 'V_AV1', mime: 'video/av01', fourcc: 'av01' },
  VP9: { matroska: 'V_VP9', mime: 'video/x-vnd.on2.vp9', fourcc: 'vp09' },
  SRT: { matroska: 'S_TEXT/UTF8', mime: 'application/x-subrip', fourcc: 'srt' },
};

/** What a 2020 TU8000 decodes in hardware (PLAN.md section 5). Anything else plays silent. */
export const PLAYABLE_AUDIO = ['AAC', 'AC3', 'EAC3', 'MP3', 'FLAC', 'OPUS', 'VORBIS', 'PCM'];

const A = (codec, lang, channels, extra) => Object.assign({ type: 'AUDIO', codec, lang, channels }, extra);
const T = (lang) => ({ type: 'TEXT', codec: 'SRT', lang });

/** Named audio layouts. `default: true` marks the track the TV selects on its own (else the first audio track). */
export const TRACK_PRESETS = {
  eac3: [A('EAC3', 'eng', 6)],
  ac3: [A('AC3', 'eng', 6)],
  aac: [A('AAC', 'eng', 2)],
  dts: [A('DTS', 'eng', 6)],
  dtshd: [A('DTSHD', 'eng', 8)],
  truehd: [A('TRUEHD', 'eng', 8)],
  mixed: [A('DTS', 'eng', 6, { default: true }), A('AC3', 'eng', 6)],     // DTS is what the TV picks: it must switch
  mixed2: [A('AC3', 'eng', 6, { default: true }), A('DTS', 'eng', 6)],
  multi: [A('EAC3', 'eng', 6), A('AC3', 'spa', 6), A('DTS', 'fre', 6), A('AAC', 'eng', 2)],
  dub: [A('AC3', 'fre', 6, { default: true }), A('EAC3', 'eng', 6)],
  none: [],
  subs: [T('eng'), T('spa')],
};

export function codecString(codec, style = 'matroska') {
  const row = CODEC_STRINGS[codec];
  return row ? row[style] || row.matroska : String(codec);
}

/** [{type, codec, lang, channels, default}] -> the AVPlay track list. `indexing` 'per-type' (0-based per type) or 'global'. */
export function buildTrackInfo(tracks, { style = 'matroska', indexing = 'per-type' } = {}) {
  const counters = { VIDEO: 0, AUDIO: 0, TEXT: 0 };
  let global = 0;
  return tracks.map((t) => {
    const index = indexing === 'global' ? global++ : counters[t.type]++;
    let info;
    if (t.type === 'VIDEO') {
      info = { Width: String(t.width || 1920), Height: String(t.height || 1080), Bit_rate: String(t.bitrate || 8000000), fourCC: codecString(t.codec || 'HEVC', style) };
      // what a file may say about its shape; Samsung documents neither name (a guess, like the rest of extra_info)
      if (t.dar) info.display_aspect_ratio = String(t.dar);
      if (t.par) info.pixel_aspect_ratio = String(t.par);
      if (t.noshape) { delete info.Width; delete info.Height; }
    } else if (t.type === 'AUDIO') {
      info = { language: String(t.lang || 'und').toUpperCase(), channels: String(t.channels || 2), sample_rate: '48000', bitrate: String(t.bitrate || 0), fourCC: codecString(t.codec, style) };
    } else {
      info = { track_num: String(index), track_lang: t.lang || 'und', subtitle_type: '1' };
    }
    return { index, type: t.type, extra_info: JSON.stringify(info), _spec: t };
  });
}

/** Resolves "eac3+subs", a JSON array, or an array into [{type, ...}] (video first). */
export function resolveTracks(spec, { video = 'HEVC', width = 1920, height = 1080, dar = null, par = null, noshape = false } = {}) {
  let audioText = [];
  if (Array.isArray(spec)) audioText = spec;
  else if (typeof spec === 'string' && spec.trim().charAt(0) === '[') audioText = JSON.parse(spec);
  else String(spec || 'eac3').split('+').forEach((name) => {
    const preset = TRACK_PRESETS[name.trim().toLowerCase()];
    if (!preset) throw new Error('unknown mock track preset "' + name + '" (try ' + Object.keys(TRACK_PRESETS).join(', ') + ')');
    audioText = audioText.concat(preset);
  });
  const hasVideo = audioText.some((t) => t.type === 'VIDEO');
  const list = hasVideo ? audioText : [{ type: 'VIDEO', codec: video, width, height, dar, par, noshape }].concat(audioText);
  // audio first then text keeps the usual container order
  return list.slice().sort((a, b) => ({ VIDEO: 0, AUDIO: 1, TEXT: 2 }[a.type] - { VIDEO: 0, AUDIO: 1, TEXT: 2 }[b.type]) || 0);
}

// ---------------------------------------------------------------------------------------------------------------
// scenarios: what a given URL does
// ---------------------------------------------------------------------------------------------------------------

/** Guesses a track layout from a release name when nothing says otherwise (lowest precedence). */
export function autoPreset(url) {
  let s = url;
  try { s = decodeURIComponent(url); } catch (e) { /* keep as is */ }
  s = s.toLowerCase();
  const bad = /dts|true-?hd/.test(s);
  const good = /ddp|dd\+|e-?ac-?3|(^|[^a-z])ac-?3|dd5|aac|opus|flac|mp3/.test(s);
  if (bad && good) return 'mixed';
  if (/true-?hd/.test(s)) return 'truehd';
  if (/dts-?hd|dts-?x/.test(s)) return 'dtshd';
  if (/dts/.test(s)) return 'dts';
  if (/ddp|dd\+|e-?ac-?3|atmos/.test(s)) return 'eac3';
  if (/(^|[^a-z])ac-?3|dd5/.test(s)) return 'ac3';
  if (/aac/.test(s)) return 'aac';
  return 'eac3';
}

export const DEFAULT_SCENARIO = {
  tracks: null,            // null: autoPreset(url)
  durationSec: 5400,
  prepare: 'ok',           // ok | fail[:CODE] | never | slow:<ms>
  start: 'ok',             // ok | never (buffering never completes: no picture) | error[:CODE] | slow:<ms>
  errorAtSec: null,        // an onerror this many seconds into playback
  errorCode: 'PLAYER_ERROR_CONNECTION_FAILED',
  stalls: [],              // [{ atSec, forSec }] forSec Infinity = forever
  seek: 'ok',              // ok | fail
  badAudio: 'silent',      // what selecting an unplayable codec does: silent | error
  style: 'matroska',       // fourCC style: matroska | mime | fourcc
  indexing: 'per-type',    // per-type | global
  video: 'HEVC',
  width: 1920, height: 1080,
  dar: null, par: null,    // the video's display / pixel aspect, when its extra_info says (mock.dar=2.39:1)
  noshape: false,          // extra_info without Width and Height (a TV that does not say)
  media: 'sim',            // sim | video (a hidden <video> supplies time and pictures; the URL must really play)
  prepareMs: 150, startMs: 400, seekMs: 200,
};

const num = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

/** "10:3,40:forever" -> [{atSec: 10, forSec: 3}, {atSec: 40, forSec: Infinity}] */
export function parseStalls(text) {
  return String(text).split(',').filter(Boolean).map((part) => {
    const [at, dur = '3'] = part.split(':');
    return { atSec: num(at, 0), forSec: dur === 'forever' ? Infinity : num(dur, 3) };
  });
}

/** Applies one `mock.*` option (from a query string or a registry entry given as strings) to a scenario. */
function applyOption(sc, key, value) {
  switch (key) {
    case 'tracks': sc.tracks = value; break;
    case 'duration': sc.durationSec = num(value, sc.durationSec); break;
    case 'prepare': {
      const [mode, arg] = String(value).split(':');
      sc.prepare = mode;
      if (mode === 'fail' && arg) sc.prepareCode = arg;
      if (mode === 'slow') { sc.prepare = 'ok'; sc.prepareMs = num(arg, 3000); }
      break;
    }
    case 'start': {
      const [mode, arg] = String(value).split(':');
      sc.start = mode;
      if (mode === 'error' && arg) sc.startCode = arg;
      if (mode === 'slow') { sc.start = 'ok'; sc.startMs = num(arg, 5000); }
      break;
    }
    case 'error': {
      const [at, code] = String(value).split(':');
      sc.errorAtSec = num(at, 5);
      if (code) sc.errorCode = code;
      break;
    }
    case 'stall': sc.stalls = sc.stalls.concat(parseStalls(value)); break;
    case 'seek': sc.seek = value; break;
    case 'badAudio': sc.badAudio = value; break;
    case 'style': sc.style = value; break;
    case 'indexing': sc.indexing = value; break;
    case 'video': sc.video = value.toUpperCase(); break;
    case 'res': { const m = /^(\d+)x(\d+)$/.exec(value); if (m) { sc.width = Number(m[1]); sc.height = Number(m[2]); } break; }
    case 'dar': sc.dar = value; break;
    case 'par': sc.par = value; break;
    case 'noshape': sc.noshape = value === '1' || value === 'true'; break;
    case 'media': sc.media = value; break;
    case 'startMs': case 'prepareMs': case 'seekMs': sc[key] = num(value, sc[key]); break;
    default: break;
  }
}

/** The `mock.*` query parameters of a URL as { key: value }. */
export function queryOptions(url) {
  const out = {};
  const q = url.indexOf('?');
  if (q < 0) return out;
  url.slice(q + 1).split('&').forEach((pair) => {
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    if (k.indexOf('mock.') !== 0) return;
    const v = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1).replace(/\+/g, ' '));
    const key = k.slice(5);
    out[key] = key === 'stall' && out[key] ? out[key] + ',' + v : v; // mock.stall may be repeated
  });
  return out;
}

/** The URL without its `mock.*` parameters: what a real server would be asked for. */
export function stripMockParams(url) {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const kept = url.slice(q + 1).split('&').filter((p) => p && decodeURIComponent(p.split('=')[0]).indexOf('mock.') !== 0);
  return url.slice(0, q) + (kept.length ? '?' + kept.join('&') : '');
}

/**
 * A registry of per-URL scenarios for tests and the dev console:
 *   registry.add('Dune.2021', { tracks: 'dts', start: 'never' })     substring of the URL
 *   registry.add(/2160p/, { video: 'hevc', res: '3840x2160' })       RegExp
 *   registry.add((url) => url.endsWith('.mkv'), { ... })             function
 * Entries use the same keys and string forms as the `mock.*` query parameters (values may be strings or numbers).
 * Earlier entries win over later ones for the same key.
 */
export function createRegistry() {
  const entries = [];
  return {
    add(matcher, options) { entries.push({ matcher, options }); return this; },
    clear() { entries.length = 0; },
    entries: () => entries.slice(),
    optionsFor(url) {
      const out = {};
      for (let i = entries.length - 1; i >= 0; i--) {
        const { matcher, options } = entries[i];
        const hit = typeof matcher === 'string' ? url.indexOf(matcher) >= 0 : matcher instanceof RegExp ? matcher.test(url) : !!matcher(url);
        if (hit) Object.assign(out, options);
      }
      return out;
    },
  };
}

/** The scenario for [url]: defaults < release-name guess < registry entries < `mock.*` query parameters. */
export function scenarioFor(url, registry) {
  const sc = Object.assign({}, DEFAULT_SCENARIO, { stalls: [] });
  const options = Object.assign({}, registry ? registry.optionsFor(url) : {}, queryOptions(url));
  Object.keys(options).forEach((k) => applyOption(sc, k, String(options[k])));
  if (!sc.tracks) sc.tracks = autoPreset(url);
  return sc;
}

// ---------------------------------------------------------------------------------------------------------------
// AVPlay
// ---------------------------------------------------------------------------------------------------------------

/** What Samsung's runtime throws for a bad call: a WebAPIException-alike. */
export class MockWebApiError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
    this.code = { InvalidStateError: 11, InvalidValuesError: 22, TypeMismatchError: 17, NotSupportedError: 9, SecurityError: 18 }[name] || 0;
  }
}

/** AVPlayDisplayMode: the only three values Samsung's AVPlay API reference lists. */
export const DISPLAY_METHODS = ['PLAYER_DISPLAY_MODE_LETTER_BOX', 'PLAYER_DISPLAY_MODE_FULL_SCREEN', 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO'];

const TICK_MS = 500; // oncurrentplaytime cadence

/**
 * createAvplayMock({ clock, registry, video, log, strict })
 *   clock     { now, setTimeout, clearTimeout, setInterval, clearInterval }: realClock by default, a fake one in tests
 *   registry  createRegistry() (also exposed as avplay.__mock.registry)
 *   video     () => HTMLVideoElement, for scenarios with media=video (browser only)
 *   strict    throw InvalidStateError on calls made in a state Samsung documents as invalid (default true)
 * Everything a test needs to see or force is under avplay.__mock.
 */
export function createAvplayMock({ clock = realClock, registry = createRegistry(), video = null, log = null, strict = true } = {}) {
  let state = 'NONE';
  let listener = null;
  let url = '';
  let scenario = null;
  let tracks = [];
  let selected = { VIDEO: 0, AUDIO: 0, TEXT: -1 };
  let pos = 0;                 // ms
  let speed = 1;
  let lastTick = 0;
  let ticker = null;
  let started = false;         // the picture has begun (first onbufferingcomplete after play)
  let frozen = false;          // a stall is in progress
  let completed = false;
  let suspended = false;
  let errored = false;
  let startTimer = null;
  let stallTimer = null;
  // Every one-shot timer of the current session. A real player delivers nothing after close() or stop(), so the mock
  // must not either: leaving one of these running was the "fast Back" crash (a seek timer reading the closed session).
  const timers = new Set();
  let epoch = 0;               // bumped by close() and stop(): a timer that was already queued checks it before acting
  let videoListeners = [];     // [type, fn] pairs put on the <video> by open(), removed by close()
  const firedStalls = new Set();
  const calls = [];
  const props = {};
  const display = { rect: [0, 0, 1920, 1080], method: 'PLAYER_DISPLAY_MODE_LETTER_BOX', roi: [0, 0, 1, 1] };
  const subtitle = { silent: false, path: '', position: 0 };
  let videoEl = null;

  const record = (method, args) => { calls.push({ t: clock.now(), method, args: Array.prototype.slice.call(args) }); if (log) log('avplay.' + method + '(' + Array.prototype.slice.call(args).map((a) => (typeof a === 'function' ? 'fn' : JSON.stringify(a))).join(', ') + ') [' + state + ']'); };
  const need = (method, allowed) => {
    if (strict && allowed.indexOf(state) < 0) throw new MockWebApiError('InvalidStateError', method + ' is not valid in state ' + state + ' (valid: ' + allowed.join('/') + ')');
  };
  const later = (fn, ms) => {
    const mine = epoch;
    const id = clock.setTimeout(() => { timers.delete(id); if (mine === epoch) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const dropTimers = () => { epoch++; timers.forEach((id) => clock.clearTimeout(id)); timers.clear(); startTimer = null; stallTimer = null; };
  const deliver = (fn) => later(fn, 0);   // native events reach JS asynchronously
  const emit = (name, ...args) => {
    if (!listener || typeof listener[name] !== 'function') return;
    deliver(() => { if (listener && typeof listener[name] === 'function') listener[name](...args); });
  };
  const mediaVideo = () => (scenario && scenario.media === 'video');

  function isUnplayable(track) {
    const codec = track._spec && track._spec.codec;
    return track.type === 'AUDIO' && PLAYABLE_AUDIO.indexOf(codec) < 0;
  }

  function selectedAudioPlayable() {
    const t = tracks.filter((x) => x.type === 'AUDIO')[selected.AUDIO];
    return !t || !isUnplayable(t);
  }

  function position() {
    if (mediaVideo() && videoEl) return videoEl.currentTime * 1000;
    return pos;
  }

  function stopTicker() { if (ticker !== null) { clock.clearInterval(ticker); ticker = null; } }
  function startTicker() {
    stopTicker();
    lastTick = clock.now();
    ticker = clock.setInterval(tick, TICK_MS);
  }

  function fail(code) {
    if (errored) return;
    errored = true;
    emit('onerror', code);
    emit('onerrormsg', code, code);
  }

  function beginStall(forSec) {
    frozen = true;
    emit('onbufferingstart');
    if (mediaVideo() && videoEl) videoEl.pause();
    if (forSec !== Infinity) {
      stallTimer = later(() => {
        frozen = false;
        lastTick = clock.now();
        emit('onbufferingprogress', 100);
        emit('onbufferingcomplete');
        if (mediaVideo() && videoEl && state === 'PLAYING') videoEl.play();
      }, forSec * 1000);
    }
  }

  function tick() {
    if (state !== 'PLAYING' || suspended) return;
    const t = clock.now();
    if (started && !frozen && !errored && !completed) {
      if (!mediaVideo()) pos += (t - lastTick) * speed;
      const dur = scenario.durationSec * 1000;
      if (position() >= dur && !mediaVideo()) { pos = dur; completed = true; emit('oncurrentplaytime', Math.floor(pos)); emit('onstreamcompleted'); lastTick = t; return; }
      emit('oncurrentplaytime', Math.floor(position()));
      const here = position();
      scenario.stalls.forEach((s, i) => {
        if (!firedStalls.has(i) && here >= s.atSec * 1000) { firedStalls.add(i); beginStall(s.forSec); }
      });
      if (scenario.errorAtSec !== null && here >= scenario.errorAtSec * 1000) fail(scenario.errorCode);
    }
    lastTick = t;
  }

  function begin() {
    // play() from READY: the picture starts after startMs unless the scenario says it never does
    started = false;
    if (scenario.start === 'never') { emit('onbufferingstart'); return; }
    if (scenario.start === 'error') { startTimer = later(() => fail(scenario.startCode || scenario.errorCode), scenario.startMs); return; }
    emit('onbufferingstart');
    const steps = 4;
    for (let i = 1; i <= steps; i++) later(() => { if (state === 'PLAYING' && !started) emit('onbufferingprogress', Math.round((100 * i) / steps)); }, (scenario.startMs * i) / (steps + 1));
    startTimer = later(() => {
      if (state !== 'PLAYING') { started = false; return; }
      started = true;
      lastTick = clock.now();
      if (!selectedAudioPlayable() && scenario.badAudio === 'error') { fail('PLAYER_ERROR_NOT_SUPPORTED_FORMAT'); return; }
      emit('onbufferingcomplete');
      if (mediaVideo() && videoEl) videoEl.play();
    }, scenario.startMs);
  }

  function seekDone(target, ok, err, jump) {
    if (scenario.seek === 'fail') { deliver(() => { if (typeof err === 'function') err(new MockWebApiError('InvalidValuesError', 'seek failed')); emit('onerror', 'PLAYER_ERROR_SEEK_FAILED'); }); return; }
    later(() => {
      const dur = scenario.durationSec * 1000;
      pos = Math.max(0, Math.min(dur, target));
      if (mediaVideo() && videoEl) videoEl.currentTime = pos / 1000;
      firedStalls.forEach((i) => { if (scenario.stalls[i] && scenario.stalls[i].atSec * 1000 < pos) { /* earlier stalls stay fired */ } });
      completed = pos >= dur;
      if (state === 'PLAYING') { emit('onbufferingstart'); emit('onbufferingcomplete'); }
      if (typeof ok === 'function') ok();
    }, scenario.seekMs);
  }

  const avplay = {
    open(u) {
      record('open', arguments);
      need('open', ['NONE']);
      if (typeof u !== 'string' || !u) throw new MockWebApiError('TypeMismatchError', 'open needs a url string');
      url = u;
      scenario = scenarioFor(u, registry);
      tracks = buildTrackInfo(resolveTracks(scenario.tracks, { video: scenario.video, width: scenario.width, height: scenario.height, dar: scenario.dar, par: scenario.par, noshape: scenario.noshape }), scenario);
      const defaultAudio = tracks.filter((t) => t.type === 'AUDIO').findIndex((t) => t._spec.default);
      selected = { VIDEO: 0, AUDIO: tracks.some((t) => t.type === 'AUDIO') ? Math.max(0, defaultAudio) : -1, TEXT: -1 };
      pos = 0; speed = 1; started = false; frozen = false; completed = false; errored = false; suspended = false;
      display.roi = [0, 0, 1, 1]; // a new session shows the whole frame
      firedStalls.clear();
      if (mediaVideo()) {
        videoEl = video ? video() : null;
        if (videoEl) {
          videoEl.src = stripMockParams(u); videoEl.load();
          videoListeners = [
            ['ended', () => { if (state === 'PLAYING') { completed = true; emit('onstreamcompleted'); } }],
            ['error', () => fail('PLAYER_ERROR_NOT_SUPPORTED_FILE')],
          ];
          videoListeners.forEach(([type, fn]) => videoEl.addEventListener(type, fn));
        }
      }
      state = 'IDLE';
    },
    close() {
      record('close', arguments);
      need('close', ['IDLE', 'READY', 'PLAYING', 'PAUSED']);
      stopTicker(); dropTimers();
      if (videoEl) { videoListeners.forEach(([type, fn]) => videoEl.removeEventListener(type, fn)); videoListeners = []; videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); }
      state = 'NONE'; listener = null; url = ''; scenario = null; tracks = [];
    },
    prepare() {
      record('prepare', arguments);
      need('prepare', ['IDLE']);
      if (scenario.prepare === 'fail') throw new MockWebApiError('InvalidStateError', scenario.prepareCode || 'PLAYER_ERROR_CONNECTION_FAILED');
      state = 'READY';
    },
    prepareAsync(ok, err) {
      record('prepareAsync', arguments);
      need('prepareAsync', ['IDLE']);
      if (scenario.prepare === 'never') return;
      later(() => {
        if (state !== 'IDLE') return; // closed or stopped meanwhile
        if (scenario.prepare === 'fail') {
          if (typeof err === 'function') err(new MockWebApiError('InvalidStateError', scenario.prepareCode || 'PLAYER_ERROR_CONNECTION_FAILED'));
          return;
        }
        state = 'READY';
        if (typeof ok === 'function') ok();
      }, scenario.prepareMs);
    },
    play() {
      record('play', arguments);
      need('play', ['READY', 'PAUSED']);
      const wasReady = state === 'READY';
      state = 'PLAYING';
      startTicker();
      if (wasReady) begin();
      else if (mediaVideo() && videoEl) videoEl.play();
      else lastTick = clock.now();
    },
    pause() {
      record('pause', arguments);
      need('pause', ['PLAYING']);
      if (!mediaVideo()) pos += started && !frozen ? (clock.now() - lastTick) * speed : 0;
      state = 'PAUSED';
      stopTicker();
      if (mediaVideo() && videoEl) videoEl.pause();
    },
    stop() {
      record('stop', arguments);
      need('stop', ['READY', 'PLAYING', 'PAUSED']);
      stopTicker(); dropTimers();
      state = 'IDLE'; started = false; frozen = false; pos = 0; completed = false;
      if (mediaVideo() && videoEl) { videoEl.pause(); videoEl.currentTime = 0; }
    },
    seekTo(ms, ok, err) {
      record('seekTo', arguments);
      need('seekTo', ['READY', 'PLAYING', 'PAUSED']);
      if (typeof ms !== 'number' || ms < 0) throw new MockWebApiError('InvalidValuesError', 'seekTo needs milliseconds >= 0');
      seekDone(ms, ok, err);
    },
    jumpForward(ms, ok, err) {
      record('jumpForward', arguments);
      need('jumpForward', ['READY', 'PLAYING', 'PAUSED']);
      seekDone(position() + ms, ok, err, true);
    },
    jumpBackward(ms, ok, err) {
      record('jumpBackward', arguments);
      need('jumpBackward', ['READY', 'PLAYING', 'PAUSED']);
      seekDone(position() - ms, ok, err, true);
    },
    getState() { return state; },
    getSubState() { return state; },
    getDuration() { need('getDuration', ['READY', 'PLAYING', 'PAUSED']); return scenario.durationSec * 1000; },
    getCurrentTime() { need('getCurrentTime', ['READY', 'PLAYING', 'PAUSED']); return Math.floor(position() + (state === 'PLAYING' && started && !frozen && !mediaVideo() ? (clock.now() - lastTick) * speed : 0)); },
    getVersion() { return 'mock-1.0'; },
    getVideoSize() { return { width: scenario ? scenario.width : 0, height: scenario ? scenario.height : 0 }; },
    getCodecInfo() { return { videoCodec: scenario ? scenario.video : '', audioCodec: '' }; },
    setListener(l) {
      record('setListener', arguments);
      need('setListener', ['IDLE', 'READY', 'PLAYING', 'PAUSED']);
      listener = l;
    },
    setDisplayRect(x, y, w, h) { record('setDisplayRect', arguments); need('setDisplayRect', ['IDLE', 'READY', 'PLAYING', 'PAUSED']); display.rect = [x, y, w, h]; },
    setDisplayMethod(m) {
      record('setDisplayMethod', arguments);
      need('setDisplayMethod', ['IDLE', 'READY', 'PLAYING', 'PAUSED']);
      // Samsung documents three modes (AVPlayDisplayMode); anything else, CROPPED_FULL included, is not AVPlay's
      if (DISPLAY_METHODS.indexOf(m) < 0) throw new MockWebApiError('InvalidValuesError', 'unknown display method ' + m);
      display.method = m;
    },
    /** Samsung gives the signature (four ratios of the frame) and no behaviour; modelled as "show this part of the frame". */
    setVideoRoi(x, y, w, h) {
      record('setVideoRoi', arguments);
      need('setVideoRoi', ['READY', 'PLAYING', 'PAUSED']);
      const v = [x, y, w, h];
      if (v.some((n) => typeof n !== 'number' || !Number.isFinite(n)) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) throw new MockWebApiError('InvalidValuesError', 'setVideoRoi needs ratios inside the frame');
      display.roi = v;
    },
    setStreamingProperty(name, value) {
      record('setStreamingProperty', arguments);
      need('setStreamingProperty', ['IDLE', 'READY']);
      const ok = ['COOKIE', 'USER_AGENT', 'PREBUFFER_MODE', 'ADAPTIVE_INFO', 'SET_MODE_4K', 'LISTEN_SPARSE_TRACK', 'USE_VIDEOMIXER', 'SET_MIXEDFRAME', 'PORTRAIT_MODE', 'IN_APP_MULTIVIEW'];
      if (ok.indexOf(name) < 0) throw new MockWebApiError('InvalidValuesError', 'unknown streaming property ' + name);
      props[name] = String(value);
    },
    getStreamingProperty(name) {
      record('getStreamingProperty', arguments);
      if (name === 'IS_LIVE') return '0';
      if (name === 'AVAILABLE_BITRATE' || name === 'CURRENT_BANDWIDTH') return '0';
      return props[name] || '';
    },
    setTimeoutForBuffering() { record('setTimeoutForBuffering', arguments); },
    setBufferingParam() { record('setBufferingParam', arguments); },
    setSpeed(s) { record('setSpeed', arguments); need('setSpeed', ['PLAYING', 'PAUSED']); speed = s; if (mediaVideo() && videoEl) videoEl.playbackRate = s; },
    setSilentSubtitle(on) { record('setSilentSubtitle', arguments); need('setSilentSubtitle', ['IDLE', 'READY', 'PLAYING', 'PAUSED']); subtitle.silent = !!on; },
    setExternalSubtitlePath(p) { record('setExternalSubtitlePath', arguments); need('setExternalSubtitlePath', ['IDLE', 'READY', 'PLAYING', 'PAUSED']); subtitle.path = p; },
    setSubtitlePosition(ms) { record('setSubtitlePosition', arguments); need('setSubtitlePosition', ['PLAYING', 'PAUSED']); subtitle.position = ms; },
    getTotalTrackInfo() {
      record('getTotalTrackInfo', arguments);
      need('getTotalTrackInfo', ['READY', 'PLAYING', 'PAUSED']);
      return tracks.map((t) => ({ index: t.index, type: t.type, extra_info: t.extra_info }));
    },
    getCurrentStreamInfo() {
      record('getCurrentStreamInfo', arguments);
      need('getCurrentStreamInfo', ['READY', 'PLAYING', 'PAUSED']);
      return ['VIDEO', 'AUDIO', 'TEXT'].map((type) => {
        const t = tracks.filter((x) => x.type === type)[selected[type]];
        return t ? { index: t.index, type: t.type, extra_info: t.extra_info } : null;
      }).filter(Boolean);
    },
    setSelectTrack(type, index) {
      record('setSelectTrack', arguments);
      need('setSelectTrack', ['READY', 'PLAYING', 'PAUSED']);
      if (type !== 'VIDEO' && type !== 'AUDIO' && type !== 'TEXT') throw new MockWebApiError('TypeMismatchError', 'bad track type ' + type);
      const list = tracks.filter((t) => t.type === type);
      const at = list.findIndex((t) => t.index === index);
      if (at < 0) throw new MockWebApiError('InvalidValuesError', 'no ' + type + ' track with index ' + index);
      selected[type] = at;
      if (type === 'AUDIO' && started && !selectedAudioPlayable() && scenario.badAudio === 'error') fail('PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
    },
    suspend() { record('suspend', arguments); need('suspend', ['READY', 'PLAYING', 'PAUSED']); suspended = true; if (mediaVideo() && videoEl) videoEl.pause(); },
    restore(u, resumeMs) {
      record('restore', arguments);
      need('restore', ['READY', 'PLAYING', 'PAUSED']);
      suspended = false;
      if (typeof resumeMs === 'number') pos = resumeMs;
      lastTick = clock.now();
      if (state === 'PLAYING' && mediaVideo() && videoEl) videoEl.play();
    },
    restoreAsync(u, resumeMs, prepare, ok) { avplay.restore(u, resumeMs); deliver(() => { if (typeof ok === 'function') ok(); }); },
    enableAudioStream() {}, disableAudioStream() {}, setLooping() {}, setSeamlessLooping() {}, setVideoStillMode() {}, setDisplayRotation() {},
  };

  /** Everything a test or the dev console may inspect or force. Not part of Samsung's API. */
  avplay.__mock = {
    registry,
    calls,
    get scenario() { return scenario; },
    get url() { return url; },
    get position() { return position(); },
    get started() { return started; },
    get frozen() { return frozen; },
    get selected() { return Object.assign({}, selected); },
    /** What the speakers would hear: the selected audio codec while it is playable, else 'silent'. */
    get audioOutput() {
      if (state !== 'PLAYING' || !started || frozen) return 'none';
      const t = tracks.filter((x) => x.type === 'AUDIO')[selected.AUDIO];
      return !t ? 'none' : isUnplayable(t) ? 'silent' : t._spec.codec;
    },
    display, subtitle, props,
    /** Calls a listener callback now (asynchronously, like the real thing): force an error or a stall from a test. */
    emit(name, ...args) { emit(name, ...args); },
    fail(code = 'PLAYER_ERROR_CONNECTION_FAILED') { errored = false; fail(code); },
    stall(forSec = Infinity) { beginStall(forSec); },
    reset() { calls.length = 0; },
    /** One-shot timers still waiting (0 after close() or stop(), like a player that has gone quiet). */
    get pendingTimers() { return timers.size + (ticker === null ? 0 : 1); },
  };
  return avplay;
}

// ---------------------------------------------------------------------------------------------------------------
// the rest of tizen / webapis
// ---------------------------------------------------------------------------------------------------------------

/** Key names tizen.tvinputdevice knows, with their codes (the ones Alder uses plus a few the remote has). */
export const TV_KEYS = {
  MediaPlay: 415, MediaPause: 19, MediaPlayPause: 10252, MediaStop: 413, MediaFastForward: 417, MediaRewind: 412,
  MediaTrackPrevious: 10232, MediaTrackNext: 10233, ColorF0Red: 403, ColorF1Green: 404, ColorF2Yellow: 405, ColorF3Blue: 406,
  Info: 457, Caption: 10221, '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55, '8': 56, '9': 57,
  ChannelUp: 427, ChannelDown: 428, VolumeUp: 447, VolumeDown: 448, VolumeMute: 449, Menu: 10133, Tools: 10135, Exit: 10182, Guide: 458,
};

export function createTizenMock({ onExit = null, log = null } = {}) {
  const registered = new Set();
  const say = (m) => { if (log) log(m); };
  return {
    tvinputdevice: {
      getSupportedKeys: () => Object.keys(TV_KEYS).map((name) => ({ name, code: TV_KEYS[name] })),
      getKey(name) {
        if (!(name in TV_KEYS)) throw new MockWebApiError('InvalidValuesError', 'unknown key ' + name);
        return { name, code: TV_KEYS[name] };
      },
      registerKey(name) {
        if (!(name in TV_KEYS)) throw new MockWebApiError('InvalidValuesError', 'unknown key ' + name);
        registered.add(name); say('registerKey ' + name);
      },
      registerKeyBatch(names, ok) {
        const bad = names.filter((n) => !(n in TV_KEYS));
        if (bad.length) throw new MockWebApiError('InvalidValuesError', 'unknown key(s) ' + bad.join(', '));
        names.forEach((n) => registered.add(n)); say('registerKeyBatch ' + names.length);
        if (typeof ok === 'function') ok();
      },
      unregisterKey(name) { registered.delete(name); },
      unregisterKeyBatch(names) { names.forEach((n) => registered.delete(n)); },
    },
    application: {
      getCurrentApplication: () => ({
        exit() { say('application.exit()'); if (onExit) onExit(); },
        hide() { say('application.hide()'); },
        getRequestedAppControl: () => ({ appControl: { operation: '', uri: null, mime: null, category: null, data: [] }, callerAppId: null }),
      }),
    },
    __registeredKeys: () => Array.from(registered),
  };
}

/**
 * Device description for productinfo / avinfo. `fhd` is a 1080p panel without HDR (to exercise the fallbacks);
 * `throws` lists APIs that throw (an older firmware or a missing privilege).
 */
export const DEVICES = {
  tu8000: { model: 'UE55TU8000', realModel: 'UE55TU8000UXXC', firmware: 'T-KTSUAKUC-1500.5', udPanel: true, hdr: true, tizen: '5.5' },
  fhd: { model: 'UE43T5300', realModel: 'UE43T5300AUXXC', firmware: 'T-NTK-1000.1', udPanel: false, hdr: false, tizen: '5.5' },
};

export function createWebapisMock({ clock = realClock, registry = createRegistry(), video = null, log = null, device = DEVICES.tu8000, throws = [], strict = true } = {}) {
  const guard = (name, value) => () => { if (throws.indexOf(name) >= 0) throw new MockWebApiError('NotSupportedError', name + ' is not available'); return value; };
  return {
    avplay: createAvplayMock({ clock, registry, video, log, strict }),
    productinfo: {
      isUdPanelSupported: guard('isUdPanelSupported', device.udPanel),
      getModel: guard('getModel', device.model),
      getRealModel: guard('getRealModel', device.realModel),
      getFirmware: guard('getFirmware', device.firmware),
      getVersion: guard('getVersion', device.tizen),
      getSmartTVServerType: guard('getSmartTVServerType', 0),
      isBuiltInPanel: guard('isBuiltInPanel', true),
    },
    avinfo: {
      isHdrTvSupport: guard('isHdrTvSupport', device.hdr),
      getVersion: guard('avinfo.getVersion', '1.0'),
    },
  };
}

/**
 * Puts the mock on [win] as `tizen` and `webapis`. In a browser the hidden <video> for media=video scenarios is made
 * on demand. Query parameters on the page choose the device: `?mock.device=fhd`.
 * Returns { tizen, webapis, registry }; the AVPlay mock is also at win.webapis.avplay.__mock.
 */
export function installMockTizen(win, opts = {}) {
  const doc = win.document;
  const search = win.location ? win.location.search : '';
  const deviceName = (/[?&]mock\.device=([\w-]+)/.exec(search) || [])[1];
  const registry = opts.registry || createRegistry();
  let videoEl = null;
  const video = () => {
    if (!videoEl && doc) {
      videoEl = doc.createElement('video');
      videoEl.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      videoEl.muted = true;
      doc.body.appendChild(videoEl);
    }
    return videoEl;
  };
  const log = opts.log || ((m) => { if (win.console && win.console.debug) win.console.debug('[mock] ' + m); });
  const webapis = createWebapisMock(Object.assign({ registry, video, log, device: DEVICES[deviceName] || DEVICES.tu8000 }, opts));
  const tizen = createTizenMock({
    log,
    onExit: () => { win.__mockExitRequested = (win.__mockExitRequested || 0) + 1; if (win.dispatchEvent && typeof win.CustomEvent === 'function') win.dispatchEvent(new win.CustomEvent('tizen-exit')); },
  });
  win.tizen = tizen;
  win.webapis = webapis;
  win.__mockTizen = { registry, DEVICES, TRACK_PRESETS };
  return { tizen, webapis, registry };
}
