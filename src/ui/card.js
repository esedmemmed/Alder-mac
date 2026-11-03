/*
 * A poster card (Alder's card in MainActivity): the picture, a progress bar when it is partly watched, a tick when
 * it is watched, and the tungsten rim and glow when focused (CSS). Absolutely positioned by its row.
 *
 * item: { id, name, poster, progress (0..1, optional), watched (bool, optional) }
 * box:  { left, width, height } in px inside the row's track
 */
import { h } from '../lib/dom.js';
import { iconEl } from './icons.js';

export function progressBar(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return h('div', { class: 'progress' }, h('i', { style: { width: (p * 100).toFixed(1) + '%' } }));
}

export function createCard(item, index, box, images) {
  const img = h('img', { class: 'card-img', alt: '' });
  const el = h('div', {
    class: 'card', 'data-focus': '', tabindex: '-1', 'data-index': index,
    style: { left: box.left + 'px', width: box.width + 'px', height: box.height + 'px' },
  },
  h('div', { class: 'card-clip' }, img, h('div', { class: 'card-name' }, item.name || '')),
  item.progress > 0 ? progressBar(item.progress) : null,
  item.watched ? h('div', { class: 'card-check' }, iconEl('check', 28)) : null,
  h('span', { class: 'rim' }));
  el._img = img;
  if (images && item.poster) {
    images.load(img, item.poster, {
      onDone() { img.classList.add('on'); el.classList.add('has-img'); },
    });
  }
  return el;
}

/** Called when a card leaves the DOM: its picture no longer matters. */
export function disposeCard(el, images) {
  if (images && el._img) images.cancel(el._img);
}
