'use strict';
// The Mac build must not tell her she is on a TV: no user-visible string in dist-mac (app.js, index.html, app.css) holds the word TV.
// dist-mac comes from `npm run build:mac`; the Mac patch table in scripts/build.mjs swaps the shared src/ wording.
const nodeTest = require('node:test').test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, 'dist-mac');
const BUILT = fs.existsSync(path.join(DIST, 'app.js'));
const SKIP = !BUILT && 'dist-mac not built (npm run build:mac)';

// Exclusions (a string is skipped only if a regex here matches the whole literal; each needs a reason).
//  - 'TV Shows: ': src/app/home-model.js:188 strips this prefix from an add-on's catalog name before matching; it is compared, never displayed.
//  - Code identifiers (createTvLanguage, tvLanguage, TVs in names) are not /\bTV\b/ matches, so need no entry.
//  - Tizen-only modules are not in dist-mac, so need no entry.
// Do not add an entry for text she can read.
const EXCLUDED = [/^TV Shows: $/];

const WORD = /\bTV\b/;

/** String and template literals of a JS source, comments skipped. Template `${...}` code is scanned as code, the text parts as strings. */
function jsStrings(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let last = ''; // last significant char, to tell a regex from a division
  const braces = []; // template nesting: brace depth at each open `${`
  let depth = 0;
  const readTemplate = () => { // i is just after a ` or a closing } of ${}
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += src[i + 1]; i += 2; continue; }
      if (c === '`') { i++; out.push(s); last = '`'; return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; out.push(s); braces.push(depth); depth++; last = '{'; return; }
      s += c; i++;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let s = ''; i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') { s += src[i + 1]; i += 2; } else { s += src[i++]; } }
      i++; out.push(s); last = c; continue;
    }
    if (c === '`') { i++; readTemplate(); continue; }
    if (c === '/') {
      const prevWord = /[\w$)\]]/.test(last) || last === '"' || last === "'" || last === '`';
      if (!prevWord) { // regex literal: skip it (its text is a pattern, never shown)
        i++;
        let cls = false;
        while (i < n && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
        i++;
        while (/[a-z]/.test(src[i] || '')) i++;
        last = ')';
        continue;
      }
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (braces.length && braces[braces.length - 1] === depth) { braces.pop(); i++; readTemplate(); continue; }
    }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}

const hits = (list) => list.filter((s) => WORD.test(s) && !EXCLUDED.some((re) => re.test(s)));

nodeTest('the tokenizer reads strings, templates and skips comments and regexes', () => {
  const got = jsStrings("a = 'x TV'; // no TV here\n/* TV */ b = `t ${ f('y') } u`; r = /TV/g; q = 4 / 2; z = \"w\";");
  assert.deepEqual(got, ['x TV', 't ', 'y', ' u', 'w']);
});

nodeTest('dist-mac/app.js has no user-visible "TV"', { skip: SKIP }, () => {
  const found = hits(jsStrings(fs.readFileSync(path.join(DIST, 'app.js'), 'utf8')));
  assert.deepEqual(found, [], 'strings with the word TV:\n' + found.map((s) => '  ' + JSON.stringify(s)).join('\n'));
});

nodeTest('dist-mac/index.html has no visible "TV" (text, title, alt, placeholder, aria-label)', { skip: SKIP }, () => {
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const parts = [];
  parts.push(...(html.match(/<title[^>]*>[\s\S]*?<\/title>/gi) || []).map((t) => t.replace(/<[^>]*>/g, '')));
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  for (const m of body.matchAll(/\b(?:title|alt|placeholder|aria-label)\s*=\s*("([^"]*)"|'([^']*)')/gi)) parts.push(m[2] !== undefined ? m[2] : m[3]);
  parts.push(...body.replace(/<[^>]*>/g, ' ').split(/\n/));
  const found = hits(parts);
  assert.deepEqual(found, [], 'visible HTML with the word TV:\n' + found.join('\n'));
});

nodeTest('dist-mac/app.css has no "TV" in a content string', { skip: SKIP }, () => {
  const css = fs.readFileSync(path.join(DIST, 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found = hits([...css.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] !== undefined ? m[1] : m[2]));
  assert.deepEqual(found, [], 'CSS strings with the word TV:\n' + found.join('\n'));
});
