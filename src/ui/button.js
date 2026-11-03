/* The warm-white primary action and the round icon button (Screen.pill and the buttons beside Play). */
import { h, cls } from '../lib/dom.js';
import { iconSvg } from './icons.js';

/** pill('Play', { icon: 'play', onClick }) */
export function pill(label, { icon = null, onClick = null, onHold = null, className = '' } = {}) {
  const el = h('div', { class: cls('pill', icon && 'has-icon', className), 'data-focus': '', tabindex: '-1', role: 'button' },
    icon ? h('span', { class: 'icon', html: iconSvg(icon) }) : null,
    h('span', { class: 'label' }, label),
    h('span', { class: 'rim' }));
  if (onClick) el.addEventListener('click', onClick);
  if (onHold) el.addEventListener('alder:hold', onHold);
  return el;
}

/** roundButton('check', { label: 'In My List', onClick }) */
export function roundButton(icon, { label = '', onClick = null, onHold = null, className = '' } = {}) {
  const el = h('div', { class: cls('btn-round', className), 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': label || null },
    h('span', { class: 'icon', html: iconSvg(icon) }));
  if (onClick) el.addEventListener('click', onClick);
  if (onHold) el.addEventListener('alder:hold', onHold);
  return el;
}
