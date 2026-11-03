/*
 * The remote control: key codes, the names the screens use, and "hold OK" (Alder's long press).
 *
 * Samsung TV key codes: https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
 * Everything a screen sees is an action name ('left', 'ok', 'back', 'playpause', '5', ...), never a key code.
 * The dev harness (a desktop keyboard) maps onto the same actions: arrows, Enter, Backspace/Escape = Back,
 * Space = Play/Pause, [ and ] = Rewind / Fast-forward.
 */

/** key code -> action */
export const KEY_ACTIONS = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down',
  13: 'ok',
  10009: 'back', 27: 'back', 8: 'back',            // Return on the remote; Escape and Backspace on a keyboard
  415: 'play', 19: 'pause', 10252: 'playpause', 32: 'playpause', 413: 'stop',
  417: 'ff', 221: 'ff', 412: 'rw', 219: 'rw',
  10232: 'prev', 10233: 'next',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue',
  457: 'info', 10221: 'caption',
};
for (let d = 0; d <= 9; d++) { KEY_ACTIONS[48 + d] = String(d); KEY_ACTIONS[96 + d] = String(d); }

/** Names for tizen.tvinputdevice.registerKeyBatch: the keys that are not delivered to a web app until asked for. */
export const REGISTER_KEYS = [
  'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
  'MediaTrackPrevious', 'MediaTrackNext', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  'Info', 'Caption', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

export const HOLD_MS = 600;

/** The action for a KeyboardEvent's keyCode, or null. */
export function actionFor(keyCode) {
  return Object.prototype.hasOwnProperty.call(KEY_ACTIONS, keyCode) ? KEY_ACTIONS[keyCode] : null;
}

export const isDigit = (action) => action != null && action.length === 1 && action >= '0' && action <= '9';

/**
 * Registers the extra keys with the TV. Names the TV does not know are skipped one by one (registerKeyBatch throws
 * for the whole batch otherwise). Returns the names that were registered.
 */
export function registerKeys(tizen, names = REGISTER_KEYS) {
  const api = tizen && tizen.tvinputdevice;
  if (!api) return [];
  try { api.registerKeyBatch(names); return names.slice(); } catch (e) { /* one of them is unknown: go one at a time */ }
  const done = [];
  names.forEach((name) => { try { api.registerKey(name); done.push(name); } catch (e) { /* not on this TV */ } });
  return done;
}

/**
 * The press / hold state machine, free of the DOM so it can be tested with a fake clock.
 *
 *  - Every action but 'ok' is a 'press' the moment the key goes down; holding it repeats ('press' with repeat: true).
 *  - OK waits: released within [holdMs] it is a 'press' (on key-up); held longer it is one 'hold', once, as soon as
 *    the time is up (not on release: the options menu opens while the thumb is still down, as Alder's long press does),
 *    and the release after it does nothing.
 *
 * emit({ type: 'press' | 'hold', action, repeat, event })
 */
export function createKeyDispatcher({ emit, holdMs = HOLD_MS, holdActions = ['ok'],
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) } } = {}) {
  let down = null; // { action, timer, fired, event }

  function down_(action, event, repeat) {
    if (holdActions.indexOf(action) < 0) { emit({ type: 'press', action, repeat: !!repeat, event }); return; }
    if (down && down.action === action) return; // auto-repeat of a key we are already timing
    if (down) clear();
    const entry = { action, fired: false, event, timer: null };
    entry.timer = timers.setTimeout(() => {
      entry.fired = true;
      emit({ type: 'hold', action, repeat: false, event: entry.event });
    }, holdMs);
    down = entry;
  }

  function up_(action, event) {
    if (!down || down.action !== action) return;
    const entry = down;
    clear();
    if (!entry.fired) emit({ type: 'press', action, repeat: false, event });
  }

  function clear() {
    if (down) timers.clearTimeout(down.timer);
    down = null;
  }

  return {
    keydown: down_,
    keyup: up_,
    /** Forget a key that is "down" (the window lost focus, so its key-up will never come). */
    reset: clear,
    isHolding: () => !!down,
  };
}

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

/**
 * Listens for the keys on [target] (the window) and calls onAction({type, action, repeat, event}).
 * While a text field has focus, only up / down / OK / Back reach the app (Backspace stays the field's own);
 * the rest goes to the field. Returns a function that removes the listeners.
 */
export function attachKeys({ target, onAction, holdMs = HOLD_MS, timers, isTyping = (e) => isTypingTarget(e.target) }) {
  const dispatcher = createKeyDispatcher({ emit: onAction, holdMs, timers });
  const TYPING_OK = { up: 1, down: 1, ok: 1, back: 1 };

  function resolve(e) {
    const action = actionFor(e.keyCode);
    if (!action) return null;
    if (isTyping(e)) {
      if (e.keyCode === 8 || !TYPING_OK[action]) return null;
    }
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
