// The pure parts of the player: subtitle parsing and timing, track names and rows, the start-subtitle rule, the AVPlay
// wrapper's call order, the TV language, and what Diagnostics keeps. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles, shiftCues, cueAt, cueLines, cuePlain } from '../../src/player/subtitles.js';
import { trackName, audioRows, parseTextTracks, startSubtitle, subtitleRows, timingLabel, TIMING_STEPS, SEP } from '../../src/player/tracks.js';
import { createAvplay, splitHeaders, errorCode, SCREEN } from '../../src/player/avplay.js';
import { twoLetters, createTvLanguage } from '../../src/player/language.js';
import { urlParts, createDiag } from '../../src/player/diag.js';
import { parseAudioTracks } from '../../src/core/audio.js';
import { resolvePlayableUrl } from '../../src/player/sources.js';

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>there</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n{\\an8}Second\r\nline &amp; more\r\n\r\n3\r\n01:02:03,004 --> 01:02:04,000\r\nLate\r\n';
const VTT = 'WEBVTT\n\nNOTE x\n\n00:01.000 --> 00:02.000 align:start\nCue one\n\ncue2\n00:03.000 --> 00:04.250\nCue two\n';

test('SRT: times, italics, tags dropped, entities decoded, BOM and CRLF tolerated', () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual([cues[0].start, cues[0].end], [1000, 3500]);
  assert.deepEqual(cues[0].lines, [[{ text: 'Hello ', italic: false }, { text: 'there', italic: true }]]);
  assert.equal(cuePlain(cues[1].lines), 'Second\nline & more');
  assert.equal(cues[2].start, 3723004);
});

test('VTT: header and notes skipped, short times, cue identifiers ignored', () => {
  const cues = parseSubtitles(VTT, 'vtt');
  assert.deepEqual(cues.map((c) => [c.start, c.end, cuePlain(c.lines)]), [[1000, 2000, 'Cue one'], [3000, 4250, 'Cue two']]);
});

test('ASS: dialogue lines with commas in the text, override tags dropped, time order', () => {
  const ass = '[Script Info]\nTitle: x\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    + 'Dialogue: 0,0:00:09.50,0:00:11.00,Default,,0,0,0,,Later, with comma\n'
    + 'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\i1}First{\\i0}\\Nsecond\n';
  const cues = parseSubtitles(ass);
  assert.deepEqual(cues.map((c) => c.start), [1000, 9500]);
  assert.equal(cuePlain(cues[1].lines), 'Later, with comma');
  assert.deepEqual(cues[0].lines[0], [{ text: 'First', italic: true }]);
  assert.equal(cues[0].lines.length, 2);
});

test('untrusted text is never markup: tags other than italic vanish, nothing is kept as HTML', () => {
  const lines = cueLines('<script>alert(1)</script>Hi <b>bold</b> <font color="red">x</font>');
  assert.equal(cuePlain(lines), 'alert(1)Hi bold x');
});

test('garbage and empty input give no cues', () => {
  assert.deepEqual(parseSubtitles(''), []);
  assert.deepEqual(parseSubtitles('not a subtitle file'), []);
  assert.deepEqual(parseSubtitles(null), []);
});

test('shiftCues is Alder\'s shiftSubtitles on parsed times; never before 0', () => {
  const cues = parseSubtitles(SRT);
  const later = shiftCues(cues, 500);
  assert.deepEqual([later[0].start, later[0].end], [1500, 4000]);
  const earlier = shiftCues(cues, -2000);
  assert.equal(earlier[0].start, 0);
  assert.equal(earlier[1].start, 2000);
  assert.equal(shiftCues(cues, 0), cues);
});

test('cueAt: the cue showing now, forward playback with a hint, seeking back', () => {
  const cues = parseSubtitles(SRT);
  assert.equal(cueAt(cues, 500), null);
  const a = cueAt(cues, 1000);
  assert.equal(a.index, 0);
  assert.equal(cueAt(cues, 3499, a.index).index, 0);
  assert.equal(cueAt(cues, 3500, a.index), null, 'end is exclusive');
  const b = cueAt(cues, 5000, a.index);
  assert.equal(b.index, 1);
  assert.equal(cueAt(cues, 1500, b.index).index, 0, 'a hint past the time is not trusted');
  assert.equal(cueAt([], 1000), null);
});

// ---- track names and rows ----

const TRACKS = [
  { index: 0, type: 'VIDEO', extra_info: '{"fourCC":"avc1","width":"1920","height":"1080"}' },
  { index: 1, type: 'AUDIO', extra_info: '{"language":"eng","channels":"6","sample_rate":"48000","fourCC":"audio/ac3"}' },
  { index: 2, type: 'AUDIO', extra_info: '{"language":"eng","channels":"6","sample_rate":"48000","fourCC":"audio/dts"}' },
  { index: 3, type: 'AUDIO', extra_info: '{"language":"rus","channels":"2","sample_rate":"48000","fourCC":"audio/mp4a-latm"}' },
  { index: 4, type: 'TEXT', extra_info: '{"track_lang":"eng"}' },
  { index: 5, type: 'TEXT', extra_info: '{"track_lang":"rus","track_name":"Forced"}' },
];

test('trackName: Alder\'s "English  ·  Dolby Digital 5.1"', () => {
  const audio = parseAudioTracks(TRACKS);
  assert.equal(trackName(audio.find((t) => t.index === 1), true), 'English' + SEP + 'Dolby Digital 5.1');
  assert.equal(trackName(audio.find((t) => t.index === 3), true), 'Russian' + SEP + 'AAC Stereo');
});

test('audioRows: an undecodable track stays in the list, greyed, tagged "No sound on this TV"', () => {
  const rows = audioRows(parseAudioTracks(TRACKS));
  const dts = rows.find((r) => r.index === 2);
  assert.equal(dts.playable, false);
  assert.ok(dts.tag.endsWith('No sound on this TV'), dts.tag);
  assert.equal(rows.find((r) => r.index === 1).playable, true);
  assert.equal(rows.find((r) => r.index === 1).label, 'English' + SEP + 'Dolby Digital 5.1');
});

test('text tracks parsed from getTotalTrackInfo; und/unknown language is empty', () => {
  const text = parseTextTracks(TRACKS);
  assert.deepEqual(text.map((t) => [t.index, t.language, t.forced]), [[4, 'en', false], [5, 'ru', true]]);
  assert.deepEqual(parseTextTracks('notSet'), []);
  assert.deepEqual(parseTextTracks([{ index: 0, type: 'TEXT', extra_info: '{"track_lang":"und"}' }])[0].language, '');
});

test('start subtitle: only in the TV\'s language, ignoring foreign forced/default flags', () => {
  const text = parseTextTracks(TRACKS);
  assert.equal(startSubtitle(text, { enabled: true, tvLanguage: 'en' }).index, 4);
  assert.equal(startSubtitle(text, { enabled: true, tvLanguage: 'de' }), null, 'no German track: none, not the Russian forced one');
  assert.equal(startSubtitle(text, { enabled: false, tvLanguage: 'en' }), null);
  assert.equal(startSubtitle([], { enabled: true, tvLanguage: 'en' }), null);
  const both = parseTextTracks([
    { index: 7, type: 'TEXT', extra_info: '{"track_lang":"eng","track_name":"Forced"}' },
    { index: 8, type: 'TEXT', extra_info: '{"track_lang":"eng"}' },
  ]);
  assert.equal(startSubtitle(both, { enabled: true, tvLanguage: 'en' }).index, 8, 'a full track beats a forced one');
});

test('subtitle rows: Off first, then the file\'s, then the add-on\'s', () => {
  const rows = subtitleRows(parseTextTracks(TRACKS), [{ language: 'English', addon: 'OpenSubtitles', url: 'https://x/s.srt' }]);
  assert.deepEqual(rows.map((r) => r.kind), ['off', 'file', 'file', 'addon']);
  assert.equal(rows[1].label, 'English' + SEP + 'in the file');
  assert.equal(rows[3].label, 'English' + SEP + 'OpenSubtitles');
});

test('subtitle timing steps and words', () => {
  assert.deepEqual(TIMING_STEPS, [-2000, -1000, -500, 0, 500, 1000, 2000]);
  assert.equal(timingLabel(0), 'On time');
  assert.equal(timingLabel(-500), '-0.5 s  earlier');
  assert.equal(timingLabel(2000), '+2.0 s  later');
});

// ---- the AVPlay wrapper ----

function fakeWebapis(opts = {}) {
  const calls = [];
  let listener = null;
  const a = {
    getState: () => (calls.some((c) => c[0] === 'open') && !calls.some((c) => c[0] === 'close') ? 'IDLE' : 'NONE'),
    open: (u) => calls.push(['open', u]),
    close: () => calls.push(['close']),
    setListener: (l) => { listener = l; calls.push(['setListener']); },
    setDisplayRect: (...r) => calls.push(['setDisplayRect', ...r]),
    setDisplayMethod: (m) => calls.push(['setDisplayMethod', m]),
    setStreamingProperty: (k, v) => calls.push(['setStreamingProperty', k, v]),
    prepareAsync: (ok, bad) => { calls.push(['prepareAsync']); if (opts.prepareFails) bad(opts.prepareFails); else ok(); },
    seekTo: (ms, ok, bad) => { calls.push(['seekTo', ms]); ok(); },
    getTotalTrackInfo: () => opts.tracks === undefined ? TRACKS : opts.tracks,
  };
  return { calls, listener: () => listener, webapis: { avplay: a } };
}

test('open: Samsung\'s order, the whole screen in 1920x1080, User-Agent set, other headers logged as unsupported', () => {
  const f = fakeWebapis();
  const lines = [];
  const av = createAvplay({ webapis: f.webapis, log: { info: (t, m) => lines.push(t + ' ' + m) } });
  const r = av.open('https://h/x.mkv', { headers: { 'User-Agent': 'UA', Referer: 'https://r/' } }, {});
  assert.deepEqual(r.unsupportedHeaders, ['Referer']);
  assert.deepEqual(f.calls.map((c) => c[0]), ['open', 'setListener', 'setDisplayRect', 'setDisplayMethod', 'setStreamingProperty']);
  assert.deepEqual(f.calls[2], ['setDisplayRect', 0, 0, SCREEN.width, SCREEN.height]);
  assert.deepEqual(f.calls[4], ['setStreamingProperty', 'USER_AGENT', 'UA']);
  assert.ok(lines.some((l) => /Referer/.test(l)));
});

test('a new open drops the old session\'s callbacks', () => {
  const f = fakeWebapis();
  const av = createAvplay({ webapis: f.webapis });
  const seen = [];
  av.open('https://h/1.mkv', {}, { onTime: (ms) => seen.push('first ' + ms) });
  const first = f.listener();
  av.open('https://h/2.mkv', {}, { onTime: (ms) => seen.push('second ' + ms) });
  first.oncurrentplaytime(1000);
  f.listener().oncurrentplaytime(2000);
  assert.deepEqual(seen, ['second 2000']);
  av.close();
  f.listener().oncurrentplaytime(3000);
  assert.deepEqual(seen, ['second 2000'], 'nothing after close');
});

test('prepare and seek are promises; a failed prepare rejects with AVPlay\'s error', async () => {
  const bad = fakeWebapis({ prepareFails: 'PLAYER_ERROR_NOT_SUPPORTED_FILE' });
  const av = createAvplay({ webapis: bad.webapis });
  av.open('https://h/x.mkv', {}, {});
  await assert.rejects(av.prepare(), (e) => e === 'PLAYER_ERROR_NOT_SUPPORTED_FILE');
  const good = fakeWebapis();
  const av2 = createAvplay({ webapis: good.webapis });
  av2.open('https://h/x.mkv', {}, {});
  await av2.prepare();
  await av2.seekTo(12345.6);
  assert.deepEqual(good.calls.find((c) => c[0] === 'seekTo'), ['seekTo', 12346]);
});

test('"notSet" from getTotalTrackInfo (Tizen 5.5, DASH) is an empty list, not a crash', () => {
  const f = fakeWebapis({ tracks: 'notSet' });
  const av = createAvplay({ webapis: f.webapis });
  assert.deepEqual(av.totalTracks(), []);
});

test('splitHeaders and errorCode', () => {
  assert.deepEqual(splitHeaders({ cookie: 'a=b', 'USER-AGENT': 'u', Authorization: 'x' }), { supported: { COOKIE: 'a=b', USER_AGENT: 'u' }, unsupported: ['Authorization'] });
  assert.deepEqual(splitHeaders(null), { supported: {}, unsupported: [] });
  assert.equal(errorCode('PLAYER_ERROR_CONNECTION_FAILED'), 'PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(errorCode({ message: 'x PLAYER_ERROR_INVALID_URI y' }), 'PLAYER_ERROR_INVALID_URI');
  assert.equal(errorCode({ name: 'InvalidStateError', message: 'bad' }), 'InvalidStateError: bad');
  assert.equal(errorCode(null), 'UNKNOWN');
});

test('resolvePlayableUrl is the identity for now', () => {
  assert.equal(resolvePlayableUrl({ url: 'https://h/x' }), 'https://h/x');
});

// ---- the TV's language ----

test('twoLetters normalises locales', () => {
  assert.equal(twoLetters('en_US'), 'en');
  assert.equal(twoLetters('de-DE'), 'de');
  assert.equal(twoLetters('pt-BR'), 'pt');
  assert.equal(twoLetters('fra'), 'fr');
  assert.equal(twoLetters(''), '');
  assert.equal(twoLetters(undefined), '');
});

test('TV language: systeminfo LOCALE when it answers, else navigator.language, else en', async () => {
  const withInfo = createTvLanguage({ tizen: { systeminfo: { getPropertyValue: (k, ok) => { Promise.resolve().then(() => ok({ language: 'sv_SE' })); } } }, navigator: { language: 'en-US' } });
  assert.equal(withInfo.get(), 'en', 'at once from the browser');
  assert.equal(await withInfo.ready, 'sv');
  assert.equal(withInfo.get(), 'sv');
  const failing = createTvLanguage({ tizen: { systeminfo: { getPropertyValue: (k, ok, bad) => bad({ name: 'SecurityError' }) } }, navigator: { language: 'de-DE' } });
  assert.equal(await failing.ready, 'de');
  const throwing = createTvLanguage({ tizen: { systeminfo: { getPropertyValue: () => { throw new Error('x'); } } }, navigator: { language: 'fr' } });
  assert.equal(await throwing.ready, 'fr');
  const nothing = createTvLanguage({ tizen: undefined, navigator: undefined });
  assert.equal(nothing.get(), 'en');
});

// ---- Diagnostics keeps ----

test('urlParts: host and file only, never the query or the credentials', () => {
  assert.deepEqual(urlParts('https://user:pw@media.example.org/a/b/Dune%202024.mkv?token=SECRET#x'), { host: 'media.example.org', file: 'Dune 2024.mkv' });
  assert.deepEqual(urlParts('weird'), { host: '', file: 'weird' });
  assert.deepEqual(urlParts(''), { host: '', file: '' });
});

test('diag: a new stream clears the old tracks; the lists are bounded', () => {
  let t = 0;
  const d = createDiag({ now: () => ++t, limit: 3 });
  d.setStream({ url: 'https://h/f.mkv?k=1', label: '1080p', at: 0, total: 2 });
  d.setTracks([{ index: 1 }]);
  for (let i = 0; i < 5; i++) d.decision('d' + i);
  d.error('e');
  let s = d.snapshot();
  assert.deepEqual(s.decisions.map((x) => x.text), ['d2', 'd3', 'd4']);
  assert.equal(s.stream.file, 'f.mkv');
  assert.ok(!JSON.stringify(s).includes('k=1'));
  d.setStream({ url: 'https://h/g.mkv' });
  s = d.snapshot();
  assert.equal(s.rawTracks, null);
  assert.equal(s.errors.length, 1);
});

test('MIME-like fourCCs from AVPlay classify (audio/mpeg, audio/x-ac3, audio/mp4a-latm)', () => {
  const t = (fourCC) => parseAudioTracks([{ index: 1, type: 'AUDIO', extra_info: JSON.stringify({ language: 'ENG', channels: '2', fourCC }) }])[0];
  assert.equal(t('audio/mpeg').codec, 'MP3');
  assert.equal(t('audio/x-ac3').codec, 'AC3');
  assert.equal(t('audio/mp4a-latm').codec, 'AAC');
  assert.equal(t('audio/x-dts').playable, 'no');
});
