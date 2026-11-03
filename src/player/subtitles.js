/*
 * Subtitles. Two sources, one overlay:
 *
 *   add-on files (OpenSubtitles): Alder hands the URL to ExoPlayer, or, for a timing shift, fetches the file, moves every time
 *   with a regex and attaches the changed copy. AVPlay cannot attach a web subtitle file, so here the file is fetched once,
 *   parsed into cues (SRT, VTT and ASS), and drawn by us in a div synced to the playing time. A shift is then just an
 *   offset added when looking a cue up, with no reload: shiftCues() is Alder's regex shift done on parsed times.
 *
 *   the file's own tracks: AVPlay selects one (setSelectTrack('TEXT', i)) and calls onsubtitlechange(duration, text, ...)
 *   when its text changes; the same overlay draws it.
 *
 * Alder's look: Settings' size (percent of ExoPlayer's default fraction of the height) and background (70% black or none),
 * white text with a drop shadow, raised while the controls are up.
 *
 * The parsers and cue lookup are pure (no DOM); createSubtitleView is the only DOM part.
 */
import { h, clear } from '../lib/dom.js';
import { stableSort } from '../core/util.js';

// --- parsing ---------------------------------------------------------------------------------------------------------

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function toMs(hours, m, s, frac) {
  const ms = Number((frac + '00').slice(0, 3));
  return ((Number(hours || 0) * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&lrm;': '', '&rlm;': '' };

/**
 * Cue text as lines of runs: <i>…</i> and {\i1}…{\i0} become italic runs, every other tag and ASS override is dropped, the
 * few HTML entities subtitle files use are decoded. Add-on files are untrusted: nothing here is ever used as markup.
 * Returns [[{ text, italic }]] (one array per line).
 */
export function cueLines(raw) {
  const text = String(raw)
    .replace(/\{\\i1\}/g, '<i>').replace(/\{\\i0\}/g, '</i>')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|nbsp|lrm|rlm|#39);/g, (e) => ENTITIES[e]);
  return text.split(/\r?\n/).map((line) => {
    const runs = [];
    let italic = false;
    line.split(/(<\/?[a-zA-Z][^>]*>)/).forEach((piece) => {
      const tag = /^<(\/?)([a-zA-Z]+)[^>]*>$/.exec(piece);
      if (tag) { if (tag[2].toLowerCase() === 'i') italic = tag[1] !== '/'; return; }
      if (piece) runs.push({ text: piece, italic });
    });
    return runs;
  }).filter((runs) => runs.some((r) => r.text.trim() !== ''));
}

/** The words of a cue as one plain string (used for tests and for the log). */
export function cuePlain(lines) {
  return lines.map((runs) => runs.map((r) => r.text).join('')).join('\n');
}

function parseSrtVtt(source) {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  text.split(/\n{2,}/).forEach((block) => {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (at < 0) return; // WEBVTT header, NOTE, STYLE blocks
    const [a, b] = lines[at].split('-->');
    const start = TIME.exec(a);
    const end = TIME.exec(b);
    if (!start || !end) return;
    const body = lines.slice(at + 1).join('\n');
    const parsed = cueLines(body);
    if (parsed.length) cues.push({ start: toMs(start[1], start[2], start[3], start[4]), end: toMs(end[1], end[2], end[3], end[4]), lines: parsed });
  });
  return cues;
}

function parseAss(source) {
  const rows = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let inEvents = false;
  let columns = null;
  const cues = [];
  const stamp = /(\d+):(\d{2}):(\d{2})[.](\d{1,3})/;
  rows.forEach((row) => {
    if (/^\s*\[/.test(row)) { inEvents = /^\s*\[events\]/i.test(row); return; }
    if (!inEvents) return;
    if (/^\s*format\s*:/i.test(row)) { columns = row.slice(row.indexOf(':') + 1).split(',').map((c) => c.trim().toLowerCase()); return; }
    if (!/^\s*dialogue\s*:/i.test(row) || !columns) return;
    const parts = row.slice(row.indexOf(':') + 1).split(',');
    const textAt = columns.indexOf('text');
    if (textAt < 0) return;
    const fields = parts.slice(0, textAt);
    const body = parts.slice(textAt).join(',');
    const start = stamp.exec(fields[columns.indexOf('start')] || '');
    const end = stamp.exec(fields[columns.indexOf('end')] || '');
    if (!start || !end) return;
    const frac = (f) => Number((f + '00').slice(0, 3)); // ASS counts centiseconds, written with two digits
    const at = (m) => ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac(m[4]);
    const lines = cueLines(body);
    if (lines.length) cues.push({ start: at(start), end: at(end), lines });
  });
  return stableSort(cues, (x, y) => x.start - y.start);
}

/** Subtitle file text -> cues [{ start, end, lines }] in ms, in time order. [format]: 'srt' | 'vtt' | 'ass' (guessed from the text when omitted). */
export function parseSubtitles(source, format = null) {
  const text = String(source || '');
  const kind = format || (/\[events\]/i.test(text) ? 'ass' : 'srt');
  return kind === 'ass' ? parseAss(text) : parseSrtVtt(text);
}

/** Alder's shiftSubtitles on parsed cues: every time moved by [delayMs] (later when positive), never before 0. */
export function shiftCues(cues, delayMs) {
  if (!delayMs) return cues;
  return cues.map((c) => ({ start: Math.max(0, c.start + delayMs), end: Math.max(0, c.end + delayMs), lines: c.lines }));
}

/**
 * The cue showing at [ms], or null. Cues are sorted by start; overlapping cues show the latest one that started.
 * [hint] is the index returned last time: playback mostly moves forward, so the search starts there.
 */
export function cueAt(cues, ms, hint = 0) {
  if (!cues.length) return null;
  let i = hint >= 0 && hint < cues.length && cues[hint].start <= ms ? hint : 0;
  let found = null;
  for (; i < cues.length && cues[i].start <= ms; i++) if (ms < cues[i].end) found = i;
  return found === null ? null : { cue: cues[found], index: found };
}

// --- the overlay -----------------------------------------------------------------------------------------------------

/** ExoPlayer's SubtitleView.DEFAULT_TEXT_SIZE_FRACTION: text is this fraction of the view's height. */
export const TEXT_SIZE_FRACTION = 0.0533;
/** Bottom padding as a fraction of the height: 0.08 with the controls down, 0.28 above them (PlayerActivity.showControls). */
export const BOTTOM_HIDDEN = 0.08;
export const BOTTOM_SHOWN = 0.28;

/**
 * The subtitle overlay in [host]. size: Settings' percent (80/100/130/160), background: Settings' on/off.
 *   show(lines)  lines as from cueLines() (or a plain string)    hide()    raise(bool): above the controls
 */
export function createSubtitleView(host, { size = 100, background = true, height = 1080 } = {}) {
  const el = h('div', { class: 'subs' + (background ? ' with-bg' : ''), 'aria-live': 'off' });
  el.style.fontSize = Math.round(height * TEXT_SIZE_FRACTION * size / 100) + 'px';
  el.style.lineHeight = Math.round(height * TEXT_SIZE_FRACTION * size / 100 * 1.25) + 'px';
  el.style.bottom = Math.round(height * BOTTOM_HIDDEN) + 'px';
  host.appendChild(el);
  let key = '';
  return {
    el,
    show(content) {
      const lines = typeof content === 'string' ? cueLines(content) : content;
      const next = cuePlain(lines);
      if (next === key) return;
      key = next;
      clear(el);
      lines.forEach((runs) => {
        const line = h('div', { class: 'subs-line' });
        const box = h('span', null);
        runs.forEach((r) => box.appendChild(r.italic ? h('i', null, r.text) : document.createTextNode(r.text)));
        line.appendChild(box);
        el.appendChild(line);
      });
      el.style.display = lines.length ? '' : 'none';
    },
    hide() { if (key === '') return; key = ''; clear(el); el.style.display = 'none'; },
    raise(up) { el.style.bottom = Math.round(height * (up ? BOTTOM_SHOWN : BOTTOM_HIDDEN)) + 'px'; },
    destroy() { if (el.parentNode) el.parentNode.removeChild(el); },
  };
}
