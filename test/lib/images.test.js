import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoFor, backgroundFor, sharp, sized, createImageLoader } from '../../src/lib/images.js';

test('logoFor / backgroundFor build MetaHub URLs from an IMDb id, episode suffix dropped', () => {
  assert.equal(logoFor('tt0111161'), 'https://images.metahub.space/logo/medium/tt0111161/img');
  assert.equal(logoFor('tt0903747:1:2'), 'https://images.metahub.space/logo/medium/tt0903747/img');
  assert.equal(backgroundFor('tt0111161'), 'https://images.metahub.space/background/large/tt0111161/img');
  assert.equal(logoFor('kitsu:1'), null);
  assert.equal(logoFor(undefined), null);
  assert.equal(backgroundFor(''), null);
});

test('sharp picks the MetaHub copy by display width', () => {
  const poster = 'https://images.metahub.space/poster/small/tt1/img';
  assert.equal(sharp(poster, 100), poster);
  assert.equal(sharp(poster, 176), 'https://images.metahub.space/poster/medium/tt1/img');
  assert.equal(sharp(poster, 1920), 'https://images.metahub.space/poster/large/tt1/img');
  assert.equal(sharp('https://images.metahub.space/background/medium/tt1/img', 1920), 'https://images.metahub.space/background/large/tt1/img');
  assert.equal(sharp('https://example.com/p.jpg', 1920), 'https://example.com/p.jpg');
});

test('sized picks the TMDB width', () => {
  assert.equal(sized('https://image.tmdb.org/t/p/original/abc.jpg', 176), 'https://image.tmdb.org/t/p/w780/abc.jpg');
  assert.equal(sized('https://image.tmdb.org/t/p/original/abc.jpg', 1000), 'https://image.tmdb.org/t/p/w1280/abc.jpg');
  assert.equal(sized('https://image.tmdb.org/t/p/original/abc.jpg', 1920), 'https://image.tmdb.org/t/p/original/abc.jpg');
});

/** Fake Image elements the test finishes by hand. */
function harness(opts = {}) {
  const pics = [];
  const createImage = () => {
    const pic = { set src(v) { pic._src = v; pics.push(pic); }, get src() { return pic._src; } };
    return pic;
  };
  const loader = createImageLoader(Object.assign({ createImage }, opts));
  const el = (name) => ({ name, src: '', removeAttribute() { this.src = ''; } });
  const finish = (url, ok = true) => { const p = pics.find((x) => x._src === url && !x.done); p.done = true; (ok ? p.onload : p.onerror)(); };
  const started = () => pics.map((p) => p._src);
  const tick = () => new Promise((r) => setImmediate(r));
  return { loader, el, finish, started, tick, pics };
}

test('at most 6 normal loads run at once; the rest wait and start as slots free', async () => {
  const t = harness();
  const els = Array.from({ length: 10 }, (_, i) => t.el('e' + i));
  els.forEach((e, i) => t.loader.load(e, 'u' + i));
  assert.equal(t.started().length, 6);
  t.finish('u0'); await t.tick();
  assert.equal(t.started().length, 7);
  assert.equal(els[0].src, 'u0');
});

test('newest request first: the card the remote stopped on loads before the ones it passed', async () => {
  const t = harness({ normal: 1 });
  const els = Array.from({ length: 5 }, (_, i) => t.el('e' + i));
  els.forEach((e, i) => t.loader.load(e, 'u' + i));
  assert.deepEqual(t.started(), ['u0']);
  t.finish('u0'); await t.tick();
  assert.deepEqual(t.started(), ['u0', 'u4'], 'the newest waiting request goes next');
  t.finish('u4'); await t.tick();
  assert.deepEqual(t.started(), ['u0', 'u4', 'u3']);
});

test('a request whose element moved on is dropped when its turn comes', async () => {
  const t = harness({ normal: 1 });
  const a = t.el('a'); const b = t.el('b'); const c = t.el('c');
  t.loader.load(a, 'ua'); t.loader.load(b, 'ub'); t.loader.load(c, 'uc');
  t.loader.load(c, 'uc2');          // c wants something else now
  t.loader.cancel(b);               // b was unmounted
  t.finish('ua'); await t.tick();
  assert.deepEqual(t.started(), ['ua', 'uc2']);
});

test('one download per URL however many elements ask; all of them show it', async () => {
  const t = harness();
  const a = t.el('a'); const b = t.el('b');
  t.loader.load(a, 'same'); t.loader.load(b, 'same');
  assert.equal(t.started().filter((s) => s === 'same').length, 1);
  t.finish('same'); await t.tick();
  assert.equal(a.src, 'same');
  assert.equal(b.src, 'same');
  assert.ok(t.loader.cached('same'));
});

test('a cached picture shows at once and calls onDone synchronously', async () => {
  const t = harness();
  const a = t.el('a');
  t.loader.load(a, 'p'); t.finish('p'); await t.tick();
  const b = t.el('b'); let done = 0;
  t.loader.load(b, 'p', { onDone: () => done++ });
  assert.equal(b.src, 'p');
  assert.equal(done, 1);
  assert.equal(t.started().length, 1, 'no second download');
});

test('failure: orElse is tried, then onFail', async () => {
  const t = harness();
  const a = t.el('a'); let failed = 0;
  t.loader.load(a, 'bad', { orElse: 'fallback', onFail: () => failed++ });
  t.finish('bad', false); await t.tick();
  assert.deepEqual(t.started(), ['bad', 'fallback']);
  t.finish('fallback', false); await t.tick();
  assert.equal(failed, 1);
  assert.equal(a.src, '');
  const b = t.el('b'); let f2 = 0;
  t.loader.load(b, null, { onFail: () => f2++ });
  assert.equal(f2, 1);
  const c = t.el('c');
  t.loader.load(c, '', { orElse: 'fb2' });
  assert.deepEqual(t.started().slice(-1), ['fb2']);
});

test('urgent loads have their own lane and do not wait behind a full normal lane', () => {
  const t = harness({ normal: 1, urgent: 2 });
  t.loader.load(t.el('a'), 'n1'); t.loader.load(t.el('b'), 'n2');
  t.loader.load(t.el('logo'), 'logo', { urgent: true });
  assert.deepEqual(t.started(), ['n1', 'logo']);
});

test('prefetch uses the ahead lane, skips cached and in-flight URLs, and warms the cache', async () => {
  const t = harness({ ahead: 1 });
  t.loader.prefetch('x'); t.loader.prefetch('x'); t.loader.prefetch('y');
  assert.deepEqual(t.started(), ['x']);
  t.finish('x'); await t.tick();
  assert.ok(t.loader.cached('x'));
  t.loader.prefetch('x');
  assert.equal(t.started().filter((s) => s === 'x').length, 1);
  const a = t.el('a'); t.loader.load(a, 'x');
  assert.equal(a.src, 'x');
  t.loader.prefetch(null);
});

test('a download that never ends is given up after timeoutMs', async () => {
  const t = harness({ timeoutMs: 20 });
  const a = t.el('a'); let failed = 0;
  t.loader.load(a, 'slow', { onFail: () => failed++ });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(failed, 1);
  assert.deepEqual(t.loader.stats().running, { normal: 0, urgent: 0, ahead: 0 });
});

test('rewrite redirects the download but cached() and src use the rewritten address consistently', async () => {
  const t = harness({ rewrite: (u) => 'http://local/' + u });
  const a = t.el('a');
  t.loader.load(a, 'img.png'); t.finish('http://local/img.png'); await t.tick();
  assert.equal(a.src, 'http://local/img.png');
  assert.ok(t.loader.cached('img.png'));
});

test('the loaded set is capped', async () => {
  const t = harness({ maxLoaded: 3 });
  for (let i = 0; i < 5; i++) { t.loader.load(t.el('e' + i), 'u' + i); t.finish('u' + i); await t.tick(); }
  assert.equal(t.loader.stats().loaded, 3);
  assert.ok(!t.loader.cached('u0') && t.loader.cached('u4'));
});
