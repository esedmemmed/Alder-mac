// The start wait: the values (the TV takes 7-8 s for a TorBox file), and the order of the start timer and the first frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, stream } from './helpers.js';
import { PLAYER } from '../../src/core/playback.js';

const decisions = (t) => t.diag.snapshot().decisions.map((d) => d.text);

test('start wait: 15 s for a cached source, 20 s for the others', () => {
  assert.equal(PLAYER.START_WAIT_CACHED, 15000);
  assert.equal(PLAYER.START_WAIT, 20000);
});

// Tizen only: the mock's slow:<ms> start is AVPlay's.
test('start wait: a cached source whose picture comes at 9 s is not failed over (it used to be at 8 s)', async () => {
  const t = makeEngine({ sources: [stream('A 1080p DDP5.1', { start: 'slow:9000' }, { title: '[TB+] 1080p' }), stream('B 1080p DDP5.1')] });
  await t.start();
  await t.advance(8500);
  assert.equal(t.loads().length, 1);
  assert.equal(t.events.started.length, 0, 'no picture yet');
  await t.advance(1500);
  assert.equal(t.events.started.length, 1, 'the picture is on');
  await t.advance(30000);
  assert.equal(t.loads().length, 1, 'the start timer was cleared at the first frame: no second source');
  assert.ok(!decisions(t).some((d) => /source failed/.test(d)), decisions(t).join(' | '));
});

// Tizen only: AVPlay's time reports are AVPlay internals.
test('start wait: the timer fires while AVPlay is playing and its clock has moved: counted as the picture, never "source failed"', async () => {
  const t = makeEngine({ sources: [stream('A', { duration: 3000, start: 'slow:60000' }), stream('B')], params: { resumeAt: 1000000 } });
  await t.start();
  await t.advance(1500); // prepared, play() called, the mock's own picture is a minute away
  assert.equal(t.callsOf('play').length, 1);
  t.av.__mock.emit('oncurrentplaytime', 1000100); // one report only: not yet two in a row, not 500 ms past the start
  await t.advance(0);
  assert.equal(t.events.started.length, 0);
  t.avplay.time = () => 1000200; // AVPlay's own clock has moved off the start (the mock only moves it with its own picture)
  await t.advance(19000); // START_WAIT (20 s) from the start
  assert.equal(t.events.started.length, 1, 'counted as the picture');
  assert.equal(t.loads().length, 1, 'no next source');
  assert.ok(!decisions(t).some((d) => /source failed/.test(d)), decisions(t).join(' | '));
});
