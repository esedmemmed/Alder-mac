/*
 * Alder's SeekBar (the View at the bottom of PlayerActivity.kt): a light track, a brighter stretch for what is buffered,
 * tungsten for what is played, and a warm-white knob that grows when the bar has focus. Drawn with three divs; the fill
 * and the knob move with transform only (no layout) so the half-second refresh is cheap on the TU8000.
 */
import { h } from '../lib/dom.js';

const KNOB = 12; // px: the knob's radius at rest (Alder 6 dp)
const END = 18; // px: where the line starts and stops, so the knob never leaves the bar (Alder: the focused knob radius, 9 dp)

/** Milliseconds as "6:47" or "1:39:49". */
export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n) => (n < 10 ? '0' : '') + n;
  return s >= 3600 ? Math.floor(s / 3600) + ':' + two(Math.floor(s / 60) % 60) + ':' + two(s % 60) : Math.floor(s / 60) + ':' + two(s % 60);
}

/** "−1:39:49": what is left (with the true minus sign, as in tracks.jpg). */
export function formatLeft(position, duration) {
  return duration > 0 ? '−' + formatClock(Math.max(0, duration - position)) : '';
}

/** createBar(width px) -> { el, set(position, buffered, duration) (ms), focus(on) } */
export function createBar(width) {
  const inner = width - 2 * END;
  const track = h('div', { class: 'bar-line bar-track' });
  const buffered = h('div', { class: 'bar-line bar-buffered' });
  const fill = h('div', { class: 'bar-line bar-fill' });
  const knob = h('div', { class: 'bar-knob' });
  [track, buffered, fill].forEach((el) => { el.style.left = END + 'px'; el.style.width = inner + 'px'; });
  const el = h('div', { class: 'pl-bar', style: { width: width + 'px' } }, track, buffered, fill, knob);
  let focused = false;
  let lastFraction = 0;

  function place(fraction) {
    lastFraction = fraction;
    fill.style.transform = 'scaleX(' + fraction.toFixed(4) + ')';
    knob.style.transform = 'translate3d(' + (END + inner * fraction - KNOB).toFixed(1) + 'px,0,0) scale(' + (focused ? 1.5 : 1) + ')';
  }

  return {
    el,
    set(position, bufferedTo, duration) {
      const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
      buffered.style.transform = 'scaleX(' + (duration > 0 ? Math.min(1, Math.max(fraction, bufferedTo / duration)) : 0).toFixed(4) + ')';
      knob.style.display = duration > 0 ? '' : 'none';
      place(fraction);
    },
    focus(on) {
      focused = !!on;
      el.classList.toggle('focus', focused);
      place(lastFraction);
    },
  };
}
