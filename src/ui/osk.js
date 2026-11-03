/*
 * Typing with a remote: a text field and an on-screen keyboard (Alder's name entry in ProfilesActivity, plus an e-mail layout for
 * the Stremio sign-in fallback). Every key is a focusable tile, so Left / Right / Up / Down and OK work as everywhere else.
 *
 *   const field = createTextField({ placeholder, password, maxLength, onChange })
 *   const osk = createOsk({ field, layout: 'name' | 'email', submitLabel, onSubmit })
 *   osk.setShift(true)                one capital for the next letter (names start with one; Alder turns it on while the box is empty)
 *   osk.firstKey                      what to focus first
 *   typeFromKeyboard(field, osk)      letters from a USB / Bluetooth keyboard go to the field too; returns the remover
 *
 * The field is a real <input>, read-only while the keyboard types into it, so a TV's own IME (the keyboard key) can take over
 * when the person asks for it: Alder's "⌨" key does the same with Android's soft keyboard.
 */
import { h } from '../lib/dom.js';

export function createTextField({ placeholder = '', password = false, maxLength = 64, onChange = null, className = '' } = {}) {
  const input = h('input', {
    class: 'osk-input', type: password ? 'password' : 'text', placeholder, maxlength: maxLength, readonly: '',
    spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', tabindex: '-1',
  });
  const el = h('div', { class: 'osk-field ' + className }, input);
  let editing = false;
  let done = null;

  const changed = () => { if (onChange) onChange(input.value); };
  input.addEventListener('input', changed);

  const api = {
    el, input,
    get value() { return input.value; },
    set(v) { input.value = v; changed(); },
    append(ch) { if (input.value.length < maxLength) { input.value += ch; changed(); } },
    backspace() { if (input.value.length) { input.value = input.value.slice(0, -1); changed(); } },
    get editing() { return editing; },
    /** Hands the field to the TV's own keyboard until Enter or Back; [then] is called after. */
    edit(then) {
      editing = true;
      done = then || null;
      input.removeAttribute('readonly');
      el.classList.add('editing');
      input.focus();
    },
    stopEditing() {
      if (!editing) return;
      editing = false;
      input.setAttribute('readonly', '');
      el.classList.remove('editing');
      input.blur();
      const cb = done; done = null;
      if (cb) cb();
    },
  };
  input.addEventListener('keydown', (e) => { if (editing && e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); api.stopEditing(); } });
  return api;
}

const NAME_ROWS = 'abcdefghijklmnopqrstuvwxyz'.match(/.{1,6}/g);
const EMAIL_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl.', 'zxcvbnm@_-'];

export function createOsk({ field, layout = 'name', submitLabel = null, onSubmit = null, className = '' }) {
  const keys = [];
  const letterKeys = [];
  let shift = false;

  function key(label, row, { weight = 1, aria = null, action }) {
    const el = h('div', { class: 'osk-key', 'data-focus': '', tabindex: '-1', role: 'button', 'aria-label': aria || null, style: { flexGrow: String(weight) } }, label);
    el.addEventListener('click', action);
    row.appendChild(el);
    keys.push(el);
    return el;
  }

  function setShift(on) {
    shift = !!on;
    letterKeys.forEach((k) => { k.textContent = shift ? k.textContent.toUpperCase() : k.textContent.toLowerCase(); });
    if (shiftKey) shiftKey.classList.toggle('on', shift);
  }
  let shiftKey = null;

  const letter = (ch, row) => {
    const k = key(ch, row, { action: () => { field.append(shift ? ch.toUpperCase() : ch); if (shift && layout === 'name') setShift(false); } });
    if (/[a-z]/.test(ch)) letterKeys.push(k);
    return k;
  };

  const el = h('div', { class: 'osk glass ' + className });
  const row = () => { const r = h('div', { class: 'osk-row' }); el.appendChild(r); return r; };

  if (layout === 'name') {
    NAME_ROWS.forEach((letters) => {
      const r = row();
      letters.split('').forEach((c) => letter(c, r));
      for (let i = letters.length; i < 6; i++) r.appendChild(h('div', { class: 'osk-key blank' })); // "yz" keeps the grid
    });
    const r = row();
    shiftKey = key('⇧', r, { aria: 'Shift', action: () => setShift(!shift) });
    key('SPACE', r, { weight: 3, action: () => field.append(' ') });
    key('⌫', r, { aria: 'Delete', action: () => field.backspace() });
    key('⌨', r, { aria: 'TV keyboard', action: () => field.edit(() => { if (keys[0]) keys[0].focus({ preventScroll: true }); }) });
  } else {
    EMAIL_ROWS.forEach((chars) => { const r = row(); chars.split('').forEach((c) => letter(c, r)); });
    const r = row();
    key('.com', r, { weight: 2, action: () => { field.append('.com'); } });
    key('⌫', r, { weight: 2, aria: 'Delete', action: () => field.backspace() });
    key('⌨', r, { weight: 2, aria: 'TV keyboard', action: () => field.edit(() => { if (keys[0]) keys[0].focus({ preventScroll: true }); }) });
    if (submitLabel) key(submitLabel, r, { weight: 3, action: () => { if (onSubmit) onSubmit(); } });
  }

  return { el, keys, get firstKey() { return keys[0]; }, setShift, get shift() { return shift; } };
}

/** Letters, digits and punctuation from a physical keyboard go to [field]. Returns a function that stops listening. */
export function typeFromKeyboard(field, osk = null, target = typeof window !== 'undefined' ? window : null) {
  if (!target) return () => {};
  const onKey = (e) => {
    if (field.editing || e.ctrlKey || e.altKey || e.metaKey || typeof e.key !== 'string' || e.key.length !== 1) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    field.append(e.key);
    if (osk && osk.shift) osk.setShift(false);
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
