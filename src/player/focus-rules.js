/*
 * Where the remote's focus is on the player's controls, as rules with no DOM (tested in test/player/focus-rules.test.js).
 *
 * The owner's rule (docs/PLAN-v0.2.md D2): whenever the controls come up, and after anything that was on top of them has
 * closed or a seek is over, focus is on Play/Pause, so OK always pauses or resumes. Before this the focus came back to
 * whatever button had opened a panel (Audio & subtitles), or to the bar, and a press of OK did something else.
 *
 * Buttons are named by id: 'audio' | 'stream' | 'play' | 'next' | 'info'; the bar is 'bar'.
 */

/** The button focus returns to. */
export const HOME = 'play';

/** Milliseconds after the last step of a scrub before focus leaves the bar for Play/Pause (a held key repeats faster than this). */
export const SEEK_SETTLE = 1200;

/** The buttons left to right (Next episode only when there is one). */
export function buttonOrder(hasNext) {
  return ['audio', 'stream', 'play'].concat(hasNext ? ['next'] : [], ['info']);
}

/**
 * Focus when the controls come up from hidden: Play/Pause, except for a quick seek (Left/Right while hidden), which asks for
 * the bar [wanted = 'bar'] so the next press keeps seeking; SEEK_SETTLE after its last step focus goes back to Play/Pause.
 */
export function focusOnShow(wanted) {
  return wanted === 'bar' ? 'bar' : HOME;
}

/** Focus when something that sat over the controls has closed (the Audio & subtitles panel, the Info card): Play/Pause. */
export function focusAfterClose() {
  return HOME;
}

/** Whether the controls come back by themselves when [kind] of card closes: Info was opened from them, so yes. Up next, the stall offer and the error leave the picture as it was. */
export function showsControlsAfterClose(kind) {
  return kind === 'info';
}

/** Focus once a seek is over: off the bar (where Left/Right scrub) and on to Play/Pause; anywhere else stays. */
export function focusAfterSeek(current) {
  return current === 'bar' ? HOME : current;
}

/** The focus after [action] while the controls are up: Left/Right along the buttons (no wrap), Up to the bar, Down back to Play/Pause. */
export function stepFocus(order, current, action) {
  if (current === 'bar') return action === 'down' ? HOME : 'bar';
  const i = order.indexOf(current);
  if (action === 'left') return order[Math.max(0, i - 1)];
  if (action === 'right') return order[Math.min(order.length - 1, i + 1)];
  if (action === 'up') return 'bar';
  return current;
}

/**
 * What a key does while the controls are hidden (and no card is open): { show, toggle, focus, seek } or null when the screen has
 * no use for it. OK pauses or resumes AND brings the controls up on Play/Pause (Alder: showControls(playPause)); Up and Down only
 * bring them up (on Play/Pause); Left and Right are the quick seek (Alder, Netflix): the controls come up with the bar focused
 * AND the first step (seek: -1 / +1 of 10 s) is taken at once.
 */
export function hiddenKey(action) {
  if (action === 'ok') return { show: true, toggle: true, focus: HOME };
  if (action === 'left') return { show: true, toggle: false, focus: 'bar', seek: -1 };
  if (action === 'right') return { show: true, toggle: false, focus: 'bar', seek: 1 };
  if (action === 'up' || action === 'down') return { show: true, toggle: false, focus: HOME };
  return null;
}

/**
 * What a media key does: { toggle, play, pause, seek (+1/-1 steps of SKIP), showControls }. Play/Pause acts at once and
 * leaves the controls as they are (the centre glyph says what happened); fast-forward and rewind bring them up, on
 * Play/Pause, because a seek is something to watch.
 */
export function mediaPlan(action) {
  switch (action) {
    case 'playpause': return { toggle: true, showControls: false };
    case 'play': return { play: true, showControls: false };
    case 'pause': return { pause: true, showControls: false };
    case 'ff': return { seek: 1, showControls: true };
    case 'rw': return { seek: -1, showControls: true };
    default: return null;
  }
}

/** What the centre glyph does when playing changes: 'pause' (stay up while paused), 'play' (flash, then fade) or null (no change, or the first report). */
export function glyphFor(was, now) {
  if (was === null || was === now) return null;
  return now ? 'play' : 'pause';
}

export const GLYPH = { IN_MS: 120, FLASH_MS: 600, OUT_MS: 250 };
