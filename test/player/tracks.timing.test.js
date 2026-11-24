// Subtitle timing steps (tracks.js): 0.1 s from -2 s to +2 s, the same on the TV and the Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMING_STEPS, timingLabel } from '../../src/player/tracks.js';

test('Subtitle timing steps are 0.1 s from -2 s to +2 s', () => {
  assert.equal(TIMING_STEPS.length, 41);
  assert.equal(TIMING_STEPS[0], -2000);
  assert.equal(TIMING_STEPS[20], 0);
  assert.equal(TIMING_STEPS[40], 2000);
  assert.ok(TIMING_STEPS.every((v, i) => i === 0 || v - TIMING_STEPS[i - 1] === 100));
  assert.equal(timingLabel(100), '+0.1 s  later');
});
