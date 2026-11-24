// Mac subtitle delay memory (T4.c1): the delay set by hand is started again for the same release and the same subtitle (a file track, or an
// add-on subtitle with an id); another release or subtitle starts at 0; an add-on subtitle without an id is not kept, and says so; 0 removes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subtitle } from '../../src/core/addon.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createDelayMemory, releaseKey, subtitleKey } from '../../src/core/delay-memory.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';
import { makeEngine, stream } from '../player/helpers.js';

const plainStore = () => {
  const m = new Map();
  return { m, get: k => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
};

const video = { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 };
const audio = { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true };
const sub = (id, lang, title) => ({ type: 'sub', id, lang, title, codec: 'subrip', selected: false });
const TRACKS = [video, audio, sub(1, 'eng', 'English'), sub(2, 'fra', 'Francais')];
const TV_TRACKS = JSON.stringify([{ type: 'AUDIO', codec: 'AAC', lang: 'eng', channels: 2 }, { type: 'TEXT', codec: 'SRT', lang: 'eng' }, { type: 'TEXT', codec: 'SRT', lang: 'fra' }]);
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n';
const REL_A = 'Movie 1080p WEB-DL x264-A';
const REL_B = 'Movie 2160p BluRay x265-B';

/** One playback on the shared store: the shared engine on the mpv adapter, memory.delays over the store. */
async function play({ store, rel = REL_A, addonIds = [], reports = [], file = null, adapter = 'mpv', srtAt = null }) {
  clearSubtitleCache(); // the fetch keeps answers per add-on name and video id
  const mem = createSourceMemory(store);
  mem.delays = createDelayMemory(store, { report: l => reports.push(l) });
  const src = stream(rel, { tracks: adapter === 'mpv' ? JSON.stringify(TRACKS) : TV_TRACKS });
  const t = makeEngine({ adapter, memory: mem, sources: [src], http: { get: async () => (srtAt ? srtAt(t.position()) : SRT) } });
  t.stremio.addons = async () => [{ name: 'Subs', serves: () => true, subtitles: async () => addonIds.map((id, i) => Object.assign(new Subtitle('https://subs.example/' + i + '.srt?token=SECRET', 'swe', 'Subs'), id ? { id } : {})) }];
  await t.start();
  await t.advance(40000);
  if (file !== null) { await t.engine.selectSubtitle({ kind: 'file', index: file }); await t.advance(50); }
  return t;
}
const dk = (store) => [...store.m.keys()].filter(k => k.startsWith('delay/'));
const delayLines = (t) => t.log.filter(l => /delay: /.test(l)).map(l => l.replace(/^.*delay:/, 'delay:'));

test('module: keys, get / remember, 0 removes, nothing URL-like', () => {
  const store = plainStore();
  const mem = createDelayMemory(store, { report: () => {} });
  assert.equal(releaseKey({ filename: 'Show.S01E02.1080p.WEB.mkv' }), 'show.s01e02.1080p.web.mkv');
  assert.equal(releaseKey({ filename: 'x', title: '' }) !== null, true);
  assert.equal(releaseKey({ title: 'Movie 1080p WEB-DL x264-A', description: '' }), '1080p|web|avc|a');
  assert.equal(releaseKey({ filename: 'https://host.example/a?token=1', title: 'Movie 1080p WEB-DL x264-A' }), '1080p|web|avc|a', 'a link falls back to the signature');
  assert.equal(releaseKey({ filename: 'a', title: '' }), 'a');
  assert.equal(releaseKey(null), null);
  assert.equal(releaseKey({ title: 'plain' }), null);
  assert.equal(subtitleKey({ kind: 'file', track: { language: 'en', index: 2, label: 'English' } }), 'file:en:2:English');
  assert.equal(subtitleKey({ kind: 'addon', sub: { addon: 'Subs', id: 'abc' } }), 'addon:Subs:abc');
  assert.equal(subtitleKey({ kind: 'addon', sub: { addon: 'Subs' } }), null);
  assert.equal(subtitleKey({ kind: 'addon', sub: { addon: 'Subs', id: 'https://h.example/x' } }), null);
  assert.equal(mem.get('r', 's'), 0);
  mem.remember('r', 's', 300);
  assert.deepEqual(store.m.get('delay/r/s'), { ms: 300 });
  assert.equal(mem.get('r', 's'), 300);
  mem.remember('r', 's', 0);
  assert.equal(dk(store).length, 0);
  mem.remember(null, 's', 300);
  mem.remember('r', null, 300);
  assert.equal(dk(store).length, 0);
  assert.equal(mem.apply(null, { kind: 'file', track: { index: 0 } }).line, 'delay: none (no release identity)');
  assert.match(mem.store({ filename: 'a.mkv' }, { kind: 'addon', sub: { addon: 'S' } }, 100), /^delay: not remembered/);
});

test('same release and same file track: mpv starts with the remembered delay; other track or release: 0', async () => {
  const store = plainStore();
  const reports = [];
  const a = await play({ store, reports });
  assert.equal(a.engine.tracks().subMode, 'file');
  a.engine.setSubtitleDelay(300);
  await a.advance(50);
  assert.deepEqual(store.m.get('delay/' + releaseKey(stream(REL_A)) + '/file:en:0:English'), { ms: 300 });
  assert.ok(reports.includes('delay: remembered 0.3 s'));
  const b = await play({ store, reports: [] });
  assert.equal(b.mpv.prop('sub-delay'), 0.3, 'the start rule track gets it');
  assert.equal(b.engine.tracks().subDelay, 300);
  assert.ok(delayLines(b).includes('delay: applied 0.3 s'));
  assert.equal(dk(store).length, 1, 'applying never stores');
  await b.engine.selectSubtitle({ kind: 'file', index: 1 });
  await b.advance(50);
  assert.equal(b.mpv.prop('sub-delay'), 0, 'another subtitle');
  await b.engine.selectSubtitle({ kind: 'file', index: 0 });
  await b.advance(50);
  assert.equal(b.mpv.prop('sub-delay'), 0.3, 'menu pick of the same subtitle');
  const c = await play({ store, rel: REL_B, reports: [] });
  assert.equal(c.mpv.prop('sub-delay'), 0, 'another release');
  assert.equal(c.engine.tracks().subDelay, 0);
});

test('0 removes the remembered delay', async () => {
  const store = plainStore();
  const a = await play({ store });
  a.engine.setSubtitleDelay(500);
  assert.equal(dk(store).length, 1);
  a.engine.setSubtitleDelay(0);
  assert.equal(dk(store).length, 0);
  assert.ok(delayLines(a).includes('delay: forgotten (back to 0)'));
  const b = await play({ store });
  assert.equal(b.mpv.prop('sub-delay'), 0);
});

test('add-on subtitle: remembered with an id; without an id: not remembered, said', async () => {
  const store = plainStore();
  const a = await play({ store, addonIds: ['id1', null] });
  const [s1, s2] = a.engine.tracks().addonSubs;
  await a.engine.selectSubtitle({ kind: 'addon', sub: s1 });
  a.engine.setSubtitleDelay(-700);
  await a.advance(50);
  assert.deepEqual(store.m.get('delay/' + releaseKey(stream(REL_A)) + '/addon:Subs:id1'), { ms: -700 });
  const b = await play({ store, addonIds: ['id1', null] });
  const [t1, t2] = b.engine.tracks().addonSubs;
  await b.engine.selectSubtitle({ kind: 'addon', sub: t1 });
  await b.advance(50);
  assert.equal(b.mpv.prop('sub-delay'), -0.7);
  assert.ok(delayLines(b).includes('delay: applied -0.7 s'));
  await b.engine.selectSubtitle({ kind: 'addon', sub: t2 });
  await b.advance(50);
  assert.equal(b.mpv.prop('sub-delay'), 0);
  assert.equal(delayLines(b).at(-2), 'delay: not remembered (add-on subtitle without id)');
  const size = dk(store).length;
  b.engine.setSubtitleDelay(400);
  assert.equal(dk(store).length, size, 'nothing stored for it');
  assert.ok(delayLines(b).includes('delay: not remembered (add-on subtitle without id)'));
  void s2;
});

test('no release identity: nothing kept, says so', async () => {
  const store = plainStore();
  const mem = createSourceMemory(store);
  const reports = [];
  mem.delays = createDelayMemory(store, { report: l => reports.push(l) });
  const src = Object.assign(stream('x', { tracks: JSON.stringify(TRACKS) }), { filename: null, title: 'plain' });
  const t = makeEngine({ adapter: 'mpv', memory: mem, sources: [src], http: { get: async () => SRT } });
  await t.start();
  await t.advance(40000);
  t.engine.setSubtitleDelay(300);
  await t.advance(50);
  assert.equal(dk(store).length, 0);
  assert.ok(reports.includes('delay: none (no release identity)'));
  assert.ok(delayLines(t).includes('delay: none (no release identity)'));
});

test('no link, host or token in a stored key, value or delay line', async () => {
  const store = plainStore();
  const reports = [];
  const a = await play({ store, addonIds: ['id1'], reports });
  a.engine.setSubtitleDelay(300);
  await a.engine.selectSubtitle({ kind: 'addon', sub: a.engine.tracks().addonSubs[0] });
  a.engine.setSubtitleDelay(200);
  await a.advance(50);
  const b = await play({ store, addonIds: ['id1'], reports });
  const texts = [...store.m.keys(), ...[...store.m.values()].map(v => JSON.stringify(v)), ...reports, ...delayLines(a), ...delayLines(b)];
  assert.ok(dk(store).length >= 2);
  for (const x of texts) assert.doesNotMatch(x, /:\/\/|\?|subs\.example|media\.fixture|SECRET|token/i, x);
});

// ---- the TV adapter (AVPlay has no sub-delay): an add-on subtitle's cues are moved, a file track cannot be shifted ----
const stamp = (ms) => { const p = (n, w) => String(n).padStart(w, '0'); const s = Math.floor(ms / 1000); return p(Math.floor(s / 3600), 2) + ':' + p(Math.floor(s / 60) % 60, 2) + ':' + p(s % 60, 2) + ',' + p(ms % 1000, 3); };
const shownNow = (t) => { const e = t.events.subtitle; return e.length && e[e.length - 1].lines ? e[e.length - 1].lines.map((l) => l.map((s) => s.text).join('')).join('/') : null; };

test('TV: a remembered add-on delay comes back on the next play for that release and subtitle, and shifts its cues', async () => {
  const store = plainStore();
  const a = await play({ store, adapter: 'avplay', addonIds: ['id1'] });
  await a.engine.selectSubtitle({ kind: 'addon', sub: a.engine.tracks().addonSubs[0] });
  a.engine.setSubtitleDelay(300);
  assert.deepEqual(store.m.get('delay/' + releaseKey(stream(REL_A)) + '/addon:Subs:id1'), { ms: 300 });
  let p0 = 0;
  const srtAt = (pos) => { p0 = pos; return ['1', stamp(pos + 1000) + ' --> ' + stamp(pos + 5000), 'hi', ''].join('\n'); };
  const b = await play({ store, adapter: 'avplay', addonIds: ['id1'], srtAt });
  await b.engine.selectSubtitle({ kind: 'addon', sub: b.engine.tracks().addonSubs[0] });
  assert.equal(b.engine.tracks().subDelay, 300);
  assert.ok(delayLines(b).includes('delay: applied 0.3 s'));
  await b.advance(p0 + 1100 - b.position());
  assert.equal(shownNow(b), null, 'its cues are moved: not yet at +1.1 s');
  await b.advance(p0 + 1500 - b.position());
  assert.equal(shownNow(b), 'hi');
  const other = await play({ store, adapter: 'avplay', rel: REL_B, addonIds: ['id1'] });
  await other.engine.selectSubtitle({ kind: 'addon', sub: other.engine.tracks().addonSubs[0] });
  assert.equal(other.engine.tracks().subDelay, 0, 'another release');
});

test('TV: a file track cannot be shifted: canShift false, nothing sent, nothing remembered or applied', async () => {
  const store = plainStore();
  store.set('delay/' + releaseKey(stream(REL_A)) + '/file:en:0:English', { ms: 300 }); // a remembered value that must not be used
  const t = await play({ store, adapter: 'avplay' });
  assert.equal(t.engine.tracks().subMode, 'file');
  assert.equal(t.engine.tracks().canShift, false);
  assert.equal(t.engine.tracks().subDelay, 0, 'the remembered delay is not applied to a file track');
  t.engine.setSubtitleDelay(500);
  assert.equal(t.engine.tracks().subDelay, 0);
  assert.equal(dk(store).length, 1, 'nothing new stored');
  assert.deepEqual(delayLines(t), []);
});
