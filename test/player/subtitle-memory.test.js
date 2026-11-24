// Mac subtitle memory (T2.c1): the language the viewer picked in the menu (Off, a file track, an add-on subtitle) is started again for the
// next episode and on a rewatch; a file track first, else an add-on subtitle in that language (the remembered add-on first, then the add-on
// order). Nothing in that language: the normal start rule and the reason. Written by a menu pick only, never by the start rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subtitle } from '../../src/core/addon.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createReleaseMemory } from '../../src/core/release-memory.js';
import { createSubtitleMemory } from '../../src/core/subtitle-memory.js';
import { createEngine } from '../../src/player/engine.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';
import { makeEngine, stream } from './helpers.js';

const plainStore = () => {
  const m = new Map();
  const sets = [];
  return { m, sets, get: k => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { sets.push(k); m.set(k, v); }, remove: k => { m.delete(k); } };
};

const video = { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 };
const audio = { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true };
const sub = (id, lang, title, extra = {}) => Object.assign({ type: 'sub', id, lang, title, codec: 'subrip', selected: false }, extra);
const TR_EN = [video, audio, sub(1, 'eng', 'English'), sub(2, 'tur', 'Turkish')]; // English first: the normal rule starts English
const EN_ONLY = [video, audio, sub(1, 'eng', 'English')];
const NONE = [video, audio];

// a real subtitle has at least 5 cues (the engine skips message files)
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n' + [2, 3, 4, 5, 6].map((n) => '\n' + n + '\n01:0' + n + ':00,000 --> 01:0' + n + ':02,000\nlater ' + n + '\n').join('');
const addon = (clock, name, langs, delay = 0) => ({
  name, serves: () => true,
  subtitles: () => new Promise((resolve) => clock.setTimeout(() => resolve(langs.map((l, i) => new Subtitle('https://' + name.toLowerCase() + '.example/' + l + i + '.srt', l, name))), delay)),
});

/** One playback of an episode on the shared store; returns the engine's harness plus what the memory said. */
async function play({ store, videoId = 'tt9:1:1', tracks = TR_EN, addons = [], menu = null, ms = 40000, subLang = '' }) {
  clearSubtitleCache(); // the fetch keeps answers per add-on name and video id
  const reports = [];
  const mem = createReleaseMemory(store, createSourceMemory(store), { report: () => {} });
  mem.subtitles = createSubtitleMemory(store, { report: l => { if (!/^match:/.test(l)) reports.push(l); } }); // the T3 match: line is tested in mac.subtitle-match.test.js
  const src = stream('Movie 1080p WEB-DL x264-A', { tracks: JSON.stringify(tracks) });
  const t = makeEngine({ adapter: 'mpv', createEngine, memory: mem, sources: [src], params: { type: 'series', metaId: 'tt9', videoId }, http: { get: async () => SRT } });
  if (subLang) t.store.set('settings/subLang@p1', subLang);
  t.stremio.addons = async () => addons.map(a => addon(t.clock, a.name, a.langs, a.delay || 0));
  await t.start();
  await t.advance(ms);
  if (menu) { await menu(t); await t.advance(10); }
  return { t, reports, info: () => t.engine.tracks(), memLines: () => t.log.filter(l => /memory: subtitles|memory: no /.test(l)) };
}
const choose = async (t, kind, pick) => {
  const tr = t.engine.tracks();
  if (kind === 'off') return t.engine.selectSubtitle({ kind: 'off' });
  if (kind === 'file') return t.engine.selectSubtitle({ kind: 'file', index: tr.text.find(x => x.language === pick).index });
  return t.engine.selectSubtitle({ kind: 'addon', sub: tr.addonSubs.find(s => s.lang === pick.lang && s.addon === pick.addon) });
};

test('module: value shapes, key subs/<metaId>, a later pick overwrites, nothing else stored', () => {
  const store = plainStore();
  const m = createSubtitleMemory(store, { report: () => {} });
  assert.equal(m.get('tt9'), null);
  m.remember('tt9', { kind: 'lang', language: 'tr', addon: 'B' });
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'tr', addon: 'B' });
  assert.deepEqual(m.get('tt9'), { kind: 'lang', language: 'tr', addon: 'B' });
  m.remember('tt9', { kind: 'lang', language: 'en' });
  assert.deepEqual(m.get('tt9'), { kind: 'lang', language: 'en' });
  m.remember('tt9', { kind: 'off' });
  assert.deepEqual(m.get('tt9'), { kind: 'off' });
  store.m.set('subs/tt8', { kind: 'bogus' });
  assert.equal(m.get('tt8'), null);
  assert.deepEqual([...store.m.keys()].sort(), ['subs/tt8', 'subs/tt9']);
});

test('Turkish pick of a file track: the next episode and a rewatch start the Turkish file track (the normal rule would start English)', async () => {
  const store = plainStore();
  const plain = await play({ store: plainStore() });
  assert.equal(plain.info().textIndex, 0, 'today: English');
  assert.deepEqual(plain.reports, []);
  const first = await play({ store, menu: t => choose(t, 'file', 'tr') });
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'tr' });
  assert.deepEqual(first.reports, [], 'the first start had nothing remembered: nothing said');
  for (const videoId of ['tt9:1:2', 'tt9:1:1']) {
    const t = await play({ store, videoId });
    assert.equal(t.info().subMode, 'file');
    assert.equal(t.info().textIndex, 1);
    assert.equal(t.memLines().length, 1);
    assert.equal(t.t.diag.snapshot().decisions.filter(d => /memory: subtitles/.test(d.text || d)).length, 1);
    assert.deepEqual(t.reports, ['memory: found by=sub_file source=2']);
  }
});

test('Turkish pick of an add-on subtitle: a late add-on track is started, the remembered add-on first, then the add-on order', async () => {
  const store = plainStore();
  const addons = [{ name: 'A', langs: ['tur', 'eng'] }, { name: 'B', langs: ['tur'], delay: 500 }];
  await play({ store, tracks: EN_ONLY, addons, menu: t => choose(t, 'addon', { lang: 'tur', addon: 'B' }) });
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'tr', addon: 'B' });
  // A answers first and starts; B (the remembered add-on) answers 500 ms later and replaces it
  const next = await play({ store, videoId: 'tt9:1:2', tracks: EN_ONLY, addons });
  assert.equal(next.info().subMode, 'addon');
  assert.equal(next.info().chosenSub.addon, 'B');
  assert.equal(next.info().chosenSub.lang, 'tur');
  assert.equal(next.memLines().length, 1);
  assert.deepEqual(next.reports, ['memory: found by=sub_addon source=2', 'memory: upgraded to=B']);
  // the remembered add-on is gone: the first Turkish one in the add-on order
  const other = await play({ store, videoId: 'tt9:1:3', tracks: NONE, addons: [{ name: 'A', langs: ['eng', 'tur'] }, { name: 'C', langs: ['tur'] }] });
  assert.equal(other.info().chosenSub.addon, 'A');
  assert.equal(other.info().chosenSub.lang, 'tur');
  assert.equal(other.reports.length, 1);
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'tr', addon: 'B' }, 'the start rule wrote nothing');
});

test('English likewise: a file track, and a late add-on track', async () => {
  const store = plainStore();
  await play({ store, tracks: [video, audio, sub(1, 'tur', 'Turkish'), sub(2, 'eng', 'English')], menu: t => choose(t, 'file', 'en') });
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'en' });
  const f = await play({ store, videoId: 'tt9:1:2', tracks: [video, audio, sub(1, 'tur', 'Turkish'), sub(2, 'eng', 'English')] });
  assert.equal(f.info().textIndex, 1);
  assert.deepEqual(f.reports, ['memory: found by=sub_file source=2']);
  const l = await play({ store, videoId: 'tt9:1:3', tracks: [video, audio, sub(1, 'tur', 'Turkish')], addons: [{ name: 'A', langs: ['tur'] }, { name: 'B', langs: ['eng'], delay: 300 }] });
  assert.equal(l.info().subMode, 'addon');
  assert.equal(l.info().chosenSub.addon, 'B');
  assert.equal(l.info().chosenSub.lang, 'eng');
  assert.equal(l.reports.length, 1);
});

test('Off: the next episode starts with no subtitles, though a file track is in the TV language', async () => {
  const store = plainStore();
  await play({ store, menu: t => choose(t, 'off') });
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'off' });
  const next = await play({ store, videoId: 'tt9:1:2' });
  assert.equal(next.info().subMode, 'off');
  assert.equal(next.info().textIndex, null);
  assert.equal(next.memLines().length, 1);
  assert.deepEqual(next.reports, ['memory: found by=sub_off']);
  assert.ok(!next.t.log.some(l => /subtitles: started #/.test(l)), 'the normal rule did not start a track');
});

test('no track in the remembered language: the normal start rule plus the reason, one decide line and one memory: line', async () => {
  const store = plainStore();
  store.m.set('subs/tt9', { kind: 'lang', language: 'tr' });
  const t = await play({ store, tracks: EN_ONLY, addons: [{ name: 'A', langs: ['eng', 'fra'] }] });
  assert.equal(t.info().subMode, 'file');
  assert.equal(t.info().textIndex, 0, 'the normal rule: English');
  assert.equal(t.memLines().length, 1);
  assert.match(t.memLines()[0], /no Turkish subtitles/);
  assert.deepEqual(t.reports, ['memory: not offered by=sub']);
  const noAddons = await play({ store, tracks: EN_ONLY });
  assert.deepEqual(noAddons.reports, ['memory: not offered by=sub']);
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'tr' }, 'not overwritten by the start rule');
});

test('Turkish then English: the later pick wins on the next start', async () => {
  const store = plainStore();
  await play({ store, menu: async t => { await choose(t, 'file', 'tr'); await choose(t, 'file', 'en'); } });
  const next = await play({ store, videoId: 'tt9:1:2' });
  assert.equal(next.info().textIndex, 0);
  assert.deepEqual(store.m.get('subs/tt9'), { kind: 'lang', language: 'en' });
});

test('the start rule and a remembered start never write; nothing remembered says nothing; a menu pick is the only write; no link kept', async () => {
  const store = plainStore();
  const a = await play({ store });
  assert.deepEqual(store.sets.filter(k => /^subs\//.test(k)), []);
  assert.deepEqual(a.memLines(), []);
  await play({ store, tracks: EN_ONLY, addons: [{ name: 'A', langs: ['tur'] }], menu: t => choose(t, 'addon', { lang: 'tur', addon: 'A' }) });
  assert.equal(store.sets.filter(k => /^subs\//.test(k)).length, 1);
  await play({ store, videoId: 'tt9:1:2', tracks: EN_ONLY, addons: [{ name: 'A', langs: ['tur'] }] });
  assert.equal(store.sets.filter(k => /^subs\//.test(k)).length, 1, 'applying the memory is not a pick');
  assert.ok(!/https?:|example|\.srt/i.test(JSON.stringify([...store.m])), 'no link in the store');
});

test('subtitle language set, nothing remembered: the Turkish file track, else the first Turkish add-on subtitle', async () => {
  const f = await play({ store: plainStore(), subLang: 'tr' });
  assert.equal(f.info().subMode, 'file');
  assert.equal(f.info().textIndex, 1);
  const a = await play({ store: plainStore(), subLang: 'tr', tracks: EN_ONLY, addons: [{ name: 'A', langs: ['eng', 'tur'] }] });
  assert.equal(a.info().subMode, 'addon');
  assert.equal(a.info().chosenSub.lang, 'tur');
});

test('subtitle language set: a remembered Off stays off, a remembered English wins over the setting', async () => {
  const off = plainStore();
  off.m.set('subs/tt9', { kind: 'off' });
  const o = await play({ store: off, subLang: 'tr', tracks: EN_ONLY, addons: [{ name: 'A', langs: ['tur'] }] });
  assert.equal(o.info().subMode, 'off');
  const en = plainStore();
  en.m.set('subs/tt9', { kind: 'lang', language: 'en' });
  const e = await play({ store: en, subLang: 'tr' });
  assert.equal(e.info().subMode, 'file');
  assert.equal(e.info().textIndex, 0);
});
