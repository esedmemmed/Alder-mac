// The Android web variant (node scripts/build.mjs --mac --android): the page draws every subtitle, so three Mac patch pairs are skipped,
// and the mpv adapter (src/platform/mac/mpv.js) loses addSubtitle / setSubDelay / delayKeysHint and reads the native sub-text property.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMac, MPV_SUBS } from '../../scripts/build.mjs';
import { createAvplay } from '../../src/platform/mac/mpv.js';
import { withMacBuildLock } from './mac-build-lock.js';

const require = createRequire(import.meta.url);
const { createBridge } = require('../../mac/web/bridge.js');

async function buildTo(android) {
  const out = mkdtempSync(join(tmpdir(), 'alder-variant-'));
  try {
    const r = await withMacBuildLock(() => buildMac({ log: () => {}, android, outDir: out }));
    return { skipped: r.skipped, js: readFileSync(join(out, 'app.js'), 'utf8') };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

test('android build skips exactly the three mpv-subtitle pairs and applies the rest; the Mac build skips none', async () => {
  assert.equal(MPV_SUBS, 'mpvSubs');
  const android = await buildTo(true);
  const got = android.skipped.map(([file, anchor]) => file + ' | ' + anchor.slice(0, 40)).sort();
  assert.deepEqual(got, [
    'src/player/engine.js | avplay.subtitlesOn(false);',
    'src/player/engine.js | parseSubtitles(await http.get(choice.sub',
    "src/player/screen.js | engine.on('subtitle', (d) => { if (d.lin",
  ]);
  assert.ok(!android.js.includes('.addSubtitle('), 'the engine no longer hands add-on subtitles to the adapter');
  assert.ok(!/subtitlesOn([a-zA-Z]+==="addon")/.test(android.js), 'subtitlesOn does not depend on add-on mode');
  assert.ok(android.js.includes('No sound on this Mac'), 'the other Mac patches still apply');
  const mac = await buildTo(false);
  assert.deepEqual(mac.skipped, []);
  assert.ok(mac.js.includes('.addSubtitle('));
  assert.ok(/subtitlesOn\([a-zA-Z]+==="addon"\)/.test(mac.js));
});

function startAdapter(android) {
  const posted = [];
  const win = { webkit: { messageHandlers: { alder: { postMessage: (m) => { posted.push(m); Promise.resolve().then(() => win.alderNative.onEvent({ type: 'reply', id: m.id, ok: true })); } } } } };
  const bridge = createBridge({ win });
  if (android) globalThis.__ALDER_ANDROID__ = true;
  try {
    const subtitles = [];
    const mpv = createAvplay({ bridge });
    mpv.open('https://host.example/v.mkv', {}, { onSubtitle: (s) => subtitles.push(s) });
    return { mpv, win, posted, subtitles };
  } finally { delete globalThis.__ALDER_ANDROID__; }
}

test('mpv.js on Android: no addSubtitle, setSubDelay or delayKeysHint; sub-text reaches onSubtitle', () => {
  const { mpv, win, posted, subtitles } = startAdapter(true);
  assert.equal('addSubtitle' in mpv, false);
  assert.equal('setSubDelay' in mpv, false);
  assert.equal('delayKeysHint' in mpv, false);
  assert.equal(typeof mpv.subtitlesOn, 'function');
  const observe = posted.find((m) => m.cmd === 'observe');
  assert.ok(observe.args.names.includes('sub-text'));
  assert.ok(observe.args.names.includes('time-pos'));
  globalThis.__ALDER_ANDROID__ = true; // read at event time, like the adapter's other reads
  try {
    win.alderNative.onEvent({ type: 'prop', name: 'sub-text', value: 'Hello\nWorld' });
    win.alderNative.onEvent({ type: 'prop', name: 'sub-text', value: '' });
    win.alderNative.onEvent({ type: 'prop', name: 'sub-text', value: null });
  } finally { delete globalThis.__ALDER_ANDROID__; }
  assert.deepEqual(subtitles, [
    { durationMs: 60000, text: 'Hello\nWorld', type: undefined },
    { durationMs: 0, text: '', type: undefined },
    { durationMs: 0, text: '', type: undefined },
  ]);
});

test('mpv.js without the Android define (Mac): the adapter keeps addSubtitle, setSubDelay, delayKeysHint and ignores sub-text', () => {
  const { mpv, win, posted, subtitles } = startAdapter(false);
  assert.equal(typeof mpv.addSubtitle, 'function');
  assert.equal(typeof mpv.setSubDelay, 'function');
  assert.ok(mpv.delayKeysHint);
  assert.ok(!posted.find((m) => m.cmd === 'observe').args.names.includes('sub-text'));
  win.alderNative.onEvent({ type: 'prop', name: 'sub-text', value: 'ignored' });
  assert.deepEqual(subtitles, []);
});
