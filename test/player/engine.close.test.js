// Leaving the player at any moment (a fast Back, REVIEW-phase4): the engine and the AVPlay wrapper must go quiet at once.
// After exit(): every timer cancelled, no listener answered, no AVPlay call made, whatever was in flight (prepareAsync, the
// resume seek, the 12 s start wait, a retry wait). The fake clock throws if a timer of the mock misbehaves, so a late
// callback shows up here as a failed test, not as a console error on somebody's TV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, stream } from './helpers.js';
import { createAvplay } from '../../src/player/avplay.js';

/** After the viewer left: nothing happens however long we wait, and nothing is scheduled. */
async function assertQuiet(t, label) {
  const calls = t.calls().length;
  const opens = t.opens().length;
  assert.equal(t.av.getState(), 'NONE', label + ': AVPlay is closed');
  assert.equal(t.clock.pending(), 0, label + ': no timer is left (engine or mock)');
  assert.equal(t.av.__mock.pendingTimers, 0, label + ': the mock holds no timer either');
  await t.advance(120000);
  assert.equal(t.calls().length, calls, label + ': no AVPlay call after leaving');
  assert.equal(t.opens().length, opens, label + ': no other source was opened');
  assert.equal(t.events.navigate.length, 1, label + ': one navigate, the exit');
  assert.equal(t.events.navigate[0].kind, 'exit');
}

test('closed during prepareAsync: the late answer is ignored, nothing opens, no timer is left', async () => {
  const t = makeEngine({ sources: [stream('Slow prepare', { prepare: 'slow:3000' }), stream('Second')], params: { resumeAt: 60000 } });
  await t.start();
  await t.advance(500);
  assert.equal(t.av.getState(), 'IDLE', 'still preparing');
  t.engine.exit();
  await assertQuiet(t, 'prepare');
  assert.equal(t.callsOf('play').length, 0, 'play() was never reached');
  assert.equal(t.callsOf('seekTo').length, 0);
});

test('closed during the resume seek (the fast Back): the mock timer cannot outlive the session', async () => {
  const t = makeEngine({ sources: [stream('Resuming', { prepareMs: 100, seekMs: 400 })], params: { resumeAt: 3000000 } });
  await t.start();
  await t.advance(300);
  assert.equal(t.callsOf('seekTo').length, 1, 'the resume seek is in flight');
  t.engine.exit();
  await assertQuiet(t, 'seek');
  assert.equal(t.callsOf('play').length, 0);
});

test('closed during the start wait: START_WAIT is cancelled, the next source never opens', async () => {
  const t = makeEngine({ sources: [stream('No picture', { start: 'never' }), stream('Second')] });
  await t.start();
  await t.advance(5000);
  assert.equal(t.callsOf('play').length, 1, 'waiting for a picture');
  t.engine.exit();
  await assertQuiet(t, 'start wait');
  assert.equal(t.events.started.length, 0);
  assert.equal(t.puts.length, 0, 'nothing is saved for a source that never showed a picture');
});

test('closed during a retry wait: the retry never happens', async () => {
  const t = makeEngine({ sources: [stream('Blip'), stream('Second')] });
  await t.start();
  await t.advance(8000);
  t.av.__mock.fail('PLAYER_ERROR_CONNECTION_FAILED');
  await t.advance(700);
  assert.equal(t.engine.state.retries, 1, 'a retry is waiting for its 1.5 s');
  assert.equal(t.opens().length, 1);
  t.engine.exit();
  await assertQuiet(t, 'retry wait');
});

test('closed while the library answer is still on its way: the late begin() starts nothing', async () => {
  const t = makeEngine({ sources: [stream('Late library')], libraryDelay: 2000 });
  await t.start();
  await t.advance(500);
  assert.equal(t.opens().length, 0, 'nothing started yet: waiting for Stremio');
  t.engine.exit();
  await t.advance(5000);
  assert.equal(t.opens().length, 0);
  assert.equal(t.clock.pending(), 0);
});

test('destroy() (the screen was torn down) is as quiet as exit()', async () => {
  const t = makeEngine({ sources: [stream('Playing')] });
  await t.start();
  await t.advance(4000);
  t.engine.destroy();
  assert.equal(t.av.getState(), 'NONE');
  assert.equal(t.clock.pending(), 0);
  const calls = t.calls().length;
  t.engine.scrub(30000); // a view calling in after the fact
  t.engine.seekTo(1000);
  t.engine.togglePlay();
  await t.advance(60000);
  assert.equal(t.clock.pending(), 0, 'late calls schedule nothing');
  assert.equal(t.calls().length, calls, 'and reach AVPlay with nothing');
});

test('the wrapper drops listener callbacks and prepare/seek answers of a closed session', async () => {
  const seen = [];
  let listener = null;
  let prepareOk = null;
  let seekOk = null;
  let state = 'NONE';
  const fake = {
    getState: () => state,
    open: () => { state = 'IDLE'; },
    close: () => { state = 'NONE'; },
    setListener: (l) => { listener = l; },
    setDisplayRect() {}, setDisplayMethod() {},
    prepareAsync: (ok) => { prepareOk = ok; },
    seekTo: (ms, ok) => { seekOk = ok; },
  };
  const avplay = createAvplay({ webapis: { avplay: fake } });
  const handlers = {};
  ['onBufferingStart', 'onBufferingComplete', 'onTime', 'onCompleted', 'onError', 'onEvent', 'onSubtitle'].forEach((n) => { handlers[n] = () => seen.push(n); });
  avplay.open('https://x.test/a.mkv', {}, handlers);
  const oldListener = listener;
  avplay.prepare().then(() => seen.push('prepared'));
  avplay.seekTo(5000).then(() => seen.push('seeked'), () => seen.push('seek-failed'));
  avplay.close();
  prepareOk(); seekOk();
  oldListener.onbufferingstart(); oldListener.onbufferingcomplete(); oldListener.oncurrentplaytime(1000); oldListener.onstreamcompleted();
  oldListener.onerror('PLAYER_ERROR_CONNECTION_FAILED'); oldListener.onevent('X', 'y'); oldListener.onsubtitlechange(1000, 'hi', 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(seen, [], 'nothing reached the engine after close()');

  // a new session right after: the old session's late answer must not be taken for the new one's
  const answers = [];
  const okA = prepareOk;
  avplay.open('https://x.test/a.mkv', {}, handlers);
  avplay.prepare().then(() => answers.push('B'));
  okA();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(answers, [], 'the old session\'s prepareAsync answer is not the new one\'s');
  prepareOk();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(answers, ['B'], 'the open session still hears its own');
});
