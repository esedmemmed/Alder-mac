// The clock of the top bar and the picker: "h:mm AM". Dev builds freeze it with ?clock=12:03%20AM for screenshots.
import { IS_DEV } from '../lib/env.js'
import { wallClockText } from '../player/controls.js'

export function clockText(date = new Date()) {
  if (IS_DEV && typeof window !== 'undefined') {
    const fixed = new URLSearchParams(window.location.search).get('clock')
    if (fixed) return fixed
  }
  return wallClockText(date)
}

/** Keeps [el] on the time (every 20 s: the minute changes are all it shows). Returns a function that stops it. */
export function runClock(el) {
  const draw = () => { const t = clockText(); if (el.textContent !== t) el.textContent = t }
  draw()
  const id = setInterval(draw, 20000)
  return () => clearInterval(id)
}
