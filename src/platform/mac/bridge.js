/*
 * The page's one handle on the native bridge (mac/web/bridge.js, loaded by dist-mac/index.html as window.AlderBridge).
 * One bridge per page: createBridge owns window.alderNative, so the player stub and the exit button share this one.
 * Without the native handler (a browser, a test) every call resolves quietly.
 */
let shared = null;

export function macBridge(win = typeof window !== 'undefined' ? window : undefined) {
  if (shared && shared.win === win) return shared.bridge;
  const factory = win && win.AlderBridge;
  if (!factory || typeof factory.createBridge !== 'function') return null;
  const bridge = factory.createBridge({ win });
  shared = { win, bridge };
  return bridge;
}

/** Test hook: forget the shared bridge. */
export function resetMacBridge() { shared = null; }

/** Asks the shell to quit. Never throws, never waits. Returns whether a bridge was there. */
export function macQuit(win) {
  const bridge = macBridge(win);
  if (!bridge) return false;
  bridge.quit().catch(() => {});
  return true;
}
