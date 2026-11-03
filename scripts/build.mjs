/*
 * Builds Alder for Tizen.
 *
 *   node scripts/build.mjs          production: dist/app/ (the package contents) and dist/Alder.wgt (unsigned zip,
 *                                   config.xml at its root; Apps2Samsung re-signs it on install)
 *   node scripts/build.mjs --mac    Mac: dist-mac/ (see buildMac), target safari14, platform modules from src/platform/mac/
 *   node scripts/build.mjs --dev    dev: dist/dev/ (a static site with the Tizen mock and sourcemaps; serve it with
 *                                   `npm run dev`, which also serves dev/fixtures)
 *
 * JS: esbuild, one IIFE, target chrome69 (Tizen 5.5's engine, see docs/DECISIONS.md), minified in prod.
 * CSS: esbuild bundles src/ui/styles/main.css (fonts and images become files under assets/).
 * Production ends with the compat check and the .wgt verification, and fails the build on any error.
 */
import { build as esbuild } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join, relative, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zip } from './zip.mjs';
import { verifyWgt } from './verify-wgt.mjs';
import { checkCompat, report } from './compat-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** The Chromium version of Tizen 5.5 (2020 TVs): Samsung's Web Engine Specifications, M69. One constant to change. */
export const TARGET = 'chrome69';

/** The WebKit of the oldest macOS the shell supports (11, Safari 14). */
export const MAC_TARGET = 'safari14';

const WEBAPIS_TAG = '<script src="$WEBAPIS/webapis/webapis.js"></script>';

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function sizeKb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

export async function build({ dev = false, log = console.log } = {}) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const outDir = join(DIST, dev ? 'dev' : 'app');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const define = { __ALDER_ENV__: JSON.stringify(dev ? 'dev' : 'prod'), __ALDER_DEV__: dev ? 'true' : 'false', __ALDER_VERSION__: JSON.stringify(pkg.version) };
  const common = { bundle: true, target: TARGET, logLevel: 'silent', absWorkingDir: ROOT, legalComments: dev ? 'none' : 'external' };

  const js = await esbuild({
    ...common, entryPoints: ['src/main.js'], outfile: join(outDir, 'app.js'), format: 'iife', define,
    minify: !dev, sourcemap: dev ? 'linked' : false, metafile: true,
  });
  const css = await esbuild({
    ...common, entryPoints: ['src/ui/styles/main.css'], outfile: join(outDir, 'app.css'),
    minify: !dev, loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.webp': 'file' }, assetNames: 'assets/[name]-[hash]', metafile: true,
  });

  // index.html: in dev the mock replaces the TV's webapis.js
  let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  if (!html.includes(WEBAPIS_TAG)) throw new Error('index.html lost its $WEBAPIS script tag');
  if (dev) {
    html = html.replace(WEBAPIS_TAG, '<script src="mock-tizen.js"></script>');
    await esbuild({
      ...common, legalComments: 'none', entryPoints: ['dev/mock-entry.js'], outfile: join(outDir, 'mock-tizen.js'), format: 'iife',
      define, sourcemap: 'linked',
    });
  }
  writeFileSync(join(outDir, 'index.html'), html);
  copyFileSync(join(ROOT, 'icon.png'), join(outDir, 'icon.png'));

  const config = readFileSync(join(ROOT, 'config.xml'), 'utf8');
  const wv = /<widget\b[^>]*\bversion="([^"]+)"/.exec(config);
  if (!wv || wv[1] !== pkg.version) throw new Error('config.xml version (' + (wv && wv[1]) + ') differs from package.json (' + pkg.version + ')');
  writeFileSync(join(outDir, 'config.xml'), config);

  if (dev) {
    log('dev build: ' + relative(ROOT, outDir) + ' (' + sizeKb(statSync(join(outDir, 'app.js')).size) + ' js)');
    return { outDir, dev };
  }

  // licences travel with the package: the GPL text, the font licences, and esbuild's collected legal comments
  copyFileSync(join(ROOT, 'LICENSE'), join(outDir, 'LICENSE.txt'));
  mkdirSync(join(outDir, 'licenses'), { recursive: true });
  for (const f of ['INTER_LICENSE.txt', 'INSTRUMENT_SERIF_LICENSE.txt']) copyFileSync(join(ROOT, 'src/ui/fonts', f), join(outDir, 'licenses', f));
  writeFileSync(join(outDir, 'licenses/NOTICE.txt'),
    'Alder for Tizen ' + pkg.version + '\nGPL-3.0-or-later. A port of Alder, the Android TV Stremio client (https://github.com/aradhyas8/Alder).\n' +
    'Bundled: pako (MIT AND Zlib), qrcode-generator (MIT), Inter and Instrument Serif (SIL OFL 1.1).\n');

  // the package: config.xml first, then everything else in name order
  const files = walk(outDir).map((p) => relative(outDir, p).split('\\').join('/'));
  const order = ['config.xml', 'index.html'].concat(files.filter((f) => f !== 'config.xml' && f !== 'index.html'));
  const wgt = zip(order.map((name) => ({ name, data: readFileSync(join(outDir, name)) })));
  const wgtPath = join(DIST, 'Alder.wgt');
  writeFileSync(wgtPath, wgt);

  const verdict = verifyWgt(wgt);
  verdict.warnings.forEach((w) => log('wgt warning: ' + w));
  if (verdict.errors.length) { verdict.errors.forEach((e) => log('wgt ERROR: ' + e)); throw new Error('Alder.wgt failed verification'); }

  const compat = checkCompat({ root: ROOT, dist: true });
  report(compat, { log });
  if (compat.errors.length) throw new Error('compat check failed');

  log('Alder.wgt ' + sizeKb(wgt.length) + ', ' + files.length + ' files, id ' + verdict.info.appId + ', icon ' + verdict.info.icon);
  for (const f of files) log('  ' + f.padEnd(40) + sizeKb(statSync(join(outDir, f)).size).padStart(10));
  return { outDir, wgtPath, info: verdict.info, js: js.metafile, css: css.metafile };
}

// Shared modules the Mac build swaps for src/platform/mac/<file>: keys, device, language, and the player screen (a stub,
// so no engine and no failover). The Mac modules may import the shared ones; nobody else gets the Tizen versions.
const MAC_SWAPS = {
  'src/lib/keys.js': 'keys.js', 'src/core/device.js': 'device.js', 'src/player/language.js': 'language.js', 'src/player/screen.js': 'player.js',
  'src/ui/osk.js': 'osk.js', // native text fields, no on-screen keyboard
};
// src/main.js is shared and holds the Tizen exit and key registration: the Mac plugin patches its text on load (and throws if a piece moved).
const MAIN_PATCHES = [ // also diagnostics.js (webapis) and settings.js (the About text) below
  ["import { installed as polyfilled } from './lib/compat.js';", "import { installed as polyfilled } from './lib/compat.js';\nimport { macQuit } from './platform/mac/bridge.js';\nimport './platform/mac/layout.js';\nimport { installPointer } from './platform/mac/index.js';"],
  ['const engine = createFocusEngine({ root: document.body });', 'const engine = createFocusEngine({ root: document.body });\n  installPointer(engine);'],
  ['registerKeys(window.tizen)', 'registerKeys()'],
  ['webapis: window.webapis,', 'webapis: null,'],
  ['window.tizen.application.getCurrentApplication().exit();', "if (!macQuit()) log.info('app', 'exit requested (no native shell)');"],
];

/** esbuild plugin: `#platform/<name>` resolves to src/platform/mac/<name>.js, so shared code never branches at run time. */
function macPlatform() {
  return {
    name: 'mac-platform',
    setup(b) {
      const swaps = new Map(Object.entries(MAC_SWAPS).map(([from, to]) => [join(ROOT, from), join(ROOT, 'src/platform/mac', to)]));
      b.onResolve({ filter: /^\.\.?\// }, (a) => {
        if (a.kind === 'entry-point' || !a.importer || a.importer.startsWith(join(ROOT, 'src/platform/mac'))) return null;
        const target = resolve(a.resolveDir, a.path);
        return swaps.has(target) ? { path: swaps.get(target) } : null;
      });
      const patches = new Map([
        [join(ROOT, 'src/main.js'), MAIN_PATCHES],
        [join(ROOT, 'src/screens/diagnostics.js'), [['deviceProfile({ webapis: window.webapis })', 'deviceProfile({})']]],
        [join(ROOT, 'src/screens/settings.js'), [['Alder for Tizen is a port of Alder', 'Alder for Mac is a port of Alder']]],
        // sign-in leads with e-mail + password in native fields (platform/mac/signin-form.js), Return continues the name step
        [join(ROOT, 'src/screens/signin.js'), [
          ["import { qrSvg } from '../ui/qr.js';", "import { qrSvg } from '../ui/qr.js';\nimport { macSigninForm } from '#platform/signin-form';"],
          ["const emailChip = chip('Sign in with e-mail instead', { onClick: () => toState('email') });", "const emailChip = chip('Sign in with e-mail instead', { onClick: () => toState('email') });\n    const macForm = macSigninForm({ session, draftName: draft.name, onApproved: approved, log: log() });"],
          ["h('div', { class: 'ob-h1' }, 'Connect Stremio'),", "macForm.el,\n      h('div', { class: 't-title ob-or' }, 'Or connect with your phone'),"],
          ['ctx.engine.focus(backChip.el);', 'ctx.engine.focus(macForm.firstInput);'],
          ["const next = pill('Continue    →', { onClick: go });", "const next = pill('Continue    →', { onClick: go });\n    f.input.addEventListener('keydown', (e) => { if (e.keyCode === 13) go(); });"],
        ]],
        // search: the native field alone; the letter grid is built but never shown, and focus goes to the field
        [join(ROOT, 'src/screens/search.js'), [
          ['el.appendChild(buildKeyboard());', 'buildKeyboard();'],
          ['ctx.engine.focus(firstKey);', 'input.focus();'],
          ["if (a === 'down' && focus === input) { input.focus(); return true; }", "if (a === 'down' && focus === input) return false;"],
        ]],
      ]);
      b.onLoad({ filter: /\.js$/ }, (a) => {
        const list = patches.get(a.path);
        if (!list) return null;
        let text = readFileSync(a.path, 'utf8');
        for (const [from, to] of list) {
          if (!text.includes(from)) throw new Error('Mac build: ' + relative(ROOT, a.path) + ' no longer contains ' + JSON.stringify(from));
          text = text.split(from).join(to);
        }
        return { contents: text, loader: 'js', resolveDir: dirname(a.path) };
      });
      // the 1080-high design becomes the window's logical height (src/platform/mac/layout.js sets --app-h); the shared CSS is untouched
      b.onLoad({ filter: /\.css$/ }, (a) => {
        return { contents: readFileSync(a.path, 'utf8').replace(/(^|[^-\w])height:\s*1080px/g, '$1height: var(--app-h, 1080px)'), loader: 'css', resolveDir: dirname(a.path) };
      });
      b.onResolve({ filter: /^#platform\// }, (a) => {
        const file = join(ROOT, 'src/platform/mac', a.path.slice('#platform/'.length) + '.js');
        if (!existsSync(file)) return { errors: [{ text: 'no Mac platform module ' + relative(ROOT, file) }] };
        return { path: file };
      });
    },
  };
}

/**
 * Alder for the Mac shell: dist-mac/ (gitignored) holds index.html (mac/web/alder-index.html), bridge.js (the 1.1 native
 * bridge), app.js, app.css, assets and licences. mac/shell/build-app.sh copies it into the app's web/ directory.
 * Same sources as the Tizen build, bundled for WebKit; the Tizen output is not touched.
 */
export async function buildMac({ log = console.log, dev = false, outDir: outDirArg = null } = {}) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const outDir = outDirArg || join(ROOT, 'dist-mac'); // dev (dev/screenshot-mac.mjs): fixture-server rewrites on, not minified
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const define = { __ALDER_ENV__: JSON.stringify(dev ? 'dev' : 'prod'), __ALDER_DEV__: dev ? 'true' : 'false', __ALDER_VERSION__: JSON.stringify(pkg.version) };
  const common = { bundle: true, target: MAC_TARGET, logLevel: 'silent', absWorkingDir: ROOT, legalComments: 'external', minify: !dev,
    // esbuild cannot lower destructuring for safari14 (a WebKit 14 bug in some destructuring forms), so it fails the build
    // instead; the shell's WebKit runs it as written (T3.c1 note; revisit if the Air shows a Safari 14 fault).
    supported: { destructuring: true } };
  await esbuild({ ...common, entryPoints: ['src/main.js'], outfile: join(outDir, 'app.js'), format: 'iife', define, plugins: [macPlatform()] });
  await esbuild({
    ...common, outfile: join(outDir, 'app.css'), plugins: [macPlatform()],
    // the shared stylesheet, then the Mac-only one (cursor, stronger focus)
    stdin: { contents: '@import "./src/ui/styles/main.css";\n@import "./src/platform/mac/mac.css";', resolveDir: ROOT, sourcefile: 'mac-main.css', loader: 'css' },
    loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.webp': 'file' }, assetNames: 'assets/[name]-[hash]',
  });

  const html = readFileSync(join(ROOT, 'mac/web/alder-index.html'), 'utf8');
  if (html.includes('$WEBAPIS')) throw new Error('mac/web/alder-index.html must not load the Samsung webapis');
  writeFileSync(join(outDir, 'index.html'), html);
  copyFileSync(join(ROOT, 'mac/web/bridge.js'), join(outDir, 'bridge.js'));

  copyFileSync(join(ROOT, 'LICENSE'), join(outDir, 'LICENSE.txt'));
  mkdirSync(join(outDir, 'licenses'), { recursive: true });
  for (const f of ['INTER_LICENSE.txt', 'INSTRUMENT_SERIF_LICENSE.txt']) copyFileSync(join(ROOT, 'src/ui/fonts', f), join(outDir, 'licenses', f));
  writeFileSync(join(outDir, 'licenses/NOTICE.txt'),
    'Alder ' + pkg.version + ' (Mac)\nGPL-3.0-or-later. A port of Alder, the Android TV Stremio client (https://github.com/aradhyas8/Alder).\n' +
    'Bundled: pako (MIT AND Zlib), qrcode-generator (MIT), Inter and Instrument Serif (SIL OFL 1.1).\n');

  const compat = checkCompat({ root: ROOT, dist: false, mac: true });
  report(compat, { log });
  if (compat.errors.length) throw new Error('compat check failed (Mac)');
  const files = walk(outDir).map((p) => relative(outDir, p).split('\\').join('/'));
  log('dist-mac: ' + files.length + ' files, app.js ' + sizeKb(statSync(join(outDir, 'app.js')).size));
  return { outDir, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv.includes('--mac') ? buildMac() : build({ dev: process.argv.includes('--dev') })).catch((e) => { console.error(e.message || e); process.exit(1); });
}
