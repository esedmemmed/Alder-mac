import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macProfile } from '../../src/platform/mac/device.js';
import { Stream } from '../../src/core/addon.js';
import { RANKING_PATCHES } from '../../scripts/build.mjs';
import { settingsStub, stream } from '../core/helpers.js';

// The Mac bundle ranks with src/core/ranking.js plus RANKING_PATCHES; load exactly that text (a copy beside the original, for its imports).
const src = fileURLToPath(new URL('../../src/core/ranking.js', import.meta.url));
const copy = fileURLToPath(new URL('../../src/core/ranking.mac-test.js', import.meta.url));
let text = readFileSync(src, 'utf8');
for (const [from, to] of RANKING_PATCHES) {
  assert.ok(text.includes(from), 'anchor present: ' + from);
  text = text.split(from).join(to);
}
writeFileSync(copy, text);
let createRanker;
try { ({ createRanker } = await import(pathToFileURL(copy).href)); } finally { rmSync(copy, { force: true }); }

const names = {
  k4: 'Movie.2160p.WEB-DL.DDP5.1.HEVC-A.mkv',
  ten: 'Movie.1080p.BluRay.10bit.DDP5.1.x265-B.mkv',
  fps60: 'Movie.1080p60.WEB-DL.DDP5.1.x264-C.mkv',
  dts: 'Movie.1080p.BluRay.DTS.x264-D.mkv',
  p720: 'Movie.720p.WEB-DL.DDP5.1.x264-E.mkv',
};
const streams = Object.values(names).map(n => stream(n));
const ranker = () => createRanker({ settings: settingsStub(), device: macProfile(), memory: null, videoId: 'v', metaId: 'm' });

test('Mac: auto-play takes only H.264 8-bit 1080p30 or lower, in rank order', () => {
  assert.deepEqual(ranker().autoCandidates(streams).map(s => s.filename), [names.dts, names.p720]);
});

test('Mac: the manual list holds all five, BEST MATCH is an auto-eligible one, none dropped for sound', () => {
  const r = ranker();
  assert.ok(streams.every(s => r.playable(s)));
  assert.ok(streams.every(s => !r.noSound(s)));
  const model = r.listModel(streams.map(stream => ({ stream, addon: 'A' })));
  assert.equal(model.count, 5);
  assert.deepEqual(model.streams.map(s => s.filename).sort(), Object.values(names).sort());
  assert.equal(model.best.filename, names.dts);
});

test('Mac: a torrent-only entry has no url and never becomes a stream', () => {
  assert.equal(Stream.from({ name: 'T', infoHash: 'abc', fileIdx: 0 }), null);
});

test('Mac: unknown codec and frame rate stay auto-eligible', () => {
  const plain = stream('Movie.1080p.mkv');
  assert.equal(macProfile().autoOk(plain), true);
  assert.equal(macProfile().autoOk(stream('Movie.mkv')), true);
});
