/*
 * Builds Alder for Tizen.
 *
 *   node scripts/build.mjs          production: dist/app/ (the package contents) and dist/Alder.wgt (unsigned zip,
 *                                   config.xml at its root; Apps2Samsung re-signs it on install)
 *   node scripts/build.mjs --dev    dev: dist/dev/ (a static site with the Tizen mock and sourcemaps; serve it with
 *                                   `npm run dev`, which also serves dev/fixtures)
 *
 * JS: esbuild, one IIFE, target chrome69 (Tizen 5.5's engine, see docs/DECISIONS.md), minified in prod.
 * CSS: esbuild bundles src/ui/styles/main.css (fonts and images become files under assets/).
 * Production ends with the compat check and the .wgt verification, and fails the build on any error.
 */
import { build as esbuild } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zip } from './zip.mjs';
import { verifyWgt } from './verify-wgt.mjs';
import { checkCompat, report } from './compat-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** The Chromium version of Tizen 5.5 (2020 TVs): Samsung's Web Engine Specifications, M69. One constant to change. */
export const TARGET = 'chrome69';

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build({ dev: process.argv.includes('--dev') }).catch((e) => { console.error(e.message || e); process.exit(1); });
}
