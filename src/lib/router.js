/*
 * The screen stack (Alder's Activity back stack). Each screen is an object made by a factory:
 *
 *   { mount(root, params, router), unmount(), onKey(evt) -> handled?, suspend?(), resume?() }
 *
 * push() puts a screen on top (the one below is suspended and hidden, kept alive so Back returns to the same
 * focus and scroll, as Activities stay in memory); pop() unmounts the top and resumes the one below.
 *
 * Keys: the shell calls router.onKey(evt) with { type: 'press' | 'hold', action, repeat, event }. An overlay (a
 * dialog) sees it first, then the top screen. A Back press nobody handled pops; at the bottom of the stack it asks
 * the app to exit (tizen.application.getCurrentApplication().exit() in main.js).
 *
 * mount(root, params, context) receives the app's context object (the router, the focus engine, toast, ...): whatever
 * the shell passes as `context`. beforeHide(entry) / afterShow(entry) let the shell remember and restore focus when a
 * screen is covered and uncovered.
 *
 * The DOM is injected (createContainer / removeContainer / setHidden) so the stack logic is tested without one.
 */
export function createRouter({ root, screens, onExit = () => {}, context = {}, beforeHide = null, afterShow = null,
  createContainer, removeContainer, setHidden, log = null, maxDepth = 12 }) {
  const stack = []; // { name, screen, container }
  const overlays = [];

  const mk = createContainer || (() => { const d = document.createElement('div'); d.className = 'screen'; root.appendChild(d); return d; });
  const rm = removeContainer || ((c) => { if (c.parentNode) c.parentNode.removeChild(c); });
  const hide = setHidden || ((c, hidden) => { c.style.display = hidden ? 'none' : ''; });
  const say = (msg) => { if (log) log.debug('router', msg); };

  function build(name, params) {
    const factory = screens[name];
    if (!factory) throw new Error('No screen named ' + name);
    const container = mk(name);
    const screen = factory(params) || {};
    return { name, screen, container, params };
  }

  function mountEntry(entry) {
    if (entry.screen.mount) entry.screen.mount(entry.container, entry.params, context);
  }

  function dropEntry(entry) {
    try { if (entry.screen.unmount) entry.screen.unmount(); } finally { rm(entry.container); }
  }

  const router = {
    push(name, params = {}) {
      const below = stack[stack.length - 1];
      if (stack.length >= maxDepth) {
        // A stack that deep is a navigation loop: drop the screen right under the top rather than grow without bound.
        const old = stack.splice(1, 1)[0];
        if (old) dropEntry(old);
      }
      const entry = build(name, params);
      if (below) {
        if (beforeHide) beforeHide(below);
        if (below.screen.suspend) below.screen.suspend();
        hide(below.container, true);
      }
      stack.push(entry);
      say('push ' + name + ' (depth ' + stack.length + ')');
      mountEntry(entry);
      return entry.screen;
    },

    /** Back: removes the top screen and shows the one below. Returns false when there is nothing below. */
    pop() {
      if (stack.length <= 1) return false;
      const top = stack.pop();
      say('pop ' + top.name + ' (depth ' + stack.length + ')');
      dropEntry(top);
      const now = stack[stack.length - 1];
      hide(now.container, false);
      if (now.screen.resume) now.screen.resume();
      if (afterShow) afterShow(now);
      return true;
    },

    /** Swaps the top screen for another (sign-in done: Home replaces it). */
    replace(name, params = {}) {
      const top = stack.pop();
      if (top) dropEntry(top);
      const entry = build(name, params);
      stack.push(entry);
      say('replace -> ' + name);
      mountEntry(entry);
      return entry.screen;
    },

    /** Empties the stack and starts again from one screen (switching profile). */
    reset(name, params = {}) {
      while (stack.length) dropEntry(stack.pop());
      overlays.length = 0;
      return router.push(name, params);
    },

    top: () => (stack.length ? stack[stack.length - 1] : null),
    depth: () => stack.length,
    names: () => stack.map((e) => e.name),

    /** A dialog on top of the screen: gets keys first. handle(evt) -> handled?. Returns a function that removes it. */
    pushOverlay(handle) {
      const o = { handle };
      overlays.push(o);
      return () => { const i = overlays.indexOf(o); if (i >= 0) overlays.splice(i, 1); };
    },
    overlayCount: () => overlays.length,

    /** Offers a key to the overlay, then the top screen; an unhandled Back press pops or exits. Returns handled. */
    onKey(evt) {
      const o = overlays[overlays.length - 1];
      if (o && o.handle(evt)) return true;
      if (o && evt.type === 'press' && evt.action === 'back') return true; // an overlay swallows Back even if it forgot to
      const top = stack[stack.length - 1];
      if (top && top.screen.onKey && top.screen.onKey(evt)) return true;
      if (evt.type === 'press' && evt.action === 'back' && !evt.repeat) {
        if (!router.pop()) onExit();
        return true;
      }
      return false;
    },
  };
  return router;
}
