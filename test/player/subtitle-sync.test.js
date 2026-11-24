// Subtitle timing against an English reference (1.12): referenceFor, the kept add-on fields, the engine wiring on the overlay and the mpv path,
// the remembered alignment, the pickBest switch, and the guards against an add-on's message file posing as a subtitle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, stream } from './helpers.js';
import { Addon, Subtitle } from '../../src/core/addon.js';
import { fakeHttp, fixtureAddons } from '../core/helpers.js';
import { referenceFor, createAligner, analyse, mapCues, createAlignMemory } from '../../src/player/subtitle-sync.js';
import { releaseKey } from '../../src/core/delay-memory.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createSubtitleMemory, isNoticeSub, noticesLast, notASubtitle, subtitlePlan } from '../../src/core/subtitle-memory.js';
import { timingText } from '../../src/player/subtitle-sync.js';
import { createDiag } from '../../src/player/diag.js';
import { buildReport } from '../../src/screens/diagnostics.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';
import { createDelayMemory } from '../../src/core/delay-memory.js';

// ---- fixtures: an English reference, a Turkish copy made for another release, and an unrelated film ----
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function cuesFor(seed, n = 500) {
  const r = rng(seed);
  const out = [];
  let t = 20000;
  for (let i = 0; i < n; i++) { const d = 1200 + Math.floor(r() * 2800); out.push({ start: Math.round(t), end: Math.round(t + d) }); t += d + 400 + Math.floor(r() * 7000); }
  return out;
}
const stamp = (ms) => { const p = (n, w) => String(n).padStart(w, '0'); const s = Math.floor(ms / 1000); return p(Math.floor(s / 3600), 2) + ':' + p(Math.floor(s / 60) % 60, 2) + ':' + p(s % 60, 2) + ',' + p(ms % 1000, 3); };
const srt = (cues, tag) => cues.map((c, i) => (i + 1) + '\n' + stamp(c.start) + ' --> ' + stamp(c.end) + '\n' + tag + ' ' + i + '\n').join('\n');
const K = 25 / 23.976;
const EN = cuesFor(7);
const TR = EN.map((c) => ({ start: Math.round(c.start * K + 2500), end: Math.round(c.end * K + 2500) })); // late by 2.5 s and stretched
const OTHER = cuesFor(99);
const REL = 'Movie 1080p WEB-DL x264-A';

const sub = (url, lang, addon, extra = {}) => Object.assign(new Subtitle(url, lang, addon), extra);
const TEXTS = {
  'https://s.test/en.srt': srt(EN, 'en'),
  'https://s.test/tr1.srt': srt(TR, 'tr'),
  'https://s.test/tr-other.srt': srt(OTHER, 'tr-other'),
};
const plainStore = () => { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } }; };

async function play({ subs, sources = null, answer = null, late = null, fileHash = null, remembered = null, texts = TEXTS, store = plainStore(), adapter = 'avplay', subLang = 'tr', httpLog = [] }) {
  clearSubtitleCache();
  const mem = createSourceMemory(store);
  mem.delays = createDelayMemory(store, { report: () => {} });
  mem.aligns = createAlignMemory(store);
  mem.subtitles = createSubtitleMemory(store, { report: () => {} });
  const t = makeEngine({ adapter, memory: mem, sources: sources || [stream(REL, { duration: 5400 })], http: { get: async (u) => { httpLog.push(u); if (!(u in texts)) throw new Error('404'); return texts[u]; } } });
  if (fileHash) t.avplay.fileHash = fileHash;
  if (remembered) store.set('subs/tt15239678', remembered);
  if (subLang) t.store.set('settings/subLang@p1', subLang);
  t.stremio.addons = async () => [{ name: 'Subs', serves: () => true, subtitles: async (ty, id, extra) => (answer ? answer(extra) : subs) }].concat(late ? [{ name: 'Late', serves: () => true, subtitles: () => new Promise((resolve) => t.clock.setTimeout(() => resolve([late.en]), late.ms)) }] : []);
  await t.start();
  await t.advance(40000);
  t.store2 = store;
  t.httpLog = httpLog;
  t.decisions = () => t.diag.snapshot().decisions.map((d) => d.text || d);
  return t;
}
const shownNow = (t) => { const e = t.events.subtitle; return e.length && e[e.length - 1].lines ? e[e.length - 1].lines.map((l) => l.map((s) => s.text).join('')).join('/') : null; };
const standard = () => [sub('https://s.test/en.srt', 'eng', 'Subs', { id: 'en1', matchedBy: 'hash' }), sub('https://s.test/tr1.srt', 'tur', 'Subs', { id: 'tr1' })];

// ---- units ----
test('referenceFor: only an English subtitle with matchedBy hash', () => {
  const imdb = sub('u1', 'eng', 'A', { matchedBy: 'imdb' });
  const trHash = sub('u2', 'tur', 'A', { matchedBy: 'hash' });
  const plain = sub('u3', 'eng', 'A');
  const good = sub('u4', 'eng', 'A', { matchedBy: 'hash' });
  const good2 = sub('u5', 'en', 'B', { matchedBy: 'hash' });
  assert.equal(referenceFor([imdb, trHash, plain]), null);
  assert.equal(referenceFor([imdb, trHash, good, good2]), good);
  assert.equal(referenceFor([]), null);
  assert.equal(referenceFor(null), null);
});

test('Subtitle keeps matchedBy, fps and releaseName from the add-on answer', async () => {
  const answer = { subtitles: [
    { url: 'https://s/a.srt', lang: 'eng', m: 'h', fpsMilli: 23976, movieReleaseName: 'Movie.2020.1080p', subtitleFileName: 'x.srt' },
    { url: 'https://s/b.srt', lang: 'eng', m: 'i', subtitleFileName: 'b.srt' },
    { url: 'https://s/c.srt', lang: 'tur' },
  ] };
  const http = fakeHttp({ overrides: { 'https://opensubtitles-v3.strem.io/subtitles/movie/tt1.json': JSON.stringify(answer) } });
  const subs = fixtureAddons(http).find((a) => a.name === 'OpenSubtitles v3');
  assert.ok(subs instanceof Addon);
  const [a, b, c] = await subs.subtitles('movie', 'tt1');
  assert.deepEqual([a.matchedBy, a.fps, a.releaseName], ['hash', 23.976, 'Movie.2020.1080p']);
  assert.deepEqual([b.matchedBy, b.fps, b.releaseName], ['imdb', null, 'b.srt']);
  assert.deepEqual([c.matchedBy, c.fps, c.releaseName], [null, null, null]);
});

test('analyse finds the stretch and the shift; mapCues maps cues back within 100 ms', () => {
  const [r] = analyse(EN, [{ id: 'x', cues: TR }]);
  assert.equal(r.checked, 'high');
  const mapped = mapCues(TR.map((c) => Object.assign({ lines: [] }, c)), r);
  mapped.forEach((c, i) => { assert.ok(Math.abs(c.start - EN[i].start) < 100, 'cue ' + i); });
});

test('the aligner runs in the page when there is no worker, after a timer', async () => {
  let deferred = 0;
  const a = createAligner({ workerSource: null, defer: (fn) => { deferred++; setTimeout(fn, 0); } });
  const out = await a.compute(EN, [{ id: 1, cues: TR }]);
  assert.equal(deferred, 1);
  assert.equal(out[0].checked, 'high');
});

// ---- the message-file guard ----
test('the label filter: the Turkish quota label and English variants; Not synced entries stay', () => {
  const l = (label, id = '') => ({ label, id });
  assert.ok(isNoticeSub(l('⚠️ OpenSubtitles: bugünkü indirmeler bitti (ne zaman döneceğini görmek için seç)')));
  assert.ok(isNoticeSub(l('x', 'bugünkü indirme hakkın doldu')));
  assert.ok(isNoticeSub(l('Daily download limit reached')));
  assert.ok(isNoticeSub(l('Downloads quota exceeded')));
  assert.ok(isNoticeSub(l('Quota reached, try later')));
  assert.ok(isNoticeSub(l('LIMIT REACHED')));
  assert.ok(!isNoticeSub(l('⚠️ Not synced · SubDL · Movie.2020_[eng]')));
  assert.ok(!isNoticeSub(l('⚠️ Senkronlanmadı · SubDL · Movie.Turkish')));
  assert.ok(!isNoticeSub(l(null, null)));
  const a = l('Not synced'), b = l('indirme hakkın doldu'), c = l('Other');
  assert.deepEqual(noticesLast([b, a, c]), [a, c, b]);
});

test('notASubtitle: under 5 cues, or a short span in a long video', () => {
  const cues = (n, step) => Array.from({ length: n }, (_, i) => ({ start: i * step, end: i * step + 1000 }));
  assert.equal(notASubtitle(cues(1, 1000), 0), true);
  assert.equal(notASubtitle(cues(4, 100000), 0), true);
  assert.equal(notASubtitle(cues(5, 1000), 5400000), true);
  assert.equal(notASubtitle(cues(5, 1000), 0), false, 'duration unknown: only the count counts');
  assert.equal(notASubtitle(cues(5, 60000), 5400000), false);
});

const MESSAGE = '1\n00:00:00,000 --> 00:00:04,000\nOpenSubtitles: bugünkü indirme hakkın doldu.\n';
function messageSubs() {
  return [
    sub('https://s.test/msg.srt', 'tur', 'Subtitle Sync', { id: 'msg', label: 'Subtitle Sync file' }),
    sub('https://s.test/tr1.srt', 'tur', 'Subtitle Sync', { id: 'tr1', label: '⚠️ Not synced · SubDL · Movie' }),
  ];
}
const MSG_TEXTS = Object.assign({}, TEXTS, { 'https://s.test/msg.srt': MESSAGE });

for (const adapter of ['avplay', 'mpv']) {
  test('a 1-cue message file from the add-on is skipped and the next Turkish one starts [' + adapter + ']', async () => {
    const t = await play({ subs: messageSubs(), texts: MSG_TEXTS, adapter, subLang: 'tr' });
    assert.equal(t.engine.tracks().chosenSub.id, 'tr1');
    assert.ok(t.decisions().some((d) => /^subtitles: skipped Subtitle Sync file: not a subtitle \(1 cues\)$/.test(d)), t.decisions().join('\n'));
  });

  test('the quota label hides a file from the automatic start and lists it last [' + adapter + ']', async () => {
    const quota = sub('https://s.test/quota.srt', 'tur', 'Subtitle Sync', { id: 'q', label: '⚠️ OpenSubtitles: bugünkü indirmeler bitti' });
    const t = await play({ subs: [quota, sub('https://s.test/tr1.srt', 'tur', 'Subtitle Sync', { id: 'tr1', label: '⚠️ Senkronlanmadı · SubDL' })], adapter, subLang: 'tr' });
    assert.equal(t.engine.tracks().chosenSub.id, 'tr1');
    assert.deepEqual(t.engine.tracks().addonSubs.map((s) => s.id), ['tr1', 'q']);
    assert.ok(!t.httpLog.includes('https://s.test/quota.srt'), 'never fetched');
  });

  test('a menu pick of the message file still shows it, and is not remembered [' + adapter + ']', async () => {
    const t = await play({ subs: messageSubs(), texts: MSG_TEXTS, adapter });
    const msg = t.engine.tracks().addonSubs.find((s) => s.id === 'msg');
    assert.equal(await t.engine.selectSubtitle({ kind: 'addon', sub: msg }), true);
    assert.equal(t.engine.tracks().chosenSub.id, 'msg');
    assert.equal(t.store2.get('subs/tt15239678'), undefined, 'the subtitle memory keeps nothing');
  });
}

// ---- the wiring ----
test('overlay: Turkish late by 2.5 s and stretched, English reference marked hash: cues mapped back, decide line, store key', async () => {
  const t = await play({ subs: standard() });
  await pick(t, 'tr1');
  await t.advance(3000); // the aligner runs after the picture and a timer
  const lines = t.decisions().filter((d) => /^timing:/.test(d));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /^timing: aligned to English \(file match\): -?\+?[-+]\d+\.\d s, speed 0\.95\d\d, gain 0\.\d\d$/);
  const key = 'align/' + releaseKey(stream(REL)) + '/addon:Subs:tr1';
  const kept = t.store2.get(key);
  assert.ok(kept && Math.abs(kept.ratio - 1 / K) < 0.001 && kept.gain >= 0.4, JSON.stringify(kept));
  // at an English cue's time the Turkish cue with the same index shows
  let seen = 0;
  for (const i of [3, 12, 40]) {
    await t.advance(EN[i].start + 500 - t.position());
    assert.equal(shownNow(t), 'tr ' + i, 'cue ' + i);
    seen++;
  }
  assert.equal(seen, 3);
});

test('the user delay is added on top of the alignment on the overlay path and stays when it changes', async () => {
  const t = await play({ subs: standard() });
  await pick(t, 'tr1');
  await t.advance(3000);
  t.engine.setSubtitleDelay(1000);
  await t.advance(EN[5].start + 500 - t.position());
  assert.notEqual(shownNow(t), 'tr 5', 'one second later than the mapped time');
  await t.advance(EN[5].start + 1500 - t.position());
  assert.equal(shownNow(t), 'tr 5');
  assert.ok(t.store2.get('align/' + releaseKey(stream(REL)) + '/addon:Subs:tr1'), 'the alignment stays');
});

test('another film: gain is low, nothing is changed, nothing stored', async () => {
  const subs = [sub('https://s.test/en.srt', 'eng', 'Subs', { id: 'en1', matchedBy: 'hash' }), sub('https://s.test/tr-other.srt', 'tur', 'Subs', { id: 'tr-other' })];
  const t = await play({ subs });
  await pick(t, 'tr-other');
  await t.advance(3000);
  assert.ok(t.decisions().some((d) => /^timing: not changed \(best gain 0\.\d\d below 0\.40\)$/.test(d)), t.decisions().join('\n'));
  assert.equal([...t.store2.m.keys()].filter((k) => k.startsWith('align/')).length, 0);
  await t.advance(OTHER[10].start + 500 - t.position());
  assert.equal(shownNow(t), 'tr-other 10', 'cues unchanged');
});

test('no reference matched to this file: nothing happens, says so', async () => {
  const subs = [sub('https://s.test/en.srt', 'eng', 'Subs', { id: 'en1', matchedBy: 'imdb' }), sub('https://s.test/tr1.srt', 'tur', 'Subs', { id: 'tr1' })];
  const t = await play({ subs });
  await pick(t, 'tr1');
  await t.advance(3000);
  assert.ok(t.decisions().includes('timing: no English reference matched to this file'));
});

test('a better Turkish file of the language is switched to when the chosen one does not fit', async () => {
  const subs = [sub('https://s.test/en.srt', 'eng', 'Subs', { id: 'en1', matchedBy: 'hash' }), sub('https://s.test/tr-other.srt', 'tur', 'Subs', { id: 'tr-other' }), sub('https://s.test/tr1.srt', 'tur', 'Subs', { id: 'tr1', label: 'Good One' })];
  const t = await play({ subs });
  await pick(t, 'tr-other');
  await t.advance(5000);
  assert.equal(t.engine.tracks().chosenSub.id, 'tr1');
  assert.ok(t.decisions().includes('timing: switched to Good One (fits this file better)'), t.decisions().join('\n'));
  assert.ok(t.decisions().some((d) => /^timing: aligned/.test(d)) === false, 'the switch says one line');
  await t.advance(EN[8].start + 500 - t.position());
  assert.equal(shownNow(t), 'tr 8');
  assert.ok(t.store2.get('align/' + releaseKey(stream(REL)) + '/addon:Subs:tr1'));
});

test('remembered alignment: applied at once on the next play, without fetching the reference', async () => {
  const store = plainStore();
  const a = await play({ subs: standard(), store });
  await pick(a, 'tr1');
  await a.advance(3000);
  assert.ok(store.get('align/' + releaseKey(stream(REL)) + '/addon:Subs:tr1'));
  const b = await play({ subs: standard(), store });
  await b.advance(3000);
  assert.ok(b.httpLog.includes('https://s.test/tr1.srt') && !b.httpLog.includes('https://s.test/en.srt'), 'the reference was not fetched: ' + b.httpLog.join(' '));
  assert.ok(b.decisions().includes('timing: remembered alignment'));
  await b.advance(EN[6].start + 500 - b.position());
  assert.equal(shownNow(b), 'tr 6');
});

test('Mac path: sub-speed and sub-delay are set (alignment offset plus the user delay); a new pick resets the speed', async () => {
  const t = await play({ subs: standard(), adapter: 'mpv' });
  await pick(t, 'tr1');
  await t.advance(3000);
  const speed = t.mpv.prop('sub-speed');
  const delay = t.mpv.prop('sub-delay');
  assert.ok(Math.abs(speed - 1 / K) < 0.001, 'sub-speed ' + speed);
  assert.ok(Math.abs(delay - -2500 / K / 1000) < 0.1, 'sub-delay ' + delay);
  t.engine.setSubtitleDelay(500);
  await t.advance(50);
  assert.ok(Math.abs(t.mpv.prop('sub-delay') - (delay + 0.5)) < 1e-6, 'user delay on top');
  assert.ok(t.decisions().some((d) => /^timing: aligned/.test(d)));
  await t.engine.selectSubtitle({ kind: 'off' });
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-speed'), 1);
});

test('Mac path with a fake avplay: setSubSpeed and setSubDelay recorders', async () => {
  const t = await play({ subs: standard(), adapter: 'mpv' });
  const calls = [];
  const sp = t.avplay.setSubSpeed, dl = t.avplay.setSubDelay;
  t.avplay.setSubSpeed = (v) => { calls.push(['speed', v]); return sp(v); };
  t.avplay.setSubDelay = (v) => { calls.push(['delay', v]); return dl(v); };
  await t.engine.selectSubtitle({ kind: 'off' }); // back to the same subtitle: its remembered alignment is applied at once
  await t.advance(50);
  calls.length = 0;
  await pick(t, 'tr1');
  await t.advance(50);
  assert.ok(calls.some((c) => c[0] === 'speed' && Math.abs(c[1] - 1 / K) < 0.001), JSON.stringify(calls));
  assert.ok(calls.some((c) => c[0] === 'delay' && c[1] < -2));
});

test('the reference arrives only after the add-ons answer again: the Turkish subtitle on screen is aligned then', async () => {
  const tr = sub('https://s.test/tr1.srt', 'tur', 'Subs', { id: 'tr1' });
  const en = sub('https://s.test/en.srt', 'eng', 'Late', { id: 'en2', matchedBy: 'hash' });
  const t = await play({ subs: [tr], late: { en, ms: 60000 } });
  await pick(t, 'tr1');
  await t.advance(3000);
  assert.ok(t.decisions().includes('timing: no English reference matched to this file'));
  await t.advance(60000);
  await t.advance(3000);
  assert.ok(t.decisions().some((d) => /^timing: aligned/.test(d)), t.decisions().join(' | '));
});

// the Turkish subtitle is the profile's language: it starts by itself; a menu pick is only needed when another one is wanted
async function pick(t, id) {
  if (t.engine.tracks().chosenSub && t.engine.tracks().chosenSub.id === id) return;
  await t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs.find((s) => s.id === id) });
}

for (const adapter of ['avplay', 'mpv']) {
  test('failover to another release: the alignment is dropped, the cues are unmapped, the new release has no reference [' + adapter + ']', async () => {
    const a = stream('Movie A 1080p WEB-DL x264-A', { duration: 5400 }, { filename: 'Movie.A.mkv' });
    const b = stream('Movie B 2160p BluRay x265-B', { duration: 5400 }, { filename: 'Movie.B.mkv' });
    const answer = (extra) => (/Movie.A/.test(decodeURIComponent(extra || '')) ? standard() : [sub('https://s.test/tr1.srt', 'tur', 'Subs', { id: 'tr1' })]);
    const t = await play({ subs: [], sources: [a, b], answer, adapter });
    await pick(t, 'tr1');
    await t.advance(3000);
    assert.ok(t.decisions().some((d) => /^timing: aligned/.test(d)), t.decisions().join(' | '));
    if (adapter === 'mpv') assert.ok(Math.abs(t.mpv.prop('sub-speed') - 1 / K) < 0.001);
    t.failNow('PLAYER_ERROR_CONNECTION_FAILED', 404);
    await t.advance(5000);
    assert.equal(t.engine.currentSource ? t.engine.currentSource().filename : 'Movie.B.mkv', 'Movie.B.mkv');
    if (adapter === 'mpv') { assert.equal(t.mpv.prop('sub-speed'), 1); assert.equal(t.mpv.prop('sub-delay'), 0); }
    await t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs.find((x) => x.id === 'tr1') });
    await t.advance(3000);
    assert.ok(t.decisions().includes('timing: no English reference matched to this file'), t.decisions().join(' | '));
    if (adapter === 'mpv') assert.equal(t.mpv.prop('sub-speed'), 1);
    else { await t.advance(OTHER[0].start * 0 + TR[4].start + 500 - t.position()); assert.equal(shownNow(t), 'tr 4', 'the cues are the unmapped file'); }
  });
}

// ---- the hash-matched subtitle, the timing line after a refresh, the diagnostics counts and the menu status ----
const trSub = (id, extra = {}) => sub('https://s.test/' + id + '.srt', 'tur', 'Subs', Object.assign({ id }, extra));
const HASH_TEXTS = Object.assign({}, TEXTS, { 'https://s.test/ta.srt': TEXTS['https://s.test/tr1.srt'], 'https://s.test/tb.srt': TEXTS['https://s.test/tr1.srt'], 'https://s.test/th.srt': TEXTS['https://s.test/tr1.srt'] });

test('subtitlePlan: a hash-matched subtitle beats the remembered add-on and the name match', () => {
  const named = sub('u1', 'tur', 'Named', { id: 'Movie.1080p.WEB-DL.x264-A', label: 'Movie 1080p WEB-DL x264-A' });
  const rem = sub('u2', 'tur', 'Remembered', { id: 'r' });
  const hashed = sub('u3', 'tur', 'Hashed', { id: 'h', matchedBy: 'hash' });
  const ctx = { textTracks: [], addonsDone: true, lang: (l) => ({ tur: 'tr' }[l] || l), match: { filename: 'Movie.1080p.WEB-DL.x264-A.mkv', sig: null } };
  const before = subtitlePlan({ kind: 'lang', language: 'tr', addon: 'Remembered' }, Object.assign({ addonSubs: [rem, named] }, ctx));
  assert.notEqual(before.sub, hashed);
  const plan = subtitlePlan({ kind: 'lang', language: 'tr', addon: 'Remembered' }, Object.assign({ addonSubs: [rem, named, hashed] }, ctx));
  assert.equal(plan.sub, hashed);
  assert.equal(plan.hashed, true);
});

for (const adapter of ['avplay', 'mpv']) {
  test('after the file hash a hash-matched Turkish replaces the auto-started one, with the decide line and the note [' + adapter + ']', async () => {
    const answer = (extra) => [trSub('ta'), trSub('tb')].concat(/videoHash/.test(extra || '') ? [trSub('th', { matchedBy: 'hash' })] : []);
    const t = await play({ subs: [], answer, texts: HASH_TEXTS, adapter, fileHash: async () => '8e245d9679d31e12', remembered: { kind: 'lang', language: 'tr', addon: 'Subs' } });
    assert.equal(t.engine.tracks().chosenSub.id, 'th');
    assert.ok(t.decisions().includes('subtitles: Turkish matched to this file by its hash (Subs)'), t.decisions().join(' | '));
    assert.ok(t.decisions().includes('timing: matched to this file by OpenSubtitles (no change needed)'));
    assert.equal(t.engine.tracks().timing, 'Timed to this file');
    assert.ok(t.events.notice.some((n) => n.message === 'Turkish timed to this file'));
  });

  test('after a refresh with no reference the timing line says so, once more after the file hash [' + adapter + ']', async () => {
    const t = await play({ subs: [trSub('tr1')], adapter, fileHash: async () => '8e245d9679d31e12' });
    const lines = t.decisions().filter((d) => /^timing: no English reference matched/.test(d));
    assert.ok(lines.length >= 1, 'a timing line after the refresh');
    assert.equal(lines[lines.length - 1], 'timing: no English reference matched to this file (after the file hash)');
    assert.equal(t.engine.tracks().timing, 'Not checked: no English subtitle matched to this file');
  });
}

test('Diagnostics: the add-on line counts the subtitles matched to this file and the languages of those', async () => {
  const d = createDiag();
  d.subtitleAddon('Duck Streams (AIOStreams)', 94, ['English', 'Turkish', 'English']);
  d.subtitleAddon('Other', 5, []);
  d.subtitleAddon('Third', 2);
  const snap = d.snapshot();
  assert.deepEqual(snap.subtitleAddons.map((a) => a.text), ['94 found, 3 matched to this file (English, Turkish)', '5 found', '2 found']);
  const lines = buildReport({ log: { lines: () => [] }, diag: snap }).find((x) => x.title === 'SUBTITLE ADD-ONS').lines.map((l) => l.text);
  assert.ok(lines.includes('Duck Streams (AIOStreams): 94 found, 3 matched to this file (English, Turkish)'), lines.join(' | '));
});

test('Diagnostics from the engine: the matched count follows the add-on answer', async () => {
  const t = await play({ subs: [sub('https://s.test/en.srt', 'eng', 'Subs', { id: 'e', matchedBy: 'hash' }), trSub('tr1', { matchedBy: 'hash' }), trSub('x')] });
  assert.deepEqual(t.diag.snapshot().subtitleAddons.map((a) => a.text), ['3 found, 2 matched to this file (English, Turkish)']);
});

test('the menu status text for each timing state', () => {
  assert.equal(timingText('hash'), 'Timed to this file');
  assert.equal(timingText('aligned', { ratio: 1, offset: 1600 }), 'Aligned to English: +1.6 s');
  assert.equal(timingText('aligned', { ratio: 1 / K, offset: -2400 }), 'Aligned to English: -2.4 s, speed 0.959');
  assert.equal(timingText('remembered', { ratio: 1, offset: 1600 }), 'Remembered alignment: +1.6 s');
  assert.equal(timingText('noref'), 'Not checked: no English subtitle matched to this file');
  assert.equal(timingText('nochange'), 'Not changed: no confident fit');
  assert.equal(timingText(null), '');
});

test('the engine exposes the status: empty at first, aligned, remembered, not changed', async () => {
  const store = plainStore();
  const a = await play({ subs: standard(), store });
  assert.equal(a.engine.tracks().timing.indexOf('Aligned to English: -2.4 s, speed 0.959'), 0);
  assert.ok(a.events.notice.some((n) => n.message === 'Turkish timed to this file'));
  const b = await play({ subs: standard(), store });
  assert.match(b.engine.tracks().timing, /^Remembered alignment: -2\.4 s, speed 0\.959$/);
  const c = await play({ subs: [sub('https://s.test/en.srt', 'eng', 'Subs', { id: 'en1', matchedBy: 'hash' }), sub('https://s.test/tr-other.srt', 'tur', 'Subs', { id: 'tr-other' })] });
  assert.equal(c.engine.tracks().timing, 'Not changed: no confident fit');
});
