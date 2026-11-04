import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { actionFor, attachKeys, registerKeys, REGISTER_KEYS } from '../../src/platform/mac/keys.js';
import { deviceProfile, describeDevice } from '../../src/platform/mac/device.js';
import { createTvLanguage, twoLetters } from '../../src/platform/mac/language.js';
import { macQuit, resetMacBridge } from '../../src/platform/mac/bridge.js';
import { buildMacAppJs } from './mac-build-lock.js';

const require = createRequire(import.meta.url);
const bridgeFactory = require('../../mac/web/bridge.js');
const { installMock } = require('../../mac/web/mock-bridge.js');

// A window with the mock native handler behind webkit.messageHandlers.alder and the page's AlderBridge.
function macWindow() {
  const win = { AlderBridge: bridgeFactory };
  const mock = installMock({ win });
  return { win, mock };
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test('Mac keys: Esc is back, Return is OK, arrows move, nothing to register', () => {
  assert.equal(actionFor(27), 'back');
  assert.equal(actionFor(13), 'ok');
  assert.equal(actionFor(37), 'left');
  assert.equal(actionFor(40), 'down');
  assert.equal(actionFor(10009), null);
  assert.deepEqual(REGISTER_KEYS, []);
  assert.deepEqual(registerKeys({ tvinputdevice: {} }), []);
});

function keyHarness() {
  const handlers = {};
  const target = { addEventListener: (n, f) => { handlers[n] = f; }, removeEventListener() {} };
  const seen = [];
  attachKeys({ target, onAction: (e) => seen.push(e.action) });
  const press = (keyCode, tag) => {
    let prevented = false;
    const e = { keyCode, target: { tagName: tag || 'DIV' }, preventDefault: () => { prevented = true; }, repeat: false };
    handlers.keydown(e);
    handlers.keyup(e);
    return prevented;
  };
  return { seen, press };
}

test('Mac keys: Backspace and Space act as back / playpause outside a text field', () => {
  const { seen, press } = keyHarness();
  press(8); press(32); press(27);
  assert.deepEqual(seen, ['back', 'playpause', 'back']);
});

test('Mac keys: Backspace and Space stay the text field\'s own while it has focus; Esc and arrows still reach the app', () => {
  const { seen, press } = keyHarness();
  assert.equal(press(8, 'INPUT'), false);
  assert.equal(press(32, 'TEXTAREA'), false);
  press(27, 'INPUT'); press(40, 'INPUT'); press(37, 'INPUT');
  assert.deepEqual(seen, ['back', 'down']);
});

test('Mac device: conservative profile with the Tizen shape, no webapis needed', () => {
  const lines = [];
  const d = deviceProfile({ webapis: { throws: true }, av1: true, log: (m) => lines.push(m) });
  assert.equal(d.hevc, true); // listed as a manual pick; autoOk keeps auto-play on H.264
  assert.equal(d.av1, false);
  assert.equal(d.dolbyVision, false);
  assert.equal(d.hdr, false);
  assert.equal(d.height, 1080);
  assert.equal(d.fps, 30);
  assert.equal(d.codec, 'H.264 8-bit');
  assert.ok(d.audio instanceof Set && d.audio.has('AAC'));
  assert.ok(Array.isArray(d.notes) && typeof d.source === 'string');
  assert.ok(d.notes.some((n) => /manual picks/.test(n)));
  assert.match(describeDevice(d), /^1080p30 HEVC H\.264 8-bit/);
  assert.ok(lines.length >= 1);
  assert.doesNotThrow(() => deviceProfile());
});

test('Mac language: two letters from navigator.language, en when empty', () => {
  assert.equal(createTvLanguage({ navigator: { language: 'de-DE' } }).get(), 'de');
  assert.equal(createTvLanguage({ navigator: { languages: ['pt_BR'] } }).get(), 'pt');
  assert.equal(createTvLanguage({ navigator: {} }).get(), 'en');
  assert.equal(twoLetters(''), '');
  return createTvLanguage({ navigator: { language: 'fr' } }).ready.then((v) => assert.equal(v, 'fr'));
});

test('Mac exit: macQuit sends quit over the bridge; without a native shell it is a quiet no-op', async () => {
  const { win, mock } = macWindow();
  resetMacBridge();
  assert.equal(macQuit(win), true);
  await settle();
  assert.deepEqual(mock.posted.map((m) => m.cmd), ['quit']);
  resetMacBridge();
  assert.equal(macQuit({}), false);
  resetMacBridge();
});

test('build:mac output holds no Tizen or webapis calls', async () => {
  const js = await buildMacAppJs();
  // (the Diagnostics screen's "AVPLAY TRACKS" heading is a label, not a call; the bare name `webapis` survives only as a parameter name)
  assert.ok(!/tizen/i.test(js), 'app.js mentions tizen');
  assert.ok(!/webapis\.|window\.webapis|application\/avplayer/.test(js), 'app.js reaches for webapis');
  assert.ok(js.includes('panscan 1'), 'the mpv adapter replaces avplay.js');
});
