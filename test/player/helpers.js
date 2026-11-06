// Shared test doubles for the player tests: the AVPlay mock on a fake clock behind the real wrapper (src/player/avplay.js),
// a fake Stremio that records what is saved, and a way to collect the engine's events. No network, no DOM.
import { test } from 'node:test';
import { createFakeClock } from '../../dev/fake-clock.js';
import { createAvplayMock, createRegistry } from '../../dev/mock-tizen.js';
import { createRequire } from 'node:module';
import { createAvplay } from '../../src/player/avplay.js';
import { createAvplay as createMpv } from '../../src/platform/mac/mpv.js';
import { createEngine } from '../../src/player/engine.js';
import { createLibrary } from '../../src/core/library.js';
import { createSettings } from '../../src/core/settings.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { tu8000Profile } from '../../src/core/device.js';
import { Stream, Meta } from '../../src/core/addon.js';
import { createStore, memoryStorage } from '../../src/lib/store.js';
import { createLogger } from '../../src/lib/log.js';
import { createDiag } from '../../src/player/diag.js';
import { fixtureJson } from '../core/helpers.js';

const require = createRequire(import.meta.url);
const { createBridge } = require('../../mac/web/bridge.js');
const { installMock } = require('../../mac/web/mock-bridge.js');

/** The two adapters the engine runs on: Tizen's avplay.js (fake webapis) and the Mac's mpv.js (the bridge mock's mpv model). */
export const ADAPTERS = ['avplay', 'mpv'];

/** The adapter makeEngine() builds when a test does not name one: set by both() for the length of one test (node:test runs a file's tests one by one). */
let currentAdapter = 'avplay';

/** both(name, fn): the test once per adapter, titled "name [adapter]"; fn(adapter) calls makeEngine() as it always did and gets that adapter. */
export function both(name, fn, options = {}) {
  for (const adapter of ADAPTERS) {
    test(name + ' [' + adapter + ']', options, async () => {
      currentAdapter = adapter;
      try { await fn(adapter); } finally { currentAdapter = 'avplay'; }
    });
  }
}

/** What Tizen's `mock.*` URL options (see stream()) mean to the mpv model: a script for one load of one URL. */
const MPV_FAIL_TEXT = { PLAYER_ERROR_CONNECTION_FAILED: 'Connection refused', PLAYER_ERROR_NOT_SUPPORTED_FORMAT: 'Unrecognized file format' };
function mpvScript(url) {
  const q = new URL(url).searchParams;
  const spec = {};
  if (q.get('mock.duration')) spec.duration = Number(q.get('mock.duration')); // seconds, as Tizen's
  if (q.get('mock.start') === 'never') spec.freeze = true; // loads and plays, but the time never advances: no picture
  if (q.get('mock.tracks')) spec.tracks = JSON.parse(q.get('mock.tracks')); // mpv track-list entries (text tracks in the file)
  const prepare = q.get('mock.prepare') || '';
  if (prepare === 'hang') spec.hang = true; // the load never answers (Mac only: Tizen's equivalent is slow:<ms>)
  if (prepare.startsWith('fail:')) spec.fail = MPV_FAIL_TEXT[prepare.slice(5)] || 'Unknown error';
  const error = /^(\d+):(.+)$/.exec(q.get('mock.error') || '');
  if (error) { spec.failAt = Number(error[1]); spec.failMessage = MPV_FAIL_TEXT[error[2]] || 'Unknown error'; }
  const res = /^(\d+)x(\d+)$/.exec(q.get('mock.res') || '');
  if (res) spec.res = [Number(res[1]), Number(res[2])];
  return spec;
}

export const EVENTS = ['loading', 'started', 'playing', 'scrub', 'meta', 'tracks', 'subtitle', 'picture', 'skip', 'upNext', 'upNextHide', 'stall', 'stallHide', 'sourceError', 'notice', 'navigate'];

/** A Stream the way add-ons give them: name (what the release is called), a media URL with `mock.*` options. */
export function stream(name, options = {}, extra = {}) {
  const query = Object.keys(options).map((k) => 'mock.' + k + '=' + encodeURIComponent(options[k])).join('&');
  const file = extra.filename || (name.replace(/\s+/g, '.') + '.mkv');
  const url = 'https://media.fixture.test/' + encodeURIComponent(file) + (query ? '?' + query : '');
  return new Stream(extra.title || name, extra.description || '', url, extra.headers || {}, extra.size || 0, file, extra.bingeGroup);
}

/** The Severance meta of the fixtures: 2 seasons and a special, for Up next. */
export function severanceMeta() {
  return new Meta(fixtureJson('v3-cinemeta.strem.io/meta/series/tt11280740.json').meta);
}

export function libraryItem(overrides = {}) {
  const lib = createLibrary();
  const it = lib.newItem(overrides.id || 'tt15239678', overrides.type || 'movie', 'Dune: Part Two', null);
  it.removed = false; it.temp = false;
  Object.assign(it.state, overrides.state || {});
  return it;
}

/**
 * makeEngine({ sources, params, item, saved, meta, http, settings: { audioLang, subtitles, pictureSize }, fill (offer Fill: the build flag is off), tvLanguage, libraryDelay })
 * -> { engine, clock, av (the AVPlay mock), events (name -> [data]), log (array of lines), stremio, puts, store, diag, start(), at(ms) }
 */
export function makeEngine(opts = {}) {
  const clock = createFakeClock(opts.startTime || 0);
  const mac = (opts.adapter || currentAdapter) === 'mpv';
  const registry = createRegistry();
  const av = mac ? null : createAvplayMock({ clock, registry });
  const lines = [];
  const log = createLogger({ echo: (level, entry) => { lines.push(level + ' ' + entry.tag + ' ' + entry.msg); } });
  let mpv = null; // the bridge mock, on the Mac adapter
  let mpvBridge = null; // the page's side of it
  let avplay;
  if (mac) {
    const win = {};
    const timers = { now: clock.now, after: (ms, fn) => { const id = clock.setTimeout(fn, ms); return () => clock.clearTimeout(id); }, every: (ms, fn) => { const id = clock.setInterval(fn, ms); return () => clock.clearInterval(id); } };
    mpv = installMock({ win, clock: timers, duration: 5400, script: mpvScript });
    mpvBridge = createBridge({ win });
    avplay = createMpv({ bridge: mpvBridge, log });
  } else avplay = createAvplay({ webapis: { avplay: av }, log, fill: opts.fill });
  const store = createStore({ storage: memoryStorage() });
  const settings = createSettings({ store, activeProfileId: () => 'p1', tvLanguage: () => opts.tvLanguage || 'en' });
  if (opts.settings && opts.settings.audioLang) store.set('settings/audioLang@p1', opts.settings.audioLang);
  if (opts.settings && opts.settings.subtitles === false) store.set('settings/subtitles', false);
  if (opts.settings && opts.settings.pictureSize) store.set('settings/pictureSize@p1', opts.settings.pictureSize);
  const library = createLibrary({ now: () => 1700000000000 + clock.now() });
  const memory = opts.memory || createSourceMemory(store); // a test may bring its own (the Mac release memory)
  const puts = [];
  const item = opts.item === undefined ? libraryItem() : opts.item;
  const stremio = {
    puts,
    async addons() { return []; },
    savedLibrary: () => (opts.saved ? [opts.saved] : null),
    library() {
      if (opts.libraryFails) return Promise.reject(new Error('offline'));
      const answer = opts.libraryList || (item ? [item] : []);
      return opts.libraryDelay ? new Promise((resolve) => clock.setTimeout(() => resolve(answer), opts.libraryDelay)) : Promise.resolve(answer);
    },
    async saveLibrary(key, items) { puts.push({ key, at: clock.now(), items: JSON.parse(JSON.stringify(items)) }); },
  };
  const diag = createDiag({ now: clock.now });
  const params = Object.assign({ type: 'movie', metaId: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two', sources: opts.sources || [], picked: false }, opts.params || {});
  const engine = (opts.createEngine || createEngine)(params, {
    avplay, clock, stremio, authKey: 'FIXTURE-AUTH-KEY-0001', library, settings, memory, device: tu8000Profile(),
    http: opts.http || null, log, diag, tvLanguage: () => opts.tvLanguage || 'en',
    loadMeta: () => Promise.resolve(opts.meta || null),
  });
  const events = {};
  EVENTS.forEach((name) => { events[name] = []; engine.on(name, (data) => events[name].push(data)); });
  const calls = () => (mac ? [] : av.__mock.calls);
  return {
    adapter: mac ? 'mpv' : 'avplay', avplay, mpv, bridge: mpvBridge,
    // what the engine did to the player, the same on both: sources opened [{ t, url }], the resume seeks (ms), the playback state
    loads: () => (mac ? mpv.loadLog.map((l) => ({ t: l.at, url: l.url })) : av.__mock.calls.filter((c) => c.method === 'open').map((c) => ({ t: c.t, url: c.args[0] }))),
    seeks: () => (mac ? mpv.posted.filter((m) => m.cmd === 'seek').map((m) => Math.round(m.args.seconds * 1000)) : av.__mock.calls.filter((c) => c.method === 'seekTo').map((c) => c.args[0])),
    playState: () => avplay.state(),
    position: () => avplay.time(), // ms
    // an error in the middle of playback, as the player reports it (http: the status AVPlay / the shell's text carries)
    failNow(code, http = 0) {
      if (!mac) { if (http) av.__mock.emit('onevent', 'PLAYER_MSG_HTTP_ERROR_CODE', String(http)); av.__mock.fail(code); return; }
      mpv.failNow(http ? 'HTTP error ' + http + ' Bad' : MPV_FAIL_TEXT[code] || 'Unknown error');
    },
    // Fill is on the screen: a crop of the frame on Tizen (setVideoRoi), panscan on the Mac (a message the bridge delivers a tick later)
    cropped: () => (mac ? mpv.prop('panscan') > 0 : JSON.stringify(av.__mock.display.roi) !== '[0,0,1,1]'),
    sent: () => (mac ? mpv.posted.length : av.__mock.calls.length), // everything that crossed to the player so far
    engine, clock, av, events, log: lines, stremio, puts, store, diag, item, library, calls,
    callsOf: (method) => calls().filter((c) => c.method === method),
    opens: () => calls().filter((c) => c.method === 'open'),
    async start() { engine.start(); await clock.advance(0); },
    advance: (ms) => clock.advance(ms),
  };
}

export { createFakeClock, createRegistry };
