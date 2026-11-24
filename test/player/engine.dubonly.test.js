// A file whose only sound is dubs (uk, ru, hi, ta, te, ml, kn, bn, pl) is left for the next source, forgotten by the release memory and
// not counted as a failure; English, 'und', untagged, the profile's language or a title from that country keep it. Tizen only: the track
// scenarios are AVPlay's (mpv's mock lists no audio languages); the rule itself is shared (core/audio.js, engine.js skipDubOnly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, stream } from './helpers.js';
import { Meta } from '../../src/core/addon.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createStore, memoryStorage } from '../../src/lib/store.js';

const A = (lang, codec = 'AC3') => ({ type: 'AUDIO', codec, lang, channels: 2 });
const tracks = (...langs) => JSON.stringify(langs.map((l) => A(l)));
const decisions = (t) => t.diag.snapshot().decisions.map((d) => d.text);
const VIDEO = 'tt15239678';

function setup(sources, { dub = null, meta = null } = {}) {
  const store = createStore({ storage: memoryStorage() });
  const memory = createSourceMemory(store);
  const failed = [];
  memory.noteFailed = (info) => failed.push(info.reason);
  sources.forEach((s) => memory.remember(VIDEO, VIDEO, s)); // every one is "remembered": the last write wins the file key
  const t = makeEngine({ sources, memory, meta });
  if (dub) t.store.set('settings/dub@p1', dub);
  return { t, memory, failed };
}

test('dub-only: Ukrainian-only is skipped, forgotten, not a failure; the next source plays', async () => {
  const sources = [stream('Black Mirror S01E01', { tracks: tracks('ukr') }, { filename: 'uk.mkv' }), stream('Black Mirror S01E01 B', { tracks: tracks('eng') }, { filename: 'en.mkv' })];
  const { t, memory, failed } = setup(sources);
  memory.remember(VIDEO, VIDEO, sources[0]); // the dub is the remembered one
  await t.start();
  await t.advance(3000);
  assert.ok(decisions(t).includes('source: skipped, sound only in Ukrainian'), decisions(t).join(' | '));
  assert.equal(t.loads().length, 2);
  assert.equal(t.events.started.length, 1);
  assert.equal(t.events.started[0].source, 1);
  assert.ok(!decisions(t).some((d) => /source failed/.test(d)), 'not a failure');
  assert.deepEqual(failed, [], 'the release memory is not told of a failure');
  assert.equal(memory.file(VIDEO), 'en.mkv', 'the dub is forgotten (the playing source is remembered now)');
});

test("dub-only: the skipped release's group is forgotten too", async () => {
  const sources = [stream('A', { tracks: tracks('rus') }, { filename: 'ru.mkv', bingeGroup: 'grp' }), stream('B', { tracks: tracks('eng') }, { filename: 'en.mkv' })];
  const store = createStore({ storage: memoryStorage() });
  const memory = createSourceMemory(store);
  memory.remember(VIDEO, VIDEO, sources[0]);
  const t = makeEngine({ sources, memory });
  await t.start();
  await t.advance(300);
  assert.equal(memory.file(VIDEO), null, 'forgotten at once, before the next source shows a picture');
  await t.advance(3000);
  assert.equal(memory.file(VIDEO), 'en.mkv');
  assert.equal(memory.binge(VIDEO), null, 'its group no longer leads');
});

test('dub-only: Ukrainian and English together is kept', async () => {
  const { t } = setup([stream('A', { tracks: tracks('ukr', 'eng') }), stream('B')]);
  await t.start();
  await t.advance(3000);
  assert.equal(t.loads().length, 1);
  assert.equal(t.events.started[0].source, 0);
  assert.ok(!decisions(t).some((d) => /sound only/.test(d)));
});

test('dub-only: an undetermined track is kept', async () => {
  const { t } = setup([stream('A', { tracks: tracks('und') }), stream('B')]);
  await t.start();
  await t.advance(3000);
  assert.equal(t.loads().length, 1);
  assert.ok(!decisions(t).some((d) => /sound only/.test(d)));
});

test('dub-only: a Ukrainian film (country Ukraine) is kept', async () => {
  const meta = new Meta({ id: VIDEO, type: 'movie', name: 'Stop-Zemlia', country: 'Ukraine', videos: [] });
  const { t } = setup([stream('A', { tracks: tracks('ukr') }), stream('B')], { meta });
  await t.start();
  await t.advance(3000);
  assert.equal(t.loads().length, 1);
  assert.ok(!decisions(t).some((d) => /sound only/.test(d)));
});

test('dub-only: a meta that names another country does not save it', async () => {
  const meta = new Meta({ id: VIDEO, type: 'series', name: 'Black Mirror', country: 'United Kingdom', videos: [] });
  const { t } = setup([stream('A', { tracks: tracks('ukr') }), stream('B')], { meta });
  await t.start();
  await t.advance(3000);
  assert.ok(decisions(t).includes('source: skipped, sound only in Ukrainian'));
});

test('dub-only: the last source is kept, with the line', async () => {
  const { t } = setup([stream('A', { tracks: tracks('ukr') })]);
  await t.start();
  await t.advance(3000);
  assert.ok(decisions(t).includes('source: sound only in Ukrainian, no other source'), decisions(t).join(' | '));
  assert.equal(t.events.started.length, 1);
  assert.equal(t.loads().length, 1);
});

test('dub-only: every source a dub, the last one plays', async () => {
  const { t } = setup([stream('A', { tracks: tracks('ukr') }), stream('B', { tracks: tracks('hin') })]);
  await t.start();
  await t.advance(3000);
  assert.ok(decisions(t).includes('source: skipped, sound only in Ukrainian'));
  assert.ok(decisions(t).includes('source: sound only in Hindi, no other source'));
  assert.equal(t.events.started[0].source, 1);
});

test("dub-only: the Dubbed releases setting 'mine' keeps it", async () => {
  const { t } = setup([stream('A', { tracks: tracks('ukr') }), stream('B')], { dub: 'mine' });
  await t.start();
  await t.advance(3000);
  assert.equal(t.loads().length, 1);
  assert.ok(!decisions(t).some((d) => /sound only/.test(d)));
});
