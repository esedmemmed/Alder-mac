// The Mac player's pointer and volume rules (src/platform/mac/player-input.js): click / double click routing, the idle hide timer, the
// volume keys -> setProp on the mock bridge (mac/web/mock-bridge.js through the real mpv adapter). DOM-free: hit() and ui are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPlayerInput, CLICK_DELAY, IDLE_MS, VOLUME_STEP, OSD_MS } from '../../src/platform/mac/player-input.js';
import { createAvplay } from '../../src/platform/mac/mpv.js';
import { actionFor } from '../../src/platform/mac/keys.js';

const require = createRequire(import.meta.url);
const { installMock } = require('../../mac/web/mock-bridge.js');

/** A fake clock: setTimeout / clearTimeout and advance(ms). */
function clock() {
  let now = 0, id = 0;
  const q = new Map();
  return {
    setTimeout: (f, ms) => { q.set(++id, { f, at: now + ms }); return id; },
    clearTimeout: (i) => q.delete(i),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; q.delete(next[0]); next[1].f();
      }
      now = end;
    },
  };
}

function rig({ playing = true, blocked = false, shown = false } = {}) {
  const calls = [];
  const t = clock();
  const st = { playing, blocked, shown };
  const controls = {
    shown: () => st.shown,
    show: (id) => { st.shown = true; calls.push('show:' + id); },
    hide: () => { st.shown = false; calls.push('hide'); },
    quiet: (fn) => fn(),
    key: (e) => calls.push('key:' + e.action),
  };
  const engine = { snapshot: () => ({ playing: st.playing, duration: 600000 }), togglePlay: () => calls.push('toggle'), seekTo: (ms) => calls.push('seek:' + ms) };
  const vols = [];
  const avplay = { setVolume: (v) => vols.push(v) };
  const ui = { cursor: (on) => calls.push('cursor:' + on), osd: (x) => calls.push('osd:' + x), vol() {} };
  const hit = (target) => target;
  const input = createPlayerInput({ controls, engine, avplay, fullscreen: (e) => calls.push('fs:' + e.action), hit, blocked: () => st.blocked, timers: t, ui });
  return { input, calls, t, st, vols };
}
const VIDEO = { kind: 'video' };

test('a single click pauses after the delay; a double click is fullscreen only', () => {
  const r = rig();
  r.input.click({ target: VIDEO, detail: 1 });
  r.t.advance(CLICK_DELAY - 1);
  assert.deepEqual(r.calls, []);
  r.t.advance(1);
  assert.deepEqual(r.calls, ['toggle']);
  r.calls.length = 0;
  r.input.click({ target: VIDEO, detail: 1 });
  r.input.click({ target: VIDEO, detail: 2 });
  r.input.dblclick({ target: VIDEO });
  r.t.advance(1000);
  assert.deepEqual(r.calls, ['fs:fullscreen']);
});

test('a click on the bar acts on the bar and never reaches the video', () => {
  const r = rig({ shown: true });
  r.input.click({ target: { kind: 'btn', id: 'stream' }, detail: 1 });
  r.input.click({ target: { kind: 'bar', fraction: 0.5 }, detail: 1, fraction: 0.25 });
  r.input.click({ target: { kind: 'vol' }, detail: 1 });
  r.input.dblclick({ target: { kind: 'btn', id: 'play' } });
  r.t.advance(1000);
  assert.deepEqual(r.calls, ['show:stream', 'key:ok', 'seek:150000']);
});

test('clicks are left alone while a panel or card is up', () => {
  const r = rig({ blocked: true });
  r.input.click({ target: VIDEO, detail: 1 });
  r.input.dblclick({ target: VIDEO });
  r.t.advance(1000);
  assert.deepEqual(r.calls, []);
});

test('the pointer brings the bar up and 3 s of quiet takes bar and cursor away while playing', () => {
  const r = rig();
  assert.equal(IDLE_MS, 3000);
  r.input.activity({ type: 'mousemove', screenX: 10, screenY: 10 });
  assert.deepEqual(r.calls, ['cursor:true', 'show:null']);
  r.calls.length = 0;
  r.t.advance(2000);
  r.input.activity({ type: 'mousemove', screenX: 20, screenY: 10 });
  r.input.activity({ type: 'mousemove', screenX: 20, screenY: 10 }); // same spot: not a move
  r.calls.length = 0;
  r.t.advance(2999);
  assert.deepEqual(r.calls, []);
  r.t.advance(1);
  assert.deepEqual(r.calls, ['hide', 'cursor:false']);
});

test('paused: the bar and the cursor stay', () => {
  const r = rig({ playing: false });
  r.input.activity({ type: 'wheel' });
  r.calls.length = 0;
  r.t.advance(10000);
  assert.deepEqual(r.calls, []);
});

test('Up / Down with the bar hidden and M drive volume through setProp on the mock bridge', async () => {
  const win = { AlderBridge: require('../../mac/web/bridge.js') };
  const mock = installMock({ win });
  const bridge = win.AlderBridge.createBridge({ win });
  const avplay = createAvplay({ bridge });
  const r = rig();
  const input = createPlayerInput({
    controls: { shown: () => false }, engine: {}, avplay, fullscreen() {}, hit: () => VIDEO, blocked: () => false, timers: r.t, ui: {},
  });
  assert.equal(input.key({ type: 'press', action: 'down', repeat: false }), true);
  assert.equal(input.key({ type: 'press', action: 'down', repeat: true }), true);
  assert.equal(input.key({ type: 'press', action: 'up', repeat: false }), true);
  assert.equal(input.key({ type: 'press', action: 'mute', repeat: false }), true);
  assert.equal(input.key({ type: 'press', action: 'mute', repeat: false }), true);
  await new Promise((res) => setTimeout(res, 30));
  const sent = mock.posted.filter((m) => m.cmd === 'setProp').map((m) => [m.args.name, m.args.value]);
  assert.deepEqual(sent, [['volume', 100 - VOLUME_STEP], ['volume', 100 - 2 * VOLUME_STEP], ['volume', 100 - VOLUME_STEP], ['volume', 0], ['volume', 100 - VOLUME_STEP]]);
  assert.equal(input.key({ type: 'press', action: 'left', repeat: false }), false);
});

test('Up / Down are volume whenever no panel or card is open (bar shown too); a panel keeps them; M is the M key', () => {
  const r = rig({ shown: true });
  assert.equal(r.input.key({ type: 'press', action: 'up' }), true);
  assert.deepEqual(r.vols, [100]);
  r.st.blocked = true;
  assert.equal(r.input.key({ type: 'press', action: 'down' }), false);
  r.st.blocked = false;
  assert.equal(r.input.key({ type: 'press', action: 'mute' }), true);
  assert.deepEqual(r.vols, [100, 0]);
  r.t.advance(OSD_MS);
  assert.equal(r.calls[r.calls.length - 1], 'osd:null');
  assert.equal(actionFor(77), 'mute');
});

test('a click on an options row walks the panel to it and presses OK; Back runs engine.exit()', () => {
  const r = rig({ blocked: true });
  const keys = [];
  let exited = 0;
  const input = createPlayerInput({
    controls: {}, engine: { exit: () => exited++, snapshot: () => ({}) }, avplay: {}, fullscreen() {}, hit: (t) => t, menu: { key: (e) => keys.push(e.action) },
    blocked: () => true, timers: r.t, ui: {},
  });
  input.click({ target: { kind: 'row', index: 5, at: 2 }, detail: 1 });
  assert.deepEqual(keys, ['down', 'down', 'down', 'ok']);
  keys.length = 0;
  input.click({ target: { kind: 'row', index: 1, at: 2 }, detail: 1 });
  assert.deepEqual(keys, ['up', 'ok']);
  keys.length = 0;
  input.click({ target: { kind: 'row', index: 2, at: 2 }, detail: 1 });
  assert.deepEqual(keys, ['ok']);
  input.click({ target: { kind: 'back' }, detail: 1 });
  assert.equal(exited, 0, 'blocked: a panel is up');
  const free = createPlayerInput({ controls: {}, engine: { exit: () => exited++ }, avplay: {}, fullscreen() {}, hit: (t) => t, blocked: () => false, timers: r.t, ui: {} });
  free.click({ target: { kind: 'back' }, detail: 1 });
  assert.equal(exited, 1);
});

test('Settings (T12): mac.css positions .sg-group so its focus-fill ::before stays in its row (check:mac fails without it)', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(new URL('../../src/platform/mac/mac.css', import.meta.url), 'utf8'), /^\.sg-group \{ position: relative; \}/m);
  assert.match(readFileSync(new URL('../../dev/check-mac-webkit.mjs', import.meta.url), 'utf8'), /focus-fill ::before is absolute but the element is not positioned/);
});

test('a click on the video with the options panel open closes it like Esc and does not pause; a click on the panel itself does nothing', () => {
  const r = rig({ blocked: true });
  const keys = [];
  let open = true;
  const input = createPlayerInput({
    controls: { quiet: (fn) => fn() }, engine: { snapshot: () => ({}), togglePlay: () => keys.push('toggle') }, avplay: {}, fullscreen() {}, hit: (t) => t,
    menu: { key: (e) => { keys.push(e.action); if (e.action === 'back') open = false; } }, blocked: () => open, menuOpen: () => open, timers: r.t, ui: {},
  });
  input.click({ target: { kind: 'panel' }, detail: 1 });
  r.t.advance(CLICK_DELAY + 1);
  assert.deepEqual(keys, [], 'the panel itself is left alone');
  input.click({ target: VIDEO, detail: 1 });
  r.t.advance(CLICK_DELAY + 1);
  assert.deepEqual(keys, ['back']);
  input.click({ target: VIDEO, detail: 1 });
  r.t.advance(CLICK_DELAY + 1);
  assert.deepEqual(keys, ['back', 'toggle'], 'closed: the next click is the plain pause click again');
});

// ---- the real hit() in bindPlayerInput: fake elements with closest (the full-screen .pl-options / .pl-cardhost layers must not swallow clicks) ----
import { bindPlayerInput } from '../../src/platform/mac/player-input.js';

/** el('div', 'pl-options', parent): closest() handles '.a', '.a .b' and comma lists over the class chain. */
function el(tag, cls, parent = null, extra = {}) {
  const e = { tagName: tag.toUpperCase(), className: cls, parentNode: parent, ...extra };
  const has = (n, c) => (' ' + n.className + ' ').includes(' ' + c + ' ');
  e.classList = { contains: (c) => has(e, c), toggle() {}, add() {}, remove() {} };
  e.closest = (sel) => {
    for (const part of sel.split(',').map((s) => s.trim())) {
      const [a, b] = part.split(/\s+/);
      for (let n = e; n; n = n.parentNode) {
        if (has(n, (b || a).slice(1)) && (!b || (() => { for (let p = n.parentNode; p; p = p.parentNode) if (has(p, a.slice(1))) return true; return false; })())) return n;
      }
    }
    return null;
  };
  return e;
}

function domRig({ options = false, card = null } = {}) {
  const calls = [], logs = [], listeners = {};
  const st = { options, card };
  const mkEl = () => ({ className: '', appendChild() {}, addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, parentNode: null });
  const doc = { createElement: mkEl, addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener() {} };
  const win = { document: doc, setTimeout: (f) => { calls.push('timer'); return 1; }, clearTimeout() {}, AlderBridge: { createBridge: () => ({ log: (l) => { logs.push(l); return Promise.resolve(); } }) } };
  const controls = {
    el: { querySelector: (s) => (s === '.pl-card' && st.card ? { classList: { contains: (c) => c === 'pl-' + st.card } } : null) },
    cardOpen: () => !!st.card, show() {}, hide() {}, quiet: (fn) => fn(), key: (e) => { calls.push('ckey:' + e.action); if (e.action === 'back') st.card = null; },
  };
  const options_ = { isOpen: () => st.options, key: (e) => { calls.push('okey:' + e.action); if (e.action === 'back') st.options = false; } };
  const engine = { snapshot: () => ({ playing: true, duration: 1000 }), togglePlay: () => calls.push('toggle'), exit() {} };
  const root = { appendChild() {}, classList: { toggle() {}, remove() {} } };
  const unbind = bindPlayerInput({ root, controls, options: options_, engine, avplay: {}, fullscreen() {}, win });
  const click = (target) => listeners.click({ target, isTrusted: true, detail: 1, stopPropagation() {} });
  return { calls, logs, click, st, unbind };
}

test('real hit(): a click on the full-screen .pl-options root closes the open options panel (no pause); the panel itself is left alone', () => {
  const r = domRig({ options: true });
  const root = el('div', 'pl-options');
  const panel = el('div', 'pl-opt-panel', root);
  const row = el('div', 'pl-row', el('div', 'pl-opt-scroll', panel));
  r.click(panel);
  r.click(el('div', 'pl-opt-bar', root));
  assert.deepEqual(r.calls, [], 'inside the visible menu: nothing');
  r.click(root);
  assert.deepEqual(r.calls, ['okey:back']);
  assert.equal(r.st.options, false);
  assert.match(r.logs[r.logs.length - 1], /^menu-click: open=options target=div\.pl-options kind=video action=close$/);
  assert.ok(!r.calls.includes('toggle'));
  r.unbind();
  void row;
});

test('real hit(): a click on a row of the open options panel is still a row hit', () => {
  const r = domRig({ options: true });
  const root = el('div', 'pl-options');
  const list = el('div', 'pl-opt-scroll', el('div', 'pl-opt-panel', root));
  const a = el('div', 'pl-row focus', list), b = el('div', 'pl-row', list);
  list.querySelectorAll = () => [a, b];
  a.parentNode = list;
  b.parentNode = list;
  r.click(b);
  assert.deepEqual(r.calls, ['okey:down', 'okey:ok'], 'walked to the row and pressed OK');
});

for (const kind of ['info', 'upnext', 'stall', 'error']) {
  test('real hit(): ' + kind + ' card closes on a click outside its box (the card host layer counts as the video) and is left alone inside', () => {
    const r = domRig({ card: kind });
    const host = el('div', 'pl-cardhost');
    const card = el('div', 'pl-card pl-' + kind, host);
    r.click(el('div', 'pl-pill', card));
    assert.deepEqual(r.calls, [], 'inside the card: unchanged');
    assert.match(r.logs[0], new RegExp('^menu-click: open=card:' + kind + ' target=div\.pl-pill kind=card action=card$'));
    r.click(host);
    assert.deepEqual(r.calls, ['ckey:back']);
    assert.equal(r.st.card, null);
    assert.match(r.logs[1], new RegExp('open=card:' + kind + ' target=div\.pl-cardhost kind=video action=close$'));
    r.unbind();
  });
}

test('real hit(): with nothing open a click is the plain pause click and logs nothing', () => {
  const r = domRig();
  r.click(el('div', 'pl-cardhost'));
  assert.deepEqual(r.logs, []);
});
