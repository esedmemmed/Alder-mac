import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, stringify, formatEntry, installGlobalHandlers } from '../../src/lib/log.js';

test('stringify: strings, errors, objects, circular objects, long text', () => {
  assert.equal(stringify('a'), 'a');
  assert.equal(stringify(new TypeError('boom')), 'TypeError: boom');
  assert.equal(stringify({ a: 1 }), '{"a":1}');
  const c = {}; c.self = c;
  assert.equal(typeof stringify(c), 'string');
  assert.equal(stringify(undefined), 'undefined');
  assert.equal(stringify('x'.repeat(600)).length, 501);
  assert.equal(stringify(5), '5');
});

test('the ring buffer keeps the newest N lines', () => {
  const l = createLogger({ capacity: 3, now: () => 1 });
  for (let i = 0; i < 5; i++) l.info('t', 'm' + i);
  assert.deepEqual(l.lines().map((e) => e.msg), ['m2', 'm3', 'm4']);
  l.clear();
  assert.equal(l.lines().length, 0);
});

test('levels, data, errors() returns warnings and errors only', () => {
  const l = createLogger();
  l.debug('a', 'd'); l.info('a', 'i'); l.warn('a', 'w', { x: 1 }); l.error('b', 'e');
  assert.deepEqual(l.errors().map((e) => e.level), ['warn', 'error']);
  assert.equal(l.lines()[2].msg, 'w {"x":1}');
  assert.equal(l.errors(1).length, 1);
});

test('echo and subscribers get each entry; a throwing one does not break logging', () => {
  const echoed = []; const heard = [];
  const l = createLogger({ echo: (lv, e) => { echoed.push(lv + e.msg); throw new Error('console gone'); } });
  const off = l.subscribe((e) => heard.push(e.msg));
  l.subscribe(() => { throw new Error('bad listener'); });
  l.info('t', 'one');
  off();
  l.info('t', 'two');
  assert.deepEqual(echoed, ['infoone', 'infotwo']);
  assert.deepEqual(heard, ['one']);
  assert.equal(l.lines().length, 2);
});

test('text() and formatEntry produce aligned lines', () => {
  const t = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();
  const l = createLogger({ now: () => t });
  l.warn('player', 'stalled');
  assert.equal(formatEntry(l.lines()[0]), '03:04:05.006 WARN  player   stalled');
  assert.equal(l.text(), formatEntry(l.lines()[0]));
});

test('installGlobalHandlers logs window errors and rejections, and can be removed', () => {
  const win = new EventTarget();
  const l = createLogger();
  const off = installGlobalHandlers(win, l);
  const e = new Event('error'); e.message = 'oops'; e.filename = 'http://x/app.js'; e.lineno = 12;
  win.dispatchEvent(e);
  const r = new Event('unhandledrejection'); r.reason = new Error('nope');
  win.dispatchEvent(r);
  const r2 = new Event('unhandledrejection'); r2.reason = null;
  win.dispatchEvent(r2);
  assert.deepEqual(l.lines().map((x) => x.msg), ['oops @app.js:12', 'Error: nope', 'unhandled rejection']);
  off();
  win.dispatchEvent(e);
  assert.equal(l.lines().length, 3);
});
