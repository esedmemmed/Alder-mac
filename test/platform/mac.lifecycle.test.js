// T5.c1: the Mac player lifecycle on the bridge mock (sleep, wake, audio device, quit), Back's push, fullscreen and Esc, the
// scrubbed Diagnostics export, the F / E keys, and the Mac wording in the built bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { both, makeEngine, stream, libraryItem } from '../player/helpers.js';
import { createLifecycle } from '../../src/platform/mac/lifecycle.js';
import { macDiagExporter, scrubReport, exportName, reportText } from '../../src/platform/mac/diag-export.js';
import { attachKeys } from '../../src/platform/mac/keys.js';
import { buildReport } from '../../src/screens/diagnostics.js';
import { createDiag } from '../../src/player/diag.js';
import { createLogger } from '../../src/lib/log.js';
import { createRequire } from 'node:module';
import { buildMacAppJs } from './mac-build-lock.js';

const require = createRequire(import.meta.url);
const bridgeFactory = require('../../mac/web/bridge.js');
const { installMock } = require('../../mac/web/mock-bridge.js');

const FRESH = () => libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } });

/** A Mac engine on the bridge mock, playing 15 s into the film, with the lifecycle listening on the same bridge. */
async function playing(opts = {}) {
  const t = makeEngine({ adapter: 'mpv', sources: [stream('Film')], item: FRESH(), ...opts });
  const life = createLifecycle({ bridge: () => t.bridge });
  life.install();
  life.bind(t.engine, t.avplay);
  await t.start();
  await t.advance(15000);
  return { t, life };
}

both('Back pushes the place: finish -> shutdown -> saveAndPause -> push, before anything navigates', async () => {
  const t = makeEngine({ sources: [stream('Film')], item: FRESH() });
  await t.start();
  await t.advance(15000);
  assert.equal(t.puts.length, 0, 'nothing pushed yet (the 60 s push is not due)');
  const nav = [];
  t.engine.on('navigate', (n) => nav.push(n));
  t.engine.exit(); // what Back does
  assert.equal(t.puts.length, 1, 'pushed on Back');
  assert.ok(t.puts[0].items[0].state.timeOffset > 13000, 'with the place: ' + t.puts[0].items[0].state.timeOffset);
  assert.deepEqual(nav.map((n) => n.kind), ['exit']);
});

test('sleep: the place is saved and pushed and mpv is paused; wake stays paused, Play resumes', async () => {
  const { t } = await playing();
  assert.equal(t.puts.length, 0);
  t.mpv.sleep(); // the shell pauses mpv, then emits
  assert.equal(t.puts.length, 1, 'pushed on sleep');
  assert.ok(t.item.state.timeOffset > 13000);
  assert.equal(t.mpv.prop('pause'), true);
  await t.advance(100);
  const at = t.mpv.prop('time-pos');
  await t.advance(5000);
  assert.equal(t.mpv.prop('time-pos'), at, 'no time passes while asleep');
  t.mpv.wake();
  await t.advance(500);
  assert.equal(t.mpv.prop('pause'), true, 'wake leaves it paused');
  assert.equal(t.engine.state.suspended, false, 'the screen is live again');
  assert.equal(t.engine.snapshot().playing, false);
  t.engine.togglePlay(); // Play
  await t.advance(1000);
  assert.equal(t.mpv.prop('pause'), false);
  assert.ok(t.mpv.prop('time-pos') > at, 'playing on');
  await t.advance(10000);
  assert.ok(t.item.state.timeOffset > 20000, 'progress ticks run again after wake: ' + t.item.state.timeOffset);
});

test('sleep while paused and a wake with no sleep change nothing; no player bound is a quiet no-op', async () => {
  const { t, life } = await playing();
  t.engine.pause();
  await t.advance(100);
  t.mpv.sleep();
  t.mpv.wake();
  await t.advance(500);
  assert.equal(t.mpv.prop('pause'), true);
  life.bind(t.engine, t.avplay)(); // unbound again
  const other = createLifecycle({ bridge: () => t.bridge });
  other.install();
  assert.doesNotThrow(() => { t.mpv.sleep(); t.mpv.wake(); t.mpv.audioDeviceChanged(); });
});

test('audioDevice: the same source reloads at the second it was at and plays on; paused stays paused', async () => {
  const { t } = await playing();
  const url = t.mpv.loadLog[0].url;
  const before = t.mpv.prop('time-pos');
  t.mpv.audioDeviceChanged();
  await t.advance(300);
  assert.equal(t.mpv.loadLog.length, 2, 'one more load');
  assert.equal(t.mpv.loadLog[1].url, url, 'the same source');
  assert.ok(Math.abs(t.mpv.loads[1].start - before) < 1, 'at the saved second: ' + t.mpv.loads[1].start + ' vs ' + before);
  assert.equal(t.mpv.prop('pause'), false, 'still playing');
  await t.advance(2000);
  assert.ok(t.mpv.prop('time-pos') > t.mpv.loads[1].start, 'time moves on');
  assert.equal(t.events.sourceError.length, 0, 'the engine saw nothing');
  t.engine.pause();
  await t.advance(100);
  t.mpv.audioDeviceChanged();
  await t.advance(300);
  assert.equal(t.mpv.loadLog.length, 3);
  assert.equal(t.mpv.prop('pause'), true, 'paused stays paused');
});

test('audioDevice: a refused reload reaches the retry path of the engine, not silence', async () => {
  const { t } = await playing();
  t.mpv.failNextLoad('Connection refused');
  t.mpv.audioDeviceChanged();
  await t.advance(300);
  assert.equal(t.engine.state.retries, 1, 'the retry path took it');
  assert.ok(t.log.some((l) => /source 1\/1 error: PLAYER_ERROR_CONNECTION_FAILED/.test(l)));
});

test('willQuit: the engine records and pushes BEFORE the page sends quit', async () => {
  const { t } = await playing();
  const order = [];
  const saveLibrary = t.stremio.saveLibrary;
  t.stremio.saveLibrary = (...a) => { order.push('push'); return saveLibrary(...a); };
  const push = t.mpv.posted.push;
  t.mpv.posted.push = function (m) { order.push(m.cmd); return push.call(this, m); };
  t.mpv.requestQuit(); // Cmd-Q or the window close
  assert.ok(order.indexOf('push') >= 0 && order.indexOf('quit') > order.indexOf('push'), 'order: ' + order.join(','));
  assert.equal(t.puts.length, 1);
  assert.ok(t.puts[0].items[0].state.timeOffset > 13000);
  await t.advance(100);
  assert.equal(t.mpv.quit, true, 'the shell was told to quit');
});

test('Exit panel: exit() saves first too, and without a shell it neither quits nor pauses', async () => {
  const { t, life } = await playing();
  assert.equal(life.exit(), true);
  assert.equal(t.puts.length, 1);
  const bare = createLifecycle({ bridge: () => null });
  bare.bind(t.engine, t.avplay);
  assert.equal(bare.exit(), false);
});

test('fullscreen: F toggles through the bridge, Esc leaves fullscreen first and only then is Back the player\'s', async () => {
  const t = makeEngine({ adapter: 'mpv', sources: [] });
  const life = createLifecycle({ bridge: () => t.bridge });
  const key = (action, extra = {}) => life.fullscreenKey({ type: 'press', action, ...extra });
  assert.equal(key('back'), false, 'Back is the player\'s while windowed');
  assert.equal(key('fullscreen'), true);
  await t.advance(50);
  assert.equal(t.mpv.fullscreen, true);
  assert.equal(key('fullscreen', { repeat: true }), true, 'a held F is used up, not repeated');
  assert.equal(key('back'), true, 'the first Esc leaves fullscreen');
  await t.advance(50);
  assert.equal(t.mpv.fullscreen, false);
  assert.equal(key('back'), false, 'the second Esc is Back');
  assert.equal(life.fullscreenKey({ type: 'hold', action: 'fullscreen' }), false);
  assert.deepEqual(t.mpv.posted.filter((m) => m.cmd === 'fullscreen').map((m) => m.args.on), [true, false]);
});

test('F and E are keys; Cmd-F, Ctrl and Alt are the system\'s; a text field keeps its own letters', () => {
  const handlers = {};
  const seen = [];
  attachKeys({ target: { addEventListener: (n, f) => { handlers[n] = f; }, removeEventListener() {} }, onAction: (e) => seen.push(e.action) });
  const down = (keyCode, extra = {}, tag = 'DIV') => handlers.keydown({ keyCode, target: { tagName: tag }, preventDefault() {}, repeat: false, ...extra });
  down(70); down(69);
  down(70, { metaKey: true }); down(70, { ctrlKey: true }); down(69, { altKey: true });
  down(70, {}, 'INPUT'); down(69, {}, 'INPUT');
  assert.deepEqual(seen, ['fullscreen', 'export']);
});

test('Diagnostics export: saveFile gets the scrubbed report as ~/Downloads/Alder-diagnostics-<date>.txt', async () => {
  const win = { AlderBridge: bridgeFactory };
  const mock = installMock({ win });
  const bridge = bridgeFactory.createBridge({ win });
  const diag = createDiag();
  diag.setStream({ url: 'https://media.fixture.test/Dune.2024.mkv?token=SECRET', label: 'x', at: 1, total: 2 });
  diag.error('failed at https://media.fixture.test/a.mkv?x=1 for ada@example.com with key FIXTURE-AUTH-KEY-0001');
  const log = createLogger();
  log.info('app', 'authKey=FIXTURE-AUTH-KEY-0001 mail ada@example.com see magnet:?xt=urn:btih:abc and www.example.org/x');
  const toasts = [];
  const context = { player: { authKey: 'FIXTURE-AUTH-KEY-0001' }, toast: (m) => toasts.push(m) };
  const run = macDiagExporter({ context, bridge: () => bridge, now: () => new Date(2026, 10, 3, 9, 0), build: () => buildReport({ log, diag: diag.snapshot(), device: null, version: '1', env: 'mac', agent: 'UA' }) });
  const where = await run();
  assert.equal(where, '~/Downloads/Alder-diagnostics-2026-11-03.txt');
  assert.equal(mock.saved.length, 1);
  assert.equal(mock.saved[0].name, 'Alder-diagnostics-2026-11-03.txt');
  const text = mock.saved[0].text;
  assert.match(text, /^APP\n/);
  assert.match(text, /LOG \(last/);
  assert.ok(!/FIXTURE-AUTH-KEY|SECRET|ada@|example\.com|example\.org|fixture\.test|https?:|magnet:|xt=urn|www\./.test(text), 'nothing private: ' + text.slice(0, 2000));
  assert.match(text, /\[key\]/);
  assert.match(text, /\[email\]/);
  assert.match(text, /\[link\]/);
  assert.deepEqual(toasts, ['Saved to Downloads']);
  assert.ok(!mock.logs.concat(mock.reports).some((l) => /FIXTURE-AUTH-KEY/.test(l)));
});

test('Diagnostics export: no shell says so, a failed save says so; the name is the local date', async () => {
  const toasts = [];
  const none = macDiagExporter({ context: { toast: (m) => toasts.push(m) }, bridge: () => null, build: () => [] });
  assert.equal(await none(), null);
  const failing = macDiagExporter({ context: { toast: (m) => toasts.push(m) }, bridge: () => ({ saveFile: () => Promise.reject(new Error('disk')) }), build: () => [{ title: 'A', lines: [{ text: 'x' }] }] });
  assert.equal(await failing(), null);
  assert.deepEqual(toasts, ['Saving needs the Mac app', "Couldn't save the report"]);
  assert.equal(exportName(new Date(2027, 0, 5)), 'Alder-diagnostics-2027-01-05.txt');
  assert.equal(scrubReport('k=ABCD1234 and ABCD1234', ['ABCD1234']), 'k=[key] and [key]');
  assert.equal(reportText([{ title: 'T', lines: [{ text: 'a' }, { text: 'b' }] }]), 'T\n  a\n  b\n');
});

test('build:mac says Mac, not TV, and carries the lifecycle and export hooks', async () => {
  const js = await buildMacAppJs();
  assert.ok(js.includes("Check the Mac's internet connection."));
  assert.ok(!js.includes("Check the TV's"), 'a TV connection hint survived');
  assert.ok(!/this TV|the TV's|My TV plays|TV language|TV interface|your TV/.test(js.replace(/\/\/.*$/gm, '')), 'a TV wording survived');
  assert.ok(js.includes('Alder-diagnostics-') && js.includes('willQuit') && js.includes('E Save to Downloads'));
});
