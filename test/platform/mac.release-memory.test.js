// Mac release memory (T1.c1): a source the viewer watched is led again on a rewatch (by file name, or by a signature when the add-on
// gives no file name) and for the next episode (by bingeGroup, else by signature), even when it is outside the Mac's auto-play filter
// (HEVC, 4K, > 30 fps). Not offered, or failing, the normal ranking and the failover are unchanged. No link, host or token is stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macProfile } from '../../src/platform/mac/device.js';
import { Stream } from '../../src/core/addon.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createReleaseMemory, signature } from '../../src/platform/mac/release-memory.js';
import { RANKING_PATCHES, ENGINE_MEMORY_PATCHES, SESSION_PATCHES } from '../../scripts/build.mjs';
import { settingsStub, stream } from '../core/helpers.js';
import { makeEngine, stream as playable } from '../player/helpers.js';

// The Mac bundle's own text of ranking.js and engine.js (the memory patches), loaded from a copy beside each original, for its imports.
async function patched(rel, copyName, patches) {
  const src = fileURLToPath(new URL('../../' + rel, import.meta.url));
  const copy = fileURLToPath(new URL('../../' + rel.replace(/[^/]+$/, copyName), import.meta.url));
  let text = readFileSync(src, 'utf8');
  for (const [from, to] of patches) {
    assert.ok(text.includes(from), 'anchor present: ' + from);
    text = text.split(from).join(to);
  }
  writeFileSync(copy, text);
  try { return await import(pathToFileURL(copy).href); } finally { rmSync(copy, { force: true }); }
}
const { createRanker } = await patched('src/core/ranking.js', 'ranking.mac-memory-test.js', RANKING_PATCHES);
const { createEngine } = await patched('src/player/engine.js', 'engine.mac-memory-test.js', ENGINE_MEMORY_PATCHES);

const plainStore = () => {
  const m = new Map();
  return { m, get: k => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
};
const memoryOf = (store = plainStore(), reports = []) => {
  const mem = createReleaseMemory(store, createSourceMemory(store), { report: l => reports.push(l) });
  return { mem, store, reports };
};
const noName = (title, bingeGroup) => new Stream(title, '', 'https://media.fixture.test/x.mkv', {}, 0, undefined, bingeGroup);
const ranker = (memory, videoId = 'tt1', metaId = 'tt1') => createRanker({ settings: settingsStub(), device: macProfile(), memory, videoId, metaId });

const K4 = 'Movie.2160p.WEB-DL.DDP5.1.HEVC-A.mkv'; // outside the Mac's auto filter
const DTS = 'Movie.1080p.BluRay.DTS.x264-D.mkv';
const P720 = 'Movie.720p.WEB-DL.DDP5.1.x264-E.mkv';
const HFR = 'Movie.1080p60.WEB-DL.DDP5.1.x264-C.mkv';
const list = (...names) => names.map(n => stream(n));

test('signature: group, resolution, source, codec and HDR kept, episode markers and the title dropped; too little is none', () => {
  const a = signature(stream('Show.S01E01.2160p.WEB-DL.HEVC-GRP.mkv'));
  assert.equal(a, signature(stream('Show.S03E10.2160p.WEB-DL.HEVC-GRP.mkv')));
  assert.equal(a, signature(noName('Show 1x05 2160p WEB-DL HEVC-GRP')));
  assert.notEqual(a, signature(stream('Show.S01E01.2160p.WEB-DL.HEVC-OTHER.mkv')));
  assert.notEqual(a, signature(stream('Show.S01E01.1080p.WEB-DL.x264-GRP.mkv')));
  assert.notEqual(signature(stream('Show.2160p.DV.HEVC-G.mkv')), signature(stream('Show.2160p.HDR.HEVC-G.mkv')));
  assert.equal(signature(noName('Film')), null);
  assert.equal(signature(noName('Film 1080p')), null);
});

test('Mac memory: a movie rewatch leads with the file watched before, outside the auto filter (HEVC 4K)', () => {
  const { mem } = memoryOf();
  assert.deepEqual(ranker(null).autoCandidates(list(DTS, P720, K4)).map(s => s.filename), [DTS, P720], 'today: the 4K is never auto');
  mem.remember('tt1', 'tt1', stream(K4));
  assert.deepEqual(ranker(mem).autoCandidates(list(DTS, P720, K4)).map(s => s.filename), [K4, DTS, P720]);
  assert.deepEqual(ranker(mem).listModel(list(DTS, K4, P720).map(s => ({ stream: s, addon: 'A' }))).streams[0].filename, K4);
});

test('Mac memory: a rewatch finds the release by signature when the add-on gives no file name; 60 fps too', () => {
  const { mem } = memoryOf();
  mem.remember('tt1', 'tt1', stream(HFR));
  const again = [stream(DTS), noName('Movie.1080p60.WEB-DL.DDP5.1.x264-C'), stream(P720)];
  const got = ranker(mem).autoCandidates(again);
  assert.equal(got[0], again[1]);
  assert.equal(got.length, 3);
  assert.equal(mem.match('tt1', 'tt1', again[1]), 'signature');
  assert.equal(mem.match('tt1', 'tt1', again[0]), null);
});

test('Mac memory: the next episode leads with the same bingeGroup, else the same signature, outside the auto filter', () => {
  const { mem } = memoryOf();
  mem.remember('tt2:1:1', 'tt2', stream('Show.S01E01.2160p.WEB-DL.HEVC-A.mkv', { bingeGroup: 'aio|4k|A' }));
  const byGroup = [stream('Show.S01E02.1080p.WEB-DL.x264-Z.mkv'), stream('Show.S01E02.Other.mkv', { bingeGroup: 'aio|4k|A' })];
  assert.equal(ranker(mem, 'tt2:1:2', 'tt2').autoCandidates(byGroup)[0], byGroup[1]);
  assert.equal(mem.match('tt2:1:2', 'tt2', byGroup[1]), 'group');
  const bySig = [stream('Show.S01E02.1080p.WEB-DL.x264-Z.mkv'), stream('Show.S01E02.2160p.WEB-DL.HEVC-A.mkv')];
  assert.equal(ranker(mem, 'tt2:1:2', 'tt2').autoCandidates(bySig)[0], bySig[1]);
  assert.equal(mem.match('tt2:1:2', 'tt2', bySig[1]), 'signature');
  // and ep 1 again: the file wins over the signature
  assert.equal(mem.match('tt2:1:1', 'tt2', stream('Show.S01E01.2160p.WEB-DL.HEVC-A.mkv', { bingeGroup: 'x' })), 'file');
});

test('Mac memory: nothing remembered, or no remembered release among the sources: the normal ranking', () => {
  const { mem } = memoryOf();
  const names = [DTS, P720, K4, HFR];
  const plain = ranker(null).autoCandidates(list(...names)).map(s => s.filename);
  assert.deepEqual(ranker(mem).autoCandidates(list(...names)).map(s => s.filename), plain);
  mem.remember('tt1', 'tt1', stream('Movie.2160p.BluRay.DV.HEVC-ZZ.mkv'));
  assert.deepEqual(ranker(mem).autoCandidates(list(...names)).map(s => s.filename), plain);
});

test('Mac memory: only names and groups are stored, never a link, a host or a token', () => {
  const { mem, store } = memoryOf();
  const s = new Stream('Movie 2160p WEB-DL HEVC-A', 'https://secret.example/?token=abc', 'https://cdn.secret.example/f/abc123?token=TOPSECRET', { Authorization: 'Bearer TOPSECRET' }, 0, K4, 'aio|g');
  mem.remember('tt1', 'tt1', s);
  const dump = JSON.stringify([...store.m]);
  assert.ok(dump.includes(K4) && dump.includes('aio|g'));
  assert.ok(!/https?:|secret|token|TOPSECRET|Bearer|abc123/i.test(dump), dump);
  mem.remember('tt1', 'tt1', noName('Film'));
  assert.deepEqual([...store.m.keys()].filter(k => /sig/.test(k)), [], 'no signature, nothing kept');
});

const quiet = (name, opts = {}, extra = {}) => playable(name, opts, extra);

async function play(mem, sources) {
  const t = makeEngine({ adapter: 'mpv', createEngine, memory: mem, sources });
  await t.start();
  await t.advance(40000);
  return t;
}

test('Mac memory: the remembered source plays first: decide line "found by file" and one memory: line', async () => {
  const { mem, reports } = memoryOf();
  mem.remember('tt15239678', 'tt15239678', quiet('Movie 2160p WEB-DL HEVC-A'));
  const t = await play(mem, [quiet('Movie 2160p WEB-DL HEVC-A'), quiet('Movie 1080p BluRay x264-D')]);
  assert.equal(t.log.filter(l => /memory: remembered source found by file/.test(l)).length, 1);
  assert.deepEqual(reports, ['memory: found by=file source=1']);
  assert.ok(t.diag.snapshot().decisions.some(d => /remembered source found by file/.test(d.text || d)));
  assert.ok(t.events.started.length === 1);
});

test('Mac memory: found by signature when the sources carry no file name', async () => {
  const { mem, reports } = memoryOf();
  mem.remember('tt15239678', 'tt15239678', quiet('Movie 2160p WEB-DL HEVC-A'));
  const t = await play(mem, [new Stream('Movie.2160p.WEB-DL.HEVC-A', '', quiet('x').url, {}, 0, undefined, undefined), quiet('Movie 1080p BluRay x264-D')]);
  assert.ok(t.log.some(l => /memory: remembered source found by signature/.test(l)));
  assert.deepEqual(reports, ['memory: found by=signature source=1']);
});

test('Mac memory: not offered: one decide line, one memory: line, playback as before', async () => {
  const { mem, reports } = memoryOf();
  mem.remember('tt15239678', 'tt15239678', quiet('Movie 2160p WEB-DL HEVC-A'));
  const t = await play(mem, [quiet('Movie 1080p BluRay x264-D'), quiet('Movie 720p WEB-DL x264-E')]);
  assert.equal(t.log.filter(l => /memory: remembered source not offered/.test(l)).length, 1);
  assert.deepEqual(reports, ['memory: not offered']);
  assert.ok(t.log.some(l => /picture on, source 1\/2/.test(l)));
});

test('Mac memory: the remembered source fails: one decide line, one memory: line, the failover goes on to the next source', async () => {
  const { mem, reports } = memoryOf();
  mem.remember('tt15239678', 'tt15239678', quiet('Movie 2160p WEB-DL HEVC-A'));
  const bad = quiet('Movie 2160p WEB-DL HEVC-A', { prepare: 'fail:PLAYER_ERROR_CONNECTION_FAILED' });
  const t = await play(mem, [bad, quiet('Movie 1080p BluRay x264-D')]);
  assert.equal(t.log.filter(l => /memory: remembered source failed \(.*\), falling back/.test(l)).length, 1);
  assert.deepEqual(reports, ['memory: found by=file source=1', 'memory: failed, falling back by=file']);
  assert.ok(t.log.some(l => /trying source 2\/2/.test(l)));
  assert.ok(t.log.some(l => /picture on, source 2\/2/.test(l)));
  assert.ok(!reports.join(' ').match(/https?:/));
});

test('Mac memory: a manual pick is not commented on, and a Tizen-style memory (no Mac methods) changes nothing', async () => {
  const { mem, reports } = memoryOf();
  mem.remember('tt15239678', 'tt15239678', quiet('Movie 2160p WEB-DL HEVC-A'));
  const t = makeEngine({ adapter: 'mpv', createEngine, memory: mem, sources: [quiet('Movie 1080p BluRay x264-D')], params: { picked: true } });
  await t.start(); await t.advance(10000);
  assert.deepEqual(reports, []);
  const plain = makeEngine({ adapter: 'mpv', createEngine, sources: [quiet('Movie 1080p BluRay x264-D')] });
  await plain.start(); await plain.advance(10000);
  assert.ok(plain.log.some(l => /picture on, source 1\/1/.test(l)));
  assert.ok(!plain.log.some(l => /memory:/.test(l)));
});

test('Mac build: the session builds the release memory over the shared one', () => {
  const text = readFileSync(fileURLToPath(new URL('../../src/app/session.js', import.meta.url)), 'utf8');
  for (const [from] of SESSION_PATCHES) assert.ok(text.includes(from), 'anchor present: ' + from);
});
