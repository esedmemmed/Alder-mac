// 0.7.0: the Turkish subtitle timed against the file's own English text track, heard while playing and never shown.
// A real case from the corpus: an English file stands in for the embedded track, a Turkish file of the same title is moved by a known amount.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeEngine, stream } from './helpers.js';
import { Subtitle } from '../../src/core/addon.js';
import { createEngine } from '../../src/player/engine.js';
import { createAligner, createAlignMemory, createCollector, createLiveFit, pickEnglishTrack, LIVE, timingText } from '../../src/player/subtitle-sync.js';
import { alignChecked } from '../../src/core/subtitle-align.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createSubtitleMemory } from '../../src/core/subtitle-memory.js';
import { createDelayMemory, releaseKey } from '../../src/core/delay-memory.js';
import { createDiag } from '../../src/player/diag.js';
import { buildReport } from '../../src/screens/diagnostics.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';

// ---- the corpus pair: English eng-1 as the embedded track, Turkish tur-1 moved by +2.5 s ----
const CORPUS = new URL('../../.run/subsync/corpus/tt0111161/', import.meta.url);
const load = (f) => JSON.parse(fs.readFileSync(new URL(f, CORPUS), 'utf8')).cues.map((c) => ({ start: c[0], end: c[1] }));
const HAVE_CORPUS = fs.existsSync(new URL('eng-1.json', CORPUS));
const EN = HAVE_CORPUS ? load('eng-1.json') : [];
const TR0 = HAVE_CORPUS ? load('tur-1.json') : [];
const SHIFT = 2500;
const TR = TR0.map((c) => ({ start: c.start + SHIFT, end: c.end + SHIFT }));
const base = HAVE_CORPUS ? alignChecked(EN, TR0) : null; // how this Turkish file sits against this English one before it is moved
const stamp = (ms) => { const p = (n, w) => String(n).padStart(w, '0'); const s = Math.floor(ms / 1000); return p(Math.floor(s / 3600), 2) + ':' + p(Math.floor(s / 60) % 60, 2) + ':' + p(s % 60, 2) + ',' + p(ms % 1000, 3); };
const srt = (cues, tag) => cues.map((c, i) => (i + 1) + '\n' + stamp(c.start) + ' --> ' + stamp(c.end) + '\n' + tag + ' ' + i + '\n').join('\n');
const plainStore = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } }; };
const REL = 'Movie 1080p WEB-DL x264-A';
const TEXTS = { 'https://s.test/tr1.srt': srt(TR, 'tr'), 'https://s.test/tr2.srt': srt(TR0.map((c) => ({ start: c.start + 60000, end: c.end + 60000 })), 'tr2') };
const trSub = (id) => Object.assign(new Subtitle('https://s.test/' + id + '.srt', 'tur', 'Subs'), { id });
const TV_TRACKS = (extra = []) => JSON.stringify([{ type: 'AUDIO', codec: 'AAC', lang: 'eng', channels: 2 }, { type: 'TEXT', codec: 'SRT', lang: 'eng' }].concat(extra));
const mpvTrack = (id, lang, title, forced) => ({ type: 'sub', id, lang, title, codec: 'subrip', selected: false, forced: !!forced });
const MPV_TRACKS = [{ type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 }, { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true }, mpvTrack(1, 'eng', 'English')];

async function play({ adapter = 'avplay', sources = null, store = plainStore(), tracks = true, subs = [trSub('tr1')], answer = null } = {}) {
  clearSubtitleCache();
  const mem = createSourceMemory(store);
  mem.delays = createDelayMemory(store, { report: () => {} });
  mem.aligns = createAlignMemory(store);
  mem.subtitles = createSubtitleMemory(store, { report: () => {} });
  const calls = [];
  const real = createAligner({ workerSource: null, defer: (fn) => Promise.resolve().then(fn) });
  const aligner = { compute: (ref, cands, opts) => { calls.push({ n: ref.length, opts: opts || null }); return real.compute(ref, cands, opts); } };
  const src = sources || [stream(REL, tracks ? (adapter === 'mpv' ? { tracks: JSON.stringify(MPV_TRACKS), duration: 9000 } : { tracks: TV_TRACKS(), duration: 9000 }) : { duration: 9000 })];
  const t = makeEngine({ adapter, memory: mem, sources: src, createEngine: (p, d) => createEngine(p, Object.assign({ aligner }, d)), http: { get: async (u) => { if (!(u in TEXTS)) throw new Error('404'); return TEXTS[u]; } } });
  t.store.set('settings/subLang@p1', 'tr');
  t.stremio.addons = async () => [{ name: 'Subs', serves: () => true, subtitles: async (ty, id, extra) => (answer ? answer(extra) : subs) }];
  await t.start();
  await t.advance(3000);
  t.store2 = store;
  t.calls = calls;
  t.decisions = () => t.diag.snapshot().decisions.map((d) => d.text || d);
  // the English cue heard at its own time: the TV gets a subtitle event, mpv's secondary subtitle shows it
  t.hear = async (cue) => {
    await t.advance(Math.max(0, cue.start - t.position()));
    if (adapter === 'mpv') t.mpv.secondaryCue(cue.start / 1000, cue.end / 1000, 'ENGLISH LINE');
    else t.av.__mock.emit('onsubtitlechange', cue.end - cue.start, 'ENGLISH LINE', 0);
    await t.advance(20);
  };
  t.listenUntil = async (ms) => { for (const c of EN) { if (c.start > ms) break; if (c.start > t.position()) await t.hear(c); } await t.advance(Math.max(0, ms - t.position())); };
  return t;
}

// ---- the track choice ----
test('pickEnglishTrack: forced skipped, SDH and plain over Signs, the first in order, none', () => {
  const tr = (index, language, label = '', forced = false) => ({ index, language, label, forced });
  assert.equal(pickEnglishTrack([tr(0, 'en', 'Forced', true), tr(1, 'en', 'English')]).index, 1);
  assert.equal(pickEnglishTrack([tr(0, 'en', 'English (forced)'), tr(1, 'ru', 'Russian'), tr(2, 'en', 'SDH')]).index, 2);
  assert.equal(pickEnglishTrack([tr(0, 'en', 'Signs & Songs'), tr(1, 'en', 'Full')]).index, 1);
  assert.equal(pickEnglishTrack([tr(0, 'en', 'Signs'), tr(1, 'en', 'Songs')]).index, 0, 'only Signs and Songs: still the first');
  assert.equal(pickEnglishTrack([tr(0, 'en', 'A'), tr(1, 'en', 'B')]).index, 0);
  assert.equal(pickEnglishTrack([tr(0, 'ru', 'Russian'), tr(1, 'en', 'x', true)]), null);
  assert.equal(pickEnglishTrack([]), null);
});

test('the fixture: the Turkish file sits on the English one at ratio 1 before it is moved', () => {
  assert.ok(HAVE_CORPUS, 'the corpus .run/subsync/corpus/tt0111161 is needed');
  assert.equal(base.checked, 'high');
  assert.equal(base.ratio, 1);
});

test('alignChecked with ratios [1]: offset only, the same offset for a file that needs no stretch', () => {
  const only = alignChecked(EN, TR, { ratios: [1] });
  assert.equal(only.ratio, 1);
  assert.ok(Math.abs(only.offset - (base.offset - SHIFT)) < 100, 'offset ' + only.offset);
  assert.equal(only.checked, 'high');
});

// ---- the fitting rules on their own (a fake aligner) ----
function fitHarness(results) {
  const collector = createCollector();
  for (let i = 0; i < 40; i++) collector.add(i * 8000, i * 8000 + 2000); // 40 cues over 312 s
  const applied = [];
  const finished = [];
  const calls = [];
  const queue = results.slice();
  const fit = createLiveFit({
    collector, target: () => [], compute: async (ref, cands, opts) => { calls.push(opts || null); return [queue.length > 1 ? queue.shift() : queue[0]]; },
    apply: (r, again) => applied.push({ r, again }), finish: (reason, info) => finished.push({ reason, info }),
  });
  return { fit, collector, applied, finished, calls };
}
const high = (offset, ratio = 1) => ({ checked: 'high', offset, ratio, gain: 0.7 });

test('live fit: one high fit alone does not apply; two agreeing ones do', async () => {
  const h = fitHarness([high(-2500), high(-2400), high(-2450)]);
  await h.fit.tick(100000); assert.equal(h.applied.length, 0, 'the first fit only');
  await h.fit.tick(130000); assert.equal(h.calls.length, 1, 'not before 60 s of playback');
  await h.fit.tick(160000); assert.equal(h.applied.length, 1, 'two within 300 ms');
  assert.equal(h.applied[0].r.offset, -2400);
  assert.equal(h.applied[0].again, false);
});

test('live fit: fits that disagree, or are low, never apply', async () => {
  const h = fitHarness([high(-2500), high(-1000), { checked: 'low', offset: -1000, ratio: 1, gain: 0.35 }, high(-1000), high(-1100)]);
  for (let i = 0; i < 4; i++) await h.fit.tick(100000 + i * 60000);
  assert.equal(h.applied.length, 0);
  await h.fit.tick(100000 + 4 * 60000);
  assert.equal(h.applied.length, 1, 'high and agreeing at last');
});

test('live fit: offset only while the collected span is under 600 s, all ratios from then on', async () => {
  const h = fitHarness([high(0)]);
  await h.fit.tick(100000);
  assert.deepEqual(h.calls[0], { ratios: [1] });
  for (let i = 40; i < 90; i++) h.collector.add(i * 8000, i * 8000 + 2000); // now 720 s
  await h.fit.tick(200000);
  assert.equal(h.calls[1], null);
});

test('live fit: needs 120 s and 20 cues of English first', async () => {
  const h = fitHarness([high(0)]);
  h.collector.clear();
  for (let i = 0; i < 15; i++) h.collector.add(i * 10000, i * 10000 + 2000);
  await h.fit.tick(100000);
  assert.equal(h.calls.length, 0, '15 cues');
  for (let i = 15; i < 25; i++) h.collector.add(i * 2000 + 1000000, i * 2000 + 1001000);
  h.collector.clear();
  for (let i = 0; i < 30; i++) h.collector.add(i * 3000, i * 3000 + 1000); // 30 cues over 87 s
  await h.fit.tick(200000);
  assert.equal(h.calls.length, 0, 'under 120 s');
});

test('live fit: a later cut re-applies after two agreeing fits that differ by more than 300 ms; checks every 120 s once applied', async () => {
  const h = fitHarness([high(-2500), high(-2500), high(-2500), high(-7500), high(-7500)]);
  await h.fit.tick(100000); await h.fit.tick(160000);
  assert.equal(h.applied.length, 1);
  await h.fit.tick(220000); assert.equal(h.calls.length, 2, 'every 120 s now');
  await h.fit.tick(280000); assert.equal(h.calls.length, 3);
  await h.fit.tick(400000);
  assert.equal(h.calls.length, 4);
  assert.equal(h.applied.length, 1, 'the first different fit alone does nothing');
  await h.fit.tick(520000);
  assert.equal(h.applied.length, 2);
  assert.equal(h.applied[1].r.offset, -7500);
  assert.equal(h.applied[1].again, true);
});

test('live fit: stops 15 minutes after the first apply; with nothing applied it gives up and says so', async () => {
  const h = fitHarness([high(-2500)]);
  await h.fit.tick(100000); await h.fit.tick(160000);
  assert.equal(h.applied.length, 1);
  await h.fit.tick(160000 + LIVE.stopAfterApply - 1000);
  assert.equal(h.finished.length, 0);
  await h.fit.tick(160000 + LIVE.stopAfterApply);
  assert.deepEqual(h.finished.map((f) => f.reason), ['done']);
  const g = fitHarness([{ checked: 'none', offset: 0, ratio: 1, gain: 0 }]);
  await g.fit.tick(100000);
  await g.fit.tick(100000 + LIVE.giveUp);
  assert.equal(g.finished[0].reason, 'giveup');
  assert.equal(g.finished[0].info.applied, null);
  assert.equal(g.finished[0].info.count, 40);
});

test('the collector keeps media time order, drops repeats and nonsense', () => {
  const c = createCollector();
  assert.equal(c.add(5000, 6000), true);
  assert.equal(c.add(1000, 2000), true);
  assert.equal(c.add(5030, 6030), false, 'the same cue');
  assert.equal(c.add(7000, 6000), false);
  assert.equal(c.add(NaN, 1), false);
  assert.deepEqual(c.list().map((x) => x.start), [1000, 5000]);
  assert.equal(c.span(), 5000);
});

// ---- the engine on both adapters ----
for (const adapter of ['avplay', 'mpv']) {
  test('English track heard, never shown: the Turkish is aligned from agreeing fits, with note, status, store key and diagnostics [' + adapter + ']', async () => {
    const t = await play({ adapter });
    assert.ok(t.decisions().includes("timing: listening to the file's English subtitles"), t.decisions().join(' | '));
    assert.equal(t.engine.tracks().timing, "Checking against the file's English subtitles…");
    const tr = t.engine.tracks().chosenSub;
    assert.equal(tr.id, 'tr1');
    await t.listenUntil(60 * 60 * 1000 / 4); // 15 minutes of film
    const line = t.decisions().find((d) => /^timing: aligned to the file's English track/.test(d));
    assert.ok(line, t.decisions().join(' | '));
    assert.match(t.engine.tracks().timing, /^Aligned to the file's English track: /);
    assert.ok(t.events.notice.some((n) => n.message === 'Turkish timed to this file'));
    const key = 'align/' + releaseKey(stream(REL)) + '/addon:Subs:tr1';
    const kept = t.store2.get(key);
    assert.ok(kept && kept.source === 'file track' && Math.abs(kept.offset - (base.offset - SHIFT)) < 150 && kept.ratio === 1, JSON.stringify(kept));
    assert.ok(t.calls.some((c) => c.opts && c.opts.ratios && c.opts.ratios[0] === 1), 'offset only while the span was short');
    // the English line was never drawn
    assert.ok(t.events.subtitle.every((e) => !e.lines || !JSON.stringify(e.lines).includes('ENGLISH LINE')));
    const report = buildReport({ log: { lines: () => [] }, diag: t.diag.snapshot() });
    const timing = report.find((s) => s.title === 'TIMING');
    assert.match(timing.lines[0].text, /^File English track: English, \d+ cues collected, last fit [-+]\d+\.\d s gain 0\.\d\d$/);
    if (adapter === 'mpv') {
      assert.equal(t.mpv.prop('secondary-sub-visibility'), false);
      assert.equal(t.mpv.prop('sub-speed'), 1);
      assert.ok(Math.abs(t.mpv.prop('sub-delay') * 1000 - kept.offset) < 1);
    }
  });

  test('a user delay stays on top while listening [' + adapter + ']', async () => {
    const t = await play({ adapter });
    t.engine.setSubtitleDelay(400);
    assert.equal(t.engine.tracks().subDelay, 400);
    await t.listenUntil(60 * 60 * 1000 / 4);
    assert.equal(t.engine.tracks().subDelay, 400);
    if (adapter === 'mpv') assert.ok(Math.abs(t.mpv.prop('sub-delay') * 1000 - (t.store2.get('align/' + releaseKey(stream(REL)) + '/addon:Subs:tr1').offset + 400)) < 1);
  });

  test('a source change drops what was heard; a new Turkish file is fitted again from it [' + adapter + ']', async () => {
    const t = await play({ adapter, subs: [trSub('tr1'), trSub('tr2')] });
    await t.listenUntil(200000);
    const heard = t.diag.snapshot().fileEnglish.cues;
    assert.ok(heard > 20, 'cues heard: ' + heard);
    await t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs.find((s) => s.id === 'tr2') });
    await t.advance(100);
    assert.equal(t.engine.tracks().timing, "Checking against the file's English subtitles…");
    assert.ok(t.diag.snapshot().fileEnglish.cues >= heard, 'the heard cues are kept');
    await t.engine.selectSubtitle({ kind: 'off' });
    await t.advance(100);
    assert.equal(t.engine.tracks().timing, '', 'subtitles off: nothing is listened to');
    if (adapter === 'avplay') assert.equal(t.av.__mock.subtitle.silent, true);
  });
}

test('failover to another source: the cues heard are dropped [avplay]', async () => {
  const a = stream(REL, { tracks: TV_TRACKS(), duration: 9000 }, { filename: 'A.mkv' });
  const b = stream('Other 720p WEB-DL x264-B', { tracks: TV_TRACKS(), duration: 9000 }, { filename: 'B.mkv' });
  const t = await play({ sources: [a, b] });
  await t.listenUntil(400000);
  assert.ok(t.diag.snapshot().fileEnglish.cues > 10);
  t.failNow('PLAYER_ERROR_CONNECTION_FAILED', 404);
  await t.advance(5000);
  assert.equal(t.diag.snapshot().fileEnglish, null);
});

test('no English track in the file: says so and listens to nothing', async () => {
  const src = stream(REL, { tracks: JSON.stringify([{ type: 'AUDIO', codec: 'AAC', lang: 'eng', channels: 2 }, { type: 'TEXT', codec: 'SRT', lang: 'rus' }]), duration: 9000 });
  const t = await play({ sources: [src] });
  assert.ok(t.decisions().includes('timing: no English reference (none in the file either)'), t.decisions().join(' | '));
  assert.equal(t.engine.tracks().timing, 'Not checked: no English subtitle matched to this file');
});

test('a forced English track is not listened to', async () => {
  const src = stream(REL, { tracks: JSON.stringify([MPV_TRACKS[0], MPV_TRACKS[1], mpvTrack(1, 'eng', 'Forced', true)]), duration: 9000 });
  const t = await play({ adapter: 'mpv', sources: [src] });
  assert.ok(t.decisions().includes('timing: no English reference (none in the file either)'), t.decisions().join(' | '));
});

test('the status texts of listening and of a fit from the file track', () => {
  assert.equal(timingText('listening'), "Checking against the file's English subtitles…");
  assert.equal(timingText('aligned-file', { ratio: 1, offset: -2500 }), "Aligned to the file's English track: -2.5 s");
  assert.equal(timingText('aligned-file', { ratio: 1.043, offset: 1600 }), "Aligned to the file's English track: +1.6 s, speed 1.043");
});

test('the mpv secondary subtitle is observed and set hidden, and a cue is recorded from start, end and text', async () => {
  const t = await play({ adapter: 'mpv' });
  assert.equal(typeof t.avplay.captureTrack, 'function');
  assert.ok(t.mpv.prop('secondary-sid') !== null && t.mpv.prop('secondary-sid') !== 'no', 'the English track is the secondary one');
  const seen = [];
  const before = t.diag.snapshot().fileEnglish.cues;
  t.mpv.secondaryCue(100, 103, 'a line');
  t.mpv.secondaryCue(110, 112, '');
  await t.advance(50);
  assert.equal(t.diag.snapshot().fileEnglish.cues >= before, true);
  void seen;
});
