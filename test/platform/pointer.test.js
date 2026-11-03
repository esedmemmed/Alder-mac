import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoverTarget, wheelStep, WHEEL_THRESHOLD, WHEEL_INTERVAL, WHEEL_IDLE } from '../../src/platform/mac/pointer.js';

// A stand-in element: closest() finds the nearest ancestor-or-self with data-focus.
function el({ focus = true, disabled = false, parent = null, tag = 'DIV' } = {}) {
  const e = { tagName: tag, parent, hasAttribute: (a) => (a === 'data-disabled' ? disabled : a === 'data-focus' ? focus : false) };
  e.closest = (sel) => { for (let n = e; n; n = n.parent) if (sel === '[data-focus]' && n.hasAttribute('data-focus')) return n; return null; };
  return e;
}

test('hover: a focusable under the pointer takes focus; a child of it counts', () => {
  const card = el();
  const img = el({ focus: false, parent: card });
  assert.equal(hoverTarget(img, null), card);
  assert.equal(hoverTarget(card, el()), card);
});

test('hover: nothing to do over a non-focusable, the focused item, a disabled item, outside the scope, or while typing', () => {
  const card = el();
  assert.equal(hoverTarget(el({ focus: false }), card), null);
  assert.equal(hoverTarget(null, card), null);
  assert.equal(hoverTarget(card, card), null);
  assert.equal(hoverTarget(el({ disabled: true }), card), null);
  assert.equal(hoverTarget(card, el(), () => false), null);
  assert.equal(hoverTarget(card, el({ tag: 'INPUT' })), null);
});

const fresh = () => ({ acc: { x: 0, y: 0 }, last: -1e9, seen: -1e9 });

test('wheel: deltaX steps sideways, deltaY pages, shift + deltaY is sideways', () => {
  assert.equal(wheelStep(fresh(), { deltaX: 50, deltaY: 0 }, 1000).dir, 'right');
  assert.equal(wheelStep(fresh(), { deltaX: -50, deltaY: 3 }, 1000).dir, 'left');
  assert.equal(wheelStep(fresh(), { deltaX: 0, deltaY: 60 }, 1000).dir, 'down');
  assert.equal(wheelStep(fresh(), { deltaX: 0, deltaY: -60 }, 1000).dir, 'up');
  assert.equal(wheelStep(fresh(), { deltaX: 0, deltaY: 60, shiftKey: true }, 1000).dir, 'right');
});

test('wheel: small deltas add up to a step; a step needs WHEEL_THRESHOLD', () => {
  let s = fresh();
  let r = wheelStep(s, { deltaX: 15, deltaY: 0 }, 1000); assert.equal(r.dir, null);
  r = wheelStep(r.state, { deltaX: 15, deltaY: 0 }, 1010); assert.equal(r.dir, null);
  r = wheelStep(r.state, { deltaX: 15, deltaY: 0 }, 1020); assert.equal(r.dir, 'right');
  assert.ok(15 * 3 >= WHEEL_THRESHOLD);
});

test('wheel: inertia is throttled to one step per WHEEL_INTERVAL', () => {
  let s = fresh(), steps = 0;
  for (let t = 0; t < 1000; t += 10) { const r = wheelStep(s, { deltaX: 60, deltaY: 0 }, 1000 + t); s = r.state; if (r.dir) steps++; }
  assert.ok(steps <= Math.ceil(1000 / WHEEL_INTERVAL), 'steps ' + steps);
  assert.ok(steps >= 5, 'steps ' + steps);
});

test('wheel: after a pause a new gesture starts from zero', () => {
  let r = wheelStep(fresh(), { deltaX: 30, deltaY: 0 }, 1000);
  r = wheelStep(r.state, { deltaX: -30, deltaY: 0 }, 1000 + WHEEL_IDLE + 1);
  assert.equal(r.dir, null);
  assert.equal(r.state.acc.x, -30);
});
