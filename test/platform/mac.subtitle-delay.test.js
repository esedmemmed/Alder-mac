// Mac subtitle delay (T2.c1): the Subtitle timing of the options panel drives mpv's sub-delay over the bridge for the file's tracks and
// add-on subtitles alike (the JS cue shift stays unused); a stepper in the panel, a key pair, clamp -10..+10 s, reset on a new pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Subtitle } from '../../src/core/addon.js';
import { SUBTITLE_DELAY_PATCHES, SUBTITLE_DELAY_OPTIONS_PATCHES } from '../../scripts/build.mjs';
import { createSubtitleDelay, clampDelay, delayRows, delayNotes, DELAY_MIN, DELAY_MAX } from '../../src/platform/mac/subtitle-delay.js';
import { actionFor } from '../../src/platform/mac/keys.js';
import { createPlayerInput } from '../../src/platform/mac/player-input.js';
import { makeEngine, stream } from '../player/helpers.js';

const require = createRequire(import.meta.url);

async function patchedEngine() {
  const src = fileURLToPath(new URL('../../src/player/engine.js', import.meta.url));
  const copy = fileURLToPath(new URL('../../src/player/engine.mac-delay-test.js', import.meta.url));
  let text = readFileSync(src, 'utf8');
  for (const [from, to] of SUBTITLE_DELAY_PATCHES) {
    assert.ok(text.includes(from), 'anchor present: ' + from);
    text = text.split(from).join(to);
  }
  text = text.split('#platform/subtitle-delay').join('../platform/mac/subtitle-delay.js');
  writeFileSync(copy, text);
  try { return await import(pathToFileURL(copy).href); } finally { rmSync(copy, { force: true }); }
}
const { createEngine } = await patchedEngine();

const video = { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 };
const audio = { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true };
const sub = (id, lang, title) => ({ type: 'sub', id, lang, title, codec: 'subrip', selected: false });
const TRACKS = [video, audio, sub(1, 'eng', 'English'), sub(2, 'fra', 'Francais')];
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n';

async function play({ tracks = TRACKS, addons = [] } = {}) {
  const src = stream('Movie 1080p WEB-DL x264-A', { tracks: JSON.stringify(tracks) });
  const t = makeEngine({ adapter: 'mpv', createEngine, sources: [src], http: { get: async () => SRT } });
  t.stremio.addons = async () => addons.map((a) => ({ name: a, serves: () => true, subtitles: async () => [new Subtitle('https://x.example/a.srt', 'swe', a)] }));
  await t.start();
  await t.advance(40000);
  return t;
}
const delayLines = (t) => t.log.filter((l) => /delay: /.test(l));

test('module: clamp -10..+10 s, rows, notes with the keys, log line', () => {
  assert.equal(clampDelay(300), 300);
  assert.equal(clampDelay(99999), DELAY_MAX);
  assert.equal(clampDelay(-99999), DELAY_MIN);
  assert.equal(DELAY_MAX, 10000);
  assert.deepEqual(delayRows(300).map((r) => r.ms), [200, 400, 0]);
  assert.deepEqual(delayRows(10000).map((r) => r.ms), [9900, 10000, 0], 'the plus row stops at the limit');
  assert.ok(delayNotes(300).join(' ').includes('+0.3 s'));
  assert.match(delayNotes(0).join(' '), /Z.*X/);
  const sent = [], said = [], reported = [];
  const d = createSubtitleDelay({ avplay: { setSubDelay: (s) => sent.push(s) }, decide: (l) => said.push(l), report: (l) => reported.push(l) });
  assert.equal(d.set(-300, 'file'), -300);
  assert.deepEqual([sent, said, reported], [[-0.3], ['delay: -0.3 s file'], ['delay: -0.3 s file']]);
  assert.equal(d.set(500000, 'addon'), 10000);
  assert.equal(sent.at(-1), 10);
  assert.equal(d.pick('off'), 0);
  assert.equal(sent.length, 2, 'Off sends nothing');
  assert.equal(d.pick('file'), 0);
  assert.equal(sent.at(-1), 0);
  assert.ok(said.every((l) => !/https?:/.test(l)), 'no link in a log line');
});

test('keys: Z and X are the delay pair and are free elsewhere', () => {
  assert.equal(actionFor(90), 'subearlier');
  assert.equal(actionFor(88), 'sublater');
  assert.equal(actionFor(77), 'mute');
});

test('a file track on: canShift, the delay goes to mpv as seconds, logged once per change', async () => {
  const t = await play();
  assert.equal(t.engine.tracks().subMode, 'file');
  assert.equal(t.engine.tracks().canShift, true);
  t.engine.setSubtitleDelay(300);
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-delay'), 0.3);
  assert.equal(t.engine.tracks().subDelay, 300);
  assert.deepEqual(delayLines(t).map((l) => l.replace(/^.*delay:/, 'delay:')), ['delay: 0.0 s file', 'delay: 0.3 s file']); // the start rule's track goes through pick (T4: remembered value, here 0)
  t.engine.setSubtitleDelay(-400000);
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-delay'), -10);
  assert.equal(t.engine.tracks().subDelay, -10000);
});

test('a new pick sets the delay back to 0 and sends it; Off hides the control and changes nothing', async () => {
  const t = await play();
  t.engine.setSubtitleDelay(1200);
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-delay'), 1.2);
  await t.engine.selectSubtitle({ kind: 'file', index: 1 });
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-delay'), 0);
  assert.equal(t.engine.tracks().subDelay, 0);
  t.engine.setSubtitleDelay(500);
  await t.engine.selectSubtitle({ kind: 'off' });
  await t.advance(50);
  assert.equal(t.engine.tracks().canShift, false);
  const before = delayLines(t).length;
  t.engine.setSubtitleDelay(900);
  await t.advance(50);
  assert.equal(delayLines(t).length, before, 'no change while Off');
  assert.equal(t.engine.tracks().subDelay, 0);
  await t.engine.selectSubtitle({ kind: 'file', index: 0 });
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-delay'), 0);
  assert.match(delayLines(t).at(-1), /delay: 0\.0 s file$/);
});

test('an add-on subtitle: same wire, kind addon, no JS cue shift', async () => {
  const t = await play({ addons: ['Subs'] });
  const pick = t.engine.tracks().addonSubs[0];
  assert.ok(pick, 'the add-on answered');
  await t.engine.selectSubtitle({ kind: 'addon', sub: pick });
  await t.advance(50);
  assert.equal(t.engine.tracks().canShift, true);
  t.engine.setSubtitleDelay(700);
  await t.advance(50);
  assert.equal(t.mpv.prop('sub-delay'), 0.7);
  assert.match(delayLines(t).at(-1), /delay: 0\.7 s addon$/);
});

test('the Z / X keys step the delay by 0.1 s while playing, only with subtitles on', () => {
  const calls = [];
  let state = { subDelay: 0, canShift: true };
  const engine = { snapshot: () => ({ playing: true, duration: 1 }), tracks: () => state, setSubtitleDelay: (ms) => { calls.push(ms); state = { subDelay: ms, canShift: true }; } };
  const input = createPlayerInput({ controls: {}, engine, avplay: {}, fullscreen() {}, hit: (x) => x, timers: { setTimeout: () => 1, clearTimeout() {} }, ui: { osd: () => {} } });
  assert.equal(input.key({ type: 'press', action: 'sublater' }), true);
  assert.equal(input.key({ type: 'press', action: 'sublater' }), true);
  assert.equal(input.key({ type: 'press', action: 'subearlier' }), true);
  assert.deepEqual(calls, [100, 200, 100]);
  state = { subDelay: 0, canShift: false };
  assert.equal(input.key({ type: 'press', action: 'sublater' }), false);
});

test('options panel patch: anchors present, the timing list becomes the stepper', () => {
  const text = readFileSync(fileURLToPath(new URL('../../src/player/options.js', import.meta.url)), 'utf8');
  let out = text;
  for (const [from, to] of SUBTITLE_DELAY_OPTIONS_PATCHES) {
    assert.ok(text.includes(from), 'anchor present: ' + from);
    out = out.split(from).join(to);
  }
  assert.ok(!out.includes('TIMING_STEPS.map'));
  assert.ok(out.includes('delayRows(t.subDelay)'));
});

test('the mock bridge and the shell allow sub-delay', () => {
  const swift = readFileSync(fileURLToPath(new URL('../../mac/shell/Player.swift', import.meta.url)), 'utf8');
  assert.match(swift, /static let settable: Set<String> = \[[^\]]*"sub-delay"/);
  const { installMock } = require('../../mac/web/mock-bridge.js');
  assert.ok(installMock);
});
