/*
 * Mac Diagnostics export: the report as text, saved by the shell to ~/Downloads/Alder-diagnostics-<YYYY-MM-DD>.txt (bridge saveFile).
 * Bound to the Diagnostics screen (E) by a patch in scripts/build.mjs. The text leaves the page only after scrubbing:
 * the auth key, e-mail addresses and every link (scheme://, magnet:, www.) go, and so does the source's host line.
 */
import { macBridge } from './bridge.js';
import { reportText, scrubReport } from '../../core/report-text.js';

export { reportText, scrubReport };

/** 'Alder-diagnostics-2026-11-03.txt', the local date. */
export function exportName(now = new Date()) {
  const two = (n) => String(n).padStart(2, '0');
  return 'Alder-diagnostics-' + now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate()) + '.txt';
}

/**
 * macDiagExporter({ build, context, bridge, now }) -> () => Promise: builds the report now, scrubs it and hands it to the shell.
 * [build]: () => report sections. [context]: the router context (toast, player.authKey). Resolves the shell's path, or null.
 */
export function macDiagExporter({ build, context = {}, bridge = macBridge, now = () => new Date() }) {
  return async function exportReport() {
    const b = bridge();
    const toast = context.toast || (() => {});
    if (!b) { toast('Saving needs the Mac app'); return null; }
    const key = context.player ? context.player.authKey : '';
    const text = scrubReport(reportText(build()), [key]);
    try {
      const where = await b.saveFile(exportName(now()), text);
      toast('Saved to Downloads');
      return where || null;
    } catch (e) {
      toast("Couldn't save the report");
      return null;
    }
  };
}
