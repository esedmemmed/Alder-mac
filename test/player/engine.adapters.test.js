// The Mac adapter on its own: mpv.js's export surface, one test per row of its error table, and the Mac cases of the fail-over
// chain. The engine's logic on both adapters lives in engine.failover/close/progress and picture.test.js (helpers.js both()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeEngine, stream, createFakeClock } from './helpers.js';
import { createAvplay as createMpv, ERROR_TABLE, mapError, FIT_METHOD, fillOffered, attachVideoObject } from '../../src/platform/mac/mpv.js';

const require = createRequire(import.meta.url);
const { createBridge } = require('../../mac/web/bridge.js');
const { installMock } = require('../../mac/web/mock-bridge.js');

const urlOf = (l) => l.url;


// ---- the Mac adapter on its own ----

function bare(script) {
  const clock = createFakeClock(0);
  const win = {};
  const timers = { now: clock.now, after: (ms, fn) => { const id = clock.setTimeout(fn, ms); return () => clock.clearTimeout(id); }, every: (ms, fn) => { const id = clock.setInterval(fn, ms); return () => clock.clearInterval(id); } };
  const mock = installMock({ win, clock: timers, duration: 600, script });
  return { clock, mock, mpv: createMpv({ bridge: createBridge({ win }) }) };
}

test('mpv.js keeps avplay.js\'s export surface, Fill is always offered, there is no <object>', () => {
  assert.equal(fillOffered(), true);
  assert.equal(FIT_METHOD, 'panscan 0');
  assert.equal(attachVideoObject({}), null);
  const { mpv } = bare();
  ['state', 'open', 'setPicture', 'prepare', 'play', 'pause', 'stop', 'close', 'seekTo', 'time', 'duration', 'isLive', 'totalTracks', 'currentStreams',
    'currentIndex', 'selectTrack', 'subtitlesOn', 'suspend', 'restore'].forEach((m) => assert.equal(typeof mpv[m], 'function', m));
  assert.equal(mpv.fillSupported, true);
});

// One test per row of ERROR_TABLE: a sample of mpv's text, the code the engine gets (after the file played, so through onError) and,
// for the HTTP row, the status on its way as PLAYER_MSG_HTTP_ERROR_CODE. Links in the text never reach the engine.
const SAMPLES = {
  'HTTP 4xx/5xx': ['HTTP error 404 Not Found', 'PLAYER_ERROR_CONNECTION_FAILED', '404'],
  'host unreachable': ['Failed: Could not resolve host name', 'PLAYER_ERROR_CONNECTION_FAILED', ''],
  'connection refused': ['tcp: Connection refused', 'PLAYER_ERROR_CONNECTION_FAILED', ''],
  timeout: ['Operation timed out', 'PLAYER_ERROR_CONNECTION_FAILED', ''],
  'unrecognized format': ['Failed to recognize file format.', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', ''],
  'no streams': ['No video or audio streams selected.', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', ''],
  'decoder failure': ['Error while decoding stream #0:1', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', ''],
};

for (const row of ERROR_TABLE) {
  test('error table: ' + row.name, async () => {
    const [text, code, status] = SAMPLES[row.name];
    const { clock, mpv } = bare(() => ({ failAt: 1, failMessage: text + ' (https://host.example/v.mkv?token=SECRET)' }));
    const errors = [];
    const events = [];
    mpv.open('https://host.example/v.mkv?token=SECRET', {}, { onError: (c, m) => errors.push([c, m]), onEvent: (id, d) => events.push([id, d]) });
    const ready = mpv.prepare();
    await clock.advance(200);
    await ready;
    mpv.play();
    await clock.advance(3000);
    assert.equal(errors.length, 1, 'one error');
    assert.equal(errors[0][0], code);
    assert.ok(!/SECRET|host\.example/.test(errors[0][1]), 'no link in the text: ' + errors[0][1]);
    assert.deepEqual(events, status ? [['PLAYER_MSG_HTTP_ERROR_CODE', status]] : []);
    // the table itself, with the link left in the text
    const m = mapError(text + ' https://host.example/v.mkv?token=SECRET');
    assert.equal(m.code, code);
    assert.ok(!/SECRET|host\.example/.test(m.text));
  });
}

test('error table: a text no row knows is UNKNOWN (not retried, not the audio track\'s fault)', () => {
  assert.equal(mapError('something odd').code, 'PLAYER_ERROR_UNKNOWN');
  assert.equal(mapError(undefined).code, 'PLAYER_ERROR_UNKNOWN');
});

test('error table: a load the shell refuses rejects prepare() with the mapped code', async () => {
  const { clock, mpv } = bare(() => ({ fail: 'HTTP error 403 Forbidden' }));
  const events = [];
  mpv.open('https://host.example/v.mkv', {}, { onEvent: (id, d) => events.push([id, d]) });
  const settled = mpv.prepare().then(() => 'ready', (e) => e.message);
  await clock.advance(200);
  assert.equal(await settled, 'PLAYER_ERROR_CONNECTION_FAILED');
  assert.deepEqual(events, [['PLAYER_MSG_HTTP_ERROR_CODE', '403']]);
});

test('Mac fail-over: a dead first source (endFile error) gives way to the next at the same second, with no input', async () => {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Dead', { prepare: 'fail:PLAYER_ERROR_NOT_SUPPORTED_FORMAT' }), stream('Good')], params: { resumeAt: 100000 } });
  await t.start();
  await t.advance(3000);
  assert.deepEqual(t.loads().map(urlOf).map((u) => /\/(Dead|Good)\./.exec(u)[1]), ['Dead', 'Good'], 'no retry for a bad file');
  assert.ok(t.loads()[1].t < 1000, 'moved on at once');
  assert.deepEqual(t.seeks(), [100000], 'the next source starts at the same second');
  assert.equal(t.events.started.length, 1);
  assert.equal(t.events.started[0].source, 1);
  assert.equal(t.events.navigate.length, 0);
});

test('Mac fail-over: a refused connection at load is retried twice, then the next source', async () => {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Gone', { prepare: 'fail:PLAYER_ERROR_CONNECTION_FAILED' }), stream('Good')] });
  await t.start();
  await t.advance(14000);
  assert.equal(t.loads().filter((l) => /Gone/.test(l.url)).length, 3);
  assert.equal(t.loads().filter((l) => /Good/.test(l.url)).length, 1);
  assert.equal(t.events.navigate.length, 0);
  assert.equal(t.events.started.length, 1);
});

test('Mac fail-over: a load that never answers (no playbackRestart within START_WAIT) gives way to the next source', async () => {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Silent', { prepare: 'hang' }), stream('Good')], params: { resumeAt: 100000 } });
  await t.start();
  await t.advance(11900);
  assert.equal(t.loads().length, 1, 'still waiting on the first just before 12 s');
  assert.equal(t.events.started.length, 0);
  await t.advance(200);
  assert.equal(t.loads().length, 2, 'the next opens right after START_WAIT');
  assert.ok(/Good/.test(t.loads()[1].url));
  assert.equal(t.loads()[1].t, 12000, 'at the START_WAIT mark, not later');
  await t.advance(3000);
  assert.equal(t.events.started.length, 1);
  assert.equal(t.events.started[0].source, 1);
  assert.deepEqual(t.seeks(), [100000], 'the next source starts at the same second');
  assert.equal(t.events.navigate.length, 0);
});

test('Mac: closed during the resume seek (the fast Back): nothing is sent after, no engine timer is left', async () => {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Film')], params: { resumeAt: 60000 } });
  await t.start();
  await t.advance(60);
  t.engine.exit();
  const sent = t.sent();
  assert.equal(t.playState(), 'NONE');
  await t.advance(120000);
  assert.ok(t.clock.pending() <= 1, 'only the mock own tick timer is left: ' + t.clock.pending()); // mpv is paused, not unloaded
  assert.equal(t.sent(), sent, 'nothing sent to the player after leaving');
  assert.equal(t.events.navigate.length, 1);
  assert.equal(t.events.navigate[0].kind, 'exit');
});

test('Mac: a stall (cache ran dry) shows the overlay and playback goes on when it fills', async () => {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Film')] });
  await t.start();
  await t.advance(4000);
  t.mpv.stall(1500);
  await t.advance(300);
  assert.ok(t.events.loading.some((e) => e.visible), 'the overlay is up');
  assert.equal(t.events.stall.length, 0, 'one stall is not an offer');
  await t.advance(3000);
  const at = t.avplay.time();
  await t.advance(2000);
  assert.ok(t.avplay.time() > at, 'time moves again');
});
