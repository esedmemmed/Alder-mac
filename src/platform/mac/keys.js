/*
 * Mac keys, for the module swap in scripts/build.mjs (npm run build:mac): same exports as src/lib/keys.js, no registration.
 * Esc = back, Return = OK, arrows move, F = fullscreen (player), E = save the report (Diagnostics). Backspace and Space are Back and Play/Pause only while no text field has focus.
 */
import { createKeyDispatcher, isDigit, HOLD_MS } from '../../lib/keys.js';

export { createKeyDispatcher, isDigit, HOLD_MS };

export const KEY_ACTIONS = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down',
  13: 'ok',
  27: 'back', 8: 'back',
  32: 'playpause',
  221: 'ff', 219: 'rw',
  70: 'fullscreen', // F: the player screen
  69: 'export', // E: the Diagnostics screen saves its report
};
for (let d = 0; d <= 9; d++) { KEY_ACTIONS[48 + d] = String(d); KEY_ACTIONS[96 + d] = String(d); }

/** The Mac needs no keys registered. */
export const REGISTER_KEYS = [];

export function actionFor(keyCode) {
  return Object.prototype.hasOwnProperty.call(KEY_ACTIONS, keyCode) ? KEY_ACTIONS[keyCode] : null;
}

/** Nothing to register on the Mac: answers an empty list. */
export function registerKeys() { return []; }

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/**
 * Same contract as lib/keys.js attachKeys. While a text field has focus only up / down / OK / Back (Esc) reach the app;
 * Backspace, Space and the rest stay the field's own.
 */
export function attachKeys({ target, onAction, holdMs = HOLD_MS, timers, isTyping = (e) => isTypingTarget(e.target) }) {
  const dispatcher = createKeyDispatcher({ emit: onAction, holdMs, timers });
  const TYPING_OK = { up: 1, down: 1, ok: 1, back: 1 };

  function resolve(e) {
    const action = actionFor(e.keyCode);
    if (!action) return null;
    if ((action === 'fullscreen' || action === 'export') && (e.metaKey || e.ctrlKey || e.altKey)) return null; // Cmd-F and friends are the system's
    if (isTyping(e) && (e.keyCode === 8 || !TYPING_OK[action])) return null;
    return action;
  }

  const onDown = (e) => {
    const action = resolve(e);
    if (!action) return;
    e.preventDefault();
    dispatcher.keydown(action, e, e.repeat);
  };
  const onUp = (e) => {
    const action = resolve(e);
    if (!action) return;
    e.preventDefault();
    dispatcher.keyup(action, e);
  };
  const onBlur = () => dispatcher.reset();
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
    dispatcher.reset();
  };
}
