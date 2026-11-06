// Mac subtitle name match (T3.c1): Subtitle records keep id and label (build.mjs patch), the start picks the matching add-on subtitle within the
// remembered language (the file's own track first), a later match replaces an unmatched started one within 15 s unless picked by hand, the menu
// lists the match first, and each start logs one decide() line and one `match:` line (no links).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Addon, Subtitle } from '../../src/core/addon.js';
import { chooseAddonSubtitles } from '../../src/core/playback.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createReleaseMemory } from '../../src/platform/mac/release-memory.js';
import { createSubtitleMemory, subtitlePlan, matchContext } from '../../src/platform/mac/subtitle-memory.js';
import { macLoadAddonSubtitles, clearSubtitleCache } from '../../src/platform/mac/subtitle-fetch.js';
import { SUBTITLE_MEMORY_PATCHES, SUBTITLE_FETCH_PATCHES, SUBTITLE_ID_PATCHES } from '../../scripts/build.mjs';
import { makeEngine, stream } from '../player/helpers.js';

async function patched(file, copyName, patches, swaps = []) {
  const src = fileURLToPath(new URL('../../src/' + file, import.meta.url));
  const copy = fileURLToPath(new URL('../../src/' + file.replace(/\.js$/, '') + '.' + copyName + '.js', import.meta.url));
  let text = readFileSync(src, 'utf8');
  for (const [from, to] of patches) {
    assert.ok(text.includes(from), 'anchor present: ' + from);
    text = text.split(from).join(to);
  }
  for (const [a, b] of swaps) text = text.split(a).join(b);
  writeFileSync(copy, text);
  try { return await import(pathToFileURL(copy).href); } finally { rmSync(copy, { force: true }); }
}
const { createEngine } = await patched('player/engine.js', 'mac-match-test', [...SUBTITLE_MEMORY_PATCHES, ...SUBTITLE_FETCH_PATCHES], [['#platform/subtitle-memory', '../platform/mac/subtitle-memory.js'], ['#platform/subtitle-fetch', '../platform/mac/subtitle-fetch.js']]);
const { Addon: MacAddon } = await patched('core/addon.js', 'mac-match-test', SUBTITLE_ID_PATCHES);

const plainStore = () => {
  const m = new Map();
  return { m, get: k => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
};
const video = { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 };
const audio = { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true };
const fileSub = (id, lang, title) => ({ type: 'sub', id, lang, title, codec: 'subrip', selected: false });
const NONE = [video, audio];
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n';
const OWN = 'Show.S01E02.1080p.WEB-DL.x264-GRP';
const OTHER = 'Show.S01E02.720p.WEB-DL.x264-OTHER';
const NUMERIC = '1954712345';

// one add-on: its subtitles are { lang, id, label }, answered after `delay` ms
const addon = (clock, name, subs, delay = 0) => ({
  name, serves: () => true,
  subtitles: () => new Promise((resolve) => clock.setTimeout(() => resolve(subs.map(s => Object.assign(new Subtitle('https://' + name.toLowerCase() + '.example/' + s.id + '.srt', s.lang, name), { id: s.id, label: s.label }))), delay)),
});

async function play({ addons, tracks = NONE, hand = null, ms = 40000, remembered = { kind: 'lang', language: 'en' } }) {
  clearSubtitleCache(); // the fetch keeps answers per add-on name and video id
  const store = plainStore();
  if (remembered) store.m.set('subs/tt9', remembered);
  const reports = [];
  const mem = createReleaseMemory(store, createSourceMemory(store), { report: () => {} });
  mem.subtitles = createSubtitleMemory(store, { report: l => reports.push(l) });
  const src = stream('Show S01E02 1080p WEB-DL x264-GRP', { tracks: JSON.stringify(tracks) });
  const t = makeEngine({ adapter: 'mpv', createEngine, memory: mem, sources: [src], params: { type: 'series', metaId: 'tt9', videoId: 'tt9:1:2' }, http: { get: async () => SRT } });
  t.stremio.addons = async () => addons.map(a => addon(t.clock, a.name, a.subs, a.delay || 0));
  await t.start();
  if (hand) { await t.advance(hand.at); await hand.fn(t); await t.advance(10); }
  await t.advance(ms);
  const decisions = t.diag.snapshot().decisions.map(d => d.text || d);
  return { t, reports, store, info: () => t.engine.tracks(), decisions, matchLines: reports.filter(l => /^match:/.test(l)) };
}
const en = (id, label) => ({ lang: 'eng', id, label });

test('Mac patch: a Subtitle record keeps id and label; a record without them has null; the shared text is unpatched', async () => {
  const json = { subtitles: [{ id: NUMERIC, url: 'https://os.example/a.srt', lang: 'eng', label: OWN }, { id: 'x', url: 'https://os.example/b.srt', lang: 'tur' }, { url: 'https://os.example/c.srt', lang: 'fra' }] };
  const desc = { transportUrl: 'https://os.example/manifest.json', manifest: { id: 'os', name: 'OpenSubtitles', resources: ['subtitles'], types: ['series'] } };
  const http = { get: async () => JSON.stringify(json) };
  const mac = await new MacAddon(desc, { http }).subtitles('series', 'tt9:1:2');
  assert.deepEqual(mac.map(s => [s.id, s.label]), [[NUMERIC, OWN], ['x', null], [null, null]]);
  assert.equal(mac[0].addon, 'OpenSubtitles');
  const shared = await new Addon(desc, { http }).subtitles('series', 'tt9:1:2');
  assert.equal(shared[0].id, undefined, 'src/core/addon.js is unchanged');
});

test('plan: file track first; then the best match; then the remembered add-on; then the add-on order', () => {
  const lang = l => ({ eng: 'en', tur: 'tr' }[l]);
  const subs = [
    Object.assign(new Subtitle('u1', 'eng', 'A'), { id: NUMERIC, label: null }),
    Object.assign(new Subtitle('u2', 'eng', 'B'), { id: '2', label: OTHER }),
    Object.assign(new Subtitle('u3', 'eng', 'C'), { id: '3', label: OWN }),
  ];
  const ctx = matchContext({ filename: OWN + '.mkv' });
  assert.equal(ctx.sig, '1080p|web|avc|grp');
  const base = { addonSubs: subs, addonsDone: true, lang, textTracks: [] };
  const plan = subtitlePlan({ kind: 'lang', language: 'en', addon: 'A' }, { ...base, match: ctx });
  assert.deepEqual([plan.kind, plan.sub.addon, plan.matched, plan.stats], ['addon', 'C', true, { best: 13, named: 2, n: 3 }], 'the match beats the remembered add-on');
  const file = subtitlePlan({ kind: 'lang', language: 'en' }, { ...base, match: ctx, textTracks: [{ index: 0, language: 'en', forced: false }] });
  assert.equal(file.kind, 'file');
  const remembered = subtitlePlan({ kind: 'lang', language: 'en', addon: 'B' }, { ...base, addonSubs: subs.slice(0, 2), match: ctx });
  assert.deepEqual([remembered.sub.addon, remembered.matched], ['B', false]);
  const order = subtitlePlan({ kind: 'lang', language: 'en' }, { ...base, addonSubs: subs.slice(0, 2), match: ctx });
  assert.deepEqual([order.sub.addon, order.matched], ['A', false], 'no match: the add-on order, as 1.4');
  assert.equal(subtitlePlan({ kind: 'lang', language: 'tr' }, { ...base, match: ctx }).kind, 'none');
});

test('start: the matching add-on subtitle starts, not the first; one decide line and one match: line, no link', async () => {
  const r = await play({ addons: [{ name: 'A', subs: [en(NUMERIC, null)] }, { name: 'B', subs: [en('2', OTHER), en('3', OWN)] }] });
  assert.equal(r.info().subMode, 'addon');
  assert.equal(r.info().chosenSub.id, '3');
  assert.deepEqual(r.matchLines, ['match: best=13 named=2/3']);
  assert.equal(r.decisions.filter(d => /name match/.test(d)).length, 1);
  assert.ok(!/https?:|example|\.srt/i.test(JSON.stringify([r.reports, r.decisions.filter(d => /name match/.test(d))])), 'no link in the lines');
});

test('start: the file\'s own track in the language stays first, even with a matching add-on subtitle', async () => {
  const r = await play({ tracks: [video, audio, fileSub(1, 'eng', 'English')], addons: [{ name: 'B', subs: [en('3', OWN)] }] });
  assert.equal(r.info().subMode, 'file');
  assert.equal(r.info().textIndex, 0);
  assert.deepEqual(r.matchLines, []);
});

test('start: nothing matches (numeric id only): 1.4 order, the first add-on subtitle; named=0', async () => {
  const r = await play({ addons: [{ name: 'A', subs: [en(NUMERIC, null)] }, { name: 'B', subs: [en('1954712346', null)] }] });
  assert.equal(r.info().chosenSub.addon, 'A');
  assert.deepEqual(r.matchLines, ['match: best=0 named=0/2']);
});

test('late match: replaces the unmatched add-on subtitle within 15 s, one more decide and match: line', async () => {
  const r = await play({ addons: [{ name: 'A', subs: [en(NUMERIC, null)] }, { name: 'B', subs: [en('3', OWN)], delay: 3000 }] });
  assert.equal(r.info().chosenSub.id, '3');
  assert.deepEqual(r.matchLines, ['match: best=0 named=0/1', 'match: replaced best=13 named=1/2']);
  assert.equal(r.decisions.filter(d => /replaces the one started/.test(d)).length, 1);
});

test('late match after 15 s or after a hand pick: the started subtitle stays', async () => {
  const slow = await play({ addons: [{ name: 'A', subs: [en(NUMERIC, null)] }, { name: 'B', subs: [en('3', OWN)], delay: 20000 }] });
  assert.equal(slow.info().chosenSub.addon, 'A');
  assert.deepEqual(slow.matchLines, ['match: best=0 named=0/1']);
  const picked = await play({
    addons: [{ name: 'A', subs: [en(NUMERIC, null), en('5', 'Show.S01E02.WEB-DL')] }, { name: 'B', subs: [en('3', OWN)], delay: 3000 }],
    hand: { at: 1000, fn: t => t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs.find(s => s.id === '5') }) },
  });
  assert.equal(picked.info().chosenSub.id, '5', 'his own pick is kept');
  assert.equal(picked.matchLines.length, 1);
});

test('a matched start is not replaced when another match arrives later', async () => {
  const r = await play({ addons: [{ name: 'A', subs: [en('3', OWN)] }, { name: 'B', subs: [en('4', OWN)], delay: 3000 }] });
  assert.equal(r.info().chosenSub.id, '3');
  assert.equal(r.matchLines.length, 1);
});

test('menu: macLoadAddonSubtitles lists the match first within its language, other languages keep their place', async () => {
  clearSubtitleCache();
  const clock = { setTimeout: (fn) => { fn(); return 0; } };
  const list = [
    addon(clock, 'A', [{ lang: 'eng', id: NUMERIC, label: null }, { lang: 'tur', id: '8', label: OWN }]),
    addon(clock, 'B', [{ lang: 'eng', id: '3', label: OWN }]),
  ];
  let got = [];
  const run = (match) => macLoadAddonSubtitles({ stremio: { addons: async () => list }, authKey: 'k', type: 'series', videoId: 'tt9:1:2', tvLanguage: () => 'en-US', choose: chooseAddonSubtitles, set: v => { got = v; }, changed: () => {}, report: () => {}, match });
  await run(() => matchContext({ filename: OWN + '.mkv' }));
  assert.deepEqual(got.map(s => s.id), ['3', NUMERIC, '8']);
  clearSubtitleCache();
  await run(undefined);
  assert.deepEqual(got.map(s => s.id), [NUMERIC, '3', '8'], 'without a release: the add-ons take turns as before');
});

test('Mac build: the anchors of the id patch are in addon.js', () => {
  const text = readFileSync(fileURLToPath(new URL('../../src/core/addon.js', import.meta.url)), 'utf8');
  for (const [from] of SUBTITLE_ID_PATCHES) assert.ok(text.includes(from), 'anchor present: ' + from);
});
