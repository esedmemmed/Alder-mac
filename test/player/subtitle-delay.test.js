// Mac subtitle delay (T2.c1): the Subtitle timing of the options panel drives mpv's sub-delay over the bridge for the file's tracks and
// add-on subtitles alike (the JS cue shift stays unused); a stepper in the panel, a key pair, clamp -10..+10 s, reset on a new pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Subtitle } from '../../src/core/addon.js';
import { createSubtitleDelay, clampDelay, delayRows, delayNotes, DELAY_MIN, DELAY_MAX } from '../../src/player/subtitle-delay.js';
import { actionFor } from '../../src/platform/mac/keys.js';
import { createPlayerInput } from '../../src/platform/mac/player-input.js';
import { makeEngine, stream } from './helpers.js';
import { createOptions } from '../../src/player/options.js';
import { installFakeDom, texts } from './fake-dom.js';

const require = createRequire(import.meta.url);


const video = { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 };
const audio = { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true };
const sub = (id, lang, title) => ({ type: 'sub', id, lang, title, codec: 'subrip', selected: false });
const TRACKS = [video, audio, sub(1, 'eng', 'English'), sub(2, 'fra', 'Francais')];
// a real subtitle has at least 5 cues (the engine skips message files)
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n' + [2, 3, 4, 5, 6].map((n) => '\n' + n + '\n01:0' + n + ':00,000 --> 01:0' + n + ':02,000\nlater ' + n + '\n').join('');

async function play({ tracks = TRACKS, addons = [] } = {}) {
  const src = stream('Movie 1080p WEB-DL x264-A', { tracks: JSON.stringify(tracks) });
  const t = makeEngine({ adapter: 'mpv', sources: [src], http: { get: async () => SRT } });
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

test('the mock bridge and the shell allow sub-delay', () => {
  const swift = readFileSync(fileURLToPath(new URL('../../mac/shell/Player.swift', import.meta.url)), 'utf8');
  assert.match(swift, /static let settable: Set<String> = \[[^\]]*"sub-delay"/);
  const { installMock } = require('../../mac/web/mock-bridge.js');
  assert.ok(installMock);
});

// ---- the same engine on the TV adapter (AVPlay has no sub-delay): an add-on subtitle's cues move, a file track cannot be shifted ----
const TV_TRACKS = JSON.stringify([{ type: 'AUDIO', codec: 'AAC', lang: 'eng', channels: 2 }, { type: 'TEXT', codec: 'SRT', lang: 'eng' }]);
const stamp = (ms) => { const p = (n, w) => String(n).padStart(w, '0'); const s = Math.floor(ms / 1000); return p(Math.floor(s / 3600), 2) + ':' + p(Math.floor(s / 60) % 60, 2) + ':' + p(s % 60, 2) + ',' + p(ms % 1000, 3); };
// srtAt(position ms) -> the subtitle text, asked when the add-on file is fetched
async function playTv({ addons = [], srtAt = null } = {}) {
  const src = stream('Movie 1080p WEB-DL x264-A', { tracks: TV_TRACKS });
  const t = makeEngine({ adapter: 'avplay', sources: [src], http: { get: async () => (srtAt ? srtAt(t.position()) : SRT) } });
  t.stremio.addons = async () => addons.map((a) => ({ name: a, serves: () => true, subtitles: async () => [new Subtitle('https://x.example/a.srt', 'swe', a)] }));
  await t.start();
  await t.advance(40000);
  return t;
}
const lastShown = (t) => { const e = t.events.subtitle; return e.length ? (e[e.length - 1].lines ? e[e.length - 1].lines.map((l) => l.map((s) => s.text).join('')).join('/') : null) : undefined; };

test('TV: an add-on subtitle delay of +300 ms moves the drawn cue; the adapter is not asked', async () => {
  let p0 = 0;
  const t = await playTv({ addons: ['Subs'], srtAt: (pos) => { p0 = pos; return '1\n' + stamp(pos + 1000) + ' --> ' + stamp(pos + 5000) + '\nhi\n'; } });
  assert.equal(t.engine.tracks().delayKeys, null);
  await t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs[0] });
  assert.equal(t.engine.tracks().canShift, true);
  t.engine.setSubtitleDelay(300);
  assert.equal(t.engine.tracks().subDelay, 300);
  assert.equal(t.callsOf('setSubDelay').length, 0);
  assert.match(delayLines(t).at(-1), /delay: 0\.3 s addon$/);
  // the cue starts at p0 + 1.0 s; moved by 0.3 s it shows from p0 + 1.3 s
  await t.advance(p0 + 1100 - t.position());
  assert.ok(!lastShown(t), 'not yet at +1.1 s');
  await t.advance(p0 + 1500 - t.position());
  assert.equal(lastShown(t), 'hi', 'shown at +1.5 s');
});

test('TV: the cue lookup is at the shifted time', async () => {
  const { shiftCues, cueAt, parseSubtitles } = await import('../../src/player/subtitles.js');
  const cues = parseSubtitles(SRT);
  const moved = shiftCues(cues, 300);
  assert.equal(cueAt(moved, 1100, 0), null);
  assert.equal(cueAt(moved, 1500, 0).cue.lines[0][0].text, 'hi');
  assert.equal(cueAt(moved, 2200, 0).cue.lines[0][0].text, 'hi');
  assert.equal(cueAt(cues, 2200, 0), null);
});

test('TV: a file track cannot be shifted: canShift false, setSubtitleDelay changes nothing', async () => {
  const t = await playTv();
  assert.equal(t.engine.tracks().subMode, 'file');
  assert.equal(t.engine.tracks().canShift, false);
  t.engine.setSubtitleDelay(300);
  assert.equal(t.engine.tracks().subDelay, 0);
  assert.deepEqual(delayLines(t), []);
});

async function panelTexts(t) {
  const dom = installFakeDom();
  try {
    const options = createOptions({ host: dom.host, engine: t.engine });
    options.open();
    const all = texts(dom.host);
    options.close();
    return all;
  } finally { dom.remove(); }
}

test('options panel: the stepper and "Now x" on both, the Keys line only on the Mac', async () => {
  const mac = await play({ addons: ['Subs'] });
  const tv = await playTv({ addons: ['Subs'] });
  for (const t of [mac, tv]) await t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs[0] });
  assert.equal(mac.engine.tracks().delayKeys, 'Z earlier, X later');
  const m = await panelTexts(mac);
  const v = await panelTexts(tv);
  for (const all of [m, v]) {
    assert.ok(all.includes('Subtitle timing'));
    assert.ok(all.includes('Reset to 0'));
    assert.ok(all.includes('Now 0.0 s'));
  }
  assert.ok(m.includes('Keys: Z earlier, X later'));
  assert.ok(!v.some((x) => /^Keys:/.test(x)), 'no Keys line on the TV');
});
