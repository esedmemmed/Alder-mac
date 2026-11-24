/*
 * The Diagnostics report as text: the full text (reportText), the scrub that lets it leave the page (scrubReport), the short
 * "playback report" a phone can carry in a QR code (playbackReport), and the link that holds it (reportLink / decodeReportHash).
 * The link's text is deflated and base64url-encoded into the URL's #fragment, so it never reaches a server: the viewer page
 * (src/app/report-viewer.js, web build) decodes it in the browser. Shared by the Mac export and the Diagnostics screen.
 */
import { deflateRaw, inflateRaw } from 'pako';

const LINK = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*|\bmagnet:\?[^\s"'<>]*|\bwww\.[^\s"'<>]+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const LABELLED_KEY = /\b(auth[\s_-]?key|authkey|token|password)(["']?\s*[=:]\s*["']?)[^\s"',;]+/gi;
const QUERY = /\?[^\s"'<>]+/g;

export const REPORT_BASE = 'https://esedmemmed.github.io/Alder-mac/#r=';
export const REPORT_PREFIX = '#r=';
export const LINK_MAX = 1800;
const DECISIONS = 'AUDIO AND SOURCE DECISIONS';
const ADDONS = 'SUBTITLE ADD-ONS';

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

/**
 * The short report for the phone: a Title line, then APP and DEVICE (first line each), SOURCES, STREAM, SUBTITLE ADD-ONS and the last
 * 60 audio and source decisions, scrubbed. ICONS, PICTURE, AVPLAY TRACKS and LOG stay out. [report]: buildReport's sections.
 */
export function playbackReport(report, authKeys = []) {
  const by = (title) => report.find((s) => s.title === title);
  const parts = [];
  const titleSec = by('TITLE');
  if (titleSec && titleSec.lines.length) parts.push(titleSec.lines[0].text);
  const add = (title, take) => {
    const sec = by(title);
    if (!sec) return;
    const lines = take(sec.lines);
    parts.push(title + '\n' + lines.map((l) => '  ' + l.text).join('\n'));
  };
  add('APP', (l) => l.slice(0, 1));
  add('DEVICE', (l) => l.slice(0, 1));
  add('SOURCES', (l) => l);
  add('STREAM', (l) => l);
  add(ADDONS, (l) => l);
  add(DECISIONS, (l) => l.slice(-60));
  return scrubReport(parts.join('\n\n') + '\n', authKeys);
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const linkOf = (text) => REPORT_BASE + toBase64Url(deflateRaw(text, { level: 9 }));

/** Removes one line of section [title] (from its start or end); false when it has none left. */
function dropLine(text, title, fromEnd) {
  const lines = text.split('\n');
  const at = lines.indexOf(title);
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && /^ {2}\S/.test(lines[end])) end++;
  if (end === at + 1) return null; // the section has no lines
  lines.splice(fromEnd ? end - 1 : at + 1, 1);
  return lines.join('\n');
}

/**
 * The link for [text]: pako deflateRaw (level 9), base64url, after REPORT_BASE. Over [max] characters, the oldest decisions go one at
 * a time, then the subtitle add-on lines from the end. SOURCES and STREAM are never cut (the link may then stay longer than [max]).
 */
export function reportLink(text, max = LINK_MAX) {
  let t = text;
  let link = linkOf(t);
  while (link.length > max) {
    const next = dropLine(t, DECISIONS, false) || dropLine(t, ADDONS, true);
    if (next === null) break;
    t = next;
    link = linkOf(t);
  }
  return link;
}

/** The text a "#r=..." hash holds, or null when it is not one or does not decode. */
export function decodeReportHash(hash) {
  const h = String(hash || '');
  if (h.indexOf(REPORT_PREFIX) !== 0 || h.length === REPORT_PREFIX.length) return null;
  try {
    const text = new TextDecoder('utf-8').decode(inflateRaw(fromBase64Url(h.slice(REPORT_PREFIX.length))));
    return text.length > 0 ? text : null;
  } catch (e) {
    return null;
  }
}
