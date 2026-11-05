// The Mac Back button (src/platform/mac/back-button.js): shown on screens above the first one except the player; a click is the Esc press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backVisible, installBackButton } from '../../src/platform/mac/back-button.js';

function rig() {
  const stack = ['home'];
  const keys = [];
  const router = {
    push(n) { stack.push(n); }, pop() { stack.pop(); }, replace(n) { stack[stack.length - 1] = n; }, reset(n) { stack.length = 0; stack.push(n); },
    top: () => (stack.length ? { name: stack[stack.length - 1] } : null), depth: () => stack.length,
    onKey(e) { keys.push(e); return true; },
  };
  const listeners = {};
  const btn = { style: {}, className: '', textContent: '', addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {}, parentNode: null };
  const body = { appendChild(el) { el.parentNode = body; }, removeChild(el) { el.parentNode = null; } };
  const doc = { createElement: () => btn, getElementById: () => null, body };
  const off = installBackButton(router, doc);
  return { router, keys, btn, listeners, off, shown: () => btn.style.display !== 'none' };
}

test('backVisible: one screen or the player: no; any other screen above the first: yes', () => {
  assert.equal(backVisible(1, 'home'), false);
  assert.equal(backVisible(2, 'player'), false);
  assert.equal(backVisible(2, 'details'), true);
  assert.equal(backVisible(3, 'streams'), true);
  assert.equal(backVisible(0, null), false);
});

test('the button follows the stack through push, pop, replace and reset', () => {
  const r = rig();
  assert.equal(r.shown(), false, 'home alone: Esc asks to exit, no button');
  r.router.push('details');
  assert.equal(r.shown(), true);
  r.router.push('player');
  assert.equal(r.shown(), false, 'the player has its own Back');
  r.router.pop();
  assert.equal(r.shown(), true);
  r.router.replace('settings');
  assert.equal(r.shown(), true);
  r.router.reset('home');
  assert.equal(r.shown(), false);
});

test('a click sends exactly the Esc press (back, no repeat) to the router and stops there; an untrusted click does nothing', () => {
  const r = rig();
  r.router.push('details');
  let stopped = false, prevented = false;
  r.listeners.click({ isTrusted: false, stopPropagation() {}, preventDefault() {} });
  assert.equal(r.keys.length, 0);
  r.listeners.click({ isTrusted: true, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
  assert.equal(r.keys.length, 1);
  assert.equal(r.keys[0].type, 'press');
  assert.equal(r.keys[0].action, 'back');
  assert.equal(r.keys[0].repeat, false);
  assert.ok(stopped && prevented);
});

test('removing the button takes it off the page', () => {
  const r = rig();
  r.off();
  assert.equal(r.btn.parentNode, null);
});
