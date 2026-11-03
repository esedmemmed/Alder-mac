import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impl, install, POLYFILLED } from '../../src/lib/compat.js';

test('allSettled reports fulfilled and rejected without throwing', async () => {
  const r = await impl.allSettled([Promise.resolve(1), Promise.reject(new Error('x')), 3]);
  assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(r[0].value, 1);
  assert.equal(r[1].reason.message, 'x');
  assert.equal(r[2].value, 3);
});

test('any resolves with the first fulfilment, rejects with an AggregateError when all reject', async () => {
  assert.equal(await impl.any([Promise.reject(1), Promise.resolve(2), Promise.resolve(3)]), 2);
  await assert.rejects(impl.any([Promise.reject(1), Promise.reject(2)]), (e) => e.name === 'AggregateError' && e.errors.join() === '1,2');
  await assert.rejects(impl.any([]), (e) => e.name === 'AggregateError');
});

test('fromEntries and hasOwn', () => {
  assert.deepEqual(impl.fromEntries([['a', 1], ['b', 2]]), { a: 1, b: 2 });
  assert.deepEqual(impl.fromEntries(new Map([['k', 'v']])), { k: 'v' });
  assert.equal(impl.hasOwn({ a: 1 }, 'a'), true);
  assert.equal(impl.hasOwn({ a: 1 }, 'toString'), false);
  assert.throws(() => impl.hasOwn(null, 'a'), TypeError);
});

test('replaceAll: strings, special characters, $-patterns, functions, global regex only', () => {
  const ra = (s, ...a) => impl.replaceAll.apply(s, a);
  assert.equal(ra('a.b.c', '.', '-'), 'a-b-c');
  assert.equal(ra('x+x', '+', '$&$&'), 'x++x'.replace('++', '++')); // "$&" is the match itself
  assert.equal(ra('a-b-a', 'a', (m) => m.toUpperCase()), 'A-b-A');
  assert.equal(ra('aaa', /a/g, 'b'), 'bbb');
  assert.throws(() => ra('aaa', /a/, 'b'), TypeError);
  assert.equal(ra('a(b)c', '(b)', ''), 'ac');
});

test('matchAll yields every match, leaves lastIndex alone, needs a global regex, survives empty matches', () => {
  const all = (s, re) => Array.from(impl.matchAll.call(s, re));
  const m = all('a1b22c333', /\d+/g);
  assert.deepEqual(m.map((x) => x[0]), ['1', '22', '333']);
  assert.deepEqual(m.map((x) => x.index), [1, 3, 6]);
  const re = /(\w)(\d)/g;
  re.lastIndex = 0;
  all('a1 b2', re);
  assert.equal(re.lastIndex, 0);
  assert.equal(all('abc', /x*/g).length, 4);
  assert.throws(() => all('a', /a/), TypeError);
});

test('at and findLast / findLastIndex', () => {
  assert.equal(impl.at.call([1, 2, 3], -1), 3);
  assert.equal(impl.at.call([1, 2, 3], 0), 1);
  assert.equal(impl.at.call([1, 2, 3], 3), undefined);
  assert.equal(impl.at.call('abc', -2), 'b');
  assert.equal(impl.findLast.call([1, 2, 3, 4], (x) => x % 2 === 1), 3);
  assert.equal(impl.findLastIndex.call([1, 2, 3, 4], (x) => x % 2 === 1), 2);
  assert.equal(impl.findLastIndex.call([1], (x) => x > 5), -1);
  assert.equal(impl.findLast.call([], () => true), undefined);
});

test('structuredClone copies plain data deeply, keeps cycles, refuses functions', () => {
  const src = { a: [1, { b: 2 }], d: new Date(5), m: new Map([[1, { x: 1 }]]), s: new Set([1, 2]) };
  src.self = src;
  const c = impl.structuredClone(src);
  assert.notEqual(c, src);
  assert.notEqual(c.a[1], src.a[1]);
  assert.deepEqual(c.a, [1, { b: 2 }]);
  assert.equal(c.d.getTime(), 5);
  assert.notEqual(c.d, src.d);
  assert.equal(c.m.get(1).x, 1);
  assert.deepEqual(Array.from(c.s), [1, 2]);
  assert.equal(c.self, c);
  assert.throws(() => impl.structuredClone({ f() {} }), /DataCloneError/);
});

test('queueMicrotask runs after the current code, before timers', async () => {
  const order = [];
  setTimeout(() => order.push('timer'), 0);
  impl.queueMicrotask(() => order.push('micro'));
  order.push('sync');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ['sync', 'micro', 'timer']);
  assert.throws(() => impl.queueMicrotask('no'), TypeError);
});

test('install adds what is missing to a bare global and reports it; a second install adds nothing', () => {
  function P() {}
  function S() {}
  function A() {}
  const g = { Promise: P, Object: {}, String: S, Array: A };
  const added = install(g);
  assert.ok(added.includes('Promise.allSettled') && added.includes('Object.fromEntries') && added.includes('String.prototype.replaceAll'));
  assert.ok(added.includes('Array.prototype.at') && added.includes('structuredClone') && added.includes('globalThis'));
  assert.equal(typeof P.allSettled, 'function');
  assert.equal(typeof P.any, 'function');
  assert.equal(typeof S.prototype.matchAll, 'function');
  assert.equal(typeof A.prototype.findLast, 'function');
  assert.equal(g.globalThis, g);
  assert.equal(Object.keys(A.prototype).length, 0, 'polyfills are not enumerable');
  assert.deepEqual(install(g), []);
});

test('install leaves a native implementation alone', () => {
  const native = () => 'native';
  function P() {}
  P.allSettled = native;
  install({ Promise: P, Object: {}, String() {}, Array() {} });
  assert.equal(P.allSettled, native);
});

test('every name POLYFILLED promises is installed on a bare engine', () => {
  const g = { Promise: function Promise() {}, Object: {}, String: function String() {}, Array: function Array() {}, Element: function Element() {} };
  const added = install(g);
  assert.deepEqual(POLYFILLED.filter((n) => !added.includes(n)), []);
});
