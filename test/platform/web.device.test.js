// src/platform/web/device.js with a stubbed canPlayType, screen and devicePixelRatio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../../src/platform/web/device.js';
import * as mac from '../../src/platform/mac/device.js';

const docWith = (answers) => ({ createElement: () => ({ canPlayType: (t) => (t in answers ? answers[t] : '') }) });
const HVC = 'video/mp4; codecs="hvc1.1.6.L93.B0"';
const HEV = 'video/mp4; codecs="hev1.1.6.L93.B0"';
const AV1 = 'video/mp4; codecs="av01.0.05M.08"';
const AC3 = 'audio/mp4; codecs="ac-3"';
const EC3 = 'audio/mp4; codecs="ec-3"';
const profile = (answers, width = 412, dpr = 2.625) => web.macProfile({ doc: docWith(answers), screen: { width }, dpr });

test('exports the same names as the Mac device module', () => {
  assert.deepEqual(Object.keys(web).sort(), Object.keys(mac).sort());
});

test('nothing playable: no HEVC, no AV1, AAC family only, 1080 on a phone', () => {
  const p = profile({});
  assert.equal(p.hevc, false);
  assert.equal(p.av1, false);
  assert.equal(p.hdr, false);
  assert.equal(p.dolbyVision, false);
  assert.equal(p.height, 1080);
  assert.deepEqual([...p.audio].sort(), ['AAC', 'FLAC', 'MP3', 'OPUS', 'PCM', 'VORBIS']);
});

test('hevc: probably or maybe on either tag; av1: any non-empty answer; AC3 and EAC3 follow their canPlayType', () => {
  assert.equal(profile({ [HVC]: 'probably' }).hevc, true);
  assert.equal(profile({ [HEV]: 'maybe' }).hevc, true);
  assert.equal(profile({ [AV1]: 'maybe' }).av1, true);
  assert.equal(profile({ [AV1]: 'probably' }).av1, true);
  const p = profile({ [AC3]: 'probably', [EC3]: 'maybe' });
  assert.ok(p.audio.has('AC3') && p.audio.has('EAC3'));
  assert.ok(!p.audio.has('DTS') && !p.audio.has('TRUEHD') && !p.audio.has('DTS-HD') && !p.audio.has('DTS:X'));
  assert.ok(!profile({ [AC3]: 'probably' }).audio.has('EAC3'));
});

test('height: 2160 when screen.width * devicePixelRatio >= 3000', () => {
  assert.equal(profile({}, 1920, 1.5).height, 1080); // 2880
  assert.equal(profile({}, 1920, 2).height, 2160); // 3840
  assert.equal(profile({}, 3000, 1).height, 2160);
  assert.equal(profile({}, 2999, 1).height, 1080);
});

test('autoOk: H.264 8-bit, HEVC 8-bit only when the browser plays it, height within the profile, under 50 fps', () => {
  const s = (o) => Object.assign({ hevc: false, av1: false, isHdr: false, height: 1080, words: 'movie 1080p x264' }, o);
  const plain = profile({});
  const withHevc = profile({ [HVC]: 'probably' });
  assert.equal(plain.autoOk(s({})), true);
  assert.equal(plain.autoOk(s({ height: 0 })), true);
  assert.equal(plain.autoOk(s({ hevc: true })), false);
  assert.equal(withHevc.autoOk(s({ hevc: true })), true);
  assert.equal(withHevc.autoOk(s({ hevc: true, words: 'hevc 10bit' })), false);
  assert.equal(withHevc.autoOk(s({ hevc: true, words: 'x265 main10' })), false);
  assert.equal(withHevc.autoOk(s({ av1: true })), false);
  assert.equal(withHevc.autoOk(s({ isHdr: true })), false);
  assert.equal(plain.autoOk(s({ height: 2160 })), false);
  assert.equal(profile({}, 1920, 2).autoOk(s({ height: 2160 })), true);
  assert.equal(plain.autoOk(s({ words: 'movie 48 fps' })), true);
  assert.equal(plain.autoOk(s({ words: 'movie 50 fps' })), false);
  assert.equal(plain.autoOk(s({ words: 'movie 60fps' })), false);
  assert.equal(plain.autoOk(s({ words: 'movie 1080p60' })), false);
});

test('deviceProfile logs one line and describeDevice names the profile', () => {
  const lines = [];
  const p = web.deviceProfile({ log: (m) => lines.push(m), web: { doc: docWith({ [HVC]: 'probably' }), screen: { width: 1000 }, dpr: 1 } });
  assert.ok(lines[0].startsWith('device: 1080p30 HEVC'));
  assert.ok(web.describeDevice(p).includes('(browser profile)'));
});
