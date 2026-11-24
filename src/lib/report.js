/** A line for the host shell's log, when one is listening (the Mac build sets a sink at startup; the TV has none). Pure: no DOM. */
let sink = null;

export function setReportSink(fn) { sink = typeof fn === 'function' ? fn : null; }

export function report(line) {
  if (!sink) return;
  try { const p = sink(String(line)); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) { /* no sink */ }
}
