/*
 * The report viewer (web build only): the page a phone opens from the Diagnostics QR code. The link is
 * https://.../#r=<deflated, base64url text>; the fragment never goes to a server, and this page decodes it right here and shows
 * the text with Copy and Share buttons. No app boots behind it.
 */
import { decodeReportHash, REPORT_PREFIX } from '../core/report-text.js';

const CSS = [
  'html.rv, html.rv body { width: auto; height: auto; min-height: 100%; overflow: auto; cursor: auto; user-select: text; -webkit-user-select: text; background: #0e0c0a; color: #f3eee6; }',
  '.rv-page { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px 16px; font-family: Inter, system-ui, sans-serif; font-size: 16px; line-height: 24px; }',
  '.rv-page h1 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 40px; line-height: 44px; margin-bottom: 16px; }',
  '.rv-text { white-space: pre-wrap; overflow-wrap: anywhere; font-family: Menlo, Consolas, "DejaVu Sans Mono", monospace; font-size: 13px; line-height: 19px; padding: 14px; border-radius: 12px; background: rgba(255,255,255,0.08); }',
  '.rv-bar { margin: 16px 0; }',
  '.rv-btn, .rv-link { display: inline-block; margin-right: 12px; padding: 12px 22px; border: 0; border-radius: 999px; font: inherit; font-weight: 600; color: #15110e; background: #f3d9b1; text-decoration: none; cursor: pointer; }',
  '.rv-link { background: transparent; color: #f3d9b1; padding-left: 0; }',
].join('\n');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Selects the text of [node] (the Copy fallback). */
function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  try { return document.execCommand('copy'); } catch (e) { return false; }
}

/** Replaces the page with the report in [hash] (or "This report link is damaged."). */
export function showReport(hash = location.hash) {
  const text = decodeReportHash(hash);
  document.documentElement.className = 'rv';
  document.title = 'Alder report';
  const style = el('style', '', CSS);
  document.head.appendChild(style);
  document.body.textContent = '';
  const page = el('div', 'rv-page');
  page.appendChild(el('h1', '', 'Alder report'));
  if (text === null) {
    page.appendChild(el('p', '', 'This report link is damaged.'));
  } else {
    const pre = el('pre', 'rv-text', text);
    const bar = el('div', 'rv-bar');
    const copy = el('button', 'rv-btn', 'Copy');
    copy.type = 'button';
    const done = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 2000); };
    copy.addEventListener('click', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { if (selectText(pre)) done(); });
      else if (selectText(pre)) done();
    });
    bar.appendChild(copy);
    if (typeof navigator.share === 'function') {
      const share = el('button', 'rv-btn', 'Share');
      share.type = 'button';
      share.addEventListener('click', () => { navigator.share({ title: 'Alder report', text }).catch(() => {}); });
      bar.appendChild(share);
    }
    page.appendChild(bar);
    page.appendChild(pre);
  }
  const open = el('a', 'rv-link', 'Open Alder');
  open.href = location.pathname + location.search;
  open.addEventListener('click', (ev) => { ev.preventDefault(); history.replaceState(null, '', location.pathname + location.search); location.reload(); });
  const foot = el('div', 'rv-bar');
  foot.appendChild(open);
  page.appendChild(foot);
  document.body.appendChild(page);
}

/** True when the page was opened from a report link. */
export function isReportHash(hash = location.hash) {
  return String(hash).indexOf(REPORT_PREFIX) === 0;
}
