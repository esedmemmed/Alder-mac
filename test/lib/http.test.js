import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, HttpError, hashKey, devRewrite } from '../../src/lib/http.js';
import { createCache, memoryStorage } from '../../src/lib/store.js';
import { createLogger } from '../../src/lib/log.js';

const quiet = createLogger();
const ok = (body, status = 200) => ({ status, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer });

/** A fetch that answers from a script: each entry is a function(url, init) returning a response or throwing. */
function scripted(...steps) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return step(url, init);
  };
  fn.calls = calls;
  return fn;
}
/** A fetch that never answers on its own but honours the abort signal, as the real one does. */
const hanging = () => (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
});

test('get returns the body text; post sends JSON with a content type', async () => {
  const f = scripted((u) => ok('hello ' + u));
  const http = createHttp({ fetch: f, log: quiet });
  assert.equal(await http.get('https://a.test/x'), 'hello https://a.test/x');
  assert.equal(f.calls[0].init.method, 'GET');
  const p = await http.post('https://a.test/api', { authKey: 'k', n: 1 });
  assert.ok(p.startsWith('hello'));
  assert.equal(f.calls[1].init.method, 'POST');
  assert.equal(f.calls[1].init.body, '{"authKey":"k","n":1}');
  assert.equal(f.calls[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(await createHttp({ fetch: scripted(() => ok('{"a":[1]}')), log: quiet }).getJson('u'), { a: [1] });
});

test('an error status still returns its body (Stremio puts its JSON error there); an empty one throws', async () => {
  const http = createHttp({ fetch: scripted(() => ok('{"error":{"message":"bad"}}', 400)), log: quiet });
  assert.equal(await http.get('u'), '{"error":{"message":"bad"}}');
  const res = await http.request('u');
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  const empty = createHttp({ fetch: scripted(() => ok('', 404)), log: quiet });
  await assert.rejects(empty.get('u'), (e) => e instanceof HttpError && e.kind === 'http' && e.status === 404);
});

test('timeout: a request that never answers is aborted and rejects with kind "timeout"', async () => {
  const http = createHttp({ fetch: hanging(), log: quiet });
  const t0 = Date.now();
  await assert.rejects(http.get('https://slow.test/', { timeoutMs: 40 }), (e) => e.kind === 'timeout' && /timeout/.test(e.message));
  assert.ok(Date.now() - t0 < 500);
});

test('timeout: also covers a fetch that ignores its abort signal', async () => {
  const http = createHttp({ fetch: () => new Promise(() => {}), log: quiet });
  await assert.rejects(http.get('u', { timeoutMs: 30 }), (e) => e.kind === 'timeout');
});

test('a network failure rejects with kind "network"', async () => {
  const http = createHttp({ fetch: scripted(() => { throw new TypeError('Failed to fetch'); }), log: quiet });
  await assert.rejects(http.get('u'), (e) => e.kind === 'network' && /Failed to fetch/.test(e.message));
});

test('retries: network errors and 503 are retried, then it succeeds; the wait between tries is honoured', async () => {
  const f = scripted(() => { throw new TypeError('down'); }, () => ok('', 503), () => ok('finally'));
  const sleeps = [];
  const http = createHttp({ fetch: f, retries: 2, retryDelayMs: 7, log: quiet,
    timers: { setTimeout: (fn, ms) => { sleeps.push(ms); return setTimeout(fn, ms > 1000 ? ms : 0); }, clearTimeout } });
  assert.equal(await http.get('u'), 'finally');
  assert.equal(f.calls.length, 3);
  assert.equal(sleeps.filter((m) => m === 7).length, 2);
});

test('retries: gives up after the last try with the last error, or the last 5xx answer', async () => {
  const f = scripted(() => { throw new TypeError('down'); });
  const http = createHttp({ fetch: f, retries: 2, retryDelayMs: 1, log: quiet });
  await assert.rejects(http.get('u'), (e) => e.kind === 'network');
  assert.equal(f.calls.length, 3);
  const g = scripted(() => ok('overloaded', 503));
  const h2 = createHttp({ fetch: g, retries: 1, retryDelayMs: 1, log: quiet });
  assert.equal(await h2.get('u'), 'overloaded');
  assert.equal(g.calls.length, 2);
});

test('retries: a 404 or a 400 is an answer, not retried; POST is not retried unless asked', async () => {
  const f = scripted(() => ok('nope', 404));
  await createHttp({ fetch: f, retries: 3, log: quiet }).get('u');
  assert.equal(f.calls.length, 1);
  const p = scripted(() => { throw new TypeError('down'); });
  await assert.rejects(createHttp({ fetch: p, retries: 3, retryDelayMs: 1, log: quiet }).post('u', {}));
  assert.equal(p.calls.length, 1);
  const p2 = scripted(() => { throw new TypeError('down'); });
  await assert.rejects(createHttp({ fetch: p2, retries: 2, retryDelayMs: 1, retryPost: true, log: quiet }).post('u', {}));
  assert.equal(p2.calls.length, 3);
});

test('kept answers: keep saves a successful body, savedAnswer reads it without the network, errors are not kept', async () => {
  const cache = createCache({ storage: memoryStorage() });
  const f = scripted((u) => (u.includes('bad') ? ok('{"error":1}', 500) : ok('{"fresh":true}')));
  const http = createHttp({ fetch: f, cache, log: quiet });
  assert.equal(http.savedAnswer('https://a.test/lib'), null);
  await http.get('https://a.test/lib', { keep: true });
  assert.equal(http.savedAnswer('https://a.test/lib'), '{"fresh":true}');
  assert.equal(f.calls.length, 1);
  await http.get('https://a.test/bad', { keep: true });
  assert.equal(http.savedAnswer('https://a.test/bad'), null, 'an error answer is not kept');
  await http.post('https://a.test/api', '{"authKey":"A"}', { keep: true });
  assert.equal(http.savedAnswer('https://a.test/api', '{"authKey":"A"}'), '{"fresh":true}');
  assert.equal(http.savedAnswer('https://a.test/api', '{"authKey":"B"}'), null, 'the body is part of the key');
  assert.equal(http.savedAnswer('https://a.test/api', { authKey: 'A' }), '{"fresh":true}', 'an object body is keyed as its JSON');
  http.keep('https://a.test/manual', null, 'by hand');
  assert.equal(http.savedAnswer('https://a.test/manual'), 'by hand');
  http.forget();
  assert.equal(http.savedAnswer('https://a.test/lib'), null);
  assert.equal(cache.count(), 0);
});

test('kept answers: without a cache everything is a no-op', async () => {
  const http = createHttp({ fetch: scripted(() => ok('x')), log: quiet });
  await http.get('u', { keep: true });
  assert.equal(http.savedAnswer('u'), null);
  http.keep('u', null, 'b');
  http.forget();
});

test('cache keys are hashes: neither the URL nor the body (an auth key) appears in storage', async () => {
  const storage = memoryStorage();
  const http = createHttp({ fetch: scripted(() => ok('{}')), cache: createCache({ storage }), log: quiet });
  await http.post('https://api.strem.io/api/datastoreGet', '{"authKey":"SECRETKEY"}', { keep: true });
  let all = '';
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); all += k + '=' + storage.getItem(k); }
  assert.ok(!all.includes('SECRETKEY') && !all.includes('strem.io'));
  assert.match(hashKey('a'), /^[0-9a-f]{14}$/);
  assert.notEqual(hashKey('a'), hashKey('b'));
  assert.equal(hashKey('same'), hashKey('same'));
});

test('rewrite redirects the request but the kept answer is keyed by the original URL', async () => {
  const f = scripted(() => ok('fx'));
  const cache = createCache({ storage: memoryStorage() });
  const http = createHttp({ fetch: f, cache, rewrite: (u) => 'http://127.0.0.1:1/__fx/' + u.replace(/^https?:\/\//, ''), log: quiet });
  await http.get('https://api.strem.io/api/x', { keep: true });
  assert.equal(f.calls[0].url, 'http://127.0.0.1:1/__fx/api.strem.io/api/x');
  assert.equal(http.savedAnswer('https://api.strem.io/api/x'), 'fx');
});

test('bytes returns an ArrayBuffer and throws on an error status', async () => {
  const http = createHttp({ fetch: scripted((u) => (u.includes('gone') ? ok('', 404) : ok('abc'))), log: quiet });
  const buf = await http.bytes('https://a.test/pic');
  assert.equal(new TextDecoder().decode(buf), 'abc');
  await assert.rejects(http.bytes('https://a.test/gone'), (e) => e.status === 404);
});

test('devRewrite maps any absolute URL to origin/host/path?query and leaves relative or already-local URLs alone', () => {
  const o = 'http://localhost:8080/__fx';
  assert.equal(devRewrite('https://api.strem.io/api/addonCollectionGet', o), o + '/api.strem.io/api/addonCollectionGet');
  assert.equal(devRewrite('https://v3-cinemeta.strem.io/catalog/movie/top/skip=20.json?x=1', o), o + '/v3-cinemeta.strem.io/catalog/movie/top/skip=20.json?x=1');
  assert.equal(devRewrite('http://192.168.1.5:7000/manifest.json', o), o + '/192.168.1.5_7000/manifest.json');
  assert.equal(devRewrite('https://link.stremio.com', o), o + '/link.stremio.com/');
  assert.equal(devRewrite('/relative/path', o), '/relative/path');
  assert.equal(devRewrite(o + '/x/y', o), o + '/x/y');
});
