/*
 * The web variant's bridge (scripts/build.mjs --mac --web resolves `#platform/bridge` to this file): there is no native shell in a
 * browser, so there is never a bridge. Every caller of macBridge() already answers a missing bridge (it is the same answer a
 * browser gets from src/platform/mac/bridge.js when the page has no window.AlderBridge).
 */
export function macBridge() {
  return null;
}
