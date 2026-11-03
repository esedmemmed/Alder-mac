/*
 * Mac WebKit boot check (npm run check:mac). The Air's WebView is Safari 14 era (docs/air/webview-1.2.md); Playwright's WebKit is
 * newer, so this check (1) scans the dist-mac/app.js bundle for syntax a Safari 14 cannot parse (lookbehind regexes, anything past
 * ES2020 that esbuild left in, esbuild warnings for the safari14 target: T3.1 was a lookbehind in a RegExp built at load), then (2)
 * loads dist-mac/ in Playwright WebKit on a fake origin served the way mac/shell/WebHost.swift serves alder://app (same MIME table
 * read from that file, "/" is index.html, unknown extension is octet-stream, a missing file fails), with Object.hasOwn,
 * Array.prototype.at/findLast/toSorted and structuredClone deleted first and RegExp lookbehind refused, and asserts that no page
 * error or console error occurs and that the sign-in screen renders (non-empty, visible #app). Run `npm run build:mac` first.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-mac');
const ORIGIN = 'https://alder.test';
const failures = [];
const notes = [];
const fail = (m) => { failures.push(m); console.log('FAIL ' + m); };
const ok = (m) => console.log('ok   ' + m);

if (!existsSync(join(DIST, 'index.html'))) { console.error('no dist-mac/index.html: run npm run build:mac first'); process.exit(1); }

// The MIME table of WebHost.swift (AlderSchemeHandler.mime), read from the source so the two cannot drift.
const swift = readFileSync(join(ROOT, 'mac/shell/WebHost.swift'), 'utf8');
const mimeBlock = swift.match(/static let mime: \[String: String\] = \[([\s\S]*?)\n\s*\]/);
if (!mimeBlock) { console.error('WebHost.swift: mime table not found'); process.exit(1); }
const MIME = Object.fromEntries([...mimeBlock[1].matchAll(/"(\w+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));

// 1. Bundle syntax for Safari 14.
const { transform } = await import('esbuild');
const app = readFileSync(join(DIST, 'app.js'), 'utf8');
const lookbehind = app.match(/\(\?<[=!]/g);
if (lookbehind) fail('app.js holds ' + lookbehind.length + ' lookbehind regex(es) (Safari < 16.4 throws SyntaxError)'); else ok('app.js: no lookbehind');
const es2020 = await transform(app, { target: 'es2020', logLevel: 'silent' });
const esnext = await transform(app, { target: 'esnext', logLevel: 'silent' });
if (es2020.code !== esnext.code) fail('app.js holds syntax past ES2020 (class fields, static blocks, ??=, numeric separators, ...): lowering to es2020 changes it'); else ok('app.js: nothing past ES2020');
const s14 = await transform(app, { target: 'safari14', logLevel: 'silent', supported: { destructuring: true } });
if (s14.warnings.length) s14.warnings.forEach((w) => fail('esbuild safari14: ' + w.text)); else ok('app.js: no esbuild safari14 warning');

// 2. The page in WebKit.
const { webkit } = await import('playwright');
const browser = await webkit.launch();
const served = new Map();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    for (const [o, k] of [[Object, 'hasOwn'], [Array.prototype, 'at'], [Array.prototype, 'findLast'], [Array.prototype, 'toSorted']]) delete o[k];
    delete window.structuredClone;
    const Native = window.RegExp;
    window.RegExp = function RegExp(p, f) {
      if (typeof p === 'string' && /\(\?<[=!]/.test(p)) throw new SyntaxError('Invalid regular expression: lookbehind (Safari < 16.4): ' + p);
      return new Native(p, f);
    };
    window.RegExp.prototype = Native.prototype;
    window.__posted = []; // a stand-in for the shell: what the page's log forwarder posts
    window.webkit = { messageHandlers: { alder: { postMessage: (m) => window.__posted.push(m) } } };
    window.__missing = [typeof Object.hasOwn, typeof [].at, typeof [].findLast, typeof [].toSorted, typeof window.structuredClone].join(',');
  });
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort(); // no network in this check
    let path = decodeURIComponent(url.pathname);
    if (path === '' || path === '/') path = '/index.html';
    const file = join(DIST, path);
    if ((!file.startsWith(DIST + '/') && !file.startsWith(DIST + '\\')) || !existsSync(file)) { served.set(path, 'missing'); return route.fulfill({ status: 404, body: '' }); }
    const ext = extname(file).slice(1).toLowerCase();
    served.set(path, MIME[ext] || 'application/octet-stream');
    return route.fulfill({ status: 200, contentType: MIME[ext] || 'application/octet-stream', body: readFileSync(file) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  ok('missing APIs in the page: ' + await page.evaluate(() => window.__missing) + ' (typeof hasOwn,at,findLast,toSorted,structuredClone before the app ran)');
  const state = await page.evaluate(() => {
    const el = document.getElementById('app');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return { children: el.childNodes.length, w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, text: text.slice(0, 60), inputs: el.querySelectorAll('input').length };
  });
  errors.forEach((e) => fail(e));
  if (!errors.length) ok('no page error, no console error');
  if (!state.children || state.w < 100 || state.h < 100 || state.display === 'none' || state.visibility === 'hidden' || Number(state.opacity) === 0) fail('#app is empty or not visible: ' + JSON.stringify(state));
  else if (!/welcome|sign in|connect|e-mail/i.test(state.text) || !state.inputs) fail('#app renders, but not the first screen of sign-in: ' + JSON.stringify(state));
  else ok('first (sign-in flow) screen renders: #app ' + state.w + 'x' + state.h + ', ' + state.inputs + ' input(s), "' + state.text + '"');
  // The focus fill (components.css `X::before`, absolute, z-index -1) is sized by the nearest positioned ancestor: an unpositioned X
  // let it cover its whole panel (Settings group list, T12: cream panel under light text). Every X that has such a ::before must be positioned.
  const unpositioned = await page.evaluate(() => {
    const bad = [];
    for (const cls of ['chip', 'btn-round', 'avatar', 'nav-item', 'row-item', 'sg-group', 'sg-row', 'st-row', 'ad-row', 'eg-row', 'pl-row', 'osk-key', 'sr-key', 'dt-more', 'sr-clear', 'pin-box', 'pl-btn', 'pl-chip']) {
      const el = document.createElement('div');
      el.className = cls;
      document.body.appendChild(el);
      if (getComputedStyle(el, '::before').position === 'absolute' && getComputedStyle(el).position === 'static') bad.push('.' + cls);
      el.remove();
    }
    return bad;
  });
  if (unpositioned.length) fail('focus-fill ::before is absolute but the element is not positioned (it would fill its panel): ' + unpositioned.join(' ')); else ok('focus-fill ::before: every host element is positioned');
  // the page log forwarder (mac/web/alder-index.html): boot stages arrive as bridge `log` commands, never with a link or a query string
  const posted = await page.evaluate(() => window.__posted);
  const lines = posted.filter((m) => m.cmd === 'log').map((m) => m.args.line);
  const want = ['boot: html', 'boot: bridge loaded', 'boot: first screen', 'boot: app.js loaded'];
  const lost = want.filter((w) => lines.indexOf(w) < 0);
  if (lost.length) fail('page log forwarder: missing ' + lost.join(', ') + ' (got ' + JSON.stringify(lines) + ')'); else ok('page log forwarder: ' + lines.join(' | '));
  const leaky = lines.filter((l) => /:\/\/|\?[^\s\[]/.test(l));
  if (leaky.length) fail('page log forwarder: link or query string in ' + JSON.stringify(leaky));
  // served paths vs WebHost.swift
  for (const [p, t] of served) {
    if (t === 'missing') fail('requested ' + p + ' that WebHost would fail to serve');
    else if (t === 'application/octet-stream') notes.push(p + ' is served as application/octet-stream by WebHost (extension not in its table)');
  }
  ok('served ' + served.size + ' path(s): ' + [...served.keys()].join(' '));
  await ctx.close();
} finally {
  await browser.close();
}
notes.forEach((n) => console.log('note ' + n));
console.log(failures.length ? failures.length + ' failure(s)' : 'check:mac ok');
process.exit(failures.length ? 1 : 0);
