// Mac add-on subtitle loading (src/platform/mac/subtitle-fetch.js): parallel, incremental, kept per video id, timed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macLoadAddonSubtitles, clearSubtitleCache } from '../../src/platform/mac/subtitle-fetch.js';

const sub = (addon, lang, n) => ({ addon, language: lang, url: 'x' + n });
function addon(name, run) {
  const a = { name, base: 'b-' + name, calls: 0, serves: () => true, subtitles: async () => { a.calls++; return run(); } };
  return a;
}
function rig(list, { refreshed = list } = {}) {
  const sets = [], reports = [];
  let t = 0;
  const stremio = { addons: async (k, refresh) => (refresh ? refreshed : list) };
  const run = () => macLoadAddonSubtitles({
    stremio, authKey: 'K', type: 'movie', videoId: 'tt1', tvLanguage: () => 'en',
    choose: (groups) => groups.reduce((all, g) => all.concat(g.subs), []),
    set: (v) => sets.push(v.map((s) => s.addon + ':' + s.url)), changed() {}, say() {}, warn() {},
    diag: null, now: () => (t += 10), report: (l) => reports.push(l),
  });
  return { run, sets, reports };
}
const later = (ms) => new Promise((r) => setTimeout(r, ms));

test('every add-on is asked at once and the menu fills as each answers, the fast one first', async () => {
  clearSubtitleCache();
  const slow = addon('Slow', async () => { await later(60); return [sub('Slow', 'en', 2)]; });
  const fast = addon('Fast', async () => [sub('Fast', 'en', 1)]);
  const r = rig([slow, fast]);
  const done = r.run();
  await later(20);
  assert.deepEqual(r.sets, [['Fast:x1']], 'the fast add-on is in the menu while the slow one is still out');
  await done;
  assert.deepEqual(r.sets[r.sets.length - 1], ['Slow:x2', 'Fast:x1']);
  assert.equal(slow.calls + fast.calls, 2, 'each asked once although the list came twice (memory, then refreshed)');
});

test('a failing add-on does not hold up or hide the others; the failure is logged with its time, no link', async () => {
  clearSubtitleCache();
  const bad = addon('Bad https://h.example/x', async () => { throw new Error('boom'); });
  const good = addon('Good', async () => [sub('Good', 'en', 1)]);
  const r = rig([bad, good]);
  await r.run();
  assert.deepEqual(r.sets[r.sets.length - 1], ['Good:x1']);
  assert.ok(r.reports.some((l) => /^subs-addon: fail name="Bad \[link\]" ms=\d+ count=0$/.test(l)), r.reports.join('|'));
  assert.ok(r.reports.some((l) => /^subs-addon: start name="Good"$/.test(l)));
  assert.ok(r.reports.some((l) => /^subs-addon: done name="Good" ms=\d+ count=1$/.test(l)));
  assert.ok(!r.reports.some((l) => /https?:/.test(l)));
});

test('an add-on only the refreshed list has is asked; an answer is kept for the same video id, a failure is not', async () => {
  clearSubtitleCache();
  const old = addon('Old', async () => [sub('Old', 'en', 1)]);
  const fresh = addon('Fresh', async () => [sub('Fresh', 'en', 2)]);
  let n = 0;
  const flaky = addon('Flaky', async () => { if (n++ === 0) throw new Error('first time'); return [sub('Flaky', 'en', 3)]; });
  const r1 = rig([old], { refreshed: [old, fresh, flaky] });
  await r1.run();
  assert.equal(fresh.calls, 1);
  const r2 = rig([old], { refreshed: [old, fresh, flaky] });
  await r2.run();
  assert.equal(old.calls, 1, 'kept: not asked again');
  assert.equal(fresh.calls, 1);
  assert.equal(flaky.calls, 2, 'a failure is asked again');
  assert.ok(r2.reports.some((l) => /done name="Old" ms=\d+ count=1 cached=1/.test(l)));
  assert.ok(!r2.reports.some((l) => /start name="Old"/.test(l)), 'no request, no start line');
});

test('the refresh failing falls back to the list in memory', async () => {
  clearSubtitleCache();
  const a = addon('A', async () => [sub('A', 'en', 1)]);
  const stremio = { addons: async (k, refresh) => { if (refresh) throw new Error('offline'); return [a]; } };
  const sets = [];
  await macLoadAddonSubtitles({ stremio, authKey: 'K', type: 'movie', videoId: 'tt9', tvLanguage: () => 'en', choose: (g) => g.reduce((x, y) => x.concat(y.subs), []),
    set: (v) => sets.push(v.length), changed() {}, report() {} });
  assert.deepEqual(sets, [1]);
});

test('nothing is published once the player is shut', async () => {
  clearSubtitleCache();
  const a = addon('A', async () => [sub('A', 'en', 1)]);
  const sets = [];
  await macLoadAddonSubtitles({ stremio: { addons: async () => [a] }, authKey: 'K', type: 'movie', videoId: 'tt8', tvLanguage: () => 'en', choose: (g) => g,
    set: (v) => sets.push(v), changed() {}, report() {}, isShut: () => true });
  assert.deepEqual(sets, []);
});
