'use strict';
// Per-test timeout: a broken reply path leaves an await unsettled, which hung the whole run for hours on Windows (T5).
const nodeTest = require('node:test').test;
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBridge, COMMANDS } = require('../bridge.js');
const { installMock } = require('../mock-bridge.js');
const { runProbe, TARGETS } = require('../probe.js');

const LINK = 'https://debrid.example/d/SECRETTOKEN123/film.mkv?sig=abc';

function manualClock() {
  let now = 0;
  const jobs = [];
  return {
    after(ms, fn) { const job = { at: now + ms, fn }; jobs.push(job); return () => jobs.splice(jobs.indexOf(job), 1); },
    every(ms, fn) {
      const job = { at: now + ms, every: ms, fn };
      jobs.push(job);
      return () => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); };
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = jobs.filter((j) => j.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.every) due.at += due.every; else jobs.splice(jobs.indexOf(due), 1);
        due.fn();
      }
      now = end;
    },
  };
}

function setup(mockOptions) {
  const win = {};
  const clock = manualClock();
  const lines = [];
  const log = (l) => lines.push(l);
  const mock = installMock({ win, clock, log, ...mockOptions });
  const bridge = createBridge({ win, log });
  const seen = [];
  for (const t of ['reply', 'prop', 'fileLoaded', 'playbackRestart', 'endFile']) bridge.on(t, (e) => seen.push(e));
  return { win, clock, lines, mock, bridge, seen };
}

function assertNoLink(text) {
  for (const needle of ['SECRETTOKEN123', 'debrid.example', '://', 'magnet:']) {
    assert.ok(!text.includes(needle), `found ${needle} in: ${text}`);
  }
}

test('commands post {id, cmd, args} with fresh ids, in the contract shape', () => {
  const { bridge, mock } = setup();
  bridge.pause(true);
  bridge.getProp('hwdec-current');
  assert.deepEqual(mock.posted, [
    { id: 1, cmd: 'pause', args: { paused: true } },
    { id: 2, cmd: 'getProp', args: { name: 'hwdec-current' } },
  ]);
});

test('replies overtake: a fast getProp resolves with its own value before a slow seek', async () => {
  const { bridge, clock } = setup();
  const loaded = bridge.load(LINK);
  clock.advance(40);
  await loaded;
  const order = [];
  const seek = bridge.seek(10).then((v) => { order.push('seek'); return v; });
  const get = bridge.getProp('duration').then((v) => { order.push('get'); return v; });
  clock.advance(5);
  assert.equal(await get, 120);
  assert.equal(bridge.pendingCount(), 1, 'seek still waiting');
  clock.advance(30);
  await seek;
  assert.deepEqual(order, ['get', 'seek']);
  assert.equal(bridge.pendingCount(), 0);
});

test('a failed command rejects its own promise; a reply for an unknown id is dropped', async () => {
  const { bridge, clock, mock, lines } = setup();
  const bad = bridge.getProp('no-such-prop');
  clock.advance(5);
  await assert.rejects(bad, /property unavailable/);
  mock.emitRaw({ type: 'reply', id: 999, ok: true });
  assert.ok(lines.some((l) => l.includes('unknown id 999')));
});

test('unknown commands never reach native', async () => {
  const { bridge, mock } = setup();
  await assert.rejects(bridge.send('rm', {}), /unknown command/);
  assert.equal(mock.posted.length, 0);
  assert.deepEqual(COMMANDS, ['load', 'pause', 'seek', 'setProp', 'getProp', 'quit', 'log', 'report']);
});

test('no native handler: send rejects, no throw', async () => {
  const bridge = createBridge({ win: {} });
  await assert.rejects(bridge.pause(true), /native bridge not present/);
});

test('property events arrive: time-pos at 4 Hz, stops on pause, seek moves it', async () => {
  const { bridge, clock, seen } = setup();
  const loaded = bridge.load(LINK);
  clock.advance(40);
  await loaded;
  assert.ok(seen.some((e) => e.type === 'fileLoaded'));
  assert.ok(seen.some((e) => e.type === 'playbackRestart'));
  assert.ok(seen.some((e) => e.type === 'prop' && e.name === 'duration' && e.value === 120));
  const times = () => seen.filter((e) => e.type === 'prop' && e.name === 'time-pos').map((e) => e.value);

  const before = times().length;
  clock.advance(1000);
  assert.equal(times().length - before, 4);
  assert.equal(times().at(-1), 1);

  bridge.pause(true);
  clock.advance(5);
  const paused = times().length;
  clock.advance(1000);
  assert.equal(times().length, paused);

  bridge.pause(false);
  bridge.seek(50);
  clock.advance(30);
  assert.equal(times().at(-1), 50);
});

test('an unsubscribed listener hears nothing; a throwing listener does not stop the others', async () => {
  const { bridge, clock, mock } = setup();
  const heard = [];
  const off = bridge.on('prop', (e) => heard.push(e));
  bridge.on('prop', () => { throw new Error('boom'); });
  let after = 0;
  bridge.on('prop', () => { after += 1; });
  mock.emitRaw({ type: 'prop', name: 'x', value: 1 });
  off();
  mock.emitRaw({ type: 'prop', name: 'x', value: 2 });
  clock.advance(0);
  assert.equal(heard.length, 1);
  assert.equal(after, 2);
});

test('an end-of-file error surfaces with reason, code and message', async () => {
  const { bridge, clock, mock, seen, lines } = setup();
  mock.failNextLoad();
  const loaded = bridge.load(LINK);
  clock.advance(40);
  await loaded;
  const ends = seen.filter((e) => e.type === 'endFile');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].reason, 'error');
  assert.equal(ends[0].error, -13);
  assert.equal(ends[0].message, 'loading failed');
  assert.ok(!seen.some((e) => e.type === 'fileLoaded'));
  assert.ok(lines.some((l) => l.includes('endFile error: loading failed')));
});

test('a clip plays to eof; a new load ends the old one with stop', async () => {
  const short = setup({ duration: 1 });
  const first = short.bridge.load(LINK);
  short.clock.advance(40);
  await first;
  short.clock.advance(2000);
  assert.deepEqual(short.seen.filter((e) => e.type === 'endFile').map((e) => e.reason), ['eof']);

  const { bridge, clock, seen } = setup();
  const a = bridge.load(LINK);
  clock.advance(40);
  await a;
  const b = bridge.load(LINK);
  clock.advance(40);
  await b;
  assert.deepEqual(seen.filter((e) => e.type === 'endFile').map((e) => e.reason), ['stop']);
});

test('a whole session puts no link on the wire back, in an event or in a log line', async () => {
  const { bridge, clock, mock, seen, lines } = setup({ duration: 1 });
  mock.failNextLoad();
  const failed = bridge.load(LINK);
  clock.advance(40);
  await failed;
  const ok = bridge.load(LINK);
  clock.advance(40);
  await ok;
  clock.advance(2000);
  assert.ok(mock.posted.some((m) => m.args.url === LINK), 'the link did go down to native');
  assert.ok(seen.length > 5 && lines.length > 3);
  assertNoLink(JSON.stringify(mock.delivered));
  assertNoLink(JSON.stringify(seen));
  assertNoLink(lines.join('\n'));
});

test('a native that leaks a link still reaches no listener, promise or log line', async () => {
  const { bridge, clock, mock, seen, lines } = setup();
  const loaded = bridge.load(LINK);
  clock.advance(40);
  await loaded;
  mock.emitRaw({ type: 'endFile', reason: 'error', error: -13, message: `cannot open ${LINK} now` });
  mock.emitRaw({ type: 'endFile', reason: 'error', error: -13, message: `encoded ${encodeURIComponent(LINK)}` });
  mock.emitRaw({ type: 'prop', name: 'path', value: 'magnet:?xt=urn:btih:SECRETTOKEN123' });
  mock.emitRaw({ type: 'prop', name: 'nested', value: { a: [`http://debrid.example/SECRETTOKEN123`] } });
  const leaked = bridge.getProp('duration');
  const id = mock.posted.at(-1).id;
  mock.emitRaw({ type: 'reply', id, ok: true, value: LINK });
  assert.equal(await leaked, '[link]');
  const failing = bridge.getProp('duration');
  mock.emitRaw({ type: 'reply', id: mock.posted.at(-1).id, ok: false, error: `bad ${LINK}` });
  await assert.rejects(failing, (err) => { assertNoLink(err.message); return true; });
  bridge.on('fileLoaded', () => { throw new Error(`listener saw ${LINK}`); });
  mock.emitRaw({ type: 'fileLoaded' });
  assertNoLink(JSON.stringify(seen));
  assertNoLink(lines.join('\n'));
});

test('probe reports the user agent, features and both fetches, and sends no credentials', async () => {
  const calls = [];
  const win = {
    Promise, Object, String, Array, globalThis, WeakRef, structuredClone,
    navigator: { userAgent: 'TestKit/1.0' },
    location: { origin: 'alder://app' },
    CSS: { supports: (rule) => rule.includes('grid') },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.includes('cinemeta') && init.mode !== 'no-cors') throw new TypeError('Load failed');
      return { status: 200 };
    },
  };
  const text = await runProbe(win);
  assert.match(text, /userAgent: TestKit\/1\.0/);
  assert.match(text, /origin: alder:\/\/app/);
  assert.match(text, /js Promise\.allSettled: yes/);
  assert.match(text, /css display: grid: yes/);
  assert.match(text, /css inset: 0: no/);
  assert.match(text, /api\.strem\.io: reached, status 200/);
  assert.match(text, /Cinemeta: FAILED, blocked by CORS, host reachable \(TypeError: Load failed\)/);
  assert.equal(calls.length, TARGETS.length + 1); // plus the one no-cors retry after Cinemeta failed
  assert.deepEqual(calls.map((c) => c.url).filter((u, i) => i !== 3), TARGETS.map((t) => t.url));
  for (const host of ['api.strem.io', 'link.stremio.com', 'cinemeta', 'opensubtitles-v3', 'torrentio']) {
    assert.ok(calls.some((c) => c.url.includes(host)), host);
  }
  assert.ok(!/authKey/i.test(JSON.stringify(calls)));
});

test('probe says offline when even no-cors fails, and copes with no CSS object', async () => {
  const win = {
    Promise, Object, String, Array,
    navigator: { userAgent: 'x' },
    fetch: async () => { throw new TypeError('offline'); },
  };
  const text = await runProbe(win);
  assert.match(text, /api\.strem\.io: FAILED, network failure or offline/);
  assert.match(text, /css display: grid: unavailable/);
  assert.match(text, /js WeakRef: no/);
});

test('probe parses WebKit and Safari versions from the user agent', async () => {
  const win = {
    Promise, Object, String, Array,
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.1 Safari/605.1.15' },
    fetch: async () => ({ status: 200 }),
  };
  const text = await runProbe(win);
  assert.match(text, /WebKit version: 605\.1\.15/);
  assert.match(text, /Safari version: 15\.6\.1/);
  assert.doesNotMatch(text, /localStorage/);
});

test('probe localStorage: phase 1 writes, phase 2 finds it, a wiped store reads missing', async () => {
  const data = new Map();
  const storage = { setItem: (k, v) => data.set(k, String(v)), getItem: (k) => (data.has(k) ? data.get(k) : null) };
  const mk = (localStorage) => ({ Promise, Object, String, Array, navigator: { userAgent: 'x' }, localStorage, fetch: async () => ({ status: 204 }) });
  assert.match(await runProbe(mk(storage), 1), /localStorage: written/);
  assert.match(await runProbe(mk(storage), 2), /localStorage after relaunch: present/);
  data.clear();
  assert.match(await runProbe(mk(storage), 2), /localStorage after relaunch: missing/);
  const broken = { setItem() { throw new Error('denied'); }, getItem() { return null; } };
  assert.match(await runProbe(mk(broken), 1), /localStorage: FAILED \(Error\)/);
});

test('log and report cross the bridge, are recorded by the mock, and carry no link', async () => {
  const { bridge, mock, clock, lines } = setup();
  const a = bridge.log('error: boom at ' + LINK);
  const b = bridge.report('userAgent: x\nlink ' + LINK);
  clock.advance(5);
  await Promise.all([a, b]);
  assert.deepEqual(mock.posted.map((m) => m.cmd), ['log', 'report']);
  assert.deepEqual(mock.logs, ['error: boom at [link]']);
  assert.deepEqual(mock.reports, ['userAgent: x\nlink [link]']);
  assertNoLink(JSON.stringify(mock.delivered));
  assertNoLink(lines.join('\n'));
  const c = bridge.send('log', {});
  clock.advance(5);
  await assert.rejects(c, /log needs line/);
});

test('the page holds the control bar, a transparent background, and loads the mock only without native', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /html, body \{[^}]*background: transparent/);
  for (const id of ['bar', 'play', 'seek', 'pos', 'link', 'load', 'probe']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /messageHandlers\.alder\) \{\s*start\(\);/);
  assert.doesNotMatch(html, /<script src="mock-bridge\.js"/);
});

test('the page reports errors through the bridge and runs the probe on ?probe=1|2, then quits', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /window\.onerror/);
  assert.match(html, /unhandledrejection/);
  assert.match(html, /probe=\(\[12\]\)/);
  assert.match(html, /bridge\.report\(text\)/);
  assert.match(html, /bridge\.quit\(\)/);
});
