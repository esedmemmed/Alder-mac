// The OpenSubtitles file hash: the pure function against a BigInt reference (node only), the range reader, a small file, the TV's XHR reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSubtitlesHash, hashFromRanges, CHUNK } from '../../src/core/file-hash.js';
import { xhrRange } from '../../src/player/avplay.js';

function reference(size, head, tail) {
  const M = (1n << 64n) - 1n;
  let sum = BigInt(size);
  for (const b of [head, tail]) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < b.length; i += 8) sum = (sum + dv.getBigUint64(i, true)) & M;
  }
  return sum.toString(16).padStart(16, '0');
}

function bytes(seed) {
  const b = new Uint8Array(CHUNK);
  let x = seed;
  for (let i = 0; i < b.length; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return b;
}

test('file hash: zeros give the size', () => {
  assert.equal(openSubtitlesHash(12909756, new Uint8Array(CHUNK), new Uint8Array(CHUNK)), '0000000000c4fcbc');
});

test('file hash: matches a BigInt reference, with carries across both halves and past 2^64', () => {
  for (const [size, seed] of [[131072, 1], [12909756, 2], [5000000000, 3], [9007199254740991, 4]]) {
    const head = bytes(seed), tail = bytes(seed + 100);
    assert.equal(openSubtitlesHash(size, head, tail), reference(size, head, tail), 'size ' + size);
  }
  const ones = new Uint8Array(CHUNK).fill(255); // every word 2^64-1: the sum wraps
  assert.equal(openSubtitlesHash(12909756, ones, ones), reference(12909756, ones, ones));
  assert.equal(openSubtitlesHash(12909756, ones.buffer, ones.buffer), reference(12909756, ones, ones), 'ArrayBuffers too');
});

test('file hash: under 131072 bytes there is none', () => {
  assert.equal(openSubtitlesHash(131071, new Uint8Array(CHUNK), new Uint8Array(CHUNK)), null);
});

test('file hash: hashFromRanges asks the head and the tail, and takes the size from the first answer when unknown', async () => {
  const size = 3000000;
  const asked = [];
  const file = (a) => bytes(a);
  const fetchRange = async (a, b) => { asked.push([a, b]); return a === 0 ? { bytes: file(7), total: size } : file(8); };
  const expected = reference(size, file(7), file(8));
  assert.equal(await hashFromRanges(size, fetchRange), expected);
  assert.deepEqual(asked, [[0, 65535], [size - 65536, size - 1]]);
  asked.length = 0;
  assert.equal(await hashFromRanges(null, fetchRange), expected);
  assert.deepEqual(asked, [[0, 65535], [size - 65536, size - 1]]);
  await assert.rejects(hashFromRanges(null, async () => file(7)), /size unknown/);
  await assert.rejects(hashFromRanges(size, async () => { throw new Error('boom'); }), /boom/);
});

test('file hash: a small file is not read at its tail', async () => {
  let calls = 0;
  assert.equal(await hashFromRanges(null, async () => { calls++; return { bytes: new Uint8Array(CHUNK), total: 100000 }; }), null);
  assert.equal(calls, 1);
});

function fakeXhr(answer) {
  return class {
    constructor() { this.headers = {}; }
    open(m, u) { this.url = u; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    getResponseHeader(k) { return k === 'Content-Range' ? answer.range : null; }
    abort() { this.aborted = true; }
    send() { Promise.resolve().then(() => { this.status = answer.status; this.response = answer.body; this.readyState = 2; this.onreadystatechange(); if (!this.aborted) this.onload(); }); }
  };
}

test('file hash: the TV reader sends Range, reads Content-Range, and refuses a server that ignores Range', async () => {
  const Ok = fakeXhr({ status: 206, range: 'bytes 0-65535/3000000', body: new ArrayBuffer(CHUNK) });
  const seen = [];
  const Spy = class extends Ok { setRequestHeader(k, v) { super.setRequestHeader(k, v); seen.push(k + ':' + v); } send() { super.send(); } };
  const r = await xhrRange('http://h/f', 0, 65535, { xhr: Spy });
  assert.equal(r.total, 3000000);
  assert.deepEqual(seen, ['Range:bytes=0-65535']);
  await assert.rejects(xhrRange('http://h/f', 0, 65535, { xhr: fakeXhr({ status: 200, body: null }) }), /ignores Range/);
  await assert.rejects(xhrRange('http://h/f', 0, 65535, { xhr: null }), /no XMLHttpRequest/);
});
