// The Mac adapter's tracks: mpv's track-list read by audio.js / tracks.js as they read AVPlay's, DTS and TrueHD choices on the Mac
// profile, add-on subtitles over the bridge, and switching audio, subtitles and off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createFakeClock } from './../player/helpers.js';
import { createAvplay as createMpv, audioCodecName } from '../../src/platform/mac/mpv.js';
import { parseAudioTracks, decideAudio } from '../../src/core/audio.js';
import { parseTextTracks } from '../../src/player/tracks.js';
import { macProfile } from '../../src/platform/mac/device.js';

const require = createRequire(import.meta.url);
const { createBridge } = require('../../mac/web/bridge.js');
const { installMock } = require('../../mac/web/mock-bridge.js');

const video = { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 };
const DTS_AAC = [video,
  { type: 'audio', id: 1, lang: 'eng', title: 'DTS 5.1', codec: 'dts', 'codec-profile': 'DTS', 'audio-channels': 6, selected: true },
  { type: 'audio', id: 2, lang: 'eng', title: 'AAC', codec: 'aac', 'codec-profile': 'LC', 'audio-channels': 2, selected: false }];
const TRUEHD = [video, { type: 'audio', id: 1, lang: 'eng', title: 'Atmos', codec: 'truehd', 'codec-profile': 'Dolby TrueHD + Dolby Atmos', 'audio-channels': 8, selected: true }];
const SUBS = [video,
  { type: 'audio', id: 1, lang: 'eng', codec: 'eac3', 'audio-channels': 6, selected: true },
  { type: 'sub', id: 1, lang: 'eng', title: 'English', codec: 'subrip', selected: true },
  { type: 'sub', id: 2, lang: 'fra', title: 'Francais', codec: 'subrip', selected: false }];

async function start(tracks) {
  const clock = createFakeClock(0);
  const win = {};
  const timers = { now: clock.now, after: (ms, fn) => { const id = clock.setTimeout(fn, ms); return () => clock.clearTimeout(id); }, every: (ms, fn) => { const id = clock.setInterval(fn, ms); return () => clock.clearInterval(id); } };
  const mock = installMock({ win, clock: timers, duration: 600, script: () => ({ tracks }) });
  const mpv = createMpv({ bridge: createBridge({ win }) });
  mpv.open('https://host.example/v.mkv', {}, {});
  const ready = mpv.prepare();
  await clock.advance(200);
  await ready;
  const settle = () => clock.advance(50);
  return { mock, mpv, settle };
}

test('codec names: DTS flavours and TrueHD reach classifyCodecId right', () => {
  assert.equal(audioCodecName('dts', 'DTS'), 'dts');
  assert.equal(audioCodecName('dts', 'DTS-HD MA'), 'dts-hd');
  assert.equal(audioCodecName('dts', 'DTS-HD HRA'), 'dts-hd');
  assert.equal(audioCodecName('dts', 'DTS:X'), 'dts:x');
  assert.equal(audioCodecName('truehd', 'Dolby TrueHD + Dolby Atmos'), 'truehd');
  ['eac3', 'ac3', 'aac'].forEach((c) => assert.equal(audioCodecName(c, 'LC'), c));
});

test('DTS 5.1 + AAC stereo: both listed with their codecs, the file default stays (DTS is playable on the Mac)', async () => {
  const { mpv } = await start(DTS_AAC);
  const raw = mpv.totalTracks();
  const audio = parseAudioTracks(raw, { currentIndex: mpv.currentIndex('AUDIO'), playable: macProfile().audio });
  assert.deepEqual(audio.map((t) => [t.index, t.codec, t.playable, t.channels, t.language]), [[0, 'DTS', 'yes', 6, 'en'], [1, 'AAC', 'yes', 2, 'en']]);
  const d = decideAudio(audio, { language: 'en', currentIndex: mpv.currentIndex('AUDIO') });
  assert.deepEqual([d.ok, d.index, d.change], [true, 0, false]);
});

test('TrueHD-only file plays on the Mac profile; on the Tizen default the same track is refused', async () => {
  const { mpv } = await start(TRUEHD);
  const raw = mpv.totalTracks();
  const mac = parseAudioTracks(raw, { currentIndex: 0, playable: macProfile().audio });
  assert.deepEqual([mac[0].codec, mac[0].playable], ['TRUEHD', 'yes']);
  assert.equal(decideAudio(mac, { currentIndex: 0 }).ok, true);
  assert.equal(parseAudioTracks(raw, { currentIndex: 0 })[0].playable, 'no');
});

test('switching audio sets aid, a text track sets sid, off clears sub-visibility', async () => {
  const { mpv, mock, settle } = await start(DTS_AAC.concat([
    { type: 'sub', id: 1, lang: 'eng', title: 'English', codec: 'subrip', selected: false },
    { type: 'sub', id: 2, lang: 'swe', title: 'Svenska', codec: 'subrip', selected: false }]));
  assert.equal(mpv.selectTrack('AUDIO', 1), true);
  await settle();
  assert.equal(mock.prop('aid'), 2);
  assert.equal(mpv.currentIndex('AUDIO'), 1);
  assert.equal(mpv.selectTrack('AUDIO', 0), true);
  await settle();
  assert.equal(mock.prop('aid'), 1);
  assert.equal(mpv.selectTrack('TEXT', 1), true);
  mpv.subtitlesOn(true);
  await settle();
  assert.equal(mock.prop('sid'), 2);
  assert.equal(mock.prop('sub-visibility'), true);
  mpv.subtitlesOn(false);
  await settle();
  assert.equal(mock.prop('sub-visibility'), false);
  assert.equal(mpv.selectTrack('TEXT', 5), false);
});

test('two embedded text tracks + one add-on subtitle: the add-on is selected by mpv and not listed with the file\'s', async () => {
  const { mpv, mock, settle } = await start(SUBS);
  assert.deepEqual(parseTextTracks(mpv.totalTracks()).map((t) => [t.index, t.language, t.label]), [[0, 'en', 'English'], [1, 'fr', 'Francais']]);
  assert.equal(mpv.currentIndex('TEXT'), 0);
  assert.equal(mpv.addSubtitle('1\n00:00:01,000 --> 00:00:02,000\nhi\n', { language: 'English', addon: 'OpenSubtitles' }), true);
  await settle();
  assert.deepEqual(mock.subs, [{ text: '1\n00:00:01,000 --> 00:00:02,000\nhi\n', lang: 'English', title: 'English - OpenSubtitles' }]);
  assert.equal(mock.prop('sid'), 3);
  assert.equal(parseTextTracks(mpv.totalTracks()).length, 2, 'still the two of the file');
  assert.equal(mpv.currentIndex('TEXT'), null, 'the add-on track is not one of the file\'s');
  // back to a file track, then off
  assert.equal(mpv.selectTrack('TEXT', 1), true);
  mpv.subtitlesOn(false);
  await settle();
  assert.equal(mock.prop('sid'), 2);
  assert.equal(mock.prop('sub-visibility'), false);
  assert.equal(mpv.addSubtitle('', {}), false);
  assert.ok(mock.posted.every((m) => !/https?:/.test(JSON.stringify(m.args)) || m.cmd === 'load'), 'no link on the wire but load');
});

test('Mac build: Subtitle timing steps are 0.1 s from -2 s to +2 s; the shared list stays Alder\'s', async () => {
  const { readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const { TRACKS_PATCHES } = await import('../../scripts/build.mjs');
  const src = fileURLToPath(new URL('../../src/player/tracks.js', import.meta.url));
  const copy = fileURLToPath(new URL('../../src/player/tracks.mac-test.js', import.meta.url));
  let text = readFileSync(src, 'utf8');
  for (const [from, to] of TRACKS_PATCHES) {
    assert.ok(text.includes(from), 'anchor present: ' + from);
    text = text.split(from).join(to);
  }
  writeFileSync(copy, text);
  let mac;
  try { mac = await import(pathToFileURL(copy).href); } finally { rmSync(copy, { force: true }); }
  assert.equal(mac.TIMING_STEPS.length, 41);
  assert.equal(mac.TIMING_STEPS[0], -2000);
  assert.equal(mac.TIMING_STEPS[20], 0);
  assert.equal(mac.TIMING_STEPS[40], 2000);
  assert.ok(mac.TIMING_STEPS.every((v, i) => i === 0 || v - mac.TIMING_STEPS[i - 1] === 100));
  assert.equal(mac.timingLabel(100), '+0.1 s  later');
  const shared = await import('../../src/player/tracks.js');
  assert.deepEqual([...shared.TIMING_STEPS], [-2000, -1000, -500, 0, 500, 1000, 2000]);
});
