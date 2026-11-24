// src/platform/android/device.js: the phone's profile (HEVC, HDR10, 4K, DTS and TrueHD all play), and the Mac profile still being strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as android from '../../src/platform/android/device.js';
import * as mac from '../../src/platform/mac/device.js';
import { createRanker } from '../../src/core/ranking.js';
import { settingsStub, stream } from '../core/helpers.js';

const phone = android.deviceProfile();
const ranker = (device) => createRanker({ settings: settingsStub(), device, memory: null, videoId: 'tt1', metaId: 'tt1' });
const remux = (extra = '') => stream('Movie.2024.2160p.UHD.BluRay.REMUX.HDR10.HEVC.TrueHD.7.1.Atmos' + extra + '.mkv', { title: '[TB+] 2160p' });

test('exports the same names as the Mac device module', () => {
  assert.deepEqual(Object.keys(android).sort(), Object.keys(mac).sort());
});

test('profile values and the first-picture wait', () => {
  assert.equal(phone.source, 'Android profile');
  assert.equal(phone.height, 2160);
  assert.equal(phone.fps, 60);
  assert.ok(phone.hevc && phone.av1 && phone.hdr && !phone.dolbyVision);
  assert.deepEqual(phone.startWait, { cached: 15000, other: 20000 });
  for (const a of ['AAC', 'AC3', 'EAC3', 'DTS', 'DTS-HD', 'DTS:X', 'TRUEHD']) assert.ok(phone.audio.has(a), a);
  assert.ok(android.describeDevice(phone).includes('(Android profile)'));
  assert.equal(mac.macProfile().startWait, undefined);
});

test('a 2160p HEVC HDR10 remux with TrueHD is autoOk, playable and has sound', () => {
  const s = remux();
  assert.equal(phone.autoOk(s), true);
  assert.equal(s.playableOn(phone), true);
  assert.equal(ranker(phone).noSound(s), false);
});

test('Dolby Vision without an HDR10 base is not playable; with one it is', () => {
  const dv = stream('Movie.2024.2160p.WEB-DL.DV.HEVC.EAC3.mkv', { title: '[TB+]' });
  assert.equal(dv.dolbyVision && !dv.hdr, true);
  assert.equal(dv.playableOn(phone), false);
  assert.equal(phone.autoOk(dv), false);
  const both = stream('Movie.2024.2160p.WEB-DL.DV.HDR10.HEVC.EAC3.mkv', { title: '[TB+]' });
  assert.equal(both.playableOn(phone), true);
  assert.equal(phone.autoOk(both), true);
});

test('a 1080p H.264 is autoOk; 120 fps is not', () => {
  assert.equal(phone.autoOk(stream('Movie.2024.1080p.WEB-DL.DD5.1.H.264.mkv')), true);
  assert.equal(phone.autoOk(stream('Movie.2024.1080p.WEB-DL.120fps.H.264.mkv')), false);
  assert.equal(phone.autoOk(stream('Movie.2024.2160p.WEB-DL.60fps.HEVC.mkv')), true);
});

test('ranking on the phone: a list of cached 4K HEVC remuxes starts at once and auto-play has a pick', () => {
  const list = [
    stream('Movie.2024.2160p.UHD.BluRay.REMUX.HDR10.HEVC.DTS-HD.MA.7.1.mkv', { title: '[TB+] 2160p' }),
    remux(),
    stream('Movie.2024.2160p.UHD.BluRay.REMUX.HEVC.TrueHD.7.1.mkv', { title: '[TB+] 2160p' }),
    stream('Movie.2024.2160p.WEB-DL.HEVC.DTS.5.1.mkv', { title: '[TB download] 2160p' }),
  ];
  const r = ranker(phone);
  assert.equal(r.goodStart(list[0]), true);
  assert.notEqual(r.autoCandidates(list)[0], undefined);
  assert.equal(r.autoCandidates(list).length, 4);
  // the Mac profile rejects the same list
  const m = ranker(mac.macProfile());
  assert.equal(m.goodStart(list[1]), false);
  assert.equal(m.autoCandidates(list).length, 0);
});

test('the Mac profile keeps rejecting HEVC, 4K and HDR for auto-play', () => {
  const m = mac.macProfile();
  assert.equal(m.autoOk(remux()), false);
  assert.equal(m.autoOk(stream('Movie.2024.1080p.WEB-DL.HEVC.mkv')), false);
});
