// src/platform/web/html5.js over a fake <video> (EventTarget-like): the same surface as src/player/avplay.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as html5 from '../../src/platform/web/html5.js';
import * as avplay from '../../src/player/avplay.js';
import { createAvplay, splitHeaders, mapMediaError } from '../../src/platform/web/html5.js';

class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.calls = [];
    this.style = {};
    this.paused = true;
    this.currentTime = 0;
    this.duration = NaN;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.error = null;
    this.src = '';
    this.volume = 1;
  }
  fire(name) { this.dispatchEvent(new Event(name)); }
  play() { this.calls.push('play'); this.paused = false; this.fire('play'); return Promise.resolve(); }
  pause() { this.calls.push('pause'); if (!this.paused) { this.paused = true; this.fire('pause'); } }
  removeAttribute(n) { this.calls.push('removeAttribute ' + n); if (n === 'src') this.src = ''; }
  load() { this.calls.push('load'); }
  loadMetadata({ duration = 100, w = 1920, h = 1080 } = {}) { this.duration = duration; this.videoWidth = w; this.videoHeight = h; this.fire('loadedmetadata'); }
}

function fakeTimers() {
  const t = { fns: new Map(), n: 0, cleared: [], setInterval(f, ms) { t.n++; t.fns.set(t.n, { f, ms }); return t.n; }, clearInterval(id) { t.cleared.push(id); t.fns.delete(id); } };
  return t;
}

function start(extra = {}) {
  const video = new FakeVideo();
  const timers = fakeTimers();
  const log = [];
  const events = [];
  const handlers = {};
  ['onBufferingStart', 'onBufferingComplete', 'onTime', 'onCompleted', 'onError'].forEach((n) => { handlers[n] = (...a) => events.push([n, ...a]); });
  const av = createAvplay({ video, timers, log: { info: (_, m) => log.push(m) } });
  const r = av.open('https://host.example/v.mkv', extra.opts || {}, handlers);
  return { av, video, timers, events, log, r };
}

test('same function names and exports as src/player/avplay.js (less what it cannot do)', () => {
  const surface = (o) => Object.keys(o).sort();
  const tv = surface(avplay.createAvplay({ webapis: null }));
  const web = surface(createAvplay({ video: new FakeVideo() }));
  assert.deepEqual(tv.filter((k) => !web.includes(k)), ['captureTrack', 'captureViaEvents', 'fileHash', 'stopCapture']); // the browser cannot read a file's bytes or listen to a text track
  assert.ok(!web.includes('addSubtitle') && !web.includes('setSubDelay') && !web.includes('delayKeysHint'));
  for (const name of ['SCREEN', 'FIT_METHOD', 'FILL_ENABLED', 'fillOffered', 'errorCode', 'splitHeaders', 'attachVideoObject', 'createAvplay']) assert.ok(name in html5, name);
});

test('open sets src and shows the element; prepare resolves at loadedmetadata; duration, time, state', async () => {
  const { av, video } = start();
  assert.equal(video.src, 'https://host.example/v.mkv');
  assert.equal(video.style.display, '');
  assert.equal(av.state(), 'IDLE');
  assert.equal(av.time(), null);
  const p = av.prepare();
  video.loadMetadata({ duration: 61.5 });
  await p;
  assert.equal(av.state(), 'PAUSED');
  assert.equal(av.duration(), 61500);
  assert.equal(av.time(), 0);
  assert.equal(av.isLive(), false);
});

test('play, pause and stop go to the element; pause only from PLAYING', async () => {
  const { av, video } = start();
  assert.equal(av.play(), true);
  video.loadMetadata();
  assert.equal(av.state(), 'PLAYING');
  assert.equal(av.pause(), true);
  assert.equal(av.state(), 'PAUSED');
  assert.equal(av.pause(), false);
  assert.equal(av.stop(), true);
  assert.deepEqual(video.calls.filter((c) => c === 'play' || c === 'pause'), ['play', 'pause', 'pause']);
});

test('seekTo sets currentTime in seconds and resolves at seeked', async () => {
  const { av, video } = start();
  video.loadMetadata();
  const p = av.seekTo(12345.6);
  assert.equal(video.currentTime, 12.346);
  video.fire('seeked');
  await p;
  await assert.rejects(createAvplay({ video: new FakeVideo() }).seekTo(1), /PLAYER_ERROR_SEEK_FAILED/);
});

test('timeupdate and the 250 ms timer reach onTime, the timer only while playing', () => {
  const { av, video, timers, events } = start();
  video.loadMetadata();
  video.currentTime = 1.5;
  video.fire('timeupdate');
  assert.deepEqual(events.pop(), ['onTime', 1500]);
  av.play();
  assert.equal(timers.fns.size, 1);
  assert.equal([...timers.fns.values()][0].ms, 250);
  video.currentTime = 2.25;
  [...timers.fns.values()][0].f();
  assert.deepEqual(events.pop(), ['onTime', 2250]);
  av.pause();
  assert.equal(timers.fns.size, 0);
});

test('waiting and playing map to buffering start and complete, once each', () => {
  const { av, video, events } = start();
  video.loadMetadata();
  av.play();
  video.fire('waiting'); video.fire('waiting');
  video.fire('playing'); video.fire('playing');
  assert.deepEqual(events.filter((e) => e[0].startsWith('onBuffering')), [['onBufferingStart'], ['onBufferingComplete']]);
});

test('ended is onCompleted and stops the timer', () => {
  const { video, timers, events, av } = start();
  video.loadMetadata();
  av.play();
  video.fire('ended');
  assert.deepEqual(events.pop(), ['onCompleted']);
  assert.equal(timers.fns.size, 0);
});

test('MediaError codes: 2 -> connection failed, 3 and 4 -> not supported, 1 -> unknown; before metadata prepare rejects', async () => {
  assert.equal(mapMediaError({ code: 2 }).code, 'PLAYER_ERROR_CONNECTION_FAILED');
  assert.equal(mapMediaError({ code: 3 }).code, 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
  assert.equal(mapMediaError({ code: 4 }).code, 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
  assert.equal(mapMediaError({ code: 1 }).code, 'PLAYER_ERROR_UNKNOWN');
  assert.equal(mapMediaError(null).code, 'PLAYER_ERROR_UNKNOWN');
  const a = start();
  const p = a.av.prepare();
  a.video.error = { code: 4, message: 'no https://x.example/y?token=1' };
  a.video.fire('error');
  await assert.rejects(p, (e) => html5.errorCode(e) === 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT');
  assert.deepEqual(a.events, []);
  const b = start();
  b.video.loadMetadata();
  b.video.error = { code: 2 };
  b.video.fire('error');
  assert.equal(b.events[0][0], 'onError');
  assert.equal(b.events[0][1], 'PLAYER_ERROR_CONNECTION_FAILED');
  assert.ok(!/x\.example|token/.test(a.log.join('\n')));
});

test('request headers cannot be sent: reported like the TV reports its unsupported headers; no headers, none reported', () => {
  const a = start({ opts: { headers: { Authorization: 'x', 'User-Agent': 'u' } } });
  assert.deepEqual(a.r, { unsupportedHeaders: ['Authorization', 'User-Agent'] });
  assert.ok(a.log.some((l) => /cannot send/.test(l)));
  assert.deepEqual(start({ opts: { headers: {} } }).r, { unsupportedHeaders: [] });
  assert.deepEqual(splitHeaders(null), { supported: {}, unsupported: [] });
});

test('close empties and hides the element and drops later events', () => {
  const { av, video, events } = start();
  video.loadMetadata();
  av.close();
  assert.equal(video.src, '');
  assert.equal(video.style.display, 'none');
  assert.equal(av.state(), 'NONE');
  video.currentTime = 3;
  video.fire('timeupdate'); video.fire('ended'); video.fire('waiting');
  assert.deepEqual(events, []);
});

test('tracks: one "und" audio track without audioTracks, the browser list with it; the video track carries its size', () => {
  const a = start();
  a.video.loadMetadata({ w: 1920, h: 800 });
  const tracks = a.av.totalTracks();
  assert.deepEqual(tracks.map((t) => [t.index, t.type]), [[0, 'VIDEO'], [0, 'AUDIO']]);
  assert.equal(JSON.parse(tracks[1].extra_info).language, 'und');
  assert.deepEqual(JSON.parse(tracks[0].extra_info), { Width: '1920', Height: '800', fourCC: '' });
  assert.equal(a.av.currentIndex('AUDIO'), 0);
  assert.equal(a.av.selectTrack('AUDIO', 1), false);
  assert.equal(a.av.selectTrack('TEXT', 0), false);
  assert.equal(a.av.subtitlesOn(true), true);

  const b = start();
  b.video.audioTracks = [{ language: 'eng', label: 'English', enabled: true }, { language: 'fra', label: 'Francais', enabled: false }];
  b.video.audioTracks.length = 2;
  b.video.loadMetadata();
  assert.deepEqual(b.av.totalTracks().filter((t) => t.type === 'AUDIO').map((t) => JSON.parse(t.extra_info).language), ['eng', 'fra']);
  assert.equal(b.av.currentIndex('AUDIO'), 0);
  assert.equal(b.av.selectTrack('AUDIO', 1), true);
  assert.deepEqual(b.video.audioTracks.map((t) => t.enabled), [false, true]);
  assert.equal(b.av.currentIndex('AUDIO'), 1);
});

test('setPicture: Fit is contain, Fill is cover once the file says its shape', () => {
  const { av, video } = start();
  assert.equal(av.fillSupported, true);
  assert.equal(av.setPicture('fit', null).mode, 'fit');
  assert.equal(video.style.objectFit, 'contain');
  const noShape = av.setPicture('fill', null);
  assert.equal(noShape.mode, 'fit');
  assert.equal(video.style.objectFit, 'contain');
  const fill = av.setPicture('fill', { width: 1920, height: 800, ratio: 2.4 });
  assert.deepEqual([fill.mode, fill.roi], ['fill', null]);
  assert.equal(video.style.objectFit, 'cover');
});

test('suspend pauses and restore resumes only what was playing; setVolume is 0..100', () => {
  const { av, video } = start();
  video.loadMetadata();
  av.play();
  av.suspend();
  assert.equal(av.state(), 'PAUSED');
  av.restore();
  assert.equal(av.state(), 'PLAYING');
  assert.equal(av.setVolume(40), true);
  assert.equal(video.volume, 0.4);
});
