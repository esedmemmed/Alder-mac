/*
 * A PIN for a TV remote (Alder's askPin): four boxes. Up and Down turn the digit in the box the remote is on, Left and Right move
 * between boxes (Right only once the box has a digit), the number keys type a digit and move on, and OK, or the fourth number key,
 * hands the PIN to [check]. A refusal shakes the boxes, clears them and says why.
 *
 *   const pin = createPinEntry({ title, errorMessage, check(pin) -> boolean })     check true: accepted (the caller moves on)
 *   pin.el        the whole block         pin.firstKey   what to focus first
 *   pin.key(evt)  a router key event: arrows, digits and OK; Back is left to the caller; returns handled
 *   pin.entry     the digits typed so far
 */
import { h } from '../lib/dom.js';
import { isDigit } from '../lib/keys.js';

export const PIN_LENGTH = 4;

/** The wheel rules without the DOM (Alder: `digits` and `at` in askPin). -1 is an empty box. */
export function createPinState(length = PIN_LENGTH) {
  const digits = new Array(length).fill(-1);
  let at = 0;
  return {
    length,
    get at() { return at; },
    get value() { return digits.filter((d) => d >= 0).join(''); },
    get complete() { return digits.every((d) => d >= 0); },
    up() { digits[at] = (digits[at] + 1) % 10; },
    down() { digits[at] = digits[at] <= 0 ? 9 : digits[at] - 1; },
    left() { at = Math.max(0, at - 1); },
    right() { if (digits[at] >= 0) at = Math.min(length - 1, at + 1); },
    /** A typed digit fills the box and moves on; true when it was the last box (the PIN is ready). */
    type(d) {
      digits[at] = Number(d);
      if (at < length - 1) { at++; return false; }
      return true;
    },
    clear() { digits.fill(-1); at = 0; },
    /** What a box shows: nothing, the digit it is on, or a dot. */
    shown(i) { return digits[i] < 0 ? '' : i === at ? String(digits[i]) : '\u2022'; },
  };
}

export function createPinEntry({ title, errorMessage = 'Incorrect PIN. Try again.', check, subtitle = null }) {
  const state = createPinState();
  const boxes = Array.from({ length: PIN_LENGTH }, () => h('div', { class: 'pin-box' }));
  const row = h('div', { class: 'pin-boxes', 'data-focus': '', tabindex: '-1' }, boxes);
  const error = h('div', { class: 't-body pin-error' }, '');

  function draw() {
    boxes.forEach((b, i) => {
      b.textContent = state.shown(i);
      b.classList.toggle('now', i === state.at);
    });
  }

  function shake() {
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  function submit() {
    if (!state.complete) return;
    if (check(state.value)) return;
    state.clear();
    draw();
    error.textContent = errorMessage;
    shake();
  }

  draw();
  const el = h('div', { class: 'pin' },
    h('div', { class: 't-title bold' }, title),
    subtitle ? h('div', { class: 't-body t-2 pin-sub' }, subtitle) : null,
    row, error,
    h('div', { class: 't-small t-2 pin-hint' }, '\u25B2 \u25BC change a digit    \u25C0 \u25B6 move    OK to confirm'));

  return {
    el,
    firstKey: row,
    get entry() { return state.value; },
    key(evt) {
      if (evt.type !== 'press') return false;
      const a = evt.action;
      if (a === 'ok') { submit(); return true; }
      if (a !== 'up' && a !== 'down' && a !== 'left' && a !== 'right' && !isDigit(a)) return false;
      error.textContent = '';
      if (a === 'up') state.up();
      else if (a === 'down') state.down();
      else if (a === 'left') state.left();
      else if (a === 'right') state.right();
      else if (state.type(a)) { draw(); submit(); return true; }
      draw();
      return true;
    },
  };
}
