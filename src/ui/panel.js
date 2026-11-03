/*
 * A short list to pick from (a menu, a genre, a yes or no), on glass with tungsten focus: Alder's Screen.choose().
 * [checked] gets a tick (the choice in use); focus starts on [focus].
 *
 * openPanel(ctx, { title, message, items: [string | {label, hint}], checked, focus, onPick, onClose })
 *   ctx: { overlayHost, engine, router } from the shell. Back closes it (the router offers it keys first).
 */
import { h } from '../lib/dom.js';
import { iconSvg } from './icons.js';

export function openPanel(ctx, { title, message = null, items, checked = -1, focus = Math.max(checked, 0), onPick = null, onClose = null }) {
  const { overlayHost, engine, router } = ctx;
  let closed = false;

  const rows = items.map((item, i) => {
    const label = typeof item === 'string' ? item : item.label;
    const hint = typeof item === 'string' ? null : item.hint;
    const row = h('div', { class: 'row-item', 'data-focus': '', tabindex: '-1', role: 'menuitem', 'data-i': i },
      h('span', { class: 'grow' }, label),
      hint ? h('span', { class: 't-3 t-small' }, hint) : null,
      i === checked ? h('span', { class: 'icon', html: iconSvg('check') }) : null);
    row.addEventListener('click', () => { close(); if (onPick) onPick(i); });
    return row;
  });

  const words = h('div', { class: 'panel-words' }, h('div', { class: 'bold' }, title),
    message ? h('div', { class: 'message t-small t-2' }, message) : null);
  const panel = h('div', { class: 'panel', role: 'menu' }, words, h('div', { class: 'panel-list' }, rows));
  const scrim = h('div', { class: 'scrim' }, panel);
  overlayHost.appendChild(scrim);
  void scrim.offsetWidth;
  scrim.classList.add('on');

  const removeOverlay = router.pushOverlay((evt) => {
    if (evt.type === 'press' && evt.action === 'back') { close(); return true; }
    if (evt.type === 'press' && (evt.action === 'up' || evt.action === 'down')) { engine.move(evt.action); return true; }
    if (evt.type === 'press' && evt.action === 'ok') { engine.press(); return true; }
    return true; // a dialog takes every key
  });
  engine.pushScope(panel, { focus: rows[Math.min(focus, rows.length - 1)] || true });

  function close() {
    if (closed) return;
    closed = true;
    removeOverlay();
    engine.popScope();
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    if (onClose) onClose();
  }

  return { close, el: scrim };
}
