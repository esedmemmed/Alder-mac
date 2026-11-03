// Where the remote's focus is on the player's controls (docs/PLAN-v0.2.md D2), with no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME, SEEK_SETTLE, buttonOrder, focusOnShow, focusAfterClose, showsControlsAfterClose, focusAfterSeek, stepFocus, hiddenKey, mediaPlan, glyphFor, GLYPH,
} from '../../src/player/focus-rules.js';

test('the controls always come up on Play/Pause, and so does focus after a panel or card closes', () => {
  assert.equal(HOME, 'play');
  assert.equal(focusOnShow(), 'play');
  for (const kind of ['options', 'info', 'upnext', 'stall', 'error', 'sources']) assert.equal(focusAfterClose(kind), 'play', kind);
});

test('only the Info card brings the controls back when it closes (it was opened from them); Up next and the stall offer leave the picture alone', () => {
  assert.equal(showsControlsAfterClose('info'), true);
  for (const kind of ['upnext', 'stall', 'error']) assert.equal(showsControlsAfterClose(kind), false, kind);
});

test('after a seek, focus leaves the bar for Play/Pause; a button stays where it is', () => {
  assert.equal(focusAfterSeek('bar'), 'play');
  for (const id of ['audio', 'stream', 'play', 'next', 'info']) assert.equal(focusAfterSeek(id), id, id);
  assert.ok(SEEK_SETTLE > 500 && SEEK_SETTLE < 3000, 'long enough for a held key to keep going, short enough to be a return');
});

test('Left and Right walk the buttons without wrapping; Next episode is there only when there is one', () => {
  const order = buttonOrder(false);
  assert.deepEqual(order, ['audio', 'stream', 'play', 'info']);
  assert.deepEqual(buttonOrder(true), ['audio', 'stream', 'play', 'next', 'info']);
  assert.equal(stepFocus(order, 'play', 'right'), 'info');
  assert.equal(stepFocus(order, 'info', 'right'), 'info');
  assert.equal(stepFocus(order, 'play', 'left'), 'stream');
  assert.equal(stepFocus(order, 'audio', 'left'), 'audio');
  assert.equal(stepFocus(order, 'play', 'up'), 'bar');
  assert.equal(stepFocus(order, 'bar', 'down'), 'play', 'Down from the bar goes back to Play/Pause');
  assert.equal(stepFocus(order, 'bar', 'left'), 'bar', 'Left and Right on the bar are the scrub, not focus');
  assert.equal(stepFocus(order, 'audio', 'down'), 'audio');
});

test('while the controls are hidden: OK pauses or resumes and shows them on Play/Pause; Up and Down only show them; Left and Right are the quick seek', () => {
  assert.deepEqual(hiddenKey('ok'), { show: true, toggle: true, focus: 'play' });
  for (const a of ['up', 'down']) assert.deepEqual(hiddenKey(a), { show: true, toggle: false, focus: 'play' }, a);
  assert.deepEqual(hiddenKey('left'), { show: true, toggle: false, focus: 'bar', seek: -1 }, 'Left: the bar is focused and the first 10 s step back is taken now');
  assert.deepEqual(hiddenKey('right'), { show: true, toggle: false, focus: 'bar', seek: 1 });
  assert.equal(focusOnShow('bar'), 'bar', 'the controls honour the bar for a quick seek');
  assert.equal(focusOnShow('audio'), 'play', 'and put anything else on Play/Pause');
  assert.equal(focusAfterSeek(hiddenKey('right').focus), 'play', 'and 1.2 s after the last step focus is back on Play/Pause');
  assert.equal(hiddenKey('back'), null, 'Back is the screen\'s (it leaves the player)');
  assert.equal(hiddenKey('red'), null);
});

test('the Play/Pause media key toggles at once and leaves the controls down; fast-forward and rewind bring them up and step', () => {
  assert.deepEqual(mediaPlan('playpause'), { toggle: true, showControls: false });
  assert.deepEqual(mediaPlan('play'), { play: true, showControls: false });
  assert.deepEqual(mediaPlan('pause'), { pause: true, showControls: false });
  assert.deepEqual(mediaPlan('ff'), { seek: 1, showControls: true });
  assert.deepEqual(mediaPlan('rw'), { seek: -1, showControls: true });
  assert.equal(mediaPlan('ok'), null);
  assert.equal(focusOnShow(), 'play', 'and a seek brings the controls up on Play/Pause too');
});

test('the centre glyph: pause shows when paused, play flashes on resume, the first report and a repeat show nothing', () => {
  assert.equal(glyphFor(null, true), null, 'the film starting is not a resume');
  assert.equal(glyphFor(null, false), null);
  assert.equal(glyphFor(true, false), 'pause');
  assert.equal(glyphFor(false, true), 'play');
  assert.equal(glyphFor(true, true), null);
  assert.equal(glyphFor(false, false), null);
  assert.equal(GLYPH.IN_MS, 120);
  assert.equal(GLYPH.FLASH_MS, 600);
});
