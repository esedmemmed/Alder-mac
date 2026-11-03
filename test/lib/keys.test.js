import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyDispatcher, attachKeys, actionFor, registerKeys, isDigit, KEY_ACTIONS, REGISTER_KEYS } from '../../src/lib/keys.js';
import { createFakeClock } from '../../dev/fake-clock.js';

function setup(holdMs = 600) {
  const clock = createFakeClock();
  const events = [];
  const d = createKeyDispatcher({ emit: (e) => events.push(e.type + ':' + e.action + (e.repeat ? ':repeat' : '')), holdMs, timers: clock });
  return { clock, events, d };
}

test('actionFor maps Samsung codes and the dev keyboard to the same action names', () => {
  assert.equal(actionFor(13), 'ok');
  assert.equal(actionFor(10009), 'back');
  assert.equal(actionFor(27), 'back');
  assert.equal(actionFor(8), 'back');
  assert.equal(actionFor(37), 'left');
  assert.equal(actionFor(40), 'down');
  assert.equal(actionFor(415), 'play');
  assert.equal(actionFor(19), 'pause');
  assert.equal(actionFor(10252), 'playpause');
  assert.equal(actionFor(32), 'playpause');
  assert.equal(actionFor(417), 'ff');
  assert.equal(actionFor(221), 'ff');
  assert.equal(actionFor(412), 'rw');
  assert.equal(actionFor(219), 'rw');
  assert.equal(actionFor(403), 'red');
  assert.equal(actionFor(53), '5');
  assert.equal(actionFor(101), '5');
  assert.equal(actionFor(65), null);
  assert.equal(actionFor(undefined), null);
  assert.ok(isDigit('7') && !isDigit('ok') && !isDigit(null));
  assert.equal(Object.keys(KEY_ACTIONS).length > 40, true);
});

test('OK released before the threshold is a press, delivered on release', async () => {
  const { clock, events, d } = setup();
  d.keydown('ok', {}, false);
  await clock.advance(200);
  assert.deepEqual(events, []);
  d.keyup('ok', {});
  assert.deepEqual(events, ['press:ok']);
  await clock.advance(1000);
  assert.deepEqual(events, ['press:ok'], 'nothing fires later');
  assert.equal(clock.pending(), 0);
});

test('OK held past 600 ms is one hold, fired while the key is still down; the release does nothing', async () => {
  const { clock, events, d } = setup();
  d.keydown('ok', {}, false);
  await clock.advance(599);
  assert.deepEqual(events, []);
  await clock.advance(2);
  assert.deepEqual(events, ['hold:ok']);
  assert.equal(d.isHolding(), true);
  await clock.advance(2000);
  d.keyup('ok', {});
  assert.deepEqual(events, ['hold:ok'], 'one hold, no press on release');
  assert.equal(d.isHolding(), false);
});

test('auto-repeat keydowns of OK do not restart or multiply the hold', async () => {
  const { clock, events, d } = setup();
  d.keydown('ok', {}, false);
  for (let i = 0; i < 10; i++) { await clock.advance(100); d.keydown('ok', {}, true); }
  assert.deepEqual(events, ['hold:ok'], 'the hold fired once, at 600 ms, despite repeats');
  d.keyup('ok', {});
  d.keydown('ok', {}, false);
  d.keyup('ok', {});
  assert.deepEqual(events, ['hold:ok', 'press:ok'], 'the next short press is a normal press');
});

test('other keys press immediately and repeat while held (scrolling a row)', () => {
  const { events, d } = setup();
  d.keydown('right', {}, false);
  d.keydown('right', {}, true);
  d.keydown('right', {}, true);
  d.keyup('right', {});
  assert.deepEqual(events, ['press:right', 'press:right:repeat', 'press:right:repeat']);
});

test('reset forgets a key whose release will never come (the window lost focus)', async () => {
  const { clock, events, d } = setup();
  d.keydown('ok', {}, false);
  d.reset();
  await clock.advance(5000);
  assert.deepEqual(events, []);
  assert.equal(clock.pending(), 0);
});

test('a different holdMs and a keyup for another key', async () => {
  const { clock, events, d } = setup(300);
  d.keydown('ok', {}, false);
  d.keyup('back', {});
  await clock.advance(301);
  assert.deepEqual(events, ['hold:ok']);
});

function fakeTarget() {
  const t = new EventTarget();
  t.fire = (type, props) => { const e = new Event(type, { cancelable: true }); Object.assign(e, props); t.dispatchEvent(e); return e; };
  return t;
}

test('attachKeys: key events become actions, preventDefault is called, detach stops it', async () => {
  const clock = createFakeClock();
  const seen = [];
  const target = fakeTarget();
  const detach = attachKeys({ target, onAction: (e) => seen.push(e.type + ':' + e.action), timers: clock, isTyping: () => false });
  const e = target.fire('keydown', { keyCode: 39, repeat: false });
  assert.equal(e.defaultPrevented, true);
  target.fire('keyup', { keyCode: 39 });
  target.fire('keydown', { keyCode: 13 });
  target.fire('keyup', { keyCode: 13 });
  target.fire('keydown', { keyCode: 13 });
  await clock.advance(700);
  target.fire('keyup', { keyCode: 13 });
  target.fire('keydown', { keyCode: 65 }); // an unmapped key is ignored and not prevented
  assert.deepEqual(seen, ['press:right', 'press:ok', 'hold:ok']);
  const other = target.fire('keydown', { keyCode: 65 });
  assert.equal(other.defaultPrevented, false);
  detach();
  target.fire('keydown', { keyCode: 37 });
  assert.equal(seen.length, 3);
});

test('attachKeys: while typing in a field, only up/down/OK/Back reach the app and Backspace stays the field\'s', () => {
  const seen = [];
  const target = fakeTarget();
  attachKeys({ target, onAction: (e) => seen.push(e.action), timers: createFakeClock(), isTyping: () => true });
  [8, 37, 39, 53, 38, 40, 10009, 27].forEach((keyCode) => target.fire('keydown', { keyCode }));
  assert.deepEqual(seen, ['up', 'down', 'back', 'back']);
});

test('registerKeys: one batch when the TV accepts it, key by key when one name is unknown', () => {
  const calls = [];
  const good = { tvinputdevice: { registerKeyBatch: (n) => calls.push(['batch', n.length]), registerKey: () => calls.push(['one']) } };
  assert.equal(registerKeys(good).length, REGISTER_KEYS.length);
  assert.deepEqual(calls, [['batch', REGISTER_KEYS.length]]);

  const registered = [];
  const picky = { tvinputdevice: {
    registerKeyBatch() { throw new Error('unknown key'); },
    registerKey(n) { if (n === 'Caption') throw new Error('unknown'); registered.push(n); },
  } };
  const done = registerKeys(picky);
  assert.equal(done.length, REGISTER_KEYS.length - 1);
  assert.ok(!done.includes('Caption') && done.includes('MediaPlay'));
  assert.deepEqual(registerKeys(undefined), []);
  assert.deepEqual(registerKeys({}), []);
});
