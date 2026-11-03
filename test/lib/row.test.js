import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollFor, slideFor, windowRange } from '../../src/ui/row.js';

const base = { step: 204, itemWidth: 176, viewport: 1920 - 96, count: 40, safeRight: 48 };

test('scrollFor leaves the row alone while the card is already fully visible', () => {
  assert.equal(scrollFor(Object.assign({ index: 3, scroll: 0 }, base)), 0);
  assert.equal(scrollFor(Object.assign({ index: 5, scroll: 300 }, base)), 300);
});

test('scrollFor moves just far enough to the right, keeping safeRight spare', () => {
  const s = scrollFor(Object.assign({ index: 10, scroll: 0 }, base));
  const right = 10 * 204 + 176;
  assert.equal(s, right - base.viewport + base.safeRight);
  assert.ok(right <= s + base.viewport - base.safeRight);
});

test('scrollFor moves left to put the card at the left edge', () => {
  assert.equal(scrollFor(Object.assign({ index: 4, scroll: 2000 }, base)), 4 * 204);
  assert.equal(scrollFor(Object.assign({ index: 0, scroll: 2000 }, base)), 0);
});

test('scrollFor clamps at the end of the row', () => {
  const last = scrollFor(Object.assign({ index: 39, scroll: 0 }, base));
  assert.equal(last, 39 * 204 + 176 - (base.viewport - base.safeRight));
  const short = scrollFor(Object.assign({}, base, { index: 2, scroll: 500, count: 3 }));
  assert.equal(short, 0, 'a row shorter than the screen never scrolls');
});

test('walking right one card at a time scrolls monotonically and always shows the card', () => {
  let scroll = 0;
  for (let i = 0; i < 40; i++) {
    const next = scrollFor(Object.assign({ index: i, scroll }, base));
    assert.ok(next >= scroll);
    assert.ok(i * 204 >= next && i * 204 + 176 <= next + base.viewport);
    scroll = next;
  }
});

test('windowRange keeps the visible cards plus a buffer, clamped to the row', () => {
  const [from, to] = windowRange({ scroll: 0, viewport: 1824, step: 204, count: 40, buffer: 0.75 });
  assert.equal(from, 0);
  assert.equal(to, Math.ceil((1824 + 1368) / 204));
  const [f2, t2] = windowRange({ scroll: 3000, viewport: 1824, step: 204, count: 40, buffer: 0.75 });
  assert.equal(f2, Math.floor((3000 - 1368) / 204));
  assert.ok(t2 <= 40 && t2 > f2);
  assert.ok(t2 - f2 < 25, 'only a screenful or two of 40 cards exists at once');
  const [f3, t3] = windowRange({ scroll: 99999, viewport: 1824, step: 204, count: 40, buffer: 0.75 });
  assert.ok(f3 <= t3 && t3 === 40);
  assert.deepEqual(windowRange({ scroll: 0, viewport: 1824, step: 204, count: 0, buffer: 0.75 }), [0, 0]);
});

test('slideFor puts the focused card at the row start, one card per press, and stops at the end', () => {
  const b = { step: 204, itemWidth: 176, viewport: 1824, count: 40, safeRight: 96 };
  assert.equal(slideFor(Object.assign({ index: 0 }, b)), 0);
  assert.equal(slideFor(Object.assign({ index: 3 }, b)), 3 * 204);
  assert.equal(slideFor(Object.assign({ index: 39 }, b)), 39 * 204 + 176 - (1824 - 96), 'the last card rests at the right margin');
  assert.equal(slideFor(Object.assign({}, b, { index: 2, count: 5 })), 0, 'a short row does not slide');
});
