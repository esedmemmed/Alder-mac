// 0.7.1: the release a name speaks of, the name match that reads releaseName, the Turkish choice by release, English of the same release as the timing
// reference, the frame-rate ratio, and the add-on line that is replaced instead of repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeEngine, stream } from './helpers.js';
import { Subtitle } from '../../src/core/addon.js';
import { createEngine } from '../../src/player/engine.js';
import { createAligner, createAlignMemory, releaseReference, agrees, timingText } from '../../src/player/subtitle-sync.js';
import { releaseInfo, subtitleRelease, scoreSubtitle, matchStats, THRESHOLD } from '../../src/core/subtitle-match.js';
import { subtitlePlan, matchContext } from '../../src/core/subtitle-memory.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createSubtitleMemory } from '../../src/core/subtitle-memory.js';
import { createDelayMemory, releaseKey } from '../../src/core/delay-memory.js';
import { createDiag } from '../../src/player/diag.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';

// ---- the corpus pair: English eng-1 and Turkish tur-1 (ratio 1, offset -20 ms) of one title, the Turkish moved by +2.5 s ----
const CORPUS = new URL('../../.run/subsync/corpus/tt0111161/', import.meta.url);
const load = (f) => JSON.parse(fs.readFileSync(new URL(f, CORPUS), 'utf8')).cues.map((c) => ({ start: c[0], end: c[1] }));
const EN = load('eng-1.json');
const TR = load('tur-1.json').map((c) => ({ start: c.start + 2500, end: c.end + 2500 }));
const move = (cues, ms) => cues.map((c) => ({ start: c.start + ms, end: c.end + ms }));
const stamp = (ms) => { const p = (n, w) => String(n).padStart(w, '0'); const s = Math.floor(ms / 1000); return p(Math.floor(s / 3600), 2) + ':' + p(Math.floor(s / 60) % 60, 2) + ':' + p(s % 60, 2) + ',' + p(ms % 1000, 3); };
const srt = (cues, tag) => cues.map((c, i) => (i + 1) + '\n' + stamp(c.start) + ' --> ' + stamp(c.end) + '\n' + tag + ' ' + i + '\n').join('\n');
const plainStore = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } }; };
const FILE = 'The.Mentalist.S01E02.1080p.BluRay.x264-FLHD.mkv';

// ---- releaseInfo ----
test('releaseInfo: her file, Subtitle Sync labels (cut with an ellipsis), OpenSubtitles names, WEB / AMZN, a group in brackets', () => {
  assert.deepEqual(releaseInfo(FILE), { source: 'bluray', group: 'FLHD', fps: null });
  assert.deepEqual(releaseInfo('Black.Mirror.S01E01.1080p.WEBRip.DD2.0.x264-CasStudio.mkv'), { source: 'web', group: 'CASSTUDIO', fps: null });
  assert.deepEqual(releaseInfo('Show.S01E01.AMZN.WEB-DL.DDP5.1.H.264-NTb.srt'), { source: 'web', group: 'NTB', fps: null });
  assert.deepEqual(releaseInfo('Movie.2020.1080p.BluRay.x264-[YTS]'), { source: 'bluray', group: 'YTS', fps: null });
  assert.deepEqual(releaseInfo('Movie.2020.1080p.BluRay.REMUX.AVC'), { source: 'bluray', group: null, fps: null });
  assert.deepEqual(releaseInfo('Show.S02E03.HDTV.x264-LOL'), { source: 'tv', group: 'LOL', fps: null });
  assert.deepEqual(releaseInfo('Movie.DVDRip.XviD-AXXO'), { source: 'dvd', group: 'AXXO', fps: null });
  assert.equal(releaseInfo('Movie.BluRay.23.976.fps-X1').fps, 23.976);
  assert.equal(releaseInfo('Movie.25fps.srt').fps, 25);
  assert.equal(releaseInfo('Show.S01E01.1080p.WEB-DL.x264-GRP.[eng].srt').group, 'GRP', 'a language tag after the group is ignored');
  // the label of Subtitle Sync: the release after the second ' · ', often cut
  const cut = subtitleRelease({ label: '⏳ Seçince senkronlanır · OpenSubtitles · …01E01.1080p.WEBRip' });
  assert.deepEqual(cut, { source: 'web', group: null, fps: null }, 'a cut name has no group');
  const full = subtitleRelease({ label: '⚠️ Not synced · SubDL · The.Mentalist.S01E02.1080p.BluRay.x264-FLHD_[eng]' });
  assert.deepEqual([full.source, full.group], ['bluray', 'FLHD']);
  const os = subtitleRelease(Object.assign(new Subtitle('u', 'eng', 'Duck Streams'), { id: '1954712345', releaseName: 'The.Mentalist.S01E02.720p.HDTV.x264-IMMERSE', fps: 25 }));
  assert.deepEqual(os, { source: 'tv', group: 'IMMERSE', fps: 25 });
  assert.deepEqual(releaseInfo(''), { source: null, group: null, fps: null });
  assert.deepEqual(releaseInfo(null), { source: null, group: null, fps: null });
});

// ---- the name match reads releaseName ----
test('the name match: a numeric id with a releaseName is named and scores; the weights', () => {
  const ctx = matchContext({ filename: FILE });
  assert.equal(ctx.release.group, 'FLHD');
  const sub = (releaseName, extra = {}) => Object.assign(new Subtitle('u', 'tur', 'Duck Streams'), { id: '1954712345', releaseName }, extra);
  const same = sub('The.Mentalist.S01E02.1080p.BluRay.x264-FLHD');
  const sameSource = sub('The.Mentalist.S01E02.720p.BluRay.x264-OTHER');
  const otherSource = sub('The.Mentalist.S01E02.720p.WEB-DL.x264-OTHER');
  assert.equal(scoreSubtitle(Object.assign(new Subtitle('u', 'tur', 'D'), { id: '1954712345' }), ctx), 0, 'without a name: 0, as before');
  assert.ok(scoreSubtitle(same, ctx) >= THRESHOLD, 'group + source + resolution + codec: ' + scoreSubtitle(same, ctx));
  assert.equal(scoreSubtitle(same, ctx), 6 + 4 + 2 + 1 + 1 + 1, 'group 6, source 4, resolution 2, codec 1, episode 1, a shared word 1');
  assert.ok(scoreSubtitle(sameSource, ctx) > scoreSubtitle(otherSource, ctx), 'the same source earns 4 where another costs 4 (never below 0)');
  assert.equal(scoreSubtitle(otherSource, ctx), 0, 'another group, another source: nothing left');
  const stats = matchStats([sub(null), same, sameSource, otherSource], ctx);
  assert.equal(stats.named, 3, 'the case "0 of 4 named" now counts the three with a name');
  assert.ok(stats.best >= THRESHOLD);
});

// ---- the Turkish choice by release ----
test('subtitlePlan: hash first, then the same group, then the same source, then the remembered add-on and the order', () => {
  const tur = (addon, releaseName, extra = {}) => Object.assign(new Subtitle('u-' + addon, 'tur', addon), { id: '19' + addon.length + addon, releaseName }, extra);
  const remembered = tur('Remembered', null);
  const source = tur('Source', 'The.Mentalist.S01E02.720p.BluRay.x264-OTHER');
  const group = tur('Group', 'The.Mentalist.S01E02.HDTV.x264-FLHD');
  const hashed = tur('Hashed', null, { matchedBy: 'hash' });
  const ctx = matchContext({ filename: FILE });
  const base = { addonsDone: true, lang: (l) => ({ tur: 'tr' }[l]), textTracks: [], match: ctx };
  const choice = { kind: 'lang', language: 'tr', addon: 'Remembered' };
  const all = [remembered, source, group, hashed];
  assert.equal(subtitlePlan(choice, Object.assign({ addonSubs: all }, base)).sub, hashed);
  const g = subtitlePlan(choice, Object.assign({ addonSubs: [remembered, source, group] }, base));
  assert.equal(g.sub, group);
  assert.deepEqual(g.release, { kind: 'group', source: 'bluray', group: 'FLHD' });
  const s = subtitlePlan(choice, Object.assign({ addonSubs: [remembered, source] }, base));
  assert.equal(s.sub, source);
  assert.equal(s.release.kind, 'source');
  assert.equal(subtitlePlan(choice, Object.assign({ addonSubs: [remembered, tur('Other', null)] }, base)).sub, remembered, 'nothing for this release: the remembered add-on');
});

// ---- the engine ----
const TEXTS = {
  'https://s.test/tr1.srt': srt(TR, 'tr'),
  'https://s.test/tr2.srt': srt(TR, 'tr2'),
  'https://s.test/en-a.srt': srt(EN, 'en-a'),
  'https://s.test/en-b.srt': srt(move(EN, 100), 'en-b'),
  'https://s.test/en-far.srt': srt(move(EN, 5000), 'en-far'),
  'https://s.test/en-late.srt': srt(move(EN, 1500), 'en-late'),
};
const sub = (id, lang, extra = {}) => Object.assign(new Subtitle('https://s.test/' + id + '.srt', lang, 'Subs'), { id }, extra);
const tur = (extra = {}) => sub('tr1', 'tur', Object.assign({ releaseName: 'Other.Release.S01E02.1080p.WEB-DL.x264-ZZZ' }, extra));
const eng = (id, releaseName, extra = {}) => sub(id, 'eng', Object.assign({ releaseName }, extra));
const MPV_TRACKS = (fps) => [{ type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080, 'demux-fps': fps }, { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true }];
const MPV_WITH_ENGLISH = (fps) => MPV_TRACKS(fps).concat([{ type: 'sub', id: 1, lang: 'eng', title: 'English', codec: 'subrip', selected: false }]);

async function play({ subs, tracks = null, texts = TEXTS, store = plainStore(), adapter = 'avplay' }) {
  clearSubtitleCache();
  const mem = createSourceMemory(store);
  mem.delays = createDelayMemory(store, { report: () => {} });
  mem.aligns = createAlignMemory(store);
  mem.subtitles = createSubtitleMemory(store, { report: () => {} });
  const calls = [];
  const real = createAligner({ workerSource: null, defer: (fn) => Promise.resolve().then(fn) });
  const aligner = { compute: (ref, cands, opts) => { calls.push({ n: ref.length, opts: opts || null }); return real.compute(ref, cands, opts); } };
  const trackSpec = tracks || (adapter === 'mpv' ? { tracks: JSON.stringify(MPV_TRACKS(24)) } : {});
  const src = stream('The Mentalist', Object.assign({ duration: 9000 }, trackSpec), { filename: FILE });
  const t = makeEngine({ adapter, memory: mem, sources: [src], createEngine: (p, d) => createEngine(p, Object.assign({ aligner }, d)), http: { get: async (u) => { if (!(u in texts)) throw new Error('404'); return texts[u]; } } });
  t.store.set('settings/subLang@p1', 'tr');
  t.stremio.addons = async () => [{ name: 'Subs', serves: () => true, subtitles: async () => subs }];
  await t.start();
  await t.advance(4000);
  t.store2 = store;
  t.calls = calls;
  t.decisions = () => t.diag.snapshot().decisions.map((d) => d.text || d);
  return t;
}
const keyFor = () => 'align/' + releaseKey(stream('The Mentalist', {}, { filename: FILE })) + '/addon:Subs:tr1';

test('an English subtitle of the same group is a reference on its own; the Turkish is aligned, remembered with source release', async () => {
  const t = await play({ subs: [tur(), eng('en-a', 'The.Mentalist.S01E02.720p.HDTV.x264-FLHD'), eng('en-far', 'The.Mentalist.S01E02.720p.HDTV.x264-OTHER')] });
  const line = t.decisions().find((d) => /^timing: aligned to English for the same release/.test(d));
  assert.ok(line, t.decisions().join(' | '));
  assert.match(line, /^timing: aligned to English for the same release \(BluRay FLHD\): -2\.\d s, gain 0\.\d\d$/);
  assert.match(t.engine.tracks().timing, /^Aligned to English \(same release\): -2\.\d s$/);
  assert.ok(t.events.notice.some((n) => n.message === 'Turkish timed to this file'));
  const kept = t.store2.get(keyFor());
  assert.ok(kept && kept.source === 'release' && Math.abs(kept.offset + 2520) < 120, JSON.stringify(kept));
});

test('two English files of the same source that agree are used (same source, 2 agree)', async () => {
  const t = await play({ subs: [tur(), eng('en-a', 'The.Mentalist.S01E02.720p.BluRay.x264-AAA'), eng('en-b', 'The.Mentalist.S01E02.1080p.BluRay.x264-BBB')] });
  const line = t.decisions().find((d) => /^timing: aligned to English for the same release/.test(d));
  assert.ok(line, t.decisions().join(' | '));
  assert.match(line, /^timing: aligned to English for the same release \(same source BluRay, 2 agree\): /);
});

test('two English files of the same source that disagree are not used', async () => {
  const t = await play({ subs: [tur(), eng('en-a', 'The.Mentalist.S01E02.720p.BluRay.x264-AAA'), eng('en-far', 'The.Mentalist.S01E02.1080p.BluRay.x264-BBB')] });
  assert.ok(t.decisions().includes('timing: no English for the same release'), t.decisions().join(' | '));
  assert.ok(!t.decisions().some((d) => /^timing: aligned/.test(d)));
  assert.equal(t.store2.get(keyFor()), undefined);
});

test('an English file of another source is no reference', async () => {
  const t = await play({ subs: [tur(), eng('en-a', 'The.Mentalist.S01E02.720p.WEB-DL.x264-AAA'), eng('en-b', 'The.Mentalist.S01E02.1080p.WEB-DL.x264-BBB')] });
  assert.ok(t.decisions().includes('timing: no English for the same release'));
});

test('releaseReference: at most five files are fetched, a failing file is skipped', async () => {
  const fetched = [];
  const english = [1, 2, 3, 4, 5, 6].map((i) => ({ i }));
  const r = await releaseReference({
    english, want: { source: 'bluray', group: 'GONE' }, releaseOf: () => ({ source: 'bluray', group: null }),
    fetchCues: async (s) => { fetched.push(s.i); return s.i === 1 ? null : EN.slice(0, 200); },
    compute: async () => [{ checked: 'high', offset: 0, ratio: 1, gain: 0.9 }],
  });
  assert.ok(fetched.length <= 4, 'fetched ' + fetched.length);
  assert.equal(r.how, 'source');
  assert.equal(agrees({ checked: 'high', offset: 300, ratio: 1 }), true);
  assert.equal(agrees({ checked: 'high', offset: 301, ratio: 1 }), false);
  assert.equal(agrees({ checked: 'low', offset: 0, ratio: 1 }), false);
});

test('the file\'s own English track replaces a release alignment that is more than 300 ms off', async () => {
  const subs = [tur(), eng('en-late', 'The.Mentalist.S01E02.720p.HDTV.x264-FLHD')]; // the same-group English is 1.5 s late: a wrong reference
  const t = await play({ subs, adapter: 'mpv', tracks: { tracks: JSON.stringify(MPV_WITH_ENGLISH(24)) } });
  assert.ok(t.decisions().some((d) => /^timing: aligned to English for the same release/.test(d)), t.decisions().join(' | '));
  const first = t.store2.get(keyFor());
  assert.equal(first.source, 'release');
  for (const c of EN) { if (c.start > 15 * 60 * 1000) break; if (c.start > t.position()) { await t.advance(c.start - t.position()); t.mpv.secondaryCue(c.start / 1000, c.end / 1000, 'ENGLISH LINE'); await t.advance(20); } }
  await t.advance(1000);
  const now = t.store2.get(keyFor());
  assert.equal(now.source, 'file track', t.decisions().join(' | '));
  assert.ok(Math.abs(now.offset - first.offset) > 300);
  assert.match(t.engine.tracks().timing, /^Aligned to the file's English track: /);
});

test('a subtitle made for another frame rate than the file: that exact ratio joins the ratios, and a line says so (mpv: demux-fps)', async () => {
  const t = await play({ subs: [tur({ fps: 29.97 }), eng('en-a', 'The.Mentalist.S01E02.720p.HDTV.x264-FLHD')], adapter: 'mpv' });
  assert.ok(t.decisions().includes('timing: subtitle made for 29.97 fps, file is 24'), t.decisions().join(' | '));
  const ratios = t.calls.map((c) => c.opts && c.opts.ratios).find(Boolean);
  assert.ok(ratios && ratios.some((r) => Math.abs(r - 29.97 / 24) < 1e-9), 'the ratio 29.97 / 24 is tried');
});

test('no frame rate is said when the file has none or the rates agree', async () => {
  const t = await play({ subs: [tur({ fps: 24 }), eng('en-a', 'The.Mentalist.S01E02.720p.HDTV.x264-FLHD')], adapter: 'mpv' });
  assert.ok(!t.decisions().some((d) => /made for/.test(d) && /fps/.test(d)));
  const u = await play({ subs: [tur({ fps: 25 }), eng('en-a', 'The.Mentalist.S01E02.720p.HDTV.x264-FLHD')] });
  assert.ok(!u.decisions().some((d) => /fps, file is/.test(d)), 'the TV mock says no frame rate');
});

test('the Turkish made for the same release starts, with its line', async () => {
  const t = await play({ subs: [tur(), sub('tr2', 'tur', { releaseName: 'The.Mentalist.S01E02.720p.BluRay.x264-FLHD' })] });
  assert.equal(t.engine.tracks().chosenSub.id, 'tr2');
  assert.ok(t.decisions().includes('subtitles: Turkish made for the same release (BluRay FLHD)'), t.decisions().join(' | '));
});

test('the menu status of a release alignment', () => {
  assert.equal(timingText('aligned-release', { ratio: 1, offset: 1600 }), 'Aligned to English (same release): +1.6 s');
  assert.equal(timingText('aligned-release', { ratio: 1.0427, offset: -2400 }), 'Aligned to English (same release): -2.4 s, speed 1.043');
});

test('Diagnostics: asked again after a refresh, an add-on has one line, replaced', () => {
  const d = createDiag();
  d.subtitleAddon('Subtitle Sync', 19);
  d.subtitleAddon('Duck Streams', 94, ['English']);
  d.subtitleAddon('Subtitle Sync', 19);
  d.subtitleAddon('Duck Streams', 90);
  assert.deepEqual(d.snapshot().subtitleAddons.map((a) => a.name + ': ' + a.text), ['Subtitle Sync: 19 found', 'Duck Streams: 90 found']);
});
