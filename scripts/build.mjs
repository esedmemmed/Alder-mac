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

  const define = { __ALDER_ENV__: JSON.stringify(dev ? 'dev' : 'prod'), __ALDER_DEV__: dev ? 'true' : 'false', __ALDER_VERSION__: JSON.stringify(pkg.version), __ALDER_ANDROID__: 'false', __ALDER_WEB__: 'false' };
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

// Shared modules the Mac build swaps for src/platform/mac/<file>: keys, device, language, and the AVPlay wrapper (mpv.js: the
// same surface over the native bridge, so the shared player screen and engine run, failover included). The Mac modules may
// import the shared ones; nobody else gets the Tizen versions.
const MAC_SWAPS = {
  'src/lib/keys.js': 'keys.js', 'src/core/device.js': 'device.js', 'src/player/language.js': 'language.js', 'src/player/avplay.js': 'mpv.js',
  'src/ui/osk.js': 'osk.js', // native text fields, no on-screen keyboard
};
/** The web variant (--web) swaps these two for src/platform/web/<file>; every other swap stays the Mac's. */
const WEB_SWAPS = { 'src/core/device.js': 'device.js', 'src/player/avplay.js': 'html5.js' };
/** The Android variant (--android) swaps the device profile for src/platform/android/device.js (the phone decodes HEVC, HDR and 4K in hardware). */
const ANDROID_SWAPS = { 'src/core/device.js': 'device.js' };
// src/main.js is shared and holds the Tizen exit and key registration: the Mac plugin patches its text on load (and throws if a piece moved).
/** Tag on a patch pair that only the Mac's mpv-draws-subtitles design needs: the Android variant (--android) skips it. */
export const MPV_SUBS = 'mpvSubs';
const MAIN_PATCHES = [ // also diagnostics.js (webapis) and settings.js (the About text) below
  ["import { installed as polyfilled } from './lib/compat.js';", "import { installed as polyfilled } from './lib/compat.js';\nimport { macExit, installMacLifecycle } from './platform/mac/lifecycle.js';\nimport './platform/mac/layout.js';\nimport { installPointer, installPlayHook, installBackButton } from './platform/mac/index.js';\nimport { setReportSink } from './lib/report.js';\nimport { macBridge } from '#platform/bridge';"],
  ['const engine = createFocusEngine({ root: document.body });', 'const engine = createFocusEngine({ root: document.body });\n  setReportSink((line) => { const b = macBridge(); return b && b.log ? b.log(line) : undefined; });\n  installPointer(engine);\n  installMacLifecycle();'],
  ['context.router = router;', 'context.router = router;\n  installBackButton(router);'], // a Back button where Esc is the only way back
  ['router.push(first.name, first.params);', 'router.push(first.name, first.params);\n  installPlayHook({ router, log });'], // the play check (?play= from the shell --page)
  ['registerKeys(window.tizen)', 'registerKeys()'],
  ['webapis: window.webapis,', 'webapis: null,'],
  ['window.tizen.application.getCurrentApplication().exit();', "if (!macExit()) log.info('app', 'exit requested (no native shell)');"], // saves the player's place first
  ['Leave the app and go back to the TV.', 'Leave the app.'],
  // log lines (the Diagnostics screen shows the log, so she can read them)
  [" + ' TV keys'", " + ' keys'"],
  ['no TV key registration (desktop browser?)', 'no key registration (Mac)'],
  ['exit requested (not on a TV)', 'exit requested (not in the Mac shell)'],
];

/** esbuild plugin: `#platform/<name>` resolves to src/platform/mac/<name>.js, so shared code never branches at run time. */
function macPlatform({ android = false, web = false, skipped = [] } = {}) {
  return {
    name: 'mac-platform',
    setup(b) {
      const swaps = new Map(Object.entries(MAC_SWAPS).map(([from, to]) => [join(ROOT, from), web && WEB_SWAPS[from] ? join(ROOT, 'src/platform/web', WEB_SWAPS[from]) : android && !web && ANDROID_SWAPS[from] ? join(ROOT, 'src/platform/android', ANDROID_SWAPS[from]) : join(ROOT, 'src/platform/mac', to)]));
      b.onResolve({ filter: /^\.\.?\// }, (a) => {
        if (a.kind === 'entry-point' || !a.importer || a.importer.startsWith(join(ROOT, 'src/platform/mac')) || a.importer.startsWith(join(ROOT, 'src/platform/web')) || a.importer.startsWith(join(ROOT, 'src/platform/android'))) return null;
        const target = resolve(a.resolveDir, a.path);
        return swaps.has(target) ? { path: swaps.get(target) } : null;
      });
      const patches = new Map([
        [join(ROOT, 'src/main.js'), MAIN_PATCHES],
        // Safari before 16.4 (Big Sur, the Air) throws a SyntaxError on a lookbehind regex, and this one is built at module load: the
        // whole bundle died before boot (black window, T3.1). Same word-start test without a lookbehind; Tizen's build keeps the original.
        [join(ROOT, 'src/core/audio.js'), [
          ["const START = '(?<![a-z0-9])'", "const START = '(?:^|[^a-z0-9])'"],
          ["NO_SOUND_TAG = 'No sound on this TV'", "NO_SOUND_TAG = 'No sound on this Mac'"],
        ]],
        // the Diagnostics export (E): the report as text to ~/Downloads through the bridge, scrubbed (platform/mac/diag-export.js)
        [join(ROOT, 'src/screens/diagnostics.js'), [
          ['deviceProfile({ webapis: window.webapis })', 'deviceProfile({})'],
          ['export function createDiagnosticsScreen() {', "import { macDiagExporter } from '#platform/diag-export';\n" + "export function createDiagnosticsScreen() {\n  let macExport = null;"],
          ['const report = buildReport({ log, diag: appDiag.snapshot(), device, version: VERSION, env: ENV, agent: navigator.userAgent });',
            'const report = buildReport({ log, diag: appDiag.snapshot(), device, version: VERSION, env: ENV, agent: navigator.userAgent });\n      macExport = macDiagExporter({ context, build: () => buildReport({ log, diag: appDiag.snapshot(), device, version: VERSION, env: ENV, agent: navigator.userAgent }) });'],
          ['OK Top / end   Back Close', 'OK Top / end   E Save to Downloads   Back Close'],
          ['else return false; // Back (and anything else) falls through: the router pops', "else if (a === 'export') { if (!evt.repeat && macExport) macExport(); }\n      else return false; // Back (and anything else) falls through: the router pops"],
        ]],
        // add-on subtitles: the text the page fetched goes to mpv (adapter addSubtitle) and mpv draws it; mpv also draws the file's own
        // tracks, so the DOM subtitle line stays hidden
        [join(ROOT, 'src/player/engine.js'), [
          ['parseSubtitles(await http.get(choice.sub.url), choice.sub.format)', 'parseSubtitles(((t) => { avplay.addSubtitle(t, choice.sub); return t; })(await http.get(choice.sub.url)), choice.sub.format)', MPV_SUBS],
          ['avplay.subtitlesOn(false);', "avplay.subtitlesOn(subMode === 'addon');", MPV_SUBS],
          ['by the TV', 'by the player'],
          ["message: 'No sound on this TV'", "message: 'No sound on this Mac'"],
        ]],
        [join(ROOT, 'src/player/screen.js'), [
          ["engine.on('subtitle', (d) => { if (d.lines && d.lines.length) subtitles.show(d.lines); else subtitles.hide(); });", "// Mac: mpv draws the subtitles, the DOM line stays hidden", MPV_SUBS],
          // lifecycle (platform/mac/lifecycle.js): sleep, wake, audio device and quit act on this engine; F and Esc handle fullscreen first
          ["import { createTvLanguage } from './language.js';", "import { createTvLanguage } from './language.js';\nimport { macBindPlayer, macFullscreenKey } from '#platform/lifecycle';\nimport { macBindInput, macPlayerKey } from '#platform/player-input';"],
          ['let closed = false;', 'let closed = false;\n  let macUnbind = null;\n  let macUnbindInput = null;\n  let macAv = null;'],
          ['avplay: createAvplay({ log }), clock: realClock', 'avplay: (macAv = createAvplay({ log })), clock: realClock'],
          ['engine = createEngine(params, deps);', 'engine = createEngine(params, deps);\n      macUnbind = macBindPlayer(engine, macAv);'],
          ['if (engine) engine.destroy();', 'if (macUnbind) macUnbind();\n      if (macUnbindInput) macUnbindInput();\n      if (engine) engine.destroy();'],
          // mouse, trackpad and the volume keys (platform/mac/player-input.js): bound once the controls and the options panel exist
          ['controls.setSubtitleRaise((up) => subtitles.raise(up));', 'controls.setSubtitleRaise((up) => subtitles.raise(up));\n      macUnbindInput = macBindInput({ root: el, controls, options, engine, avplay: macAv, fullscreen: macFullscreenKey });'],
          ['if (mediaKey(evt)) return true;', 'if (macFullscreenKey(evt)) return true;\n      if (macPlayerKey(evt)) return true;\n      if (mediaKey(evt)) return true;'],
        ]],
        // hover moves the highlight only: a card focused by the pointer (platform/mac/pointer.js sets window.__macHover) does not slide its row
        [join(ROOT, 'src/ui/row.js'), [['reveal(i, true);', 'if (!window.__macHover) reveal(i, true);']]],
        // "TV" wording: the Mac build says Mac (and "Check the Mac's internet connection")
        [join(ROOT, 'src/screens/home.js'), [["Check the TV's connection.", "Check the Mac's internet connection."]]],
        [join(ROOT, 'src/screens/addons.js'), [["Check the TV's internet.", "Check the Mac's internet connection."]]],
        [join(ROOT, 'src/screens/streams.js'), [['found for this TV.', 'found for this Mac.']]],
        [join(ROOT, 'src/screens/profiles.js'), [['out on this TV.', 'out on this Mac.']]],
        [join(ROOT, 'src/player/picture.js'), [
          ['than your TV (16:9)', 'than your window'], ['on this TV', 'on this Mac'], ['by the TV', 'by the player'],
        ]],
        [join(ROOT, 'src/core/settings.js'), [
          ["'TV language'", "'Mac language'"], ['My TV plays AV1', 'My Mac plays AV1'], ['plays on this TV.', 'plays on this Mac.'],
        ]],
        [join(ROOT, 'src/screens/settings.js'), [
          ['Alder for Tizen is a port of Alder', 'Alder for Mac is a port of Alder'],
          ['this TV can play', 'this Mac can play'], ["the TV's language", "the Mac's language"], ['on this TV', 'on this Mac'],
          ['This TV follows its order.', 'Alder follows its order.'], ["this TV's language", "this Mac's language"], ["the TV's own settings", "the Mac's own settings"],
          ['from this TV.', 'from this Mac.'], ['Alder is a TV interface', 'Alder is a Mac app'], ['A TV interface', 'A Mac app'], // the Alder row and its panel
          ['the Android TV Stremio client', 'the Android Stremio client'], // About: upstream credit, both lines
          ['this TV reported', 'this Mac reported'],
        ]],
        // sign-in leads with e-mail + password in native fields (platform/mac/signin-form.js), Return continues the name step
        [join(ROOT, 'src/screens/signin.js'), [
          ["Check the TV's connection.", "Check the Mac's internet connection."], ['sign in this TV.', 'sign in this Mac.'], ['brings them to the TV.', 'brings them to the Mac.'],
          ["'This TV has '", "'This Mac has '"],
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
        for (const [from, to, tag] of list) {
          if ((android || web) && tag === MPV_SUBS) { skipped.push([relative(ROOT, a.path).split('\\').join('/'), from]); continue; } // the page draws the subtitles on Android and on the web
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
        const name = a.path.slice('#platform/'.length);
        const file = join(ROOT, 'src/platform', web && name === 'bridge' ? 'web' : 'mac', name + '.js');
        if (!existsSync(file)) return { errors: [{ text: 'no platform module ' + relative(ROOT, file) }] };
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
export async function buildMac({ log = console.log, dev = false, outDir: outDirArg = null, android = false, web = false } = {}) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const outDir = outDirArg || join(ROOT, web ? 'dist-web' : android ? 'dist-android' : 'dist-mac'); // dev (dev/screenshot-mac.mjs): fixture-server rewrites on, not minified
  const skipped = []; // [file, anchor] of every patch pair the Android variant left out
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const macVersion = readFileSync(join(ROOT, 'mac/VERSION'), 'utf8').trim(); // the Mac app's own version (the TV keeps package.json's)
  const define = { __ALDER_ENV__: JSON.stringify(dev ? 'dev' : 'prod'), __ALDER_DEV__: dev ? 'true' : 'false', __ALDER_VERSION__: JSON.stringify(macVersion), __ALDER_ANDROID__: android ? 'true' : 'false', __ALDER_WEB__: web ? 'true' : 'false' };
  const common = { bundle: true, target: MAC_TARGET, logLevel: 'silent', absWorkingDir: ROOT, legalComments: 'external', minify: !dev,
    // esbuild cannot lower destructuring for safari14 (a WebKit 14 bug in some destructuring forms), so it fails the build
    // instead; the shell's WebKit runs it as written (T3.c1 note; revisit if the Air shows a Safari 14 fault).
    supported: { destructuring: true,
      'class-field': false } }; // pako's `class { options; }` fields: esbuild passes them for safari14, Safari 14.0 cannot parse them (14.1 can)
  await esbuild({ ...common, entryPoints: ['src/main.js'], outfile: join(outDir, 'app.js'), format: 'iife', define, plugins: [macPlatform({ android, web, skipped })] });
  await esbuild({
    ...common, outfile: join(outDir, 'app.css'), plugins: [macPlatform({ web })],
    // the shared stylesheet, then the Mac-only one (cursor, stronger focus)
    stdin: { contents: '@import "./src/ui/styles/main.css";\n@import "./src/platform/mac/mac.css";', resolveDir: ROOT, sourcefile: 'mac-main.css', loader: 'css' },
    loader: { '.woff': 'file', '.woff2': 'file', '.png': 'file', '.webp': 'file' }, assetNames: 'assets/[name]-[hash]',
  });

  let html = readFileSync(join(ROOT, 'mac/web/alder-index.html'), 'utf8');
  if (html.includes('$WEBAPIS')) throw new Error('mac/web/alder-index.html must not load the Samsung webapis');
  if (android || web) { // a phone: the viewport is fixed from the first frame (src/platform/mac/layout.js starts phone mode from innerWidth; a page that may zoom out reports a wider one)
    const meta = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    if (!html.includes(meta)) throw new Error('mac/web/alder-index.html no longer contains its viewport meta');
    html = html.replace(meta, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">');
  }
  if (web) { // no native bridge in a browser: the page does not load it (all other URLs in the page are already relative, so a sub-path works)
    const tag = '<script src="bridge.js"></script>';
    if (!html.includes(tag)) throw new Error('mac/web/alder-index.html no longer contains ' + tag);
    writeFileSync(join(outDir, 'index.html'), html.split(tag).join(''));
  } else {
    writeFileSync(join(outDir, 'index.html'), html);
    copyFileSync(join(ROOT, 'mac/web/bridge.js'), join(outDir, 'bridge.js'));
  }

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
  log((web ? 'dist-web' : android ? 'dist-android' : 'dist-mac') + ': ' + files.length + ' files, app.js ' + sizeKb(statSync(join(outDir, 'app.js')).size));
  return { outDir, files, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv.includes('--mac') ? buildMac({ android: process.argv.includes('--android'), web: process.argv.includes('--web') }) : build({ dev: process.argv.includes('--dev') })).catch((e) => { console.error(e.message || e); process.exit(1); });
}
