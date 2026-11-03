/*
 * Mac Diagnostics export: the report as text, saved by the shell to ~/Downloads/Alder-diagnostics-<YYYY-MM-DD>.txt (bridge saveFile).
 * Bound to the Diagnostics screen (E) by a patch in scripts/build.mjs. The text leaves the page only after scrubbing:
 * the auth key, e-mail addresses and every link (scheme://, magnet:, www.) go, and so does the source's host line.
 */
import { macBridge } from './bridge.js';

const LINK = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*|\bmagnet:\?[^\s"'<>]*|\bwww\.[^\s"'<>]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const LABELLED_KEY = /\b(auth[\s_-]?key|authkey|token|password)(["']?\s*[=:]\s*["']?)[^\s"',;]+/gi;
const QUERY = /\?[^\s"'<>]+/g;

/** The sections of buildReport as plain text. */
export function reportText(report) {
  return report.map((sec) => sec.title + '\n' + sec.lines.map((l) => '  ' + l.text).join('\n')).join('\n\n') + '\n';
}

/** [authKeys]: the keys known to the page (the active profile's). Everything else is matched by shape. */
export function scrubReport(text, authKeys = []) {
  let out = String(text);
  authKeys.filter((k) => typeof k === 'string' && k.length >= 4).forEach((k) => { out = out.split(k).join('[key]'); });
  return out
    .replace(LINK, '[link]')
    .replace(QUERY, '?[query]')
    .replace(EMAIL, '[email]')
    .replace(LABELLED_KEY, '$1$2[key]')
    .replace(/^(\s*host\s+).*$/gim, '$1[hidden]');
}

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
