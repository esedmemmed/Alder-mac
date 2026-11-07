// Mac Resume keeps the remembered source (T8.c1): after a play, Back to the title page and Resume starts the remembered release
// (the same pick as a start from Home), with one `memory:` report line. Mock only: the finder over fake add-ons, the Mac ranker and
// release memory, the engine on the mpv model; no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macProfile } from '../../src/platform/mac/device.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createReleaseMemory } from '../../src/platform/mac/release-memory.js';
import { playerParams } from '../../src/ui/screens-b/helpers.js';
import { RANKING_PATCHES, ENGINE_MEMORY_PATCHES, FINDER_MEMORY_PATCHES } from '../../scripts/build.mjs';
import { memoryStore, settingsStub } from '../core/helpers.js';
import { makeEngine, stream as playable } from '../player/helpers.js';

async function patched(rel, copyName, patches) {
  const src = fileURLToPath(new URL('../../' + rel, import.meta.url));
  const copy = fileURLToPath(new URL('../../' + rel.replace(/[^/]+$/, copyName), import.meta.url));
  let text = readFileSync(src, 'utf8');
  for (const [from, to] of patches) { assert.ok(text.includes(from), 'anchor present: ' + from); text = text.split(from).join(to); }
  writeFileSync(copy, text);
  try { return await import(pathToFileURL(copy).href); } finally { rmSync(copy, { force: true }); }
}
const { createRanker } = await patched('src/core/ranking.js', 'ranking.mac-resume-test.js', RANKING_PATCHES);
const { SourceFinder } = await patched('src/core/finder.js', 'finder.mac-resume-test.js', FINDER_MEMORY_PATCHES);
const { createEngine } = await patched('src/player/engine.js', 'engine.mac-resume-test.js', ENGINE_MEMORY_PATCHES);

const ID = 'tt15239678';
const REMEMBERED = 'Movie 2160p WEB-DL HEVC-A'; // outside the Mac's auto filter: only the memory lets it lead
const OTHER = 'Movie 1080p BluRay x264-D';
const addon = (name, make) => ({ name, streams: async () => make() });

/** What the sources page does: the finder over the add-ons with the session's ranker; resolves with what it did (play list or list). */
function findSources(params, mem, addons) {
  return new Promise((resolve) => {
    const ranker = createRanker({ settings: settingsStub(), device: macProfile(), memory: mem, videoId: params.videoId, metaId: params.id });
    const f = new SourceFinder({ addons, type: params.type, videoId: params.videoId, ranker, pick: !!params.pick,
      onPlay: (streams) => resolve({ played: streams }), onList: () => resolve({ listed: true }) });
    f.start();
  });
}

// the two ways to the sources page, as the code builds them: home.js play() and details.js openSources()
const fromHome = { type: 'movie', id: ID, name: 'Dune', poster: null, videoId: ID, nextVideoId: null, pick: false };
const fromDetails = { type: 'movie', id: ID, name: 'Dune', poster: null, background: null, videoId: ID, nextVideoId: null, startOver: false, pick: false };

async function watch(mem, played, how) {
  const t = makeEngine({ adapter: 'mpv', createEngine, memory: mem, sources: played, params: { picked: how === 'picked' } });
  await t.start();
  await t.advance(40000);
  t.engine.exit();
  await t.advance(100);
  return t;
}

async function scenario(path) {
  const store = memoryStore();
  const reports = [];
  const mem = createReleaseMemory(store, createSourceMemory(store), { report: (l) => reports.push(l) });
  const addons = [addon('A', () => [playable(OTHER), playable(REMEMBERED)])];
  // first watch: the viewer picked the 4K release from the list; it shows a picture and is remembered
  await watch(mem, [playable(REMEMBERED)], 'picked');
  // Back (to Home, or to the title page), then Resume
  const found = await findSources(path, mem, addons);
  assert.ok(found.played, 'no list: the source starts by itself');
  const t = await watch(mem, found.played, 'auto');
  return { found, t, reports };
}

test('Resume from Home starts the remembered release, one memory: line', async () => {
  const { found, reports } = await scenario(fromHome);
  assert.equal(found.played[0].filename, REMEMBERED.replace(/\s+/g, '.') + '.mkv');
  assert.deepEqual(reports, ['memory: found by=file source=1']);
});

test('Back to the title page, then Resume starts the remembered release, one memory: line', async () => {
  const { found, reports } = await scenario(fromDetails);
  assert.equal(found.played[0].filename, REMEMBERED.replace(/\s+/g, '.') + '.mkv');
  assert.deepEqual(reports, ['memory: found by=file source=1']);
});

// ---- the race: the remembered release is in a slower add-on than the first one that has something playable ----

/** An add-on whose answer the test gives when it likes. */
const slowAddon = (name) => { let give; const p = new Promise((r) => { give = r; }); return { name, streams: () => p, give }; };
/** Timers the test moves by hand (the finder's 800 ms wait for earlier add-ons). */
const handTimers = () => { const q = []; return { setTimeout: (f) => { q.push(f); return q.length; }, clearTimeout: () => {}, fire: () => { while (q.length) q.shift()(); } }; };

async function resumeWith(order, { remember = true } = {}) {
  const store = memoryStore();
  const reports = [];
  const mem = createReleaseMemory(store, createSourceMemory(store), { report: (l) => reports.push(l) });
  if (remember) await watch(mem, [playable(REMEMBERED)], 'picked'); // watched before, picked from the list
  const first = slowAddon('first'), second = slowAddon('second'), timers = handTimers();
  const ranker = createRanker({ settings: settingsStub(), device: macProfile(), memory: mem, videoId: ID, metaId: ID });
  const out = [];
  const f = new SourceFinder({ addons: [first, second], type: 'movie', videoId: ID, ranker, pick: false, timers,
    onPlay: (streams) => out.push({ played: streams }), onList: () => out.push({ listed: true }) });
  f.start();
  await order({ first, second, timers, out });
  return { out, reports, mem };
}
const nameOf = (s) => s.filename.replace(/\.mkv$/, '').replace(/\./g, ' ');

test('Resume: the first add-on answers with a playable release, the remembered one comes from the second add-on: it still leads', async () => {
  const { out } = await resumeWith(async ({ first, second }) => {
    first.give([playable(OTHER)]);
    await new Promise((r) => setImmediate(r));
    second.give([playable(REMEMBERED)]);
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(out.length, 1, 'one start');
  assert.equal(nameOf(out[0].played[0]), REMEMBERED);
});

test('Resume: the second add-on never answers: after the 800 ms wait the first add-on source starts (the 1.4 behaviour)', async () => {
  const { out } = await resumeWith(async ({ first, timers, out }) => {
    first.give([playable(OTHER)]);
    await new Promise((r) => setImmediate(r));
    assert.equal(out.length, 0, 'held for the remembered release');
    timers.fire();
  });
  assert.equal(out.length, 1);
  assert.equal(nameOf(out[0].played[0]), OTHER);
});

test('Resume: the held start logs one memory: waiting line (no link); with nothing remembered the first add-on starts at once', async () => {
  const held = await resumeWith(async ({ first, second }) => {
    first.give([playable(OTHER)]);
    await new Promise((r) => setImmediate(r));
    second.give([playable(REMEMBERED)]);
    await new Promise((r) => setImmediate(r));
  });
  assert.deepEqual(held.reports, ['memory: waiting for add-ons']);
  const fresh = await resumeWith(async ({ first, out }) => {
    first.give([playable(OTHER)]);
    await new Promise((r) => setImmediate(r));
    assert.equal(out.length, 1, 'no wait');
  }, { remember: false });
  assert.deepEqual(fresh.reports, []);
});

test('1.4 fallback: the remembered release is in no add-on: every add-on answered, the normal ranking starts; a remembered one that fails still fails over', async () => {
  const { out } = await resumeWith(async ({ first, second }) => {
    first.give([playable(OTHER)]);
    await new Promise((r) => setImmediate(r));
    second.give([playable('Movie 720p WEB-DL x264-E')]);
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(out.length, 1);
  assert.equal(nameOf(out[0].played[0]), OTHER);
  const t = await watch(createReleaseMemory(memoryStore(), createSourceMemory(memoryStore()), { report: () => {} }), [playable('Movie 2160p WEB-DL HEVC-A', { 'prepare': 'fail:PLAYER_ERROR_NOT_SUPPORTED_FORMAT' }), playable(OTHER)], 'auto');
  assert.ok(t.events.started.length >= 1, 'the failover reached the next source');
});
