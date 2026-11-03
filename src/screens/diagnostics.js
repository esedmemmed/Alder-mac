/*
 * Diagnostics (PLAN.md "Added for Tizen"): the screen the owner photographs with a phone when something does not play,
 * since there is no logcat on a TV. It shows the app's last 200 log lines, the device profile, the stream played last
 * (host and file name only: the URL can carry a debrid token), AVPlay's raw track list as it came, and every audio
 * decision with its reason. Large monospace text, scrolled with the D-pad, readable from the sofa.
 *
 *   openDiagnostics(context)       Settings > About calls this (the "Diagnostics" row, or hold OK on the version)
 *   diagnosticsScreens             { diagnostics } for the router's screen table
 *   buildReport(sources)           the report as sections of lines (pure, tested)
 *
 * The ICONS section draws every icon three ways, each light on dark and dark on light, and says how many were laid out
 * with a size (and, for the <img> row, how many loaded): the 0.1.0 player showed empty circles on the TV, so one photo of
 * this screen tells which way of drawing icons the TV can do (docs/DECISIONS.md "Icons on the TV").
 */
import { h } from '../lib/dom.js';
import { formatEntry } from '../lib/log.js';
import { log as appLog } from '../lib/log.js';
import { ENV, VERSION } from '../lib/env.js';
import { describeDevice, deviceProfile } from '../core/device.js';
import { diag as appDiag } from '../player/diag.js';
import { pictureLines } from '../player/picture.js';
import { ICON_NAMES, iconEl, iconSvg, iconImg, INK_LIGHT, INK_DARK } from '../ui/icons.js';

const LINE = 40; // px: one line of the report
const FIVE = 5; // lines per Up / Down press (a held key repeats)

/** "12:03:44" from a millisecond time. */
function clockOf(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

/**
 * The report: [{ title, lines: [{ text, level }] }]. [sources]: { log (a logger), diag (a snapshot), device (a profile),
 * version, env, agent }. Raw track info is printed as it came, one line per track, because the first TV test is what
 * tells us the real shape of AVPlay's extra_info.
 */
export function buildReport({ log, diag, device = null, version = '', env = '', agent = '' }) {
  const out = [];
  const section = (title, lines, extra) => out.push(Object.assign({ title, lines: lines.map((l) => (typeof l === 'string' ? { text: l, level: '' } : l)) }, extra));

  section('APP', ['Alder ' + version + ' (' + env + ')', agent]);
  // right under APP so the first photo has it: the icons are drawn by createDiagnosticsScreen (they need a DOM)
  section('ICONS', [ICON_NAMES.length + ' icons, light on dark (left) and dark on light (right); all three rows should show every icon'], { icons: true });
  section('DEVICE', device ? [describeDevice(device)].concat(device.notes || []) : ['No device profile yet']);

  const s = diag.stream;
  if (s) {
    section('STREAM', [
      'source ' + s.at + ' of ' + s.total + (s.label ? '  ' + s.label : ''),
      'host  ' + (s.host || '(none)'),
      'file  ' + (s.file || '(none)'),
      'request headers sent: ' + (s.headers.length ? s.headers.join(', ') : 'none'),
    ]);
  } else section('STREAM', ['Nothing has been played yet']);

  // What shape the file is and what the player did about it: tells a film's own black bars from a picture that is too small
  if (s) section('PICTURE', pictureLines(diag.picture));

  const raw = diag.rawTracks;
  if (raw === null || raw === undefined) section('AVPLAY TRACKS (raw)', ['Not read yet']);
  else if (!Array.isArray(raw)) section('AVPLAY TRACKS (raw)', ['getTotalTrackInfo gave: ' + JSON.stringify(raw)]);
  else section('AVPLAY TRACKS (raw)', raw.length ? raw.map((t) => '#' + t.index + ' ' + t.type + '  ' + (typeof t.extra_info === 'string' ? t.extra_info : JSON.stringify(t.extra_info))) : ['The list is empty']);

  section('AUDIO AND SOURCE DECISIONS', diag.decisions.length ? diag.decisions.map((d) => clockOf(d.t) + '  ' + d.text) : ['None yet']);
  if (diag.errors.length) section('PLAYER ERRORS', diag.errors.map((e) => ({ text: clockOf(e.t) + '  ' + e.text, level: 'error' })));

  const entries = log.lines();
  section('LOG (last ' + entries.length + ' of ' + log.capacity + ', newest at the bottom)',
    entries.length ? entries.map((e) => ({ text: formatEntry(e), level: e.level })) : ['The log is empty']);
  return out;
}

/** Three ways to draw an icon, as makers of a cell's content: [name], [ink] -> element. */
const ICON_WAYS = [
  { id: 'svg', label: 'svg, built by script (explicit size and colour)', make: (name, ink) => iconEl(name, 40, { color: ink }) },
  // the way most screens draw: markup in a .icon box that the stylesheet sizes, colour from the CSS colour
  { id: 'html', label: 'svg, as markup in a sized box (the app)', make: (name) => { const box = h('span', { class: 'icon' }); box.innerHTML = iconSvg(name); return box; } },
  { id: 'img', label: 'img, data: URI (colour baked in)', make: (name, ink) => iconImg(name, 40, ink) },
];

/**
 * The Icons block: for each way, a dark strip and a light strip with every icon in it, and a status line counting what was
 * laid out with a size (svg) or loaded (img). Returns { el, update() }; update() re-counts (the images load after mount).
 */
export function createIconsBlock() {
  const el = h('div', { class: 'dg-icons' });
  const ways = ICON_WAYS.map((way) => {
    const status = h('div', { class: 'dg-line' }, way.label);
    const items = [];
    const strip = (cls, ink) => h('div', { class: 'dg-strip ' + cls }, ICON_NAMES.map((name) => {
      const node = way.make(name, ink);
      items.push(node);
      return h('div', { class: 'dg-ic' }, node);
    }));
    el.appendChild(status);
    el.appendChild(h('div', { class: 'dg-strips' }, strip('dark', INK_LIGHT), strip('light', INK_DARK)));
    return { way, status, items };
  });
  function update() {
    ways.forEach(({ way, status, items }) => {
      let ok = 0;
      let box = '';
      items.forEach((node) => {
        if (way.id === 'img') { if (node.complete && node.naturalWidth > 0) ok++; return; }
        const svg = node.querySelector('svg');
        const r = svg ? svg.getBoundingClientRect() : null;
        if (r && r.width > 0 && r.height > 0) { ok++; box = Math.round(r.width) + 'x' + Math.round(r.height); }
      });
      status.textContent = way.label + '  ' + ok + '/' + items.length + (way.id === 'img' ? ' loaded' : ' sized ' + box);
      status.className = 'dg-line' + (ok < items.length ? ' warn' : '');
    });
  }
  ways.forEach(({ way, items }) => { if (way.id === 'img') items.forEach((img) => { img.addEventListener('load', update); img.addEventListener('error', update); }); });
  return { el, update };
}

export function createDiagnosticsScreen() {
  let viewport = null;
  let content = null;
  let status = null;
  let scroll = 0;
  let maxScroll = 0;

  function setScroll(to) {
    scroll = Math.max(0, Math.min(maxScroll, to));
    content.style.transform = 'translate3d(0,' + (-scroll) + 'px,0)';
    status.textContent = (maxScroll > 0 ? Math.round(scroll / maxScroll * 100) + '%   ' : '') + '▲▼ Scroll   ◀ ▶ Page   OK Top / end   Back Close';
  }

  return {
    mount(root, p, context) {
      const svc = context.player || {};
      const log = context.log || appLog;
      const device = svc.device || (typeof window !== 'undefined' ? deviceProfile({ webapis: window.webapis }) : null);
      const report = buildReport({ log, diag: appDiag.snapshot(), device, version: VERSION, env: ENV, agent: navigator.userAgent });

      content = h('div', { class: 'dg-content' });
      let icons = null;
      report.forEach((sec) => {
        content.appendChild(h('div', { class: 'dg-heading' }, sec.title));
        sec.lines.forEach((l) => content.appendChild(h('div', { class: 'dg-line' + (l.level === 'error' ? ' error' : l.level === 'warn' ? ' warn' : l.level === 'debug' ? ' debug' : '') }, l.text)));
        if (sec.icons) { icons = createIconsBlock(); content.appendChild(icons.el); }
      });
      status = h('div', { class: 'dg-status' });
      viewport = h('div', { class: 'dg-viewport' }, content);
      root.appendChild(h('div', { class: 'dg-screen' }, h('div', { class: 'dg-title t-title' }, 'Diagnostics'), viewport, status));
      maxScroll = Math.max(0, content.offsetHeight - viewport.clientHeight);
      if (icons) icons.update();
      setScroll(0);
    },

    onKey(evt) {
      if (evt.type !== 'press') return true;
      const a = evt.action;
      const page = viewport ? viewport.clientHeight - 2 * LINE : 800;
      if (a === 'down') setScroll(scroll + FIVE * LINE);
      else if (a === 'up') setScroll(scroll - FIVE * LINE);
      else if (a === 'right') setScroll(scroll + page);
      else if (a === 'left') setScroll(scroll - page);
      else if (a === 'ok' && !evt.repeat) setScroll(scroll >= maxScroll ? 0 : maxScroll);
      else return false; // Back (and anything else) falls through: the router pops
      return true;
    },
  };
}

export const diagnosticsScreens = { diagnostics: createDiagnosticsScreen };

/** Opens the Diagnostics screen on the router in [context]. */
export function openDiagnostics(context) {
  context.router.push('diagnostics');
}
