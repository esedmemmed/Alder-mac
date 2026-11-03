'use strict';
// Bridge v2 wire (docs/ops/INDEX.md): every command and event, against the scripted-mpv mock.
const nodeTest = require('node:test').test;
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
const assert = require('node:assert/strict');
const { createBridge, EVENT_TYPES } = require('../bridge.js');
const { installMock, stripUrls } = require('../mock-bridge.js');

const LINK = 'https://debrid.example/d/SECRETTOKEN123/film.mkv?sig=abc';
const TOKEN = 'Bearer SECRETTOKEN123';

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
  const mock = installMock({ win, clock, log: (l) => lines.push(l), ...mockOptions });
  const bridge = createBridge({ win, log: (l) => lines.push(l) });
  const seen = [];
  for (const t of EVENT_TYPES) bridge.on(t, (e) => seen.push(e));
  const props = (name) => seen.filter((e) => e.type === 'prop' && e.name === name).map((e) => e.value);
  return { win, clock, lines, mock, bridge, seen, props };
}

async function playing(s) {
  const p = s.bridge.load(LINK);
  s.clock.advance(40);
  await p;
}

function assertNoUrl(text) {
  for (const needle of ['SECRETTOKEN123', 'debrid.example', '://', 'sig=abc']) {
    assert.ok(!text.includes(needle), `found ${needle} in: ${text}`);
  }
}

test('load carries headers and start; the mock starts there and fileLoaded precedes playbackRestart', async () => {
  const s = setup();
  const p = s.bridge.load(LINK, { headers: { Authorization: TOKEN, 'X-A': 'b,c' }, start: 42 });
  s.clock.advance(40);
  await p;
  assert.deepEqual(s.mock.posted[0].args, { url: LINK, headers: { Authorization: TOKEN, 'X-A': 'b,c' }, start: 42 });
  assert.deepEqual(s.mock.loads, [{ headers: { Authorization: TOKEN, 'X-A': 'b,c' }, start: 42 }]);
  const order = s.seen.filter((e) => e.type === 'fileLoaded' || e.type === 'playbackRestart').map((e) => e.type);
  assert.deepEqual(order, ['fileLoaded', 'playbackRestart']);
  assert.equal(s.props('time-pos')[0], 42);
  // A load without options sends neither field.
  const q = s.bridge.load(LINK);
  s.clock.advance(40);
  await q;
  assert.deepEqual(s.mock.posted.at(-1).args, { url: LINK });
  const bad = s.bridge.send('load', { url: LINK, headers: 'x' });
  s.clock.advance(40);
  await assert.rejects(bad, /headers must be an object/);
});

test('observe: defaults flow, an observed name starts flowing with its current value, unknown names are refused', async () => {
  const s = setup();
  await playing(s);
  assert.equal(s.props('track-list').length, 0, 'not observed yet');
  const o = s.bridge.observe(['track-list', 'aid', 'paused-for-cache', 'cache-buffering-state', 'video-params',
    'audio-params', 'hwdec-current', 'eof-reached']);
  s.clock.advance(5);
  await o;
  assert.equal(s.props('track-list').at(-1).length, 3);
  assert.equal(s.props('aid').at(-1), 1);
  assert.equal(s.props('cache-buffering-state').at(-1), 100);
  assert.deepEqual(s.props('video-params').at(-1), { w: 1920, h: 1080, pixelformat: 'yuv420p' });
  assert.equal(s.props('hwdec-current').at(-1), 'mock');
  assert.equal(s.props('eof-reached').at(-1), false);
  const bad = s.bridge.observe(['path']);
  const empty = s.bridge.observe([]);
  s.clock.advance(5);
  await assert.rejects(bad, /not observable/);
  await assert.rejects(empty, /needs names/);
});

test('setProp reaches the six names only; aid and sid pick tracks; getProp reads back', async () => {
  const s = setup();
  await playing(s);
  await Promise.all([s.bridge.observe(['aid', 'sid', 'track-list']), (s.clock.advance(5), 0)]);
  const set = [
    s.bridge.setProp('aid', 2), s.bridge.setProp('sub-visibility', false), s.bridge.setProp('panscan', 0.5),
    s.bridge.setProp('video-aspect-override', '16:9'), s.bridge.setProp('volume', 80),
  ];
  s.clock.advance(5);
  await Promise.all(set);
  assert.equal(s.props('aid').at(-1), 2);
  assert.deepEqual(s.props('track-list').at(-1).filter((t) => t.selected && t.type === 'audio').map((t) => t.id), [2]);
  for (const [name, value] of [['sub-visibility', false], ['panscan', 0.5], ['video-aspect-override', '16:9'], ['volume', 80], ['aid', 2]]) {
    const g = s.bridge.getProp(name);
    s.clock.advance(5);
    assert.equal(await g, value, name);
  }
  const denied = s.bridge.setProp('pause', true);
  const denied2 = s.bridge.setProp('path', 'x');
  s.clock.advance(5);
  await assert.rejects(denied, /not settable/);
  await assert.rejects(denied2, /not settable/);
});

test('subAdd adds an external track and selects it; it needs text and a playing file', async () => {
  const s = setup();
  const early = s.bridge.subAdd('1\n00:00:01,000 --> 00:00:02,000\nhi\n', 'eng', 'English (add-on)');
  s.clock.advance(5);
  await assert.rejects(early, /nothing playing/);
  await playing(s);
  await Promise.all([s.bridge.observe(['sid', 'track-list']), (s.clock.advance(5), 0)]);
  const p = s.bridge.subAdd('WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n', 'swe', 'Svenska');
  s.clock.advance(5);
  await p;
  assert.deepEqual(s.mock.subs, [{ text: 'WEBVTT\n\n00:01.000 --> 00:02.000\nhi\n', lang: 'swe', title: 'Svenska' }]);
  assert.equal(s.props('sid').at(-1), 1);
  const sub = s.props('track-list').at(-1).find((t) => t.type === 'sub');
  assert.deepEqual([sub.lang, sub.title, sub.selected, sub.external], ['swe', 'Svenska', true, true]);
  const none = s.bridge.send('subAdd', {});
  s.clock.advance(5);
  await assert.rejects(none, /needs text/);
});

test('fullscreen and saveFile: the shell is told, saveFile replies the Downloads path with a sanitized name', async () => {
  const s = setup();
  const f = s.bridge.fullscreen(true);
  s.clock.advance(5);
  await f;
  assert.equal(s.mock.fullscreen, true);
  const g = s.bridge.fullscreen(false);
  s.clock.advance(5);
  await g;
  assert.equal(s.mock.fullscreen, false);
  const save = s.bridge.saveFile('../etc/diag: 1.txt', 'hello');
  s.clock.advance(5);
  assert.equal(await save, '~/Downloads/_etc_diag_ 1.txt');
  assert.deepEqual(s.mock.saved, [{ name: '_etc_diag_ 1.txt', text: 'hello' }]);
  const bad = s.bridge.send('saveFile', { name: 'x' });
  s.clock.advance(5);
  await assert.rejects(bad, /needs name and text/);
});

test('a clip plays: ticks, eof-reached, then endFile eof; a mid-play error ends with reason error', async () => {
  const s = setup({ duration: 2 });
  await playing(s);
  await Promise.all([s.bridge.observe(['eof-reached']), (s.clock.advance(5), 0)]);
  s.clock.advance(3000);
  assert.equal(s.props('eof-reached').at(-1), true);
  assert.deepEqual(s.seen.filter((e) => e.type === 'endFile').map((e) => e.reason), ['eof']);

  const t = setup();
  t.mock.failAt(1);
  await playing(t);
  t.clock.advance(3000);
  const end = t.seen.filter((e) => e.type === 'endFile');
  assert.equal(end.length, 1);
  assert.deepEqual([end[0].reason, end[0].error, end[0].message], ['error', -13, 'playback failed']);
});

test('a cache stall pauses the ticks and flips paused-for-cache and cache-buffering-state', async () => {
  const s = setup();
  await playing(s);
  await Promise.all([s.bridge.observe(['paused-for-cache', 'cache-buffering-state']), (s.clock.advance(5), 0)]);
  s.clock.advance(1000);
  const times = () => s.props('time-pos').length;
  s.mock.stall(2000);
  const during = times();
  s.clock.advance(1500);
  assert.equal(times(), during, 'no ticks while stalled');
  assert.equal(s.props('paused-for-cache').at(-1), true);
  assert.equal(s.props('cache-buffering-state').at(-1), 0);
  s.clock.advance(1000);
  assert.equal(s.props('paused-for-cache').at(-1), false);
  assert.equal(s.props('cache-buffering-state').at(-1), 100);
  s.clock.advance(1000);
  assert.ok(times() > during, 'ticks resume');
});

test('lifecycle events reach listeners: sleep pauses first, wake, audioDevice, willQuit; quit command ends playback', async () => {
  const s = setup();
  await playing(s);
  s.mock.sleep();
  const kinds = s.seen.map((e) => e.type === 'prop' ? `prop:${e.name}:${e.value}` : e.type);
  assert.ok(kinds.indexOf('prop:pause:true') >= 0 && kinds.indexOf('prop:pause:true') < kinds.lastIndexOf('sleep'));
  s.mock.wake();
  s.mock.audioDeviceChanged();
  s.mock.requestQuit();
  for (const t of ['sleep', 'wake', 'audioDevice', 'willQuit']) assert.equal(s.seen.filter((e) => e.type === t).length, 1, t);
  const q = s.bridge.quit();
  s.clock.advance(5);
  await q;
  assert.equal(s.mock.quit, true);
  assert.deepEqual(s.seen.filter((e) => e.type === 'endFile').map((e) => e.reason), ['quit']);
  assert.ok(s.lines.some((l) => l === 'event willQuit'));
});

test('stripUrls is the one rule: scheme://... and ?query go; endFile.message, log and report lines use it', async () => {
  assert.equal(stripUrls(`fail ${LINK} then`), 'fail [link] then');
  assert.equal(stripUrls('see /x/y?token=1 end'), 'see /x/y?[query] end');
  assert.equal(stripUrls('plain text. what?'), 'plain text. what?');
  const s = setup();
  s.mock.failNextLoad(`cannot open ${LINK}`);
  const bad = s.bridge.load(LINK);
  s.clock.advance(40);
  await bad;
  assert.equal(s.seen.find((e) => e.type === 'endFile').message, 'cannot open [link]');
  // Native-side stripping holds even when the page does not scrub: post the raw wire.
  s.win.webkit.messageHandlers.alder.postMessage({ id: 90, cmd: 'log', args: { line: `x ${LINK}` } });
  s.win.webkit.messageHandlers.alder.postMessage({ id: 91, cmd: 'report', args: { text: `play: ${LINK}\nq?a=SECRETTOKEN123` } });
  s.clock.advance(5);
  assert.deepEqual(s.mock.logs, ['x [link]']);
  assert.deepEqual(s.mock.reports, ['play: [link]\nq?[query]']);
});

test('a whole v2 session leaks no URL, header token or query in events, logs or reports', async () => {
  const s = setup({ duration: 3 });
  s.mock.failNextLoad(`cannot open ${LINK}`);
  const first = s.bridge.load(LINK, { headers: { Authorization: TOKEN } });
  s.clock.advance(40);
  await first;
  const second = s.bridge.load(LINK, { headers: { Authorization: TOKEN }, start: 1 });
  s.clock.advance(40);
  await second;
  const rest = [
    s.bridge.observe(['track-list', 'aid', 'sid', 'video-params', 'audio-params', 'hwdec-current']),
    s.bridge.subAdd('1\n00:00:01,000 --> 00:00:02,000\nhi\n', 'eng', 'E'),
    s.bridge.setProp('volume', 70), s.bridge.fullscreen(true), s.bridge.saveFile('d.txt', 'x'),
    s.bridge.log(`note ${LINK}`), s.bridge.report(`play: label=a\n${LINK}`),
  ];
  s.clock.advance(5);
  await Promise.all(rest);
  s.mock.stall(500);
  s.mock.sleep();
  s.mock.wake();
  s.mock.audioDeviceChanged();
  s.mock.requestQuit();
  s.clock.advance(5000);
  assert.ok(s.seen.length > 20 && s.lines.length > 10);
  assert.ok(s.mock.posted.some((m) => m.args.url === LINK), 'the link did go down');
  assertNoUrl(JSON.stringify(s.mock.delivered));
  assertNoUrl(JSON.stringify(s.seen));
  assertNoUrl(s.lines.join('\n'));
  assertNoUrl(s.mock.reports.join('\n'));
  assertNoUrl(s.mock.logs.join('\n'));
});
