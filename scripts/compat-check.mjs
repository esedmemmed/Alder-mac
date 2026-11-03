/*
 * Tizen 5.5 / Chromium M69 compatibility check (PLAN.md section 2). Greps src/ (JS and CSS) and the built dist/app
 * for what that engine lacks: APIs newer than M69 that nobody polyfilled, and CSS it cannot parse. Fails (exit 1) on
 * any error; warnings are printed and do not fail.
 *
 * esbuild lowers modern *syntax* (?., ??, class fields, ...) for the chrome69 target but never adds APIs, so APIs are
 * what this checks. An API is allowed when src/lib/compat.js lists it in POLYFILLED. To adjust the list for another
 * engine, edit RULES below: each rule says which Chromium version added the thing.
 *
 * Usage: node scripts/compat-check.mjs [--no-dist]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * JS rules. `needs`: polyfill names (from compat.js POLYFILLED) that make the use acceptable; none = never allowed.
 * `files`: paths (relative to the repo, forward slashes) where the rule does not apply.
 */
export const JS_RULES = [
  { id: 'Promise.allSettled', re: /\bPromise\s*\.\s*allSettled\b/, since: 76, needs: ['Promise.allSettled'] },
  { id: 'Promise.any', re: /\bPromise\s*\.\s*any\b/, since: 85, needs: ['Promise.any'] },
  { id: 'AggregateError', re: /\bAggregateError\b/, since: 85, needs: ['AggregateError'] },
  { id: 'Object.fromEntries', re: /\bObject\s*\.\s*fromEntries\b/, since: 73, needs: ['Object.fromEntries'] },
  { id: 'Object.hasOwn', re: /\bObject\s*\.\s*hasOwn\b/, since: 93, needs: ['Object.hasOwn'] },
  { id: 'replaceAll', re: /\.\s*replaceAll\s*\(/, since: 85, needs: ['String.prototype.replaceAll'] },
  { id: 'matchAll', re: /\.\s*matchAll\s*\(/, since: 73, needs: ['String.prototype.matchAll'] },
  { id: '.at()', re: /\.\s*at\s*\(/, since: 92, needs: ['Array.prototype.at', 'String.prototype.at'] },
  { id: 'findLast', re: /\.\s*findLast\s*\(/, since: 97, needs: ['Array.prototype.findLast'] },
  { id: 'findLastIndex', re: /\.\s*findLastIndex\s*\(/, since: 97, needs: ['Array.prototype.findLastIndex'] },
  { id: 'structuredClone', re: /\bstructuredClone\s*\(/, since: 98, needs: ['structuredClone'] },
  { id: 'queueMicrotask', re: /\bqueueMicrotask\b/, since: 71, needs: ['queueMicrotask'] },
  { id: 'globalThis', re: /\bglobalThis\b/, since: 71, needs: ['globalThis'] },
  { id: 'replaceChildren', re: /\.\s*replaceChildren\s*\(/, since: 86, needs: ['Element.prototype.replaceChildren'] },
  { id: 'CompressionStream', re: /\b(?:De)?CompressionStream\b/, since: 80, needs: null, hint: 'use pako' },
  { id: 'ResizeObserver', re: /\bResizeObserver\b/, since: 64, needs: null, hint: 'measure on render or focus instead; it is flaky on this TV' },
  { id: 'AbortSignal.timeout', re: /\bAbortSignal\s*\.\s*(?:timeout|any)\b/, since: 103, needs: null, hint: 'use an AbortController and a timer' },
  { id: 'randomUUID', re: /\brandomUUID\b/, since: 92, needs: null },
  { id: 'toSorted', re: /\.\s*(?:toSorted|toReversed|toSpliced)\s*\(/, since: 110, needs: null },
  { id: 'Intl.ListFormat', re: /\bIntl\s*\.\s*(?:ListFormat|RelativeTimeFormat|Segmenter|DisplayNames)\b/, since: 71, needs: null },
  { id: 'TextDecoderStream', re: /\bText(?:De|En)coderStream\b/, since: 71, needs: null },
  { id: 'WeakRef', re: /\b(?:WeakRef|FinalizationRegistry)\b/, since: 84, needs: null },
  { id: 'Object.groupBy', re: /\b(?:Object|Map)\s*\.\s*groupBy\b/, since: 117, needs: null },
  // Array.prototype.sort was not stable before V8 7.0 (Chromium 70): equal elements may swap, for arrays over 10 items.
  // Alder's ranking relies on Kotlin's stable sortedBy, so comparator sorts go through stableSort (src/core/util.js,
  // which decorates with the index). A sort whose ties cannot matter may say so with `// compat-ok: unstable sort`.
  { id: 'unstable sort', re: /\.\s*sort\s*\(\s*[^)\s]/, since: 70, needs: null, files: ['src/core/util.js'],
    hint: 'Array#sort is not stable on Chromium 69: use stableSort from src/core/util.js (or mark `// compat-ok: unstable sort` when ties cannot matter)' },
  { id: 'IntersectionObserver', re: /\bIntersectionObserver\b/, since: 58, needs: null, warn: true, hint: 'allowed, but use sparingly (PLAN.md)' },
];

export const CSS_RULES = [
  { id: 'gap', re: /(?<![-\w])(?:row-|column-)?gap\s*:/, since: 84, hint: 'flex/grid gap: use margins (grid-gap is fine in grid only)' },
  { id: 'aspect-ratio', re: /(?<![-\w])aspect-ratio\s*:/, since: 88 },
  { id: 'inset', re: /(?<![-\w])inset(?:-[a-z-]+)?\s*:/, since: 87, hint: 'use top/right/bottom/left (box-shadow "inset" values are fine)' },
  { id: ':focus-visible', re: /:focus-visible/, since: 86, hint: 'use :focus' },
  { id: ':is/:where', re: /:(?:is|where)\(/, since: 88 },
  { id: ':has', re: /:has\(/, since: 105 },
  { id: 'nesting', re: /(?:^|[\s{;])&[\s.:#[>+~]/, since: 112 },
  { id: 'backdrop-filter', re: /backdrop-filter/, since: 76, hint: 'no blur on this TV: use a darker tint' },
  { id: 'clamp/min/max()', re: /(?<![-\w])(?:clamp|min|max)\(/, since: 79 },
  { id: 'container queries', re: /@container|container-type|container-name/, since: 105 },
  { id: 'color-mix', re: /color-mix\(/, since: 111 },
  { id: 'lch/oklch', re: /(?<![-\w])(?:ok)?(?:lch|lab)\(/, since: 111 },
  { id: '@layer', re: /@layer\b/, since: 99 },
  { id: 'scroll-snap/overscroll', re: /overscroll-behavior|scrollbar-width|scrollbar-color/, since: 63, warn: true },
];

/**
 * Replaces comments and the insides of string and template literals with spaces (newlines kept), so rules see only
 * code and report the right line. A small scanner, not a parser: a regex literal is recognised by the token before it.
 */
export function codeView(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const stack = []; // template literal nesting: brace depth at each `${`
  let i = 0;
  let prev = ''; // last significant (non-space) character of code
  let braces = 0;
  const regexStarts = '(,=:[!&|?{};+-*%<>~^';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; prev = c; continue;
    }
    if (c === '`' || (c === '}' && stack.length && stack[stack.length - 1] === braces)) {
      if (c === '}') stack.pop();
      let j = i + 1;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') break;
        j++;
      }
      blank(i + 1, j);
      if (src[j] === '$') { stack.push(braces); i = j + 2; prev = '{'; } else { i = j + 1; prev = '`'; }
      continue;
    }
    if (c === '/' && (prev === '' || regexStarts.indexOf(prev) >= 0 || /(?:return|typeof|case|in|of)\s*$/.test(src.slice(Math.max(0, i - 8), i)))) {
      let j = i + 1; let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (src[j] === '/') { blank(i + 1, j); i = j + 1; prev = '/'; continue; }
    }
    if (c === '{') braces++;
    else if (c === '}') braces--;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

export function cssView(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0])
    .replace(/url\([^)]*\)/g, (m) => 'url(' + ' '.repeat(m.length - 5) + ')');
}

/** Names listed in compat.js POLYFILLED. */
export function readPolyfilled(root = ROOT) {
  const file = join(root, 'src/lib/compat.js');
  if (!existsSync(file)) return new Set();
  const m = /POLYFILLED\s*=\s*\[([\s\S]*?)\]/.exec(readFileSync(file, 'utf8'));
  return new Set(m ? Array.from(m[1].matchAll(/'([^']+)'/g), (x) => x[1]) : []);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Findings for one file: [{ file, line, rule, since, message, warn }] */
export function scanText(file, text, kind, polyfilled) {
  const findings = [];
  const view = kind === 'js' ? codeView(text) : kind === 'css' ? cssView(text) : text;
  const rules = kind === 'js' ? JS_RULES : kind === 'css' ? CSS_RULES : [];
  for (const rule of rules) {
    if (rule.files && rule.files.indexOf(file) >= 0) continue;
    // A rule with a per-file exemption (stableSort's own sort) cannot be judged in the bundle, which is one minified file with
    // no comments or paths: the source scan above already checks every src file against it.
    if (rule.files && file.indexOf('dist/') === 0) continue;
    if (kind === 'js' && rule.needs && rule.needs.every((n) => polyfilled.has(n))) continue;
    const re = new RegExp(rule.re.source, rule.re.flags.replace('g', '') + 'g');
    let m;
    const lines = text.split('\n');
    while ((m = re.exec(view)) !== null) {
      const at = lineOf(view, m.index);
      // `compat-ok: <rule id>` on the line or the one above waives a finding (for code that guards its own use).
      if ((lines[at - 1] + '\n' + (lines[at - 2] || '')).indexOf('compat-ok: ' + rule.id) >= 0) continue;
      findings.push({
        file, line: at, rule: rule.id, since: rule.since, warn: !!rule.warn,
        message: rule.id + ' needs Chromium ' + rule.since + ' (Tizen 5.5 has 69)' + (rule.hint ? ': ' + rule.hint : ''),
      });
      if (m[0] === '') re.lastIndex++;
    }
  }
  if (kind === 'html' && /<meta[^>]+name=["']viewport["']/i.test(text) === false) {
    findings.push({ file, line: 1, rule: 'viewport', since: 0, warn: false, message: 'index.html needs <meta name="viewport" content="width=1920">' });
  }
  if (kind === 'html' && !/name=["']viewport["'][^>]*width=1920/i.test(text)) {
    findings.push({ file, line: 1, rule: 'viewport', since: 0, warn: false, message: 'the viewport meta must say width=1920 (the app is laid out at a fixed 1920x1080)' });
  }
  return findings;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const KIND = { '.js': 'js', '.mjs': 'js', '.css': 'css', '.html': 'html' };

/**
 * Scans src/ and index.html, and dist/app when it exists. Returns { findings, scanned, errors, warnings }.
 * Production output must also contain nothing of the dev harness.
 */
export function checkCompat({ root = ROOT, dist = true } = {}) {
  const polyfilled = readPolyfilled(root);
  const files = [...walk(join(root, 'src'))];
  if (existsSync(join(root, 'index.html'))) files.push(join(root, 'index.html'));
  const prod = join(root, 'dist/app');
  if (dist && existsSync(prod)) files.push(...walk(prod));
  const findings = [];
  let scanned = 0;
  for (const abs of files) {
    const kind = KIND[extname(abs)];
    if (!kind) continue;
    const rel = relative(root, abs).split('\\').join('/');
    const text = readFileSync(abs, 'utf8');
    scanned++;
    // The bundle's own text is minified (one line); rules still apply, findings just all say line 1.
    findings.push(...scanText(rel, text, kind, polyfilled));
    if (rel.startsWith('dist/app/') && (kind === 'js' || kind === 'html')) {
      for (const bad of ['__fx', 'mock-tizen', 'ALDER_FIXTURE', 'sourceMappingURL']) {
        if (text.indexOf(bad) >= 0) findings.push({ file: rel, line: 1, rule: 'dev code in prod', since: 0, warn: false, message: 'production output contains "' + bad + '": dev-only code leaked into the build' });
      }
    }
  }
  const errors = findings.filter((f) => !f.warn);
  const warnings = findings.filter((f) => f.warn);
  return { findings, scanned, errors, warnings };
}

export function report(result, out = console) {
  for (const f of result.findings) out.log((f.warn ? 'warn  ' : 'ERROR ') + f.file + ':' + f.line + '  ' + f.message);
  out.log('compat: ' + result.scanned + ' files scanned, ' + result.errors.length + ' error(s), ' + result.warnings.length + ' warning(s)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkCompat({ dist: !process.argv.includes('--no-dist') });
  report(result);
  process.exit(result.errors.length ? 1 : 0);
}
