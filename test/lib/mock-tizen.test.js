import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAvplayMock, createRegistry, scenarioFor, queryOptions, stripMockParams, parseStalls, autoPreset,
  resolveTracks, buildTrackInfo, createWebapisMock, createTizenMock, MockWebApiError,
} from '../../dev/mock-tizen.js';
import { createFakeClock } from '../../dev/fake-clock.js';

const URL1 = 'http://example.test/Movie.2021.1080p.mkv';

function player(opts = {}) {
  const clock = createFakeClock();
  const av = createAvplayMock(Object.assign({ clock }, opts));
  const events = [];
  const listener = {};
  ['onbufferingstart', 'onbufferingprogress', 'onbufferingcomplete', 'oncurrentplaytime', 'onstreamcompleted', 'onerror', 'onevent', 'onerrormsg'].forEach((n) => {
    listener[n] = (...a) => { if (n !== 'oncurrentplaytime' && n !== 'onbufferingprogress') events.push(n + (a.length ? ':' + a[0] : '')); };
  });
  const ready = async (url) => {
    av.open(url);
    av.setListener(listener);
    await new Promise((resolve, reject) => { av.prepareAsync(resolve, reject); clock.advance(1000); });
  };
  return { av, clock, events, listener, ready };
}

test('autoPreset guesses tracks from the release name', () => {
  assert.equal(autoPreset('Movie.2021.1080p.BluRay.DTS-HD.MA.7.1.x265.mkv'), 'dtshd');
  assert.equal(autoPreset('Movie.WEB-DL.DDP5.1.Atmos.mkv'), 'eac3');
  assert.equal(autoPreset('Movie.BluRay.DTS.AC3.mkv'), 'mixed');
  assert.equal(autoPreset('Movie.TrueHD.Atmos.mkv'), 'truehd');
  assert.equal(autoPreset('Movie.AAC.mp4'), 'aac');
  assert.equal(autoPreset('http://x/y.mkv'), 'eac3');
});

test('queryOptions / stripMockParams: mock.* parameters configure a URL and are removed before real use', () => {
  const u = 'http://h/v.mkv?token=1&mock.tracks=dts&mock.start=never&x=2';
  assert.deepEqual(queryOptions(u), { tracks: 'dts', start: 'never' });
  assert.equal(stripMockParams(u), 'http://h/v.mkv?token=1&x=2');
  assert.equal(stripMockParams('http://h/v.mkv?mock.tracks=dts'), 'http://h/v.mkv');
  assert.equal(stripMockParams('http://h/v.mkv'), 'http://h/v.mkv');
});

test('parseStalls', () => {
  assert.deepEqual(parseStalls('10:3,40:forever,5'), [{ atSec: 10, forSec: 3 }, { atSec: 40, forSec: Infinity }, { atSec: 5, forSec: 3 }]);
});

test('scenario precedence: defaults < release name < registry < query', () => {
  const reg = createRegistry().add('Movie', { tracks: 'aac', duration: 100 });
  assert.equal(scenarioFor('http://h/Movie.DTS.mkv', null).tracks, 'dts');
  assert.equal(scenarioFor('http://h/Movie.DTS.mkv', reg).tracks, 'aac');
  assert.equal(scenarioFor('http://h/Movie.DTS.mkv', reg).durationSec, 100);
  const sc = scenarioFor('http://h/Movie.DTS.mkv?mock.tracks=truehd&mock.duration=7', reg);
  assert.equal(sc.tracks, 'truehd');
  assert.equal(sc.durationSec, 7);
  assert.equal(scenarioFor('http://h/other.mkv', reg).tracks, 'eac3');
});

test('registry matchers: substring, RegExp, function; earlier entries win', () => {
  const reg = createRegistry().add('a.mkv', { tracks: 'dts' }).add(/\.mkv$/, { tracks: 'aac', seek: 'fail' }).add((u) => u.includes('z'), { badAudio: 'error' });
  const sc = scenarioFor('http://h/a.mkv', reg);
  assert.equal(sc.tracks, 'dts');
  assert.equal(sc.seek, 'fail');
  assert.equal(scenarioFor('http://h/z.mkv', reg).badAudio, 'error');
  reg.clear();
  assert.equal(reg.entries().length, 0);
});

test('scenario options: prepare/start/error forms', () => {
  assert.equal(scenarioFor('u?mock.prepare=fail:PLAYER_ERROR_INVALID_URI').prepareCode, 'PLAYER_ERROR_INVALID_URI');
  assert.equal(scenarioFor('u?mock.prepare=slow:3000').prepareMs, 3000);
  assert.equal(scenarioFor('u?mock.start=slow:9000').startMs, 9000);
  const e = scenarioFor('u?mock.error=30:PLAYER_ERROR_NOT_SUPPORTED_FILE');
  assert.equal(e.errorAtSec, 30);
  assert.equal(e.errorCode, 'PLAYER_ERROR_NOT_SUPPORTED_FILE');
  const r = scenarioFor('u?mock.res=3840x2160&mock.video=hevc');
  assert.deepEqual([r.width, r.height, r.video], [3840, 2160, 'HEVC']);
  assert.deepEqual(scenarioFor('u?mock.stall=10:3&mock.stall=20:forever').stalls.length, 2);
});

test('tracks: presets compose with +, video is first, indexes are per type, bad names throw', () => {
  const spec = resolveTracks('dts+ac3+subs');
  assert.deepEqual(spec.map((t) => t.type), ['VIDEO', 'AUDIO', 'AUDIO', 'TEXT', 'TEXT']);
  const info = buildTrackInfo(spec);
  assert.deepEqual(info.map((t) => t.index), [0, 0, 1, 0, 1]);
  const audio = JSON.parse(info[1].extra_info);
  assert.equal(audio.language, 'ENG');
  assert.equal(audio.channels, '6');
  assert.match(audio.fourCC, /dts/i);
  const global = buildTrackInfo(spec, { indexing: 'global' });
  assert.deepEqual(global.map((t) => t.index), [0, 1, 2, 3, 4]);
  assert.throws(() => resolveTracks('nope'), /unknown mock track preset/);
  assert.equal(resolveTracks([{ type: 'AUDIO', codec: 'AAC' }]).length, 2);
  assert.equal(resolveTracks('[{"type":"AUDIO","codec":"FLAC"}]')[1].codec, 'FLAC');
  assert.notEqual(buildTrackInfo(resolveTracks('eac3'), { style: 'fourcc' })[1].extra_info, buildTrackInfo(resolveTracks('eac3'), { style: 'mime' })[1].extra_info);
});

test('state machine: valid order, and invalid calls throw InvalidStateError like the real runtime', async () => {
  const { av, ready, clock } = player();
  assert.equal(av.getState(), 'NONE');
  assert.throws(() => av.play(), (e) => e instanceof MockWebApiError && e.name === 'InvalidStateError');
  av.open(URL1);
  assert.equal(av.getState(), 'IDLE');
  assert.throws(() => av.open(URL1), MockWebApiError);
  assert.throws(() => av.play(), /not valid in state IDLE/);
  assert.throws(() => av.getTotalTrackInfo(), MockWebApiError);
  av.close();
  await ready(URL1);
  assert.equal(av.getState(), 'READY');
  assert.equal(av.getDuration(), 5400000);
  av.play();
  assert.equal(av.getState(), 'PLAYING');
  await clock.advance(1000);
  av.pause();
  assert.equal(av.getState(), 'PAUSED');
  av.stop();
  assert.equal(av.getState(), 'IDLE');
  av.close();
  assert.equal(av.getState(), 'NONE');
});

test('playback: buffering, then time advances, then the stream completes', async () => {
  const { av, ready, clock, events } = player();
  await ready(URL1 + '?mock.duration=3');
  av.play();
  await clock.advance(100);
  assert.ok(events.includes('onbufferingstart'));
  assert.ok(!events.includes('onbufferingcomplete'));
  assert.equal(av.__mock.started, false);
  await clock.advance(600);
  assert.ok(events.includes('onbufferingcomplete'));
  assert.equal(av.__mock.started, true);
  await clock.advance(1500);
  assert.ok(av.getCurrentTime() > 1000 && av.getCurrentTime() < 2500, String(av.getCurrentTime()));
  assert.ok(!events.includes('onstreamcompleted'));
  await clock.advance(3000);
  assert.ok(events.includes('onstreamcompleted'));
  assert.ok(events.indexOf('onbufferingstart') < events.indexOf('onbufferingcomplete'));
  assert.ok(events.indexOf('onbufferingcomplete') < events.indexOf('onstreamcompleted'));
});

test('callbacks are asynchronous, never inside the call that caused them', async () => {
  const { av, clock, ready } = player();
  await ready(URL1);
  let seenDuringCall = false;
  av.setListener({ onbufferingstart: () => { seenDuringCall = inCall; } });
  let inCall = true;
  av.play();
  inCall = false;
  await clock.advance(10);
  assert.equal(seenDuringCall, false);
});

test('tracks: the TV picks the default audio; setSelectTrack switches; unknown index throws', async () => {
  const { av, ready } = player();
  await ready(URL1 + '?mock.tracks=mixed');
  const info = av.getTotalTrackInfo();
  assert.deepEqual(info.map((t) => t.type), ['VIDEO', 'AUDIO', 'AUDIO']);
  assert.equal(typeof info[1].extra_info, 'string');
  assert.equal(av.__mock.selected.AUDIO, 0);
  const current = av.getCurrentStreamInfo().find((t) => t.type === 'AUDIO');
  assert.match(JSON.parse(current.extra_info).fourCC, /dts/i);
  av.setSelectTrack('AUDIO', 1);
  assert.equal(av.__mock.selected.AUDIO, 1);
  assert.throws(() => av.setSelectTrack('AUDIO', 9), (e) => e.name === 'InvalidValuesError');
  assert.throws(() => av.setSelectTrack('SOUND', 0), (e) => e.name === 'TypeMismatchError');
});

test('DTS audio plays silently by default: the failure Alder knows, observable via audioOutput', async () => {
  const { av, ready, clock } = player();
  await ready(URL1 + '?mock.tracks=mixed');
  av.play();
  await clock.advance(1000);
  assert.equal(av.__mock.audioOutput, 'silent');
  av.setSelectTrack('AUDIO', 1);
  assert.equal(av.__mock.audioOutput, 'AC3');
});

test('badAudio=error turns the unplayable codec into an onerror', async () => {
  const { av, ready, clock, events } = player();
  await ready(URL1 + '?mock.tracks=dts&mock.badAudio=error');
  av.play();
  await clock.advance(1000);
  assert.ok(events.some((e) => e.startsWith('onerror:PLAYER_ERROR_NOT_SUPPORTED_FORMAT')));
});

test('failure: prepare never answers / fails with a code', async () => {
  const a = player();
  a.av.open(URL1 + '?mock.prepare=never'); a.av.setListener(a.listener);
  let answered = false;
  a.av.prepareAsync(() => { answered = true; }, () => { answered = true; });
  await a.clock.advance(60000);
  assert.equal(answered, false);
  assert.equal(a.av.getState(), 'IDLE');

  const b = player();
  b.av.open(URL1 + '?mock.prepare=fail:PLAYER_ERROR_INVALID_URI'); b.av.setListener(b.listener);
  const err = await new Promise((resolve) => { b.av.prepareAsync(() => resolve(null), resolve); b.clock.advance(1000); });
  assert.equal(err.message, 'PLAYER_ERROR_INVALID_URI');
  assert.equal(b.av.getState(), 'IDLE');
});

test('failure: start=never buffers forever (no picture); start=error fails after startMs', async () => {
  const a = player();
  await a.ready(URL1 + '?mock.start=never');
  a.av.play();
  await a.clock.advance(120000);
  assert.deepEqual(a.events, ['onbufferingstart']);
  assert.equal(a.av.__mock.started, false);
  assert.equal(a.av.getState(), 'PLAYING');

  const b = player();
  await b.ready(URL1 + '?mock.start=error:PLAYER_ERROR_CONNECTION_FAILED');
  b.av.play();
  await b.clock.advance(1000);
  assert.ok(b.events.includes('onerror:PLAYER_ERROR_CONNECTION_FAILED'));
  assert.ok(!b.events.includes('onbufferingcomplete'));
});

test('failure: error N seconds in fires once; stall freezes the clock and then resumes', async () => {
  const a = player();
  await a.ready(URL1 + '?mock.error=3:PLAYER_ERROR_CONNECTION_FAILED');
  a.av.play();
  await a.clock.advance(2500);
  assert.ok(!a.events.some((e) => e.startsWith('onerror')));
  await a.clock.advance(3000);
  assert.equal(a.events.filter((e) => e.startsWith('onerror:')).length, 1);

  const b = player();
  await b.ready(URL1 + '?mock.stall=2:4');
  b.av.play();
  await b.clock.advance(2500);
  assert.equal(b.av.__mock.frozen, true);
  assert.equal(b.events.filter((e) => e === 'onbufferingstart').length, 2);
  const frozenAt = b.av.getCurrentTime();
  await b.clock.advance(2000);
  assert.equal(b.av.getCurrentTime(), frozenAt);
  await b.clock.advance(3000);
  assert.equal(b.av.__mock.frozen, false);
  assert.ok(b.av.getCurrentTime() > frozenAt);
});

test('seek: moves the position after seekMs; seek=fail calls the error callback', async () => {
  const a = player();
  await a.ready(URL1);
  a.av.play(); await a.clock.advance(1000);
  let done = false;
  a.av.seekTo(600000, () => { done = true; }, () => {});
  await a.clock.advance(500);
  assert.equal(done, true);
  assert.ok(Math.abs(a.av.getCurrentTime() - 600000) < 1500);
  a.av.jumpForward(10000, () => {}, () => {});
  await a.clock.advance(500);
  assert.ok(a.av.getCurrentTime() >= 610000);
  assert.throws(() => a.av.seekTo(-5), (e) => e.name === 'InvalidValuesError');

  const b = player();
  await b.ready(URL1 + '?mock.seek=fail');
  b.av.play(); await b.clock.advance(1000);
  let failed = false;
  b.av.seekTo(5000, () => {}, () => { failed = true; });
  await b.clock.advance(500);
  assert.equal(failed, true);
});

test('__mock can force an error or a stall, and records calls', async () => {
  const a = player();
  await a.ready(URL1);
  a.av.play(); await a.clock.advance(1000);
  a.av.__mock.fail('PLAYER_ERROR_CONNECTION_FAILED');
  await a.clock.advance(10);
  assert.ok(a.events.includes('onerror:PLAYER_ERROR_CONNECTION_FAILED'));
  assert.ok(a.av.__mock.calls.some((c) => c.method === 'play'));
  a.av.__mock.reset();
  assert.equal(a.av.__mock.calls.length, 0);
});

test('streaming properties: only known names, only in IDLE/READY', async () => {
  const a = player();
  a.av.open(URL1);
  a.av.setStreamingProperty('USER_AGENT', 'x');
  assert.equal(a.av.getStreamingProperty('USER_AGENT'), 'x');
  assert.throws(() => a.av.setStreamingProperty('NOPE', 1), MockWebApiError);
});

test('webapis / tizen mocks: product info, key registration, exit hook', () => {
  const w = createWebapisMock({ clock: createFakeClock() });
  assert.equal(typeof w.avplay.open, 'function');
  assert.ok(w.productinfo);
  const t = createTizenMock({ onExit: () => {} });
  assert.equal(typeof t.application.getCurrentApplication().exit, 'function');
  assert.equal(typeof t.tvinputdevice.registerKeyBatch, 'function');
  assert.ok(t.tvinputdevice.getSupportedKeys().some((k) => k.name === 'MediaPlay'));
});

test('close() and stop() leave no timer behind: a real player delivers nothing afterwards', async () => {
  const { av, clock, events, ready } = player();
  await ready('http://example.test/Movie.2021.1080p.mkv?mock.seekMs=400&mock.prepareMs=300');
  av.play();
  av.seekTo(5000, () => events.push('seek-ok'));
  av.close();
  assert.equal(av.getState(), 'NONE');
  assert.equal(av.__mock.pendingTimers, 0);
  assert.equal(clock.pending(), 0);
  await clock.advance(60000); // would throw (reading the closed scenario) if a seek or start timer survived
  assert.ok(!events.includes('seek-ok'));

  // closed during prepareAsync, then a new session: the old prepare timer must not make the new one READY early
  const second = player();
  second.av.open('http://example.test/A.mkv?mock.prepareMs=1000');
  second.av.prepareAsync(() => second.events.push('A-ready'));
  second.av.close();
  second.av.open('http://example.test/B.mkv?mock.prepareMs=5000');
  second.av.prepareAsync(() => second.events.push('B-ready'));
  await second.clock.advance(1500);
  assert.deepEqual(second.events, []);
  assert.equal(second.av.getState(), 'IDLE');
  await second.clock.advance(4000);
  assert.deepEqual(second.events, ['B-ready']);

  // stop() cancels a start in progress too
  const third = player();
  await third.ready('http://example.test/C.mkv?mock.startMs=3000');
  third.av.play();
  third.av.stop();
  assert.equal(third.av.__mock.pendingTimers, 0);
  await third.clock.advance(10000);
  assert.deepEqual(third.events, [], 'nothing arrives after stop()');
});
