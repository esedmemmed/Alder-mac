import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNext, rectOf, scoreOf, topLeftMost } from '../../src/lib/focus.js';

/** A rows x cols grid of cards like Home's rows: 176 x 264, 28 apart, rows 430 px apart. Ids are "r,c". */
function grid(rows, cols, { w = 176, h = 264, gapX = 28, gapY = 166 } = {}) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ id: r + ',' + c, rect: { left: 96 + c * (w + gapX), top: 100 + r * (h + gapY), width: w, height: h } });
  return out;
}
const at = (cands, id) => cands.find((c) => c.id === id);
const id = (c) => (c ? c.id : null);

test('rectOf accepts width/height or right/bottom and derives centres', () => {
  const a = rectOf({ left: 10, top: 20, width: 100, height: 50 });
  assert.deepEqual([a.right, a.bottom, a.cx, a.cy], [110, 70, 60, 45]);
  const b = rectOf({ left: 10, top: 20, right: 110, bottom: 70 });
  assert.deepEqual([b.width, b.height], [100, 50]);
});

test('3 rows x 40 cards: Left and Right walk the row one card at a time and stop at its ends', () => {
  const g = grid(3, 40);
  let cur = at(g, '1,0');
  assert.equal(id(pickNext(cur.rect, g.filter((c) => c !== cur), 'left')), null, 'nothing left of the first card');
  for (let c = 0; c < 39; c++) {
    const next = pickNext(cur.rect, g.filter((x) => x !== cur), 'right');
    assert.equal(id(next), '1,' + (c + 1));
    cur = next;
  }
  assert.equal(id(pickNext(cur.rect, g.filter((x) => x !== cur), 'right')), null, 'nothing right of the last card');
  for (let c = 39; c > 0; c--) {
    const prev = pickNext(cur.rect, g.filter((x) => x !== cur), 'left');
    assert.equal(id(prev), '1,' + (c - 1));
    cur = prev;
  }
});

test('Up and Down keep the column: same x in the next row, none past the first or last row', () => {
  const g = grid(3, 40);
  for (const col of [0, 1, 17, 39]) {
    const mid = at(g, '1,' + col);
    const others = g.filter((c) => c !== mid);
    assert.equal(id(pickNext(mid.rect, others, 'down')), '2,' + col);
    assert.equal(id(pickNext(mid.rect, others, 'up')), '0,' + col);
  }
  const top = at(g, '0,5');
  assert.equal(id(pickNext(top.rect, g.filter((c) => c !== top), 'up')), null);
  const bottom = at(g, '2,5');
  assert.equal(id(pickNext(bottom.rect, g.filter((c) => c !== bottom), 'down')), null);
});

test('a focused card that has grown 8% still finds its neighbours (rects are measured through transforms)', () => {
  const g = grid(3, 10);
  const card = at(g, '1,4');
  const grown = { left: card.rect.left - 7, top: card.rect.top - 10, width: card.rect.width * 1.08, height: card.rect.height * 1.08 };
  const others = g.filter((c) => c !== card);
  assert.equal(id(pickNext(grown, others, 'right')), '1,5');
  assert.equal(id(pickNext(grown, others, 'left')), '1,3');
  assert.equal(id(pickNext(grown, others, 'down')), '2,4');
  assert.equal(id(pickNext(grown, others, 'up')), '0,4');
});

test('from a top bar, Down goes to the nearest card across, not a far one', () => {
  const bar = [
    { id: 'home', rect: { left: 700, top: 46, width: 110, height: 84 } },
    { id: 'shows', rect: { left: 860, top: 46, width: 110, height: 84 } },
    { id: 'movies', rect: { left: 1010, top: 46, width: 110, height: 84 } },
  ];
  const cards = grid(1, 20).map((c) => ({ id: c.id, rect: Object.assign({}, c.rect, { top: 600 }) }));
  const all = bar.concat(cards);
  const from = at(all, 'shows');
  const best = pickNext(from.rect, all.filter((c) => c !== from), 'down');
  assert.ok(/^0,/.test(best.id));
  const expected = cards.map((c) => ({ c, d: Math.abs(rectOf(c.rect).cx - rectOf(from.rect).cx) })).reduce((a, b) => (b.d < a.d ? b : a)).c.id;
  assert.equal(best.id, expected);
  // and Up from a card returns to the bar item above it
  const card = at(all, '0,5');
  const up = pickNext(card.rect, all.filter((c) => c !== card), 'up');
  assert.ok(bar.some((b) => b.id === up.id));
});

test('irregular layout: a wide button over two chips; Down from either half picks the chip below it', () => {
  const layout = [
    { id: 'play', rect: { left: 100, top: 100, width: 400, height: 70 } },
    { id: 'chipA', rect: { left: 100, top: 220, width: 190, height: 48 } },
    { id: 'chipB', rect: { left: 310, top: 220, width: 190, height: 48 } },
  ];
  const play = layout[0];
  const others = layout.slice(1);
  assert.equal(id(pickNext(Object.assign({}, play.rect, { width: 150 }), others, 'down')), 'chipA');
  assert.equal(id(pickNext({ left: 330, top: 100, width: 150, height: 70 }, others, 'down')), 'chipB');
  assert.equal(id(pickNext(layout[1].rect, [layout[0], layout[2]], 'right')), 'chipB');
  assert.equal(id(pickNext(layout[1].rect, [layout[0], layout[2]], 'up')), 'play');
});

test('candidates in the beam beat nearer ones that are off to the side', () => {
  const from = { left: 0, top: 0, width: 100, height: 100 };
  const near = { id: 'near-off', rect: { left: 120, top: 400, width: 100, height: 100 } }; // right of us, but a row down
  const far = { id: 'far-inline', rect: { left: 600, top: 10, width: 100, height: 80 } };   // in our row
  assert.equal(id(pickNext(from, [near, far], 'right')), 'far-inline');
});

test('nothing is "beyond" when candidates overlap the origin or lie behind', () => {
  const from = { left: 200, top: 200, width: 100, height: 100 };
  const behind = [{ id: 'l', rect: { left: 0, top: 200, width: 100, height: 100 } }];
  assert.equal(pickNext(from, behind, 'right'), null);
  assert.equal(pickNext(from, [], 'down'), null);
  assert.equal(pickNext(from, [{ id: 'same', rect: from }], 'right'), null);
  assert.equal(pickNext(from, behind, 'sideways'), null);
});

test('ties go to the earlier candidate (document order)', () => {
  const from = { left: 0, top: 0, width: 100, height: 100 };
  const a = { id: 'a', rect: { left: 200, top: 0, width: 100, height: 100 } };
  const b = { id: 'b', rect: { left: 200, top: 0, width: 100, height: 100 } };
  assert.equal(id(pickNext(from, [a, b], 'right')), 'a');
  assert.equal(id(pickNext(from, [b, a], 'right')), 'b');
});

test('scoreOf prefers nearer along the axis, then more centred across it', () => {
  const f = rectOf({ left: 0, top: 0, width: 100, height: 100 });
  const nearer = rectOf({ left: 150, top: 0, width: 100, height: 100 });
  const farther = rectOf({ left: 400, top: 0, width: 100, height: 100 });
  assert.ok(scoreOf(f, nearer, 'right') < scoreOf(f, farther, 'right'));
  const centred = rectOf({ left: 150, top: 0, width: 100, height: 100 });
  const lower = rectOf({ left: 150, top: 60, width: 100, height: 100 });
  assert.ok(scoreOf(f, centred, 'right') < scoreOf(f, lower, 'right'));
});

test('topLeftMost: top row first, then leftmost; null for none', () => {
  const g = grid(3, 4);
  assert.equal(id(topLeftMost(g)), '0,0');
  assert.equal(id(topLeftMost(g.slice(5))), '1,1');
  assert.equal(topLeftMost([]), null);
});
