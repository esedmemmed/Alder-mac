import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playRequest, installPlayHook } from '../../src/platform/mac/play-hook.js';

const enc = encodeURIComponent;
function harness(search, bridgeOn = true) {
  const pushed = [];
  const logged = [];
  const fs = [];
  const router = { push: (name, params) => pushed.push({ name, params }) };
  const bridge = bridgeOn ? () => ({ fullscreen: (on) => { fs.push(on); return Promise.resolve(); } }) : () => null;
  const log = { info: (tag, m) => logged.push(tag + ' ' + m) };
  const ok = installPlayHook({ router, win: { location: { search } }, bridge, log });
  return { ok, pushed, logged, fs };
}

test('play hook: no play parameter, nothing happens', () => {
  for (const s of ['', '?', '?fs=1', '?probe=1', '?play=', '?play=file%3A%2F%2F%2Fetc%2Fpasswd', '?play=javascript%3Aalert(1)']) {
    const h = harness(s);
    assert.equal(h.ok, false, s);
    assert.deepEqual(h.pushed, []);
    assert.deepEqual(h.fs, []);
  }
});

test('play hook: one source opens the player with it, windowed', () => {
  const url = 'https://cdn.example/v/a b.mkv?token=S3CRET&x=1';
  assert.deepEqual(playRequest('?play=' + enc(url)), { sources: [url], fullscreen: false });
  const h = harness('?play=' + enc(url));
  assert.equal(h.ok, true);
  assert.equal(h.pushed.length, 1);
  assert.equal(h.pushed[0].name, 'player');
  assert.equal(h.pushed[0].params.sources[0].url, url);
  assert.deepEqual(h.fs, []);
});

test('play hook: several sources keep their order (failover), fs=1 sends fullscreen', () => {
  const a = 'http://127.0.0.1:9/dead';
  const b = 'https://cdn.example/good.mp4?k=SECRET';
  const h = harness('?play=' + enc(a) + '&play=' + enc(b) + '&fs=1');
  assert.deepEqual(h.pushed[0].params.sources.map((s) => s.url), [a, b]);
  assert.deepEqual(h.fs, [true]);
});

test('play hook: without a bridge it still plays; the link is never logged', () => {
  const url = 'https://cdn.example/good.mp4?k=SECRET';
  const h = harness('?play=' + enc(url) + '&fs=1', false);
  assert.equal(h.ok, true);
  assert.equal(h.logged.length, 1);
  assert.doesNotMatch(h.logged.join(' '), /SECRET|cdn\.example|https?:/);
});

test('play hook source never reads the UI: only location.search, and no log or emit of a link', () => {
  const src = readFileSync(new URL('../../src/platform/mac/play-hook.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /localStorage|document\.|\.value|console\./);
});
