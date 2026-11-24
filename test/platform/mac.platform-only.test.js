// Guard: the Mac build keeps one patch group (MAIN_PATCHES), the Mac-only code stays in src/platform/mac/, and shared code never names `#platform/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED_GROUPS = ['MAIN_PATCHES'];
const MAC_FILES = ['back-button.js', 'bridge.js', 'device.js', 'diag-export.js', 'index.js', 'keys.js', 'language.js', 'layout.js', 'lifecycle.js', 'mac.css', 'mpv.js', 'osk.js', 'play-hook.js', 'player-input.js', 'pointer.js', 'signin-form.js'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('scripts/build.mjs declares only the allowed patch groups', () => {
  const text = readFileSync(join(ROOT, 'scripts/build.mjs'), 'utf8');
  const found = [];
  const re = /^(?:export )?const ([A-Z][A-Z0-9_]*_PATCHES)\b/gm;
  let m;
  while ((m = re.exec(text))) found.push(m[1]);
  const extra = found.filter((n) => !ALLOWED_GROUPS.includes(n));
  assert.deepEqual(extra, [], 'patch groups not allowed: ' + extra.join(', '));
});

test('src/platform/mac/ holds exactly the Mac-only files', () => {
  const have = readdirSync(join(ROOT, 'src/platform/mac')).sort();
  const want = MAC_FILES.slice().sort();
  assert.deepEqual(have.filter((n) => !want.includes(n)), [], 'extra files');
  assert.deepEqual(want.filter((n) => !have.includes(n)), [], 'missing files');
});

test('no file under src/ outside src/platform/ names #platform/', () => {
  const bad = walk(join(ROOT, 'src')).filter((p) => !p.split(sep).join('/').includes('/src/platform/'))
    .filter((p) => readFileSync(p, 'utf8').includes('#platform/'));
  assert.deepEqual(bad, [], 'files naming #platform/: ' + bad.join(', '));
});
