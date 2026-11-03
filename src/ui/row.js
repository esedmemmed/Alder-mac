/*
 * A row of cards, virtualised horizontally (PLAN.md section 2: at most ~150 card DOM nodes alive per page):
 * only the cards within [buffer] screens of the visible part exist; the others are created as the row scrolls
 * and removed once well past. The track moves with transform only.
 *
 * Alder's rows are Android views (MainActivity "Row"): the same shape (a caps heading, cards, the selected index
 * remembered). Moving Up or Down lands on the same index in the next row (MainActivity.dispatchKeyEvent: `next.cards[
 * min(current.selected, next.cards.lastIndex)]`); enter() below is that rule, registered with the focus engine.
 *
 * Coordinates: card i sits at x = i * step in the track; the track's left edge is at screen x = padLeft; `scroll` is
 * how far the track has moved left.
 */
import { h } from '../lib/dom.js';
import { createCard, disposeCard } from './card.js';

/**
 * Where to scroll so card [index] is fully visible: unchanged when it already is, else just far enough (the first
 * card at the left edge, the last with [safeRight] px to spare). Clamped to the row's ends.
 */
export function scrollFor({ index, scroll, step, itemWidth, viewport, count, safeRight = 0 }) {
  const left = index * step;
  const right = left + itemWidth;
  let s = scroll;
  if (left < s) s = left;
  else if (right > s + viewport - safeRight) s = right - viewport + safeRight;
  const max = Math.max(0, (count - 1) * step + itemWidth - (viewport - safeRight));
  return Math.max(0, Math.min(max, s));
}

/** The cards to keep mounted: [from, to) covering the visible part plus [buffer] viewports each side. */
export function windowRange({ scroll, viewport, step, count, buffer }) {
  const b = viewport * buffer;
  const from = Math.min(count, Math.max(0, Math.floor((scroll - b) / step)));
  const to = Math.min(count, Math.ceil((scroll + viewport + b) / step));
  return [from, Math.max(from, to)];
}

/**
 * Alder's Home rows: the focused card slides to the row's start, where the eye already is, one card per press; near the end
 * the row stops, so the last card rests at the right margin (MainActivity Row.focus). [safeRight] is that margin.
 */
export function slideFor({ index, step, itemWidth, viewport, count, safeRight = 0 }) {
  const max = Math.max(0, (count - 1) * step + itemWidth - (viewport - safeRight));
  return Math.max(0, Math.min(index * step, max));
}

export function createRow({
  title = '', items = [], images = null, itemWidth = 176, itemHeight = 264, gap = 28, padLeft = 96, safeRight = 48,
  screenWidth = 1920, buffer = 0.75, name = '', renderItem = null, onSelect = null, onHold = null, onFocusItem = null,
  viewportTop = 102, className = '', slide = false,
}) {
  const step = itemWidth + gap;
  const viewport = screenWidth - padLeft;
  const render = renderItem || ((item, i, box) => createCard(item, i, box, images));
  const mounted = new Map();
  let selected = 0;
  let scroll = 0;

  const heading = h('div', { class: 'row-heading caps' }, title);
  const track = h('div', { class: 'row-track' });
  const strip = h('div', { class: 'row-viewport', style: { top: viewportTop + 'px', height: itemHeight + 'px' } }, track);
  const el = h('div', { class: 'row' + (className ? ' ' + className : ''), 'data-focus-group': name || title || 'row', style: { height: viewportTop + itemHeight + 'px' } }, heading, strip);

  function mount(i) {
    if (i < 0 || i >= items.length || mounted.has(i)) return mounted.get(i) || null;
    const card = render(items[i], i, { left: i * step, width: itemWidth, height: itemHeight });
    track.appendChild(card);
    mounted.set(i, card);
    return card;
  }

  function unmount(i) {
    const card = mounted.get(i);
    if (!card) return;
    disposeCard(card, images);
    if (card.parentNode) card.parentNode.removeChild(card);
    mounted.delete(i);
  }

  /** Mounts what is near the visible part and drops what is far (never the selected card, which holds focus). */
  function update() {
    const [from, to] = windowRange({ scroll, viewport, step, count: items.length, buffer });
    Array.from(mounted.keys()).forEach((i) => { if ((i < from || i >= to) && i !== selected) unmount(i); });
    // Right to left: the image loader serves the newest request first, so the leftmost (visible) card's picture is asked for last
    // and arrives first. Cards are placed by `left`, so their order in the DOM does not matter (the focused one has a z-index).
    for (let i = to - 1; i >= from; i--) mount(i);
  }

  function place(animate) {
    if (!animate) track.style.transition = 'none';
    track.style.transform = 'translate3d(' + (-scroll) + 'px,0,0)';
    if (!animate) { void track.offsetWidth; track.style.transition = ''; }
  }

  function reveal(i, animate) {
    const s = slide
      ? slideFor({ index: i, step, itemWidth, viewport, count: items.length, safeRight })
      : scrollFor({ index: i, scroll, step, itemWidth, viewport, count: items.length, safeRight });
    if (s !== scroll) { scroll = s; place(animate); }
    update();
  }

  el.addEventListener('focusin', (e) => {
    const card = e.target.closest ? e.target.closest('.card') : null;
    if (!card || card.parentNode !== track) return;
    const i = Number(card.getAttribute('data-index'));
    selected = i;
    reveal(i, true);
    if (onFocusItem) onFocusItem(items[i], i, card);
  });
  const fire = (cb) => (e) => {
    const card = e.target.closest ? e.target.closest('.card') : null;
    if (!card || !cb) return;
    const i = Number(card.getAttribute('data-index'));
    cb(items[i], i, card);
  };
  el.addEventListener('click', fire((item, i, card) => { if (onSelect) onSelect(item, i, card); }));
  el.addEventListener('alder:hold', fire((item, i, card) => { if (onHold) onHold(item, i, card); }));

  const api = {
    el,
    get selected() { return selected; },
    get count() { return items.length; },
    get scroll() { return scroll; },
    get step() { return step; },
    get padLeft() { return padLeft; },
    get length() { return items.length; },
    mountedCount: () => mounted.size,
    cardAt: (i) => mounted.get(i) || null,
    itemAt: (i) => items[i],
    setHeading(text) { heading.textContent = text; },

    /** Replaces the cards (a catalogue loaded, a genre chosen). The selected index is kept when it still exists. */
    setItems(next) {
      Array.from(mounted.keys()).forEach(unmount);
      items = next;
      selected = Math.max(0, Math.min(selected, items.length - 1));
      scroll = slide ? slideFor({ index: selected, step, itemWidth, viewport, count: items.length, safeRight })
        : scrollFor({ index: selected, scroll: 0, step, itemWidth, viewport, count: items.length, safeRight });
      place(false);
      update();
    },

    /**
     * A fresh answer for the same row, patched in: a card stays when the very same item is still at its place, only the others
     * are made again (or dropped). [next] reuses the old item objects for titles that did not change (home-model mergeItems), so
     * a refresh that changes nothing touches no card, and one that changes a title redraws that card, not the row. The selected
     * index is kept; when its card is gone, the caller puts focus back (focusIndex).
     */
    patch(next) {
      const prev = items;
      items = next;
      Array.from(mounted.keys()).forEach((i) => { if (i >= items.length || prev[i] !== items[i]) unmount(i); });
      selected = Math.max(0, Math.min(selected, items.length - 1));
      const s = slide ? slideFor({ index: selected, step, itemWidth, viewport, count: items.length, safeRight })
        : scrollFor({ index: selected, scroll, step, itemWidth, viewport, count: items.length, safeRight });
      if (s !== scroll) { scroll = s; place(false); }
      update();
    },

    /** More cards after the last one (a catalog's next page). The selected card and the scroll stay as they are. */
    append(extra) {
      if (!extra.length) return;
      items = items.concat(extra);
      // The slide was clamped to the old end: with more cards in, the focused one can reach the start.
      if (slide) reveal(selected, true); else update();
    },

    /** Makes card [i] visible without animating and returns it (mounting it first). */
    ensure(i) {
      const k = Math.max(0, Math.min(items.length - 1, i));
      selected = k;
      reveal(k, false);
      return mount(k);
    },

    /** Focuses card [i]. */
    focusIndex(i) {
      const card = api.ensure(i);
      if (card) card.focus({ preventScroll: true });
      return card;
    },

    /** The focus engine's way into this row: the same index as the row focus came from, else the remembered one. */
    group: {
      contain: 'x',
      enter({ from }) {
        let i = selected;
        if (from && from.getAttribute && from.getAttribute('data-index') !== null && from.closest && from.closest('.row') !== el) {
          i = Number(from.getAttribute('data-index'));
        }
        return api.ensure(i);
      },
    },

    destroy() { Array.from(mounted.keys()).forEach(unmount); },
  };

  api.setItems(items);
  return api;
}
