// The web variant (node scripts/build.mjs --mac --web): Android's rules (the page draws every subtitle), no native bridge, the browser's <video>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMac } from '../../scripts/build.mjs';
import { macBridge } from '../../src/platform/web/bridge.js';
import { withMacBuildLock } from './mac-build-lock.js';

async function buildTo(opts) {
  const out = mkdtempSync(join(tmpdir(), 'alder-web-'));
  try {
    const r = await withMacBuildLock(() => buildMac({ log: () => {}, outDir: out, ...opts }));
    return { skipped: r.skipped, js: readFileSync(join(out, 'app.js'), 'utf8'), html: readFileSync(join(out, 'index.html'), 'utf8'), files: r.files };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

const SKIPPED = [
  'src/player/engine.js | avplay.subtitlesOn(false);',
  'src/player/engine.js | parseSubtitles(await http.get(choice.sub',
  "src/player/screen.js | engine.on('subtitle', (d) => { if (d.lin",
];
const list = (r) => r.skipped.map(([file, anchor]) => file + ' | ' + anchor.slice(0, 40)).sort();

test('the web bridge is no bridge', () => {
  assert.equal(macBridge(), null);
});

test('web build: skips the three mpv-subtitle pairs, no bridge, html5.js instead of mpv.js, relative asset URLs', async () => {
  const web = await buildTo({ web: true });
  assert.deepEqual(list(web), SKIPPED);
  assert.ok(!web.js.includes('webkit.messageHandlers'), 'no native bridge code in the bundle');
  for (const mpvOnly of ['playbackRestart', 'sub-visibility', 'panscan', 'paused-for-cache']) assert.ok(!web.js.includes(mpvOnly), 'no mpv adapter code: ' + mpvOnly);
  assert.ok(web.js.includes('object-fit: contain'), 'the html5 adapter is in');
  assert.ok(web.js.includes('browser profile'), 'the web device profile is in');
  assert.ok(!web.js.includes('addSubtitle'), 'no add-on subtitle hand-over to the adapter');
  assert.ok(web.js.includes('No sound on this Mac'), 'the other Mac patches still apply');
  assert.ok(!web.html.includes('<script src="bridge.js">'), 'the page does not load the native bridge');
  assert.ok(!web.files.includes('bridge.js'));
  assert.ok(!/(?:src|href)="\//.test(web.html), 'index.html uses relative URLs only');
});

test('Mac and Android builds are unchanged by the web variant', async () => {
  const android = await buildTo({ android: true });
  assert.deepEqual(list(android), SKIPPED);
  const mac = await buildTo({});
  assert.deepEqual(mac.skipped, []);
  for (const b of [mac, android]) {
    assert.ok(b.js.includes('playbackRestart'), 'mpv adapter');
    assert.ok(!b.js.includes('browser profile'));
  }
  assert.ok(mac.files.includes('bridge.js'));
  assert.ok(/<script src="bridge\.js">/.test(mac.html));
});
