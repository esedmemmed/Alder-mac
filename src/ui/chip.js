/* A persistent choice (Screen.chip): glass, a tungsten dot while selected, brighter face on focus. */
import { h, cls } from '../lib/dom.js';

export function chip(label, { selected = false, onClick = null, className = '' } = {}) {
  const el = h('div', { class: cls('chip', selected && 'on', className), 'data-focus': '', tabindex: '-1', role: 'button' });
  const api = {
    el,
    /** TextView.select: the dot and full-strength words when [on]. */
    select(on) {
      el.classList.toggle('on', !!on);
      el.textContent = '';
      if (on) el.appendChild(h('span', { class: 'dot' }, '•'));
      el.appendChild(h('span', { class: 'label' }, label));
    },
  };
  api.select(selected);
  if (onClick) el.addEventListener('click', onClick);
  return api;
}

/** A quiet outlined tag beside a name (Screen.tag). */
export function tag(label, { accent = false } = {}) {
  return h('span', { class: cls('tag', accent && 'accent') }, label);
}

/** "[OK] Play / pause": the key in a small box, then what it does (Screen.keyHint). */
export function keyHint(key, does) {
  return h('span', { class: 'keyhint' }, h('span', { class: 'key' }, key), h('span', null, does));
}
