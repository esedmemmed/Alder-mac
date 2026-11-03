/*
 * DOM pieces the 4B screens share (Screen.kt helpers they use): the clock, the art and its shades (setWindowed), the error
 * card (failed), the spinner (ring), a text-entry dialog, and the small glyph buttons. Styles: screens-b.css.
 */
import { h } from '../../lib/dom.js';
import { IS_DEV } from '../../lib/env.js';
import { iconSvg } from '../icons.js';
import '../navhl.js'; // Search's top bar slides its focus highlight too (installs itself)
import { sharp } from '../../lib/images.js';
import { wallClockText } from '../../player/controls.js';

/** The top-right clock: the real time, or ?clock= in dev builds (screenshots). Returns { el, stop }. */
export function clock() {
  const fixed = IS_DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('clock') : null;
  const read = () => fixed || wallClockText(new Date());
  const el = h('div', { class: 'b-clock' }, read());
  const timer = fixed ? null : setInterval(() => { el.textContent = read(); }, 30000);
  return { el, stop() { if (timer) clearInterval(timer); } };
}

/** The shades Alder's setWindowed lays over art: dark at the left and bottom for text, a hint at the top, a soft vignette. */
export function shades({ left = true } = {}) {
  return h('div', { class: 'b-shades' }, left ? h('div', { class: 'b-shade-left' }) : null, h('div', { class: 'b-shade-rest' }));
}

/**
 * A full-screen picture that fades in when it is there, and cross-fades from the one before it (a screen that follows the
 * focused title). images: context.images. Returns { el, set(url, {orElse, onDone, onFail}), dim(on) }.
 */
export function artLayer(images, { width = 1920 } = {}) {
  const back = h('img', { class: 'b-art on', alt: '' });
  const front = h('img', { class: 'b-art', alt: '' });
  const el = h('div', { class: 'b-artwrap' }, back, front);
  let current = null;
  return {
    el,
    set(url, { orElse = null, onDone = null, onFail = null } = {}) {
      const pick = url || orElse;
      if (!pick) { if (onFail) onFail(); return; }
      if (current === pick) return;
      current = pick;
      if (front.classList.contains('on') && front.getAttribute('src')) { back.src = front.getAttribute('src'); back.classList.add('on'); }
      front.classList.remove('on');
      images.load(front, url ? sharp(url, width) : null, {
        urgent: true,
        orElse: orElse ? sharp(orElse, width) : null,
        onDone() { front.classList.add('on'); if (onDone) onDone(); },
        onFail() { if (onFail) onFail(); },
      });
    },
    /** Steps the picture back (the episode guide) or forward again. */
    dim(on) { el.classList.toggle('dim', !!on); },
  };
}

/**
 * Scrolls [inner] inside [clip] just far enough that [row] is whole (a ScrollView's behaviour). [state] holds { y }. The
 * rows' offsetTop is read against [inner], which must be positioned. Moves with transform only.
 */
export function keepVisible(clip, inner, row, state, rowHeight = row.offsetHeight) {
  const view = clip.clientHeight || 640;
  const top = row.offsetTop;
  if (top < state.y) state.y = top;
  else if (top + rowHeight > state.y + view) state.y = top + rowHeight - view;
  inner.style.transform = 'translate3d(0,' + (-state.y) + 'px,0)';
}

/** The spinner (Screen.ring). */
export const ring = () => h('div', { class: 'b-ring' });

/** One glass error card with a plain message and a next action (Screen.failed). Returns the element; its button is `.pill`. */
export function failedCard(message, retry, label = 'Try again') {
  const btn = h('div', { class: 'pill b-retry', 'data-focus': '', tabindex: '-1', role: 'button' }, h('span', { class: 'label' }, label), h('span', { class: 'rim' }));
  btn.addEventListener('click', retry);
  return h('div', { class: 'b-failed' }, h('div', { class: 'serif b-failed-mark' }, '!'), h('div', { class: 'b-failed-text' }, message), btn);
}

/** A glass round button with an inline glyph/icon. */
export function glyphButton(svgHtml, { label = '', onClick = null, onHold = null } = {}) {
  const el = h('div', { class: 'btn-round', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': label || null },
    h('span', { class: 'icon', html: svgHtml }));
  if (onClick) el.addEventListener('click', onClick);
  if (onHold) el.addEventListener('alder:hold', onHold);
  return el;
}

/** Material "replay" (Start over): replay10's arrow without the 10. */
export const REPLAY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true"><path d="M12,5V1L7,6l5,5V7c3.31,0 6,2.69 6,6s-2.69,6 -6,6 -6,-2.69 -6,-6H4c0,4.42 3.58,8 8,8s8,-3.58 8,-8 -3.58,-8 -8,-8z"/></svg>';

export const icon = (name) => iconSvg(name);

/** The small IMDb tag beside a rating (Screen.imdbTag). */
export const imdbTag = () => h('span', { class: 'b-imdb' }, 'IMDb');

/** The avatar disc with the profile's initial (Alder's top-left glass circle). */
export function avatar(profile) {
  return h('div', { class: 'avatar b-avatar', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': 'Profile' }, profile && profile.name ? profile.name.charAt(0).toUpperCase() : 'A');
}

/**
 * A text-entry dialog (Alder's Add-on address dialog): a title, one field, Cancel and the confirming button. The field is a
 * real <input>, so the TV's own keyboard opens when OK is pressed on it. OK on the field never submits (it opens the keyboard);
 * the keyboard's Done key does (the IME sends 65376), and the "Add" button always does.
 * ctx: { overlayHost, engine, router }. Returns { close }.
 */
export function openTextDialog(ctx, { title, placeholder = '', confirm = 'Add', cancel = 'Cancel', value = '', onSubmit, onClose = null }) {
  const { overlayHost, engine, router } = ctx;
  let closed = false;
  const field = h('input', { class: 'b-field', type: 'text', 'data-focus': '', tabindex: '-1', placeholder, value, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
  const cancelBtn = h('div', { class: 'chip', 'data-focus': '', tabindex: '-1', role: 'button' }, h('span', { class: 'label' }, cancel));
  const okBtn = h('div', { class: 'pill', 'data-focus': '', tabindex: '-1', role: 'button' }, h('span', { class: 'label' }, confirm), h('span', { class: 'rim' }));
  const panel = h('div', { class: 'panel b-dialog', role: 'dialog' },
    h('div', { class: 'bold' }, title), field,
    h('div', { class: 'b-dialog-actions' }, cancelBtn, okBtn));
  const scrim = h('div', { class: 'scrim' }, panel);
  overlayHost.appendChild(scrim);
  void scrim.offsetWidth;
  scrim.classList.add('on');

  function submit() { const v = field.value.trim(); close(); if (onSubmit) onSubmit(v); }
  function close() {
    if (closed) return;
    closed = true;
    removeOverlay();
    engine.popScope();
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    if (onClose) onClose();
  }
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', submit);
  field.addEventListener('keydown', (e) => { if (e.keyCode === 65376) { e.preventDefault(); okBtn.focus(); } }); // IME "Done": on to the button
  field.addEventListener('click', () => field.focus());

  const removeOverlay = router.pushOverlay((evt) => {
    if (evt.type !== 'press') return true;
    if (evt.action === 'back') {
      if (evt.event && evt.event.keyCode === 8 && document.activeElement === field && field.value) return false; // a keyboard's Backspace edits
      close(); return true;
    }
    if (evt.action === 'up' || evt.action === 'down' || evt.action === 'left' || evt.action === 'right') {
      if (document.activeElement === field && (evt.action === 'left' || evt.action === 'right')) return false; // the caret
      engine.move(evt.action); return true;
    }
    if (evt.action === 'ok') { if (document.activeElement === field) { field.focus(); return false; } engine.press(); return true; }
    return false; // typed digits and the like reach the field
  });
  engine.pushScope(panel, { focus: field });
  return { close, field };
}
