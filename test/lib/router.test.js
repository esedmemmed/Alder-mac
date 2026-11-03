import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/lib/router.js';

function setup(extra = {}) {
  const events = [];
  const mkScreen = (name) => (params) => ({
    mount: (c, p, ctx) => events.push('mount ' + name + ' ' + JSON.stringify(p) + (ctx && ctx.tag ? ' ' + ctx.tag : '')),
    unmount: () => events.push('unmount ' + name),
    suspend: () => events.push('suspend ' + name),
    resume: () => events.push('resume ' + name),
    onKey: (e) => { events.push('key ' + name + ' ' + e.action); return !!(extra.handles && extra.handles[name] === e.action); },
  });
  const screens = { a: mkScreen('a'), b: mkScreen('b'), c: mkScreen('c') };
  const hidden = new Map();
  let exits = 0;
  const router = createRouter({
    root: null, screens, context: { tag: 'ctx' }, onExit: () => exits++,
    createContainer: (name) => ({ name }), removeContainer: (c) => events.push('remove ' + c.name),
    setHidden: (c, h) => hidden.set(c.name, h),
    beforeHide: (e) => events.push('beforeHide ' + e.name), afterShow: (e) => events.push('afterShow ' + e.name),
    maxDepth: extra.maxDepth || 12,
  });
  return { router, events, hidden, exits: () => exits };
}
const back = { type: 'press', action: 'back', repeat: false };

test('push mounts with params and context, hides and suspends the screen below', () => {
  const t = setup();
  t.router.push('a', { x: 1 });
  t.router.push('b');
  assert.deepEqual(t.events, ['mount a {"x":1} ctx', 'beforeHide a', 'suspend a', 'mount b {} ctx']);
  assert.equal(t.hidden.get('a'), true);
  assert.deepEqual(t.router.names(), ['a', 'b']);
  assert.equal(t.router.depth(), 2);
});

test('pop unmounts the top and resumes the one below; the bottom screen cannot be popped', () => {
  const t = setup();
  t.router.push('a'); t.router.push('b'); t.events.length = 0;
  assert.equal(t.router.pop(), true);
  assert.deepEqual(t.events, ['unmount b', 'remove b', 'resume a', 'afterShow a']);
  assert.equal(t.hidden.get('a'), false);
  assert.equal(t.router.pop(), false);
  assert.equal(t.router.depth(), 1);
});

test('replace and reset', () => {
  const t = setup();
  t.router.push('a'); t.router.push('b');
  t.router.replace('c');
  assert.deepEqual(t.router.names(), ['a', 'c']);
  t.router.reset('b');
  assert.deepEqual(t.router.names(), ['b']);
  assert.equal(t.router.top().name, 'b');
});

test('an unknown screen name throws and leaves the stack alone', () => {
  const t = setup();
  t.router.push('a');
  assert.throws(() => t.router.push('nope'), /No screen named nope/);
  assert.equal(t.router.depth(), 1);
});

test('Back: the screen may handle it; otherwise it pops; at the bottom it asks the app to exit', () => {
  const t = setup({ handles: { b: 'back' } });
  t.router.push('a'); t.router.push('b');
  assert.equal(t.router.onKey(back), true);
  assert.equal(t.router.depth(), 2, 'b handled Back itself');
  const t2 = setup();
  t2.router.push('a'); t2.router.push('b');
  t2.router.onKey(back);
  assert.deepEqual(t2.router.names(), ['a']);
  assert.equal(t2.exits(), 0);
  t2.router.onKey(back);
  assert.equal(t2.exits(), 1);
  assert.equal(t2.router.onKey({ type: 'press', action: 'back', repeat: true }), false, 'a held Back does not exit');
});

test('overlays see keys first and swallow Back', () => {
  const t = setup();
  t.router.push('a'); t.router.push('b');
  const seen = [];
  const remove = t.router.pushOverlay((e) => { seen.push(e.action); return e.action === 'ok'; });
  assert.equal(t.router.overlayCount(), 1);
  assert.equal(t.router.onKey({ type: 'press', action: 'ok' }), true);
  assert.equal(t.router.onKey(back), true);
  assert.equal(t.router.depth(), 2, 'Back did not pop the screen under the dialog');
  remove();
  assert.equal(t.router.overlayCount(), 0);
  t.router.onKey(back);
  assert.equal(t.router.depth(), 1);
  assert.deepEqual(seen, ['ok', 'back']);
});

test('a runaway stack is capped by dropping the screen under the top, never the root', () => {
  const t = setup({ maxDepth: 4 });
  t.router.push('a');
  for (let i = 0; i < 10; i++) t.router.push(i % 2 ? 'b' : 'c');
  assert.equal(t.router.depth(), 4);
  assert.equal(t.router.names()[0], 'a');
});

test('unhandled keys return false', () => {
  const t = setup();
  t.router.push('a');
  assert.equal(t.router.onKey({ type: 'press', action: 'left' }), false);
});
