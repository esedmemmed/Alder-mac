import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createCache, memoryStorage, browserStorage } from '../../src/lib/store.js';

function limited(limit) {
  const data = new Map();
  const size = () => { let n = 0; data.forEach((v, k) => { n += k.length + v.length; }); return n; };
  return {
    get length() { return data.size; },
    key: (i) => Array.from(data.keys())[i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      const old = data.get(k);
      if (size() - (old === undefined ? 0 : k.length + old.length) + k.length + String(v).length > limit) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, String(v));
    },
    removeItem: (k) => { data.delete(k); },
  };
}

test('store: JSON values round-trip, fallbacks for missing and unreadable', () => {
  const s = createStore({ storage: memoryStorage() });
  assert.equal(s.get('missing'), null);
  assert.equal(s.get('missing', 7), 7);
  assert.equal(s.set('a', { x: [1, 2], y: 'z' }), true);
  assert.deepEqual(s.get('a'), { x: [1, 2], y: 'z' });
  s.set('n', 0);
  s.set('f', false);
  assert.equal(s.get('n', 5), 0);
  assert.equal(s.get('f', true), false);
  s.storage.setItem('alder:broken', '{nope');
  assert.equal(s.get('broken', 'fb'), 'fb');
  assert.equal(s.has('a'), true);
  s.remove('a');
  assert.equal(s.has('a'), false);
  s.set('n', undefined);
  assert.equal(s.has('n'), false);
});

test('store: keys are namespaced, scope() nests, clear() only clears its own prefix', () => {
  const storage = memoryStorage();
  const root = createStore({ storage });
  const profile = root.scope('profile-1');
  root.set('lang', 'en');
  profile.set('quality', '1080');
  profile.set('pin', '1234');
  assert.deepEqual(root.keys().sort(), ['lang', 'profile-1:pin', 'profile-1:quality']);
  assert.deepEqual(profile.keys().sort(), ['pin', 'quality']);
  assert.equal(storage.getItem('alder:profile-1:quality'), '"1080"');
  profile.clear();
  assert.deepEqual(root.keys(), ['lang']);
  storage.setItem('other:thing', '1');
  root.clear();
  assert.equal(storage.getItem('other:thing'), '1');
});

test('store: a full or throwing storage never throws, set() says false', () => {
  const full = limited(10);
  const s = createStore({ storage: full });
  assert.equal(s.set('k', 'this does not fit'), false);
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); }, key() { throw new Error('no'); }, length: 3 };
  const b = createStore({ storage: broken });
  assert.equal(b.get('x', 'fb'), 'fb');
  assert.equal(b.set('x', 1), false);
  assert.deepEqual(b.keys(), []);
  assert.equal(b.has('x'), false);
  b.remove('x');
});

test('browserStorage falls back to memory when localStorage throws or is missing', () => {
  assert.equal(typeof browserStorage(null).getItem, 'function');
  const bad = { get localStorage() { throw new Error('denied'); } };
  const s = browserStorage(bad);
  s.setItem('a', '1');
  assert.equal(s.getItem('a'), '1');
});

test('cache: put/get, a read refreshes the timestamp only after touchEveryMs', () => {
  let t = 1000;
  const storage = memoryStorage();
  const c = createCache({ storage, now: () => t, touchEveryMs: 100 });
  assert.equal(c.get('a'), null);
  assert.equal(c.put('a', 'body a'), true);
  assert.equal(c.get('a'), 'body a');
  assert.equal(storage.getItem('alder:cache:a'), '1000|body a');
  t = 1050;
  c.get('a');
  assert.equal(storage.getItem('alder:cache:a'), '1000|body a', 'too soon to rewrite');
  t = 1200;
  c.get('a');
  assert.equal(storage.getItem('alder:cache:a'), '1200|body a');
  assert.equal(c.count(), 1);
});

test('cache: over the cap, the least recently used entries go first', () => {
  let t = 0;
  const c = createCache({ storage: memoryStorage(), maxChars: 200, now: () => ++t, touchEveryMs: 0 });
  c.put('k1', 'x'.repeat(50));
  c.put('k2', 'x'.repeat(50));
  c.put('k3', 'x'.repeat(50));
  c.get('k1'); // k1 is now the freshest
  c.put('k4', 'x'.repeat(50)); // 4 x 64 = 256 > 200: evict down to 90%
  assert.equal(c.get('k2'), null, 'oldest untouched entry evicted');
  assert.notEqual(c.get('k1'), null, 'recently read entry kept');
  assert.notEqual(c.get('k4'), null);
  assert.ok(c.size() <= 200);
});

test('cache: a body larger than the cap is refused; a full storage evicts and retries', () => {
  const big = createCache({ storage: memoryStorage(), maxChars: 50 });
  assert.equal(big.put('k', 'x'.repeat(100)), false);

  let t = 0;
  const storage = limited(400);
  const c = createCache({ storage, maxChars: 10000, now: () => ++t, touchEveryMs: 0 });
  for (let i = 0; i < 5; i++) assert.equal(c.put('e' + i, 'y'.repeat(60)), true);
  assert.equal(c.put('new', 'z'.repeat(60)), true, 'quota error: oldest freed, then it fits');
  assert.notEqual(c.get('new'), null);
  assert.equal(c.get('e0'), null);
});

test('cache: remembers entries from an earlier run, drops unreadable ones, ignores other prefixes', () => {
  const storage = memoryStorage();
  storage.setItem('alder:cache:old', '5|saved body');
  storage.setItem('alder:cache:bad', 'no timestamp');
  storage.setItem('alder:settings', '{"a":1}');
  const c = createCache({ storage });
  assert.equal(c.get('old'), 'saved body');
  assert.equal(c.has('bad'), false);
  assert.equal(storage.getItem('alder:cache:bad'), null);
  assert.equal(storage.getItem('alder:settings'), '{"a":1}');
  c.clear();
  assert.equal(storage.getItem('alder:cache:old'), null);
  assert.equal(storage.getItem('alder:settings'), '{"a":1}');
});
