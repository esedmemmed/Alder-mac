/*
 * Mac text entry, for the module swap in scripts/build.mjs (npm run build:mac): same exports as src/ui/osk.js, but the field is a
 * native <input> (typing, paste, Backspace, Tab all the browser's own) and the on-screen keyboard never shows.
 * createOsk answers an empty hidden element; Return in the field calls its onSubmit.
 */
import { h } from '../../lib/dom.js';

export function createTextField({ placeholder = '', password = false, maxLength = 64, onChange = null, className = '' } = {}) {
  const input = h('input', {
    class: 'osk-input', type: password ? 'password' : 'text', placeholder, maxlength: maxLength,
    spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'data-focus': '', tabindex: '0',
  });
  const el = h('div', { class: 'osk-field osk-native ' + className }, input);
  const changed = () => { if (onChange) onChange(input.value); };
  input.addEventListener('input', changed);
  return {
    el, input,
    get value() { return input.value; },
    set(v) { input.value = v; changed(); },
    append(ch) { if (input.value.length < maxLength) { input.value += ch; changed(); } },
    backspace() { if (input.value.length) { input.value = input.value.slice(0, -1); changed(); } },
    get editing() { return false; },
    edit(then) { input.focus(); if (then) then(); },
    stopEditing() {},
  };
}

export function createOsk({ field, onSubmit = null } = {}) {
  const el = h('div', { class: 'osk-none', hidden: true });
  if (onSubmit) field.input.addEventListener('keydown', (e) => { if (e.keyCode === 13) { e.preventDefault(); onSubmit(); } });
  return { el, keys: [], firstKey: field.input, setShift() {}, shift: false };
}

/** A physical keyboard types into the focused native field itself. */
export function typeFromKeyboard() { return () => {}; }
