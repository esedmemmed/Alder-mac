/*
 * Mac pointer. The TV has a D-pad; a Mac also has a mouse and a trackpad. This module maps them onto what the remote already
 * does, so no screen needs to know about a pointer: hovering a focusable focuses it (the one navhl/focus highlight moves),
 * a click is OK (the keyboard's Return, replayed through the same key path), the wheel is Left/Right/Up/Down. Installed
 * by src/main.js's Mac patch (scripts/build.mjs MAIN_PATCHES) with the focus engine; the Tizen build never contains it.
 */
const OK_KEYCODE = 13;
export const WHEEL_THRESHOLD = 40; // px of wheel travel per step
export const WHEEL_INTERVAL = 140; // ms between steps: trackpad inertia would otherwise run through a whole row
export const WHEEL_IDLE = 220;     // ms of quiet after which a new gesture starts from zero
export const EDGE_MAX = 80;        // px: the edge zone of a row is 10% of its width, at most this
export const EDGE_FRACTION = 0.1;
export const EDGE_INTERVAL = 450;  // ms between the steps a pointer held in an edge zone gives (calm: about two cards a second)

function isTextField(el) {
  const tag = el && el.tagName ? String(el.tagName).toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable === true);
}

/**
 * The hover-to-focus rule: the focusable under the pointer that should take focus, or null. Null when the pointer is over
 * nothing focusable, over the item that already has focus, over a disabled one, outside the focus scope (behind a dialog),
 * or while a text field has focus (moving the mouse must not cut off typing; a click still moves focus).
 */
export function hoverTarget(target, current, inScope = () => true) {
  const el = target && target.closest ? target.closest('[data-focus]') : null;
  if (!el || el === current) return null;
  if (el.hasAttribute('data-disabled') || isTextField(current) || !inScope(el)) return null;
  return el;
}

/**
 * One wheel event -> at most one step. [state] is { acc: {x, y}, last: time of the last step, seen: time of the last event }.
 * The dominant axis decides (shift + deltaY counts as sideways); travel adds up to WHEEL_THRESHOLD and a step is not
 * given more often than WHEEL_INTERVAL. Returns { state, dir } with dir 'left' | 'right' | 'up' | 'down' or null.
 */
export function wheelStep(state, e, now) {
  const quiet = now - state.seen > WHEEL_IDLE;
  let x = quiet ? 0 : state.acc.x, y = quiet ? 0 : state.acc.y;
  let dx = e.deltaX || 0, dy = e.deltaY || 0;
  if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  x += dx; y += dy;
  const next = { acc: { x, y }, last: state.last, seen: now };
  const horizontal = Math.abs(x) >= Math.abs(y);
  const travel = horizontal ? x : y;
  if (Math.abs(travel) < WHEEL_THRESHOLD || now - state.last < WHEEL_INTERVAL) return { state: next, dir: null };
  next.acc = { x: 0, y: 0 };
  next.last = now;
  const dir = horizontal ? (travel > 0 ? 'right' : 'left') : (travel > 0 ? 'down' : 'up');
  return { state: next, dir };
}

let wheelHook = null;
/** The player asks first (platform/mac/player-input.js): a hook returning true has consumed the wheel event (an open menu scrolls). */
export function setWheelHook(fn) { wheelHook = fn; }

/** 'left' | 'right' when [x] (client px) is within the edge zone of [rect], else null. */
export function edgeDir(x, rect) {
  const w = rect.right - rect.left;
  if (!(w > 0)) return null;
  const zone = Math.min(EDGE_MAX, w * EDGE_FRACTION);
  if (x - rect.left < zone) return 'left';
  if (rect.right - x < zone) return 'right';
  return null;
}

/**
 * Hover scrolls a Home / library row only from its edge zones: while the pointer stays there, one step per EDGE_INTERVAL
 * (the focus moves along the row, the row follows as it does for the keyboard). [timers] = { setInterval, clearInterval }.
 */
export function createEdgeScroller({ engine, timers }) {
  let timer = null, row = null, dir = null;
  const stop = () => { if (timer !== null) timers.clearInterval(timer); timer = null; row = null; dir = null; };
  function tick() {
    if (!row || !row.isConnected) { stop(); return; }
    const cur = engine.current();
    if (!(cur && row.contains(cur))) { engine.focus(row); return; }
    const card = cur.closest ? cur.closest('.card') : null;
    if (dir === 'left' && card && Number(card.getAttribute('data-index')) <= 0) return; // the first card: nothing to scroll back to
    engine.move(dir);
  }
  function over(target, x) {
    const r = target && target.closest ? target.closest('.row[data-focus-group]') : null;
    const d = r ? edgeDir(x, r.getBoundingClientRect()) : null;
    if (!d) { stop(); return; }
    if (r === row && d === dir) return;
    stop();
    row = r; dir = d;
    timer = timers.setInterval(tick, EDGE_INTERVAL);
  }
  return { over, stop, active: () => timer !== null };
}

/** Wires the mouse and trackpad to [engine] (the focus engine). Returns a function that removes the listeners. */
export function installPointer(engine, win = window) {
  const doc = win.document;
  let pos = { x: -1, y: -1 };
  let wheel = { acc: { x: 0, y: 0 }, last: -1e9, seen: -1e9 };
  const inScope = (el) => engine.scopeDepth() === 0 || engine.collect().some((c) => c.el === el);

  // Hover. A layout change under a still pointer (a row sliding, a card growing) makes the browser fire mouseover with the
  // pointer where it was; only a pointer that really moved may take focus, or the keyboard would be fought for it.
  const onOver = (e) => {
    const moved = e.screenX !== pos.x || e.screenY !== pos.y;
    pos = { x: e.screenX, y: e.screenY };
    if (!moved) return;
    const el = hoverTarget(e.target, engine.current(), inScope);
    // Hover only moves the highlight: the row it sits in must not slide under the pointer (win.__macHover: the Mac patch of
    // src/ui/row.js's focusin skips its reveal). A row scrolls from its edge zones (createEdgeScroller).
    if (el) { win.__macHover = true; try { engine.focus(el); } finally { win.__macHover = false; } }
  };
  const edge = createEdgeScroller({ engine, timers: { setInterval: (f, ms) => win.setInterval(f, ms), clearInterval: (i) => win.clearInterval(i) } });
  const onMove = (e) => { pos = { x: e.screenX, y: e.screenY }; edge.over(e.target, e.clientX); };
  const onStop = () => edge.stop();

  // Click = OK. The pointer's own click is swallowed and replayed as Return on the focused item (keydown, keyup), so the
  // screen's onKey and engine.press() see exactly what the keyboard gives them and each click handler runs once.
  const onClick = (e) => {
    if (!e.isTrusted) return; // engine.press() clicks the element: let that one through
    const el = e.target && e.target.closest ? e.target.closest('[data-focus]') : null;
    if (!el || el.hasAttribute('data-disabled')) return;
    e.preventDefault();
    e.stopPropagation();
    edge.stop();
    if (engine.current() !== el) engine.focus(el);
    for (const type of ['keydown', 'keyup']) {
      const k = new win.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(k, 'keyCode', { value: OK_KEYCODE });
      win.dispatchEvent(k);
    }
  };

  // Wheel / trackpad: sideways moves along the hovered row, vertical pages up and down. Throttled (wheelStep).
  const onWheel = (e) => {
    if (e.ctrlKey) return; // a pinch
    if (wheelHook && wheelHook(e)) { edge.stop(); return; } // the player's open menu or card takes it
    e.preventDefault();
    edge.stop();
    const r = wheelStep(wheel, e, Date.now());
    wheel = r.state;
    if (!r.dir) return;
    if (r.dir === 'left' || r.dir === 'right') {
      const group = e.target && e.target.closest ? e.target.closest('[data-focus-group]') : null;
      const cur = engine.current();
      if (group && !(cur && group.contains(cur))) { engine.focus(group); return; }
    }
    engine.move(r.dir);
  };

  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('mousemove', onMove, true);
  doc.documentElement.addEventListener('mouseleave', onStop);
  win.addEventListener('keydown', onStop, true);
  win.addEventListener('click', onClick, true);
  win.addEventListener('wheel', onWheel, { passive: false, capture: true });
  return () => {
    doc.removeEventListener('mouseover', onOver, true);
    doc.removeEventListener('mousemove', onMove, true);
    doc.documentElement.removeEventListener('mouseleave', onStop);
    win.removeEventListener('keydown', onStop, true);
    edge.stop();
    win.removeEventListener('click', onClick, true);
    win.removeEventListener('wheel', onWheel, { capture: true });
  };
}
