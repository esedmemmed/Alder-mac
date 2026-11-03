/*
 * Spatial navigation for a D-pad, in two layers.
 *
 *  1. Geometry (pure, tested with plain rectangles): pickNext() chooses the neighbour of a rectangle in a direction,
 *     much as Android's FocusFinder does for Alder: candidates must lie beyond in that direction, those in the beam
 *     (overlapping on the other axis) beat those that are not, and nearer along the axis beats centred across it.
 *  2. The engine (DOM): elements with `data-focus` are focusable. Real DOM focus is used (`:focus` styles, the IME),
 *     with preventScroll, because rows and screens scroll with transforms, not with the browser.
 *
 * Attributes:
 *   data-focus                    focusable (the element gets tabindex=-1)
 *   data-focus-group="name"       a group (a row): see registerGroup() for how focus enters it from above or below
 *   data-up | data-down | data-left | data-right
 *                                 an explicit target on the element or any ancestor: a CSS selector (searched in the
 *                                 current scope), or "none" to stop there. Wins over geometry.
 *                                 Use it between rows that slide: positions are measured through transforms, so
 *                                 mid-slide a row can look farther away than the top bar behind it. A group element
 *                                 as the target is entered through its group handler (same index in the next row).
 *   data-disabled                 skipped
 *   data-focus-default            the element focusFirst() prefers
 *
 * Scopes: pushScope(el) confines navigation to el (a menu, a dialog) and popScope() puts focus back where it was.
 * Alder's panels are dialogs with their own focus; this is the same idea.
 */

export const DIRS = ['left', 'right', 'up', 'down'];
const EPS = 1; // px; rectangles measured through transforms are never exactly equal

export function rectOf(r) {
  const left = r.left, top = r.top;
  const width = r.width != null ? r.width : r.right - r.left;
  const height = r.height != null ? r.height : r.bottom - r.top;
  return { left, top, right: left + width, bottom: top + height, width, height, cx: left + width / 2, cy: top + height / 2 };
}

/** Is [c] beyond [f] in [dir]? Its centre must be past ours and its far edge past ours: wholly or partly beyond. */
function isBeyond(f, c, dir) {
  switch (dir) {
    case 'right': return c.cx > f.cx + EPS && c.right > f.right + EPS;
    case 'left': return c.cx < f.cx - EPS && c.left < f.left - EPS;
    case 'down': return c.cy > f.cy + EPS && c.bottom > f.bottom + EPS;
    case 'up': return c.cy < f.cy - EPS && c.top < f.top - EPS;
    default: return false;
  }
}

/** Lower is better. Android's FocusFinder weighting: along the axis counts 13 times as much as across it. */
export function scoreOf(f, c, dir) {
  const horizontal = dir === 'left' || dir === 'right';
  let major;
  if (dir === 'right') major = Math.max(0, c.left - f.right);
  else if (dir === 'left') major = Math.max(0, f.left - c.right);
  else if (dir === 'down') major = Math.max(0, c.top - f.bottom);
  else major = Math.max(0, f.top - c.bottom);
  const minor = Math.abs(horizontal ? c.cy - f.cy : c.cx - f.cx);
  const overlap = horizontal
    ? Math.min(f.bottom, c.bottom) - Math.max(f.top, c.top)
    : Math.min(f.right, c.right) - Math.max(f.left, c.left);
  const inBeam = overlap > EPS;
  // Out of the beam, the cross-axis miss counts double, and any in-beam candidate still wins.
  return (inBeam ? 0 : 1e9) + 13 * major * major + (inBeam ? 1 : 4) * minor * minor;
}

/**
 * The best candidate beyond [from] in [dir], or null. [candidates] are { rect, ...whatever } (rect has left/top/
 * width/height or left/top/right/bottom). Ties go to the earlier candidate (document order).
 */
export function pickNext(from, candidates, dir) {
  const f = rectOf(from);
  let best = null;
  let bestScore = Infinity;
  for (const cand of candidates) {
    const c = cand.rect && cand.rect.cx != null ? cand.rect : rectOf(cand.rect);
    if (!isBeyond(f, c, dir)) continue;
    const s = scoreOf(f, c, dir);
    if (s < bestScore) { best = cand; bestScore = s; }
  }
  return best;
}

/** The candidate nearest the top-left corner (top first, then left): where focus starts on a fresh screen. */
export function topLeftMost(candidates) {
  let best = null;
  for (const cand of candidates) {
    const c = rectOf(cand.rect);
    if (!best || c.top < best.r.top - EPS || (Math.abs(c.top - best.r.top) <= EPS && c.left < best.r.left)) best = { cand, r: c };
  }
  return best ? best.cand : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------------------------

export function createFocusEngine({ root, doc = document, onMove = null } = {}) {
  const groups = new WeakMap();      // group element -> { enter }
  const lastInGroup = new WeakMap(); // group element -> last focused element in it
  const scopes = [];                 // { el, restore }
  let lastFocused = null;

  const scopeEl = () => (scopes.length ? scopes[scopes.length - 1].el : root);

  function collect(scope = scopeEl()) {
    const out = [];
    const nodes = scope.querySelectorAll('[data-focus]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.hasAttribute('data-disabled')) continue;
      const rect = rectOf(el.getBoundingClientRect());
      if (rect.width <= 0 || rect.height <= 0) continue;
      out.push({ el, rect });
    }
    return out;
  }

  const groupOf = (el) => (el && el.closest ? el.closest('[data-focus-group]') : null);

  function current() {
    const scope = scopeEl();
    const a = doc.activeElement;
    if (a && a !== doc.body && a.hasAttribute && a.hasAttribute('data-focus') && scope.contains(a)) return a;
    if (lastFocused && lastFocused.isConnected && scope.contains(lastFocused)) return lastFocused;
    return null;
  }

  function focus(target, opts) {
    let el = target;
    if (typeof target === 'string') el = scopeEl().querySelector(target);
    if (!el) return false;
    if (!el.hasAttribute('data-focus')) {
      // A container: its group's way in, else its first focusable child.
      const g = groups.get(el);
      const inner = g && g.enter ? g.enter({ dir: null, from: current(), candidate: null, group: el }) : el.querySelector('[data-focus]');
      if (!inner) return false;
      el = inner;
    }
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    if (doc.activeElement !== el) return false;
    note(el);
    if (onMove) onMove(el, opts || null);
    return true;
  }

  function note(el) {
    lastFocused = el;
    const g = groupOf(el);
    if (g) lastInGroup.set(g, el);
  }

  function focusFirst() {
    const cands = collect();
    if (!cands.length) return false;
    const preferred = cands.find((c) => c.el.hasAttribute('data-focus-default'));
    return focus((preferred || topLeftMost(cands)).el);
  }

  /** The explicit target for [dir] declared on [from] or an ancestor: an element, null ("none": stay put) or undefined. */
  function overrideFor(from, dir) {
    const attr = 'data-' + dir;
    const scope = scopeEl();
    for (let el = from; el && el !== scope.parentNode; el = el.parentNode) {
      if (!el.getAttribute) break;
      const v = el.getAttribute(attr);
      if (v == null) continue;
      if (v === 'none') return null;
      let found = null;
      try { found = scope.querySelector(v); } catch (e) { found = null; }
      if (found) return found;
      // the selector matches nothing right now (a hidden chip row): geometry decides
      return undefined;
    }
    return undefined;
  }

  function move(dir) {
    const from = current();
    if (!from) return focusFirst();
    const override = overrideFor(from, dir);
    if (override === null) return true;
    if (override) return focus(override, { dir });
    const fromRect = rectOf(from.getBoundingClientRect());
    let candidates = collect().filter((c) => c.el !== from);
    // A row keeps Left and Right to itself (Alder's rows move their own selection and stop at the ends). Without this,
    // the last card of a scrolled row has cards of the other rows "to its right" and focus would leave the row.
    const fromGroup = groupOf(from);
    const fromHandler = fromGroup ? groups.get(fromGroup) : null;
    if (fromHandler && fromHandler.contain === 'x' && (dir === 'left' || dir === 'right')) candidates = candidates.filter((c) => groupOf(c.el) === fromGroup);
    const best = pickNext(fromRect, candidates, dir);
    if (!best) return false;
    let target = best.el;
    const g = groupOf(target);
    if (g && g !== groupOf(from)) {
      // Crossing into another group (another row): the group decides where in it focus lands.
      const handler = groups.get(g);
      if (handler && handler.enter) {
        const entered = handler.enter({ dir, from, candidate: target, group: g });
        if (entered) target = entered;
      }
    }
    return focus(target, { dir });
  }

  /**
   * Gives a group a way in. enter({ dir, from, candidate, group }) returns the element to focus (it may have to mount
   * it first: virtualised rows) or null to take the geometric candidate. `dir` is null for a programmatic focus.
   * `contain: 'x'` keeps Left and Right inside the group (a row): they stop at its ends instead of jumping to another row.
   */
  function registerGroup(el, handler) { groups.set(el, handler); }
  function unregisterGroup(el) { groups.delete(el); }

  function pushScope(el, { focus: initial = true } = {}) {
    scopes.push({ el, restore: current() });
    if (initial !== false) {
      if (typeof initial === 'string' || (initial && initial.nodeType)) focus(initial);
      else focusFirst();
    }
  }

  function popScope() {
    const s = scopes.pop();
    if (!s) return;
    const back = s.restore;
    if (back && back.isConnected && scopeEl().contains(back)) focus(back);
    else focusFirst();
  }

  const onFocusIn = (e) => { if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-focus')) note(e.target); };
  root.addEventListener('focusin', onFocusIn);

  return {
    move, focus, focusFirst, current, collect, registerGroup, unregisterGroup, pushScope, popScope,
    rememberedIn: (group) => { const el = lastInGroup.get(group); return el && el.isConnected ? el : null; },
    scopeDepth: () => scopes.length,
    /** OK: a click on the focused element. */
    press() { const el = current(); if (el) el.click(); return !!el; },
    /** Hold OK: an 'alder:hold' event on the focused element, bubbling (screens and components listen for it). */
    hold() {
      const el = current();
      if (!el) return false;
      el.dispatchEvent(new CustomEvent('alder:hold', { bubbles: true, cancelable: true }));
      return true;
    },
    destroy() { root.removeEventListener('focusin', onFocusIn); },
  };
}
