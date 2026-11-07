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

// Shared modules the Mac build swaps for src/platform/mac/<file>: keys, device, language, and the AVPlay wrapper (mpv.js: the
// same surface over the native bridge, so the shared player screen and engine run, failover included). The Mac modules may
// import the shared ones; nobody else gets the Tizen versions.
const MAC_SWAPS = {
  'src/lib/keys.js': 'keys.js', 'src/core/device.js': 'device.js', 'src/player/language.js': 'language.js', 'src/player/avplay.js': 'mpv.js',
  'src/ui/osk.js': 'osk.js', // native text fields, no on-screen keyboard
};
// src/main.js is shared and holds the Tizen exit and key registration: the Mac plugin patches its text on load (and throws if a piece moved).
const MAIN_PATCHES = [ // also diagnostics.js (webapis) and settings.js (the About text) below
  ["import { installed as polyfilled } from './lib/compat.js';", "import { installed as polyfilled } from './lib/compat.js';\nimport { macExit, installMacLifecycle } from './platform/mac/lifecycle.js';\nimport './platform/mac/layout.js';\nimport { installPointer, installPlayHook, installBackButton } from './platform/mac/index.js';"],
  ['const engine = createFocusEngine({ root: document.body });', 'const engine = createFocusEngine({ root: document.body });\n  installPointer(engine);\n  installMacLifecycle();'],
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

// Mac-only ranking: HEVC is listed (macProfile.hevc), but auto-play and BEST MATCH take only what the profile's autoOk accepts (H.264 8-bit
// 1080p30). src/core/ranking.js stays untouched so the Tizen bundle is byte-identical; a no-op where the profile has no autoOk.
export const RANKING_PATCHES = [
  // a release the viewer watched before (platform/mac/release-memory.js: file, signature, bingeGroup) is auto-eligible even outside autoOk, and leads
  ['rank(streams.filter(s => playable(s) && wanted(s)))', 'rank(streams.filter(s => playable(s) && wanted(s) && (!tv.autoOk || tv.autoOk(s) || (memory && memory.level && memory.level(videoId, metaId, s) > 0))))'],
  ['const best = eligible.find(quiet) || null', 'const best = eligible.find(s => quiet(s) && (!tv.autoOk || tv.autoOk(s))) || null'],
  ["[s => file !== null && s.filename === file, 'desc'],", "[s => (memory && memory.level ? memory.level(videoId, metaId, s, file) : (file !== null && s.filename === file ? 4 : 0)), 'desc'],"], // was: file name only
  // T8: what the finder asks (FINDER_MEMORY_PATCHES): is a release remembered for this video that none of the answers so far is, and say so once
  ['    /** The streams worth listing: real videos this TV can decode. */', `    /** Mac: something is remembered for this video and none of [streams] is it (platform/mac/release-memory.js pending). */
    memoryPending: (streams) => !!(memory && memory.pending && memory.pending(videoId, metaId, streams)),
    memoryHeld: () => { if (memory && memory.noteHeld) memory.noteHeld() },
    /** The streams worth listing: real videos this TV can decode. */`],
];

// Mac release memory: the session builds it over the shared source memory; the engine tells it when a source opens and when one fails (one decide()
// line and one `memory:` report line per case). Every call is guarded, so a memory without these methods changes nothing.
export const SESSION_PATCHES = [
  ["import { createRanker, createSourceMemory } from '../core/ranking.js'", "import { createRanker, createSourceMemory } from '../core/ranking.js'\nimport { createReleaseMemory } from '#platform/release-memory'"],
  ['const memory = createSourceMemory(store)', 'const memory = createReleaseMemory(store, createSourceMemory(store))'],
];
export const ENGINE_MEMORY_PATCHES = [
  ['function load(position, message = null) {', 'function load(position, message = null) {\n    if (memory && memory.noteLoad) memory.noteLoad({ videoId, metaId, sources, at, picked: params.picked, decide });'],
  ['function next(reason = "didn\'t start") {', 'function next(reason = "didn\'t start") {\n    if (memory && memory.noteFailed) memory.noteFailed({ videoId, metaId, sources, at, reason, picked: params.picked, decide });'],
];

// Mac Resume (T8): the finder (core/finder.js) starts as soon as the first add-on has something playable, so a release the viewer watched
// before that comes from a slower add-on never got its turn (a race: Back to the title page and Resume lost it now and then). When something is
// remembered for the video and the answers so far hold none of it, the start waits for the other add-ons: until all have answered, or the
// finder's own 800 ms wait for earlier add-ons ends (allowGaps), as in 1.4. Tizen's finder.js is untouched; a ranker without memoryPending changes nothing.
export const FINDER_MEMORY_PATCHES = [
  ['    if (best.length === 0 && this.answers.some(a => a === null)) return\n', `    if (best.length === 0 && this.answers.some(a => a === null)) return
    if (best.length > 0 && !allowGaps && this.answers.some(a => a === null) && this.ranker.memoryPending && this.ranker.memoryPending(ready)) {
      if (!this.macHeld) { this.macHeld = true; this.ranker.memoryHeld() }
      return
    }
`],
];

// Mac subtitle memory (platform/mac/subtitle-memory.js): what the viewer picked in the Subtitles menu for a title (Off, a file track, an add-on
// subtitle) is started again for the next episode and on a rewatch. The session hangs it on the memory (memory.subtitles); the engine writes it
// only in selectSubtitle (a menu pick), and reads it once at the start of the tracks and again as each add-on answers. One decide() line and one
// `memory:` report line per start. Every call is guarded, so a memory without `subtitles` changes nothing. Anchors are on the original text of engine.js.
export const SUBTITLE_SESSION_PATCHES = [
  ["import { createRanker, createSourceMemory } from '../core/ranking.js'", "import { createRanker, createSourceMemory } from '../core/ranking.js'\nimport { createSubtitleMemory } from '#platform/subtitle-memory'\nimport { createDelayMemory } from '#platform/delay-memory'"],
  ['const settings = createSettings({ store, activeProfileId: () => base.activeId(), tvLanguage })', 'memory.subtitles = createSubtitleMemory(store)\n  memory.delays = createDelayMemory(store) // T4: the delay per release and subtitle\n  const settings = createSettings({ store, activeProfileId: () => base.activeId(), tvLanguage })'],
];
export const SUBTITLE_MEMORY_PATCHES = [
  ["import { parseTextTracks, startSubtitle } from './tracks.js';", "import { parseTextTracks, startSubtitle } from './tracks.js';\nimport { subtitlePlan, matchContext } from '#platform/subtitle-memory';"],
  ['let subsPicked = false;', 'let subsPicked = false;\n  const macSub = { started: false, final: false, choice: null, addonsDone: false, hand: false, watch: false, t0: 0 }; // the remembered subtitle choice, resolved once'],
  ['const emit = (name, data = {}) => {', "const emit = (name, data = {}) => {\n    if (name === 'tracks') macSubTick();"],
  ["// Releases flag foreign subtitles as forced or default: start with subtitles only in the TV's language, else none.", "macSubStart();\n    // Releases flag foreign subtitles as forced or default: start with subtitles only in the TV's language, else none."],
  ['    loadAddonSubtitles();\n', '    loadAddonSubtitles().then(() => { macSub.addonsDone = true; macSubTick(); });\n'],
  ['async function loadAddonSubtitles() {', `// Mac subtitle memory: Off -> none; a language -> the file's track, else the first add-on subtitle in it as the answers arrive; else the normal rule
  function macSubStart() {
    if (macSub.started || !memory || !memory.subtitles || !settings.subtitles()) return;
    macSub.started = true;
    macSub.t0 = clock.now();
    macSub.choice = memory.subtitles.get(metaId);
    macSubTry();
  }
  function macMatch() { return matchContext(sources && sources[at]); }
  function macSubTick() {
    if (macSub.started && !macSub.final) macSubTry();
    else if (macSub.watch) macSubLate();
  }
  // the name match: one decide() line and one report line (no links) per start; the best match so far, how many subtitles are name-like
  function macMatchSaid(plan, what) {
    const st = plan.stats;
    decide('subtitles: ' + what + ' (name match: best score ' + st.best + ', ' + st.named + ' of ' + st.n + ' named)');
    memory.subtitles.report('match: ' + (what === 'started' ? '' : 'replaced ') + 'best=' + st.best + ' named=' + st.named + '/' + st.n);
  }
  // an add-on answer that arrives after an unmatched add-on subtitle started: a match replaces it, within the first 15 s, never over a menu pick
  function macSubLate() {
    if (shut || macSub.hand || clock.now() - macSub.t0 >= 15000) { macSub.watch = false; return; }
    const plan = subtitlePlan(macSub.choice, { textTracks, addonSubs, addonsDone: macSub.addonsDone, lang: toIso1, match: macMatch() });
    if (macSub.addonsDone) macSub.watch = false;
    if (plan.kind !== 'addon' || !plan.matched || plan.sub === chosenSub) return;
    macSub.watch = false;
    macMatchSaid(plan, 'the matching add-on subtitle from ' + plan.sub.addon + ' replaces the one started');
    selectSubtitle({ kind: 'addon', sub: plan.sub }, true);
  }
  function macSubTry() {
    if (!macSub.choice || macSub.final || shut) return;
    const plan = subtitlePlan(macSub.choice, { textTracks, addonSubs, addonsDone: macSub.addonsDone, lang: toIso1, match: macMatch() });
    if (plan.kind === 'wait') return;
    macSub.final = true;
    const language = languageName(macSub.choice.language || '');
    const said = (line, how) => { decide('memory: ' + line); memory.subtitles.report('memory: ' + how); };
    if (plan.kind === 'off') { subsPicked = true; subMode = 'off'; textIndex = null; said('subtitles off, as picked before', 'found by=sub_off'); applySubtitleMode(); }
    else if (plan.kind === 'file') { subsPicked = true; subMode = 'file'; textIndex = plan.track.index; said('subtitles ' + language + ' from the file (track #' + plan.track.index + ')', 'found by=sub_file source=' + (plan.track.index + 1)); applySubtitleMode(); }
    else if (plan.kind === 'addon') { said('subtitles ' + language + ' from ' + plan.sub.addon, 'found by=sub_addon source=' + (plan.index + 1)); macMatchSaid(plan, 'started'); if (!plan.matched && !macSub.addonsDone) macSub.watch = true; selectSubtitle({ kind: 'addon', sub: plan.sub }, true); }
    else said('no ' + language + ' subtitles in the file or from the add-ons, normal rule', 'not offered by=sub');
  }
  function macSubRemember(choice) { if (memory && memory.subtitles) memory.subtitles.remember(metaId, choice); }
  function macSubRememberFile(index) { const t = textTracks.find((x) => x.index === index); if (t && t.language) macSubRemember({ kind: 'lang', language: t.language }); }

  async function loadAddonSubtitles() {`],
  ['async function selectSubtitle(choice) {', 'async function selectSubtitle(choice, fromMemory = false) {'],
  ['const token = ++subChoiceToken;', 'if (!fromMemory) { macSub.final = true; macSub.hand = true; } // a menu pick ends the remembered start and any later replacement\n    const token = ++subChoiceToken;'],
  ["decide('subtitles: add-on file from ' + choice.sub.addon + ' (' + choice.sub.language + ', ' + cues.length + ' cues)');", "decide('subtitles: add-on file from ' + choice.sub.addon + ' (' + choice.sub.language + ', ' + cues.length + ' cues)');\n      if (!fromMemory) macSubRemember({ kind: 'lang', language: toIso1(choice.sub.lang), addon: choice.sub.addon });"],
  ["decide('subtitles: the file\\'s track #' + choice.index); }", "decide('subtitles: the file\\'s track #' + choice.index); if (!fromMemory) macSubRememberFile(choice.index); }"],
  ["decide('subtitles: off'); }", "decide('subtitles: off'); if (!fromMemory) macSubRemember({ kind: 'off' }); }"],
];

// Mac subtitle name match (T3): the add-on's Subtitle records keep Stremio's `id` and `label` (core/addon.js builds them without). Anchored, not an edit.
export const SUBTITLE_ID_PATCHES = [
  ["if (url) out.push(new Subtitle(url, text(s, 'lang') || 'und', this.name))", "if (url) { const sb = new Subtitle(url, text(s, 'lang') || 'und', this.name); sb.id = text(s, 'id'); sb.label = text(s, 'label'); out.push(sb) }"],
];

// Mac add-on subtitle lists (platform/mac/subtitle-fetch.js): all add-ons at once, the menu fills as each answers, kept per video id, timing logged;
// match() gives the playing release, so the menu lists a name match first in its language (T3).
export const SUBTITLE_FETCH_PATCHES = [
  ["import { parseSubtitles, shiftCues, cueAt, cueLines } from './subtitles.js';", "import { parseSubtitles, shiftCues, cueAt, cueLines } from './subtitles.js';\nimport { macLoadAddonSubtitles } from '#platform/subtitle-fetch';"],
  ['async function loadAddonSubtitles() {', 'async function loadAddonSubtitles() {\n    if (stremio && authKey) return macLoadAddonSubtitles({ stremio, authKey, type, videoId, tvLanguage, choose: chooseAddonSubtitles, set: (v) => { addonSubs = v; }, changed: () => emit(\'tracks\'), say, warn, diag, isShut: () => shut, match: macMatch });'],
];

// Mac-only subtitle timing: 0.1 s steps from -2 s to +2 s (Alder's list is -2, -1, -0.5, 0, 0.5, 1, 2 s). src/player/tracks.js stays untouched.
export const TRACKS_PATCHES = [
  ['Object.freeze([-2000, -1000, -500, 0, 500, 1000, 2000])', 'Object.freeze(Array.from({ length: 41 }, (_, i) => (i - 20) * 100))'],
];

// Mac subtitle delay (platform/mac/subtitle-delay.js): "Subtitle timing" is mpv's sub-delay for any subtitle on (a file track or an add-on one),
// sent through the adapter; the JS cue shift is not used. A new pick sets 0 and sends it; each change is one `delay:` line. Anchors on the original text.
export const SUBTITLE_DELAY_PATCHES = [
  ["import { resolvePlayableUrl } from './sources.js';", "import { resolvePlayableUrl } from './sources.js';\nimport { createSubtitleDelay } from '#platform/subtitle-delay';"],
  // T4 (platform/mac/delay-memory.js, memory.delays): the remembered delay for this release and subtitle, one `delay:` line per case. A file track gets
  // it in applySubtitleMode (the start rule, the 1.4 memory start and the menu all end there), an add-on subtitle in selectSubtitle (menu, memory, late replace).
  ['let subDelay = 0;', `let subDelay = 0;
  let macDelayFor = null; // the file track whose remembered delay was applied
  const macDelaySel = (kind) => (kind === 'addon' ? { kind, sub: chosenSub } : { kind, track: textTracks.find((x) => x.index === textIndex) });
  const macDelaySay = (line) => { if (line) { decide(line); if (memory && memory.delays) memory.delays.report(line); } };
  const macDelay = createSubtitleDelay({ avplay: { setSubDelay: (s) => avplay.setSubDelay(s) }, decide: (l) => decide(l),
    remembered: (kind) => { if (!memory || !memory.delays) return 0; const r = memory.delays.apply(sources && sources[at], macDelaySel(kind)); macDelaySay(r.line); return r.ms; } });`],
  ["avplay.selectTrack('TEXT', textIndex);", "avplay.selectTrack('TEXT', textIndex);\n      if (macDelayFor !== textIndex) { macDelayFor = textIndex; subDelay = macDelay.pick('file'); }"],
  ['subCues = cues;\n      subDelay = 0;', "subCues = cues;\n      macDelayFor = null;\n      subDelay = macDelay.pick('addon');"],
  ['chosenSub = null; subCues = null; shifted = null; subDelay = 0; subShown = null;', 'chosenSub = null; subCues = null; shifted = null; subDelay = 0; macDelayFor = null; subShown = null;'],
  ["function setSubtitleDelay(ms) {\n    if (subMode !== 'addon' || !subCues) return;", "function setSubtitleDelay(ms) {\n    if (subMode === 'off') return;\n    subDelay = macDelay.set(ms, subMode);\n    if (memory && memory.delays) macDelaySay(memory.delays.store(sources && sources[at], macDelaySel(subMode), subDelay));\n    emit('tracks');\n    return;\n    if (subMode !== 'addon' || !subCues) return;"],
  ["canShift: subMode === 'addon' && !!subCues", "canShift: subMode !== 'off'"],
];
// The options panel's timing list becomes the stepper (0.1 s earlier / later, reset to 0) with the live value and the keys under the heading.
export const SUBTITLE_DELAY_OPTIONS_PATCHES = [
  ["import { PICTURE, pictureHints } from './picture.js';", "import { PICTURE, pictureHints } from './picture.js';\nimport { delayRows, delayNotes } from '#platform/subtitle-delay';"],
  ["      const steps = TIMING_STEPS.map((ms) => ({ name: timingLabel(ms), tag: '', id: ms, ms }));\n      section(list, 'Subtitle timing', steps, TIMING_STEPS.indexOf(t.subDelay), (i, r) => { engine.setSubtitleDelay(r.ms); });",
    "      section(list, 'Subtitle timing', delayRows(t.subDelay), -1, (i, r) => { engine.setSubtitleDelay(r.ms); }, delayNotes(t.subDelay));"],
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
        // Safari before 16.4 (Big Sur, the Air) throws a SyntaxError on a lookbehind regex, and this one is built at module load: the
        // whole bundle died before boot (black window, T3.1). Same word-start test without a lookbehind; Tizen's build keeps the original.
        [join(ROOT, 'src/core/ranking.js'), RANKING_PATCHES],
        [join(ROOT, 'src/core/finder.js'), FINDER_MEMORY_PATCHES],
        [join(ROOT, 'src/app/session.js'), [...SESSION_PATCHES, ...SUBTITLE_SESSION_PATCHES]],
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
          ...ENGINE_MEMORY_PATCHES,
          ...SUBTITLE_MEMORY_PATCHES,
          ...SUBTITLE_DELAY_PATCHES,
          ['parseSubtitles(await http.get(choice.sub.url), choice.sub.format)', 'parseSubtitles(((t) => { avplay.addSubtitle(t, choice.sub); return t; })(await http.get(choice.sub.url)), choice.sub.format)'],
          ...SUBTITLE_FETCH_PATCHES,
          ['avplay.subtitlesOn(false);', "avplay.subtitlesOn(subMode === 'addon');"],
          ['in the TV language', 'in the Mac language'], // (decision lines on the Diagnostics screen)
          ['by the TV', 'by the player'],
          ["message: 'No sound on this TV'", "message: 'No sound on this Mac'"],
        ]],
        // the add-on's own words for each subtitle (Stremio `id` and `label`) are kept for the name match (platform/mac/subtitle-memory.js)
        [join(ROOT, 'src/core/addon.js'), SUBTITLE_ID_PATCHES],
        [join(ROOT, 'src/player/screen.js'), [
          ["engine.on('subtitle', (d) => { if (d.lines && d.lines.length) subtitles.show(d.lines); else subtitles.hide(); });", "// Mac: mpv draws the subtitles, the DOM line stays hidden"],
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
        [join(ROOT, 'src/player/tracks.js'), TRACKS_PATCHES],
        [join(ROOT, 'src/player/options.js'), SUBTITLE_DELAY_OPTIONS_PATCHES],
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
          ["'TV language'", "'Mac language'"], ["in the TV's language", "in the Mac's language"], ['My TV plays AV1', 'My Mac plays AV1'], ['plays on this TV.', 'plays on this Mac.'],
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

  const macVersion = readFileSync(join(ROOT, 'mac/VERSION'), 'utf8').trim(); // the Mac app's own version (the TV keeps package.json's)
  const define = { __ALDER_ENV__: JSON.stringify(dev ? 'dev' : 'prod'), __ALDER_DEV__: dev ? 'true' : 'false', __ALDER_VERSION__: JSON.stringify(macVersion) };
  const common = { bundle: true, target: MAC_TARGET, logLevel: 'silent', absWorkingDir: ROOT, legalComments: 'external', minify: !dev,
    // esbuild cannot lower destructuring for safari14 (a WebKit 14 bug in some destructuring forms), so it fails the build
    // instead; the shell's WebKit runs it as written (T3.c1 note; revisit if the Air shows a Safari 14 fault).
    supported: { destructuring: true,
      'class-field': false } }; // pako's `class { options; }` fields: esbuild passes them for safari14, Safari 14.0 cannot parse them (14.1 can)
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
