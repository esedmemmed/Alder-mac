// Failover, audio decisions, retries: PlayerActivity's next(), onPlayerError() and the Tizen Stage B audio rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, stream, libraryItem } from './helpers.js';
import { isRetryable, isDecodeError } from '../../src/player/engine.js';

const FIRST = 'Dune.Part.Two.2160p.WEB-DL.DDP5.1';

test('a source with no picture after START_WAIT (12 s) gives way to the next at the same second', async () => {
  const t = makeEngine({
    sources: [stream('A 2160p DDP5.1', { start: 'never' }), stream('B 1080p DDP5.1')],
    params: { resumeAt: 100000 },
  });
  await t.start();
  await t.advance(11900);
  assert.equal(t.opens().length, 1, 'still on the first source just before 12 s');
  assert.ok(/A\.2160p/.test(t.opens()[0].args[0]));
  assert.equal(t.events.started.length, 0);
  await t.advance(200);
  assert.equal(t.opens().length, 2, 'the second source opens right after 12 s');
  assert.ok(/B\.1080p/.test(t.opens()[1].args[0]));
  assert.equal(t.opens()[1].t, 12000, 'at the START_WAIT mark, not later');
  const messages = t.events.loading.filter((e) => e.visible).map((e) => e.message);
  assert.ok(messages.includes('That source failed · trying the next one'), messages.join(' | '));
  await t.advance(3000);
  // the same second: B is told to seek to where the first source was asked to start
  assert.deepEqual(t.callsOf('seekTo').map((c) => c.args[0]), [100000, 100000]);
  assert.equal(t.events.started.length, 1);
  assert.equal(t.events.started[0].source, 1);
  assert.equal(t.av.__mock.audioOutput, 'EAC3');
});

test('the order is kept and the list is walked once: three sources, the third plays', async () => {
  const t = makeEngine({ sources: [stream('A', { start: 'never' }), stream('B', { start: 'never' }), stream('C')] });
  await t.start();
  await t.advance(12100);
  await t.advance(12100);
  assert.deepEqual(t.opens().map((o) => /media\.fixture\.test\/([A-Z])\./.exec(o.args[0])[1]), ['A', 'B', 'C']);
  assert.deepEqual(t.opens().map((o) => o.t), [0, 12000, 24000]);
  await t.advance(2000);
  assert.equal(t.events.started.length, 1);
  assert.equal(t.events.navigate.length, 0);
});

test('every source fails: the sources page is asked for (navigate), once', async () => {
  const t = makeEngine({ sources: [stream('A', { start: 'never' }), stream('B', { prepare: 'fail:PLAYER_ERROR_NOT_SUPPORTED_FILE' })], params: { resumeAt: 5000 } });
  await t.start();
  await t.advance(13000);
  assert.equal(t.events.navigate.length, 1);
  const nav = t.events.navigate[0];
  assert.equal(nav.kind, 'sources');
  assert.equal(nav.pick, true);
  assert.equal(nav.message, "2 sources didn't play");
  await t.advance(60000);
  assert.equal(t.events.navigate.length, 1, 'nothing more happens once it is closed');
  assert.equal(t.av.getState(), 'NONE', 'AVPlay is closed');
});

test('when the viewer picked the source, running out shows "Source failed" instead of leaving', async () => {
  const t = makeEngine({ sources: [stream('Only', { start: 'never' })], params: { picked: true } });
  await t.start();
  await t.advance(12100);
  assert.equal(t.events.navigate.length, 0);
  assert.equal(t.events.sourceError.length, 1);
  const last = t.events.loading[t.events.loading.length - 1];
  assert.equal(last.visible, true);
  assert.equal(last.message, 'That source failed · choose another source');
});

test('a DTS-only source is skipped at once (no playable audio), without waiting for START_WAIT', async () => {
  const t = makeEngine({ sources: [stream('Dune.DTS-HD.MA', { tracks: 'dtshd' }), stream('Dune.DDP5.1', { tracks: 'eac3' })] });
  await t.start();
  await t.advance(2000);
  assert.equal(t.opens().length, 2);
  assert.ok(t.opens()[1].t < 1000, 'second source opened at ' + t.opens()[1].t + ' ms');
  const sequence = t.calls().map((c) => c.method);
  const firstPlay = sequence.indexOf('play');
  const secondOpen = sequence.indexOf('open', sequence.indexOf('open') + 1);
  assert.ok(secondOpen < firstPlay, 'play() was never called for the DTS source');
  assert.ok(t.diag.snapshot().decisions.some((d) => /no playable audio/.test(d.text)), 'the decision is in Diagnostics');
  assert.equal(t.events.started.length, 1);
  assert.equal(t.av.__mock.audioOutput, 'EAC3');
});

test('DTS and AC3 in one file: the AC3 track is chosen with setSelectTrack before play', async () => {
  const t = makeEngine({ sources: [stream('Multi.DTS.AC3', { tracks: 'mixed' })] });
  await t.start();
  await t.advance(3000);
  const sequence = t.calls();
  const select = sequence.findIndex((c) => c.method === 'setSelectTrack' && c.args[0] === 'AUDIO');
  const play = sequence.findIndex((c) => c.method === 'play');
  assert.ok(select >= 0, 'setSelectTrack was called');
  assert.deepEqual(sequence[select].args, ['AUDIO', 1]);
  assert.ok(select < play, 'before play');
  assert.equal(t.av.__mock.audioOutput, 'AC3', 'the TV would play sound, not silence');
  assert.equal(t.engine.state.audioIndex, 1);
});

test('AC3 already selected by default: no setSelectTrack call', async () => {
  const t = makeEngine({ sources: [stream('Multi.AC3.DTS', { tracks: 'mixed2' })] });
  await t.start();
  await t.advance(3000);
  assert.equal(t.callsOf('setSelectTrack').filter((c) => c.args[0] === 'AUDIO').length, 0);
  assert.equal(t.av.__mock.audioOutput, 'AC3');
});

test("the audio language is Settings' (else the TV's): Spanish picks the Spanish dub of a multi-audio file", async () => {
  const es = makeEngine({ sources: [stream('Multi', { tracks: 'multi' })], settings: { audioLang: 'es' } });
  await es.start(); await es.advance(3000);
  assert.deepEqual(es.callsOf('setSelectTrack').filter((c) => c.args[0] === 'AUDIO').map((c) => c.args), [['AUDIO', 1]]);
  const tv = makeEngine({ sources: [stream('Multi', { tracks: 'multi' })], tvLanguage: 'en' });
  await tv.start(); await tv.advance(3000);
  assert.equal(tv.callsOf('setSelectTrack').filter((c) => c.args[0] === 'AUDIO').length, 0, 'English is already the default track');
  const tr = makeEngine({ sources: [stream('Dub', { tracks: 'dub' })], tvLanguage: 'en-US' });
  await tr.start(); await tr.advance(3000);
  assert.deepEqual(tr.callsOf('setSelectTrack').filter((c) => c.args[0] === 'AUDIO').map((c) => c.args), [['AUDIO', 1]], 'the French default is replaced by English');
});

test('audio error in the middle of the film: the next best track, from the same second', async () => {
  const t = makeEngine({ sources: [stream('Multi', { tracks: 'multi' })] });
  await t.start();
  await t.advance(20000);
  assert.equal(t.opens().length, 1);
  const before = t.av.__mock.position;
  t.av.__mock.fail('PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
  await t.advance(3000);
  assert.equal(t.opens().length, 2, 'the same source is opened again');
  assert.equal(t.events.navigate.length, 0, 'not a source failure');
  const selected = t.callsOf('setSelectTrack').filter((c) => c.args[0] === 'AUDIO').map((c) => c.args[1]);
  assert.deepEqual(selected, [3], 'AAC English (the next English track) replaces the EAC3 that failed');
  assert.equal(t.av.__mock.audioOutput, 'AAC');
  const seeks = t.callsOf('seekTo').map((c) => c.args[0]);
  assert.ok(Math.abs(seeks[seeks.length - 1] - before) < 1500, 'resumed at ' + seeks[seeks.length - 1] + ', was at ' + before);
  assert.equal(t.engine.state.audioIndex, 3);
  assert.ok(t.diag.snapshot().decisions.some((d) => /track #0 failed/.test(d.text)));
});

test('audio error with no other track to play: the source fails and the next one is tried', async () => {
  const t = makeEngine({ sources: [stream('Single', { tracks: 'eac3' }), stream('Next', { tracks: 'eac3' })] });
  await t.start();
  await t.advance(5000);
  t.av.__mock.fail('PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
  await t.advance(3000);
  assert.equal(t.opens().length, 2);
  assert.ok(/Next/.test(t.opens()[1].args[0]));
  assert.equal(t.engine.state.at, 1);
});

test('retryable errors: twice, 1.5 s apart, then the next source', async () => {
  const t = makeEngine({ sources: [stream('Flaky', { error: '5:PLAYER_ERROR_CONNECTION_FAILED' }), stream('Good')] });
  await t.start();
  await t.advance(13000);
  const flaky = t.opens().filter((o) => /Flaky/.test(o.args[0]));
  assert.equal(flaky.length, 3, 'the first try and RETRIES = 2 more');
  assert.ok(flaky[1].t - flaky[0].t >= 1500 && flaky[2].t - flaky[1].t >= 1500);
  await t.advance(8000);
  const good = t.opens().filter((o) => /Good/.test(o.args[0]));
  assert.equal(good.length, 1);
  assert.equal(t.engine.state.at, 1);
  // a retry resumes where the film was
  const seeks = t.callsOf('seekTo').map((c) => c.args[0]);
  assert.ok(seeks.length >= 3 && seeks[1] >= 4000, 'the retry seeks to the second it was at: ' + seeks.join());
});

test('a retry that works is invisible: playing again after one blip', async () => {
  // fails once at 5 s, then the mock scenario errors again... so use the forced error instead
  const t = makeEngine({ sources: [stream('Blip')] });
  await t.start();
  await t.advance(8000);
  t.av.__mock.fail('PLAYER_ERROR_CONNECTION_FAILED');
  await t.advance(1400);
  assert.equal(t.opens().length, 1, 'RETRY_WAIT has not passed');
  await t.advance(300);
  assert.equal(t.opens().length, 2);
  await t.advance(2000);
  assert.equal(t.av.getState(), 'PLAYING');
  assert.equal(t.events.navigate.length, 0);
  assert.equal(t.engine.state.retries, 1);
});

test('errors that are not retryable go straight to the next source', async () => {
  for (const code of ['PLAYER_ERROR_NOT_SUPPORTED_FILE', 'PLAYER_ERROR_INVALID_URI', 'PLAYER_ERROR_NO_SUCH_FILE']) {
    const t = makeEngine({ sources: [stream('Bad', { start: 'error:' + code }), stream('Good')] });
    await t.start();
    await t.advance(1500);
    assert.equal(t.opens().length, 2, code + ': no retry');
    assert.ok(t.opens()[1].t < 1500);
  }
});

test('CONNECTION_FAILED with an HTTP 4xx (the link is gone) is not retried, a 503 is', async () => {
  const gone = makeEngine({ sources: [stream('Gone'), stream('Good')] });
  await gone.start(); await gone.advance(3000);
  gone.av.__mock.emit('onevent', 'PLAYER_MSG_HTTP_ERROR_CODE', '404');
  gone.av.__mock.fail('PLAYER_ERROR_CONNECTION_FAILED');
  await gone.advance(300);
  assert.equal(gone.opens().length, 2, 'went to the next source');
  assert.equal(gone.engine.state.retries, 0);
  const busy = makeEngine({ sources: [stream('Busy'), stream('Good')] });
  await busy.start(); await busy.advance(3000);
  busy.av.__mock.emit('onevent', 'PLAYER_MSG_HTTP_ERROR_CODE', '503');
  busy.av.__mock.fail('PLAYER_ERROR_CONNECTION_FAILED');
  await busy.advance(1800);
  assert.equal(busy.opens().length, 2, 'retried the same source');
  assert.ok(/Busy/.test(busy.opens()[1].args[0]));
});

test('isRetryable and isDecodeError', () => {
  assert.equal(isRetryable('PLAYER_ERROR_CONNECTION_FAILED'), true);
  assert.equal(isRetryable('PLAYER_ERROR_CONNECTION_FAILED', 500), true);
  assert.equal(isRetryable('PLAYER_ERROR_CONNECTION_FAILED', 404), false);
  assert.equal(isRetryable('PLAYER_ERROR_CONNECTION_FAILED', 403), false);
  assert.equal(isRetryable('PLAYER_ERROR_CONNECTION_FAILED', 408), true);
  assert.equal(isRetryable('PLAYER_ERROR_CONNECTION_FAILED', 429), true);
  assert.equal(isRetryable('PLAYER_ERROR_NOT_SUPPORTED_FILE'), false);
  assert.equal(isRetryable('PLAYER_ERROR_INVALID_URI'), false);
  assert.equal(isRetryable('PLAYER_ERROR_NO_SUCH_FILE'), false);
  assert.equal(isDecodeError('PLAYER_ERROR_NOT_SUPPORTED_FORMAT'), true);
  assert.equal(isDecodeError('PLAYER_ERROR_CONNECTION_FAILED'), false);
});

test('a failed seek is not a failed source', async () => {
  const t = makeEngine({ sources: [stream('Seeky', { seek: 'fail' })] });
  await t.start();
  await t.advance(3000);
  t.engine.seekTo(1000000);
  await t.advance(2000);
  assert.equal(t.events.navigate.length, 0);
  assert.equal(t.opens().length, 1);
});

test('request headers: the User-Agent goes to AVPlay, others are reported as unsupported', async () => {
  const t = makeEngine({ sources: [stream('Headers', {}, { headers: { 'User-Agent': 'Mozilla/5.0 (Tizen)', Referer: 'https://debrid.example.org/' } })] });
  await t.start();
  await t.advance(1000);
  assert.deepEqual(t.callsOf('setStreamingProperty').map((c) => c.args), [['USER_AGENT', 'Mozilla/5.0 (Tizen)']]);
  assert.ok(t.log.some((l) => /cannot send/.test(l) && /Referer/.test(l)), t.log.join('\n'));
});

test('the source memory is written once a picture shows', async () => {
  const t = makeEngine({ sources: [stream('Never', { start: 'never' }), stream('Plays', {}, { filename: 'Dune.2160p.mkv', bingeGroup: 'grp|2160p' })] });
  await t.start();
  await t.advance(1000);
  assert.equal(t.store.get('sources/file:tt15239678'), null, 'nothing remembered for a source that never showed a picture');
  await t.advance(14000);
  assert.equal(t.store.get('sources/file:tt15239678'), 'Dune.2160p.mkv');
  assert.equal(t.store.get('sources/binge:tt15239678'), 'grp|2160p');
});

// ---- the picture signal: time advancing after play(), not buffering complete ----

test('buffering completes but the time never advances: no picture, so the next source after START_WAIT, nothing saved', async () => {
  const t = makeEngine({ sources: [stream('Undecodable', { start: 'never' }), stream('Good')], item: libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } }) });
  await t.start();
  await t.advance(2000);
  t.av.__mock.emit('onbufferingcomplete'); // the decoder refused the video, but AVPlay says it is buffered
  await t.advance(3000);
  assert.equal(t.events.started.length, 0, 'not a picture');
  assert.equal(t.opens().length, 1, 'still on the first source');
  await t.advance(8000); // START_WAIT (12 s) from the start
  assert.equal(t.opens().length, 2, 'START_WAIT failover still ran');
  assert.ok(/Good/.test(t.opens()[1].args[0]));
  assert.equal(t.puts.length, 0);
  assert.equal(t.item.state.timeOffset, 0, 'nothing saved for the broken source');
  await t.advance(3000);
  assert.equal(t.events.started.length, 1, 'the second source shows a picture once its time advances');
});

test('the loading overlay goes at buffering complete, though the picture has not been confirmed', async () => {
  const t = makeEngine({ sources: [stream('Undecodable', { start: 'never' })], params: { picked: true } });
  await t.start();
  await t.advance(1000);
  assert.equal(t.events.loading[t.events.loading.length - 1].visible, true);
  t.av.__mock.emit('onbufferingcomplete');
  await t.advance(0);
  assert.equal(t.events.loading[t.events.loading.length - 1].visible, false);
  assert.equal(t.events.started.length, 0);
});

test('time advancing after play() is the picture: started, remembered, saved', async () => {
  const t = makeEngine({ sources: [stream('Good')], item: libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } }) });
  await t.start();
  assert.equal(t.events.started.length, 0, 'play() was called but no time yet');
  await t.advance(1200);
  assert.equal(t.events.started.length, 1);
  await t.advance(10000);
  assert.ok(t.item.state.timeOffset > 0, 'progress is saved once started');
});

test('two consecutive increasing time reports count as a picture even from a resume point near the end of a short window', async () => {
  const t = makeEngine({ sources: [stream('Good', { duration: 3000, start: 'slow:8000' })], params: { resumeAt: 1000000 } });
  await t.start();
  await t.advance(1500); // prepared, seeked, play() called; the mock's own picture is 8 s away
  const mock = t.av.__mock;
  assert.equal(t.callsOf('play').length, 1, 'play() was called');
  const before = t.events.started.length;
  mock.emit('oncurrentplaytime', 1000000); // first report: a baseline only (not 500 ms past the start yet)
  await t.advance(0);
  assert.equal(t.events.started.length, before);
  await t.advance(0);
  assert.equal(t.events.started.length, before);
  mock.emit('oncurrentplaytime', 1000100); // second, increasing
  await t.advance(0);
  assert.equal(t.events.started.length, 1);
});

test('time reports before play() (a seek landing) are not a picture', async () => {
  const t = makeEngine({ sources: [stream('Slow', { prepare: 'slow:3000' })], params: { resumeAt: 50000 } });
  t.engine.start();
  await t.advance(500);
  assert.equal(t.callsOf('play').length, 0);
  assert.equal(t.events.started.length, 0);
});
