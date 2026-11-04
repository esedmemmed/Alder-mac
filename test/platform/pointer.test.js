import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeDir, createEdgeScroller, EDGE_INTERVAL, hoverTarget, wheelStep, WHEEL_THRESHOLD, WHEEL_INTERVAL, WHEEL_IDLE } from '../../src/platform/mac/pointer.js';

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

test('row edges: only the outer 10% (at most 80px) of a row scrolls', () => {
  const rect = { left: 0, right: 1000 };
  assert.equal(edgeDir(50, rect), 'left');
  assert.equal(edgeDir(950, rect), 'right');
  assert.equal(edgeDir(500, rect), null);
  assert.equal(edgeDir(150, rect), null);
  assert.equal(edgeDir(85, { left: 0, right: 2000 }), null);
});

test('row edges: the middle never steps; held in an edge zone it steps once per EDGE_INTERVAL and stops on leaving', () => {
  const jobs = [];
  const timers = { setInterval: (f) => { jobs.push(f); return jobs.length; }, clearInterval: (i) => { jobs[i - 1] = null; } };
  const cur = { closest: () => ({ getAttribute: () => '3' }) };
  const moves = [];
  const engine = { current: () => cur, focus: () => {}, move: (d) => moves.push(d) };
  const row = { isConnected: true, contains: () => true, getBoundingClientRect: () => ({ left: 0, right: 1000 }) };
  const target = { closest: () => row };
  const s = createEdgeScroller({ engine, timers });
  s.over(target, 500);
  assert.equal(s.active(), false);
  s.over(target, 960);
  assert.equal(s.active(), true);
  assert.equal(moves.length, 0, 'no step before the interval');
  jobs[0]();
  assert.deepEqual(moves, ['right']);
  s.over(target, 500);
  assert.equal(s.active(), false);
  assert.ok(EDGE_INTERVAL >= 300);
});
