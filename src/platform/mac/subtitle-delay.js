/*
 * Mac subtitle delay: Alder's "Subtitle timing" on the Mac is mpv's own `sub-delay`, sent over the bridge (setProp, seconds) for the file's tracks
 * and the add-on subtitles alike; the page's JS cue shift is not used (mpv draws every subtitle). Wired by anchored patches in scripts/build.mjs
 * (SUBTITLE_DELAY_PATCHES for engine.js, SUBTITLE_DELAY_OPTIONS_PATCHES for options.js); the Tizen build never contains this file.
 *
 * Range -10..+10 s (a positive delay shows the subtitle later). The panel's stepper is three rows (0.1 s earlier, 0.1 s later, Reset to 0) with the
 * live value and the keys under the heading; the keys are Z (earlier) and X (later), handled in player-input.js. A new subtitle pick sets the delay
 * back to 0 and sends it (pick(); T4 will hand it a remembered value through `remembered`). Each change is one line, to decide() and to the
 * shell's report (the Air's ui-report prints it):   delay: <seconds, one decimal> s <file|addon>
 * Safari 14: no lookbehind, no class fields. Nothing here sorts.
 */
import { macBridge } from './bridge.js';

export const DELAY_MIN = -10000;
export const DELAY_MAX = 10000;
export const DELAY_STEP = 100;
export const DELAY_KEYS = 'Z earlier, X later';

function bridgeLog(line) {
  const b = macBridge();
  if (!b || !b.log) return;
  try { const p = b.log(line); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no shell */ }
}

export function clampDelay(ms) {
  const n = Math.round(Number(ms));
  if (!isFinite(n)) return 0;
  return Math.max(DELAY_MIN, Math.min(DELAY_MAX, n));
}

const seconds = (ms) => (ms / 1000).toFixed(1);

/** The value as the panel shows it: +0.3 s, -0.3 s, 0.0 s. */
export function delayText(ms) { return (ms > 0 ? '+' : '') + seconds(ms) + ' s'; }

/** The stepper's rows; each carries the delay OK sets (the clamp is applied again by the engine). */
export function delayRows(ms) {
  return [
    { name: '− 0.1 s  earlier', tag: '', id: 'earlier', ms: clampDelay(ms - DELAY_STEP) },
    { name: '+ 0.1 s  later', tag: '', id: 'later', ms: clampDelay(ms + DELAY_STEP) },
    { name: 'Reset to 0', tag: '', id: 'reset', ms: 0 },
  ];
}

/** The lines under the heading: the live value and the keys. */
export function delayNotes(ms) { return ['Now ' + delayText(ms), 'Keys: ' + DELAY_KEYS]; }

/**
 * avplay: the adapter (setSubDelay(seconds)); decide(line): the engine's decision line; report(line): the shell's log (default: the bridge);
 * remembered(kind) -> ms: what a new pick starts with (T4's remembered value goes here; 0 until then).
 */
export function createSubtitleDelay({ avplay, decide, report = bridgeLog, remembered = () => 0 }) {
  function set(ms, kind) {
    const v = clampDelay(ms);
    try { avplay.setSubDelay(v / 1000); } catch (e) { /* no bridge: nothing to drive */ }
    const line = 'delay: ' + seconds(v) + ' s ' + kind;
    if (decide) decide(line);
    report(line);
    return v;
  }
  return {
    set,
    /** A new subtitle was picked: its delay (0, or the remembered one), sent. Off has no delay to send. */
    pick(kind) { return kind === 'off' ? 0 : set(remembered(kind), kind); },
  };
}
