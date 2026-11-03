// The player's keys with Mac keyCodes (1.3 T8): the real Mac key table and dispatcher (src/platform/mac/keys.js), the real engine on the
// mpv adapter, and the DOM-free rules the screen and controls apply (focus-rules.js, lifecycle.js fullscreenKey). The DOM parts (options
// panel rows, button highlight) need a browser and are not run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachKeys } from '../../src/platform/mac/keys.js';
import { createLifecycle } from '../../src/platform/mac/lifecycle.js';
import { hiddenKey, mediaPlan, stepFocus, buttonOrder, HOME } from '../../src/player/focus-rules.js';
import { PLAYER } from '../../src/core/playback.js';
import { makeEngine, stream } from '../player/helpers.js';

const CODE = { left: 37, up: 38, right: 39, down: 40, esc: 27, space: 32, f: 70, ff: 221, rw: 219 };

/** Mac keys in, the player's decisions out. controls: hidden | shown (focus tracked). */
async function rig() {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Film')] });
  await t.start();
  await t.advance(3000);
  t.engine.play();
  await t.advance(3000);
  const listeners = {};
  const target = { addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener() {} };
  const seen = [];
  const fsCalls = [];
  const life = createLifecycle({ bridge: () => ({ fullscreen: (on) => { fsCalls.push(on); return Promise.resolve(); } }) });
  const st = { shown: false, focus: HOME, options: false, exited: false };
  const onAction = (evt) => {
    seen.push(evt.action);
    if (life.fullscreenKey(evt)) return;
    if (evt.type !== 'press') return;
    const m = mediaPlan(evt.action);
    if (m) { if (m.toggle) t.engine.togglePlay(); if (m.seek) { st.shown = true; t.engine.scrub(m.seek * PLAYER.SKIP); } return; }
    if (st.options) { if (evt.action === 'back') st.options = false; return; }
    if (!st.shown) {
      const plan = hiddenKey(evt.action);
      if (!plan) { if (evt.action === 'back') st.exited = true; return; }
      if (plan.show) { st.shown = true; st.focus = plan.focus; }      if (plan.seek) t.engine.scrub(plan.seek * PLAYER.SKIP);
      return;
    }
    if (evt.action === 'back') { st.shown = false; return; }
    if (st.focus === 'bar' && (evt.action === 'left' || evt.action === 'right')) { t.engine.scrub((evt.action === 'left' ? -1 : 1) * PLAYER.SKIP); return; } // controls.js: Left/Right on the bar
    if (st.focus === 'audio' && evt.action === 'ok') { st.options = true; return; }
    st.focus = stepFocus(buttonOrder(false), st.focus, evt.action);
  };
  attachKeys({ target, onAction, isTyping: () => false });
  const key = (keyCode) => { const e = { keyCode, repeat: false, preventDefault() {} }; listeners.keydown(e); listeners.keyup(e); };
  return { t, key, st, seen, fsCalls, life };
}

test('Mac keys reach the player: Space pauses and resumes', async () => {
  const { t, key } = await rig();
  assert.equal(t.playState(), 'PLAYING');
  key(CODE.space);
  assert.equal(t.playState(), 'PAUSED');
  key(CODE.space);
  assert.equal(t.playState(), 'PLAYING');
});

test('Mac keys: Left / Right seek 10 s once the presses settle; ] and [ also seek', async () => {
  const { t, key, seen } = await rig();
  const at = t.position();
  key(CODE.right);
  await t.advance(PLAYER.SEEK_SETTLE + 100);
  assert.deepEqual(t.seeks().slice(-1), [at + 10000]);
  key(CODE.left);
  await t.advance(PLAYER.SEEK_SETTLE + 100);
  assert.equal(t.seeks().length, 2);
  key(CODE.ff);
  await t.advance(PLAYER.SEEK_SETTLE + 100);
  assert.equal(t.seeks().length, 3);
  assert.deepEqual(seen, ['right', 'left', 'ff']);
});

test('Mac keys: Left walks the controls to the Audio button, Return opens the options, Esc closes them, Esc again hides the controls', async () => {
  const { t, key, st } = await rig();
  key(CODE.up); // hidden: Up only brings the controls up, on Play/Pause
  assert.deepEqual([st.shown, st.focus], [true, 'play']);
  key(CODE.left); key(CODE.left);
  assert.equal(st.focus, 'audio');
  key(13);
  assert.equal(st.options, true);
  key(CODE.esc);
  assert.equal(st.options, false);
  key(CODE.esc);
  assert.equal(st.shown, false);
  key(CODE.esc);
  assert.equal(st.exited, true);
  assert.equal(t.seeks().length, 0, 'no stray seek from navigating');
});

test('Mac keys: Up / Down move between the bar and the buttons', async () => {
  const { key, st } = await rig();
  key(CODE.down);
  assert.equal(st.focus, 'play');
  key(CODE.up);
  assert.equal(st.focus, 'bar');
  key(CODE.down);
  assert.equal(st.focus, 'play');
});

test('Mac keys: F toggles fullscreen, Esc leaves it before the player', async () => {
  const { key, st, fsCalls } = await rig();
  key(CODE.f);
  assert.deepEqual(fsCalls, [true]);
  key(CODE.esc);
  assert.deepEqual(fsCalls, [true, false]);
  assert.equal(st.exited, false);
  key(CODE.esc);
  assert.equal(st.exited, true);
});

test('Fullscreen asked by the play-check hook is known to the lifecycle: the first F leaves it, Esc leaves it before the player', async () => {
  const { key, st, fsCalls, life } = await rig();
  life.noteFullscreen(true); // what installPlayHook does with fs=1
  key(CODE.f);
  assert.deepEqual(fsCalls, [false]);
  life.noteFullscreen(true);
  key(CODE.esc);
  assert.deepEqual(fsCalls, [false, false]);
  assert.equal(st.exited, false);
});
