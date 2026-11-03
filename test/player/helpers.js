// Shared test doubles for the player tests: the AVPlay mock on a fake clock behind the real wrapper (src/player/avplay.js),
// a fake Stremio that records what is saved, and a way to collect the engine's events. No network, no DOM.
import { createFakeClock } from '../../dev/fake-clock.js';
import { createAvplayMock, createRegistry } from '../../dev/mock-tizen.js';
import { createAvplay } from '../../src/player/avplay.js';
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
  const registry = createRegistry();
  const av = createAvplayMock({ clock, registry });
  const lines = [];
  const log = createLogger({ echo: (level, entry) => { lines.push(level + ' ' + entry.tag + ' ' + entry.msg); } });
  const avplay = createAvplay({ webapis: { avplay: av }, log, fill: opts.fill });
  const store = createStore({ storage: memoryStorage() });
  const settings = createSettings({ store, activeProfileId: () => 'p1', tvLanguage: () => opts.tvLanguage || 'en' });
  if (opts.settings && opts.settings.audioLang) store.set('settings/audioLang@p1', opts.settings.audioLang);
  if (opts.settings && opts.settings.subtitles === false) store.set('settings/subtitles', false);
  if (opts.settings && opts.settings.pictureSize) store.set('settings/pictureSize@p1', opts.settings.pictureSize);
  const library = createLibrary({ now: () => 1700000000000 + clock.now() });
  const memory = createSourceMemory(store);
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
  const engine = createEngine(params, {
    avplay, clock, stremio, authKey: 'FIXTURE-AUTH-KEY-0001', library, settings, memory, device: tu8000Profile(),
    http: opts.http || null, log, diag, tvLanguage: () => opts.tvLanguage || 'en',
    loadMeta: () => Promise.resolve(opts.meta || null),
  });
  const events = {};
  EVENTS.forEach((name) => { events[name] = []; engine.on(name, (data) => events[name].push(data)); });
  const calls = () => av.__mock.calls;
  return {
    engine, clock, av, events, log: lines, stremio, puts, store, diag, item, library, calls,
    callsOf: (method) => calls().filter((c) => c.method === method),
    opens: () => calls().filter((c) => c.method === 'open'),
    async start() { engine.start(); await clock.advance(0); },
    advance: (ms) => clock.advance(ms),
  };
}

export { createFakeClock, createRegistry };
