/*
 * Phone layout shots (npm run shots:phone). Builds the Android variant of the Mac bundle in dev mode (fixture-server rewrites on,
 * `node scripts/build.mjs --mac --android` with dev:true) into .run/1.9/dist-android-dev, serves it with the fixture server, and drives
 * Playwright Chromium as a phone (412x915 portrait, 915x412 landscape, deviceScaleFactor 3, touch). Saves
 * .run/1.9/phone/<orientation>-<nn>-<screen>.png for sign-in, home, home scrolled, movie, series episodes, sources, player,
 * settings and diagnostics, and prints one line per file plus every console error. Exits 1 only when the script itself fails.
 */
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.run/1.9');
const SHOTS = join(OUT, 'phone');
const VIEWS = [['portrait', 412, 915], ['landscape', 915, 412]];
const CLOCK = '&clock=12:03%20AM';
const AUTH = 'FIXTURE-AUTH-KEY-0001';
const DUNE = { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' };
const SEV = { type: 'series', id: 'tt11280740', name: 'Severance' };

async function main() {
  const { chromium } = await import('playwright');
  const { buildMac } = await import('../scripts/build.mjs');
  const { startServer } = await import('./fixture-server.mjs');
  const dist = join(OUT, 'dist-android-dev');
  mkdirSync(SHOTS, { recursive: true });
  await buildMac({ dev: true, android: true, outDir: dist, log: () => {} });
  const server = await startServer({ quiet: true, staticDir: dist });
  // The player needs a <video>: the web variant (same pages and CSS, an HTML5 player behind them) in a second dev build, serving a clip
  // the browser records itself (there is no ffmpeg for the fixture server's own test clip).
  const webDist = join(OUT, 'dist-web-dev');
  await buildMac({ dev: true, web: true, outDir: webDist, log: () => {} });
  const webServer = await startServer({ quiet: true, staticDir: webDist });
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' })); // the bundled Chromium when installed, else the system Edge
  const problems = [];
  let n = 0;
  try {
    let clip = null;
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(webServer.origin + '/?x=1');
      clip = Buffer.from(await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 360;
        const g = c.getContext('2d');
        const rec = new MediaRecorder(c.captureStream(24), { mimeType: 'video/webm' });
        const parts = [];
        rec.ondataavailable = (e) => parts.push(e.data);
        let k = 0;
        const iv = setInterval(() => { g.fillStyle = 'hsl(' + (k * 5 % 360) + ',45%,32%)'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText('Alder test clip ' + k++, 40, 190); }, 40);
        rec.start();
        await new Promise((r) => setTimeout(r, 14000));
        const stopped = new Promise((r) => { rec.onstop = r; });
        rec.stop();
        await stopped;
        clearInterval(iv);
        const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
        let t = '';
        for (let i = 0; i < buf.length; i += 8192) t += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
        return btoa(t);
      }), 'base64');
      await ctx.close();
    }
    for (const [orient, w, h] of VIEWS) {
      let nn = 0;
      const open = async (url, before = null) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
        if (before) await before(ctx);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => problems.push(orient + ' page error: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') problems.push(orient + ' console error: ' + m.text()); });
        page.on('response', (r) => { if (r.status() === 404) problems.push(orient + ' 404: ' + r.url().replace(server.origin, '')); });
        await page.goto(server.origin + url, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
        return { ctx, page };
      };
      const shot = async (page, name, num = null) => {
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.waitForTimeout(500);
        const file = join(SHOTS, orient + '-' + String(num === null ? ++nn : num).padStart(2, '0') + '-' + name + '.png');
        await page.screenshot({ path: file });
        n++;
        console.log(file);
      };
      const show = async (page, name, params) => {
        await page.evaluate(([nm, p, auth]) => {
          const s = window.__alder.context.session;
          if (!s.profiles.all().length) s.profiles.add('Enough', auth);
          s.profiles.setActive(s.profiles.all()[0].id);
          window.__alder.router.reset(nm, p);
        }, [name, params, AUTH]);
        await page.waitForTimeout(300);
      };
      const press = async (page, key, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(60); } await page.waitForTimeout(300); };
      // Native touch scrolling: a real touch sequence (touchStart, touchMove steps, touchEnd) through the DevTools protocol, then the
      // scroller's scrollTop before and after. (Input.synthesizeScrollGesture does not scroll in headless Edge, even on a plain page.)
      const state = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); return e ? { top: Math.round(e.scrollTop), max: Math.round(e.scrollHeight - e.clientHeight) } : null; }, sel);
      const swipe = async (page, x, y, dist) => {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - Math.round(dist * i / 12) }] }); await page.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(700);
        await cdp.detach();
      };
      const scrolls = async (page, label, sel, dist = Math.round(h * 0.6), x = Math.round(w / 2), opts = {}) => {
        const a = await state(page, sel);
        await swipe(page, x, Math.round(h * 0.7), dist);
        const b = await state(page, sel);
        const fits = !!(a && a.max === 0 && opts.fitOk);
        const ok = fits || !!(a && b && b.top > a.top);
        console.log('scroll ' + orient + ' ' + label + ': scrollTop ' + (a && a.top) + ' -> ' + (b && b.top) + ' (max ' + (b && b.max) + ')' + (ok ? '' : '  FAILED'));
        if (!ok) problems.push(orient + ' ' + label + ': a touch swipe did not scroll ' + sel);
        return ok;
      };
      // swipes on until the end: the last element's bottom edge is inside the window
      const toEnd = async (page, label, sel, lastSel) => {
        for (let i = 0; i < 8; i++) { const st = await state(page, sel); if (st && st.top >= st.max - 1) break; await swipe(page, Math.round(w / 2), Math.round(h * 0.65), Math.round(h * 0.6)); }
        const r = await page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { bottom: Math.round(b.bottom), vh: innerHeight }; }, lastSel);
        const ok = !!(r && r.bottom <= r.vh + 1);
        console.log('end ' + orient + ' ' + label + ': last row bottom ' + (r && r.bottom) + ' of ' + (r && r.vh) + (ok ? '' : '  FAILED'));
        if (!ok) problems.push(orient + ' ' + label + ': the end is not reached by touch');
      };
      const attempt = async (name, fn) => { try { await fn(); } catch (e) { problems.push(orient + ' ' + name + ' not reached: ' + String(e.message).split('\n')[0]); } };

      let c = await open('/?x=1' + CLOCK);
      await attempt('signin', () => shot(c.page, 'signin'));
      await c.ctx.close();

      c = await open('/?profile=fixture' + CLOCK);
      await attempt('home', async () => {
        await c.page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 10000 });
        await c.page.waitForTimeout(900);
        await shot(c.page, 'home');
        await press(c.page, 'ArrowDown', 3);
        await c.page.waitForTimeout(600);
        await shot(c.page, 'home-scrolled');
      });
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await attempt('movie', async () => {
        await show(c.page, 'details', DUNE);
        await c.page.waitForFunction(() => document.querySelector('.dt-buttons .pill'), null, { timeout: 8000 });
        await c.page.waitForTimeout(700);
        await shot(c.page, 'movie');
      });
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await attempt('episodes', async () => {
        await show(c.page, 'details', SEV);
        await c.page.waitForFunction(() => document.querySelector('.dt-buttons .pill') && document.querySelector('.dt-more'), null, { timeout: 8000 });
        await c.page.waitForTimeout(700);
        await press(c.page, 'ArrowDown');
        await c.page.waitForSelector('.eg.on .eg-row', { timeout: 8000 });
        await shot(c.page, 'episodes');
        await scrolls(c.page, 'episodes', '.dt-screen', Math.round(h * 0.6), Math.round(w / 2), { fitOk: true }); // a tall window shows all nine rows
      });
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await attempt('sources', async () => {
        await show(c.page, 'details', DUNE);
        await c.page.evaluate((p) => window.__alder.router.push('streams', Object.assign({ videoId: p.id, pick: true }, p)), DUNE);
        await c.page.waitForSelector('.st-row', { timeout: 8000 });
        await shot(c.page, 'sources');
      });
      await c.ctx.close();

      // a source list longer than the window: the fixture's Dune streams four times over (the add-on answer is replaced on the way)
      c = await open('/?x=1' + CLOCK, async (ctx) => {
        const base = JSON.parse(readFileSync(join(ROOT, 'dev/fixtures/torrentio.strem.fun/stream/movie/tt15239678.json'), 'utf8'));
        const streams = [];
        for (let k = 0; k < 4; k++) base.streams.forEach((x) => streams.push(Object.assign({}, x, { url: x.url && x.url + '?copy=' + k, behaviorHints: Object.assign({}, x.behaviorHints, { filename: x.behaviorHints && x.behaviorHints.filename && k + '.' + x.behaviorHints.filename }) })));
        await ctx.route('**/torrentio.strem.fun/stream/movie/tt15239678.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streams }) }));
      });
      await attempt('long sources list', async () => {
        await show(c.page, 'details', DUNE);
        await c.page.evaluate((p) => window.__alder.router.push('streams', Object.assign({ videoId: p.id, pick: true }, p)), DUNE);
        await c.page.waitForSelector('.st-row', { timeout: 8000 });
        await c.page.waitForTimeout(500);
        if (orient === 'portrait') await shot(c.page, 'sources', 12);
        await scrolls(c.page, 'sources (' + (await c.page.evaluate(() => document.querySelectorAll('.st-row').length)) + ' rows)', '.st-screen');
        if (orient === 'portrait') await shot(c.page, 'sources-scrolled', 13);
      });
      await c.ctx.close();

      await attempt('player', async () => {
        const pctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
        try {
          // the add-on subtitle list of the clip: the fixture's ten Dune files (the request carries the file's size and name)
          const subs = readFileSync(join(ROOT, 'dev/fixtures/opensubtitles-v3.strem.io/subtitles/movie/tt15239678.json'));
          await pctx.route('**/opensubtitles-v3.strem.io/subtitles/movie/tt15239678/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: subs }));
          await pctx.route('**/media.fixture.test/**', (r) => r.fulfill({ status: 200, contentType: 'video/webm', body: clip }));
          const page = await pctx.newPage();
          page.on('pageerror', (e) => problems.push(orient + ' player page error: ' + e.message));
          page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) problems.push(orient + ' player console error: ' + m.text()); });
          await page.goto(webServer.origin + '/?profile=fixture' + CLOCK, { waitUntil: 'load' });
          await page.waitForFunction(() => window.__alder && window.__alder.router.names().join() === 'home', null, { timeout: 10000 });
          const src = { name: 'Fixture (1080p)', description: '', url: 'https://media.fixture.test/dune.webm', headers: {}, size: 3e9, filename: 'dune.webm', binge: null };
          await page.evaluate((x) => window.__alder.router.push('player', x), { type: 'movie', metaId: DUNE.id, videoId: DUNE.id, name: DUNE.name, sources: [src] });
          await page.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2 && v.currentTime > 0.3; }, null, { timeout: 15000 });
          await page.mouse.move(w / 2, h / 3); // a pointer move brings the controls up (src/platform/mac/player-input.js)
          await page.waitForTimeout(500);
          // no add-on subtitle reaches a clip with no tracks: one line is written into the page's own subtitle layer to show where it sits
          await page.evaluate(() => { const el = document.querySelector('.subs'); if (el) { el.style.display = 'block'; el.innerHTML = '<span class="subs-line"><span>A subtitle line, where the page draws it</span></span>'; } });
          const info = await page.evaluate(() => ({ top: window.__alder.router.names().join(), controls: !!document.querySelector('.pl-controls.on'), subs: !!document.querySelector('.subs') }));
          console.log(orient + ' player state (web variant): ' + JSON.stringify(info));
          await shot(page, 'player');
          if (orient === 'landscape') {
            await page.evaluate(() => { const el = document.querySelector('.subs'); if (el) el.innerHTML = ''; });
            await page.tap('.pl-btn[aria-label="Audio & subtitles"]');
            await page.waitForSelector('.pl-opt-scroll .pl-row', { timeout: 8000 });
            await page.waitForTimeout(800);
            const rows = await page.evaluate(() => document.querySelectorAll('.pl-opt-scroll .pl-row').length);
            const chosen = () => page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-scroll .pl-row.chosen')).map((e) => e.textContent).join('|'));
            const before = await chosen();
            await shot(page, 'subs-panel', 10);
            const ok = await scrolls(page, 'player subtitle panel (' + rows + ' rows)', '.pl-opt-scroll', Math.round(h * 0.5), 150);
            await shot(page, 'subs-panel-scrolled', 11);
            const same = (await chosen()) === before && !!(await page.$('.pl-opt-scroll'));
            console.log('swipe picks nothing ' + orient + ': ' + (same ? 'ok' : 'FAILED') + ' (chosen: ' + before + ')');
            if (!same) problems.push(orient + ' a swipe on the subtitle panel picked a row');
            // a tap picks: the third row of the Subtitles list (visible now) becomes the chosen one
            const target = await page.evaluate(() => { const r = Array.from(document.querySelectorAll('.pl-opt-scroll .pl-row')).find((e) => { const b = e.getBoundingClientRect(); return !e.classList.contains('chosen') && b.top > 60 && b.bottom < innerHeight - 20 && !e.classList.contains('pl-stream'); }); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
            if (target) { await page.touchscreen.tap(target.x, target.y); await page.waitForTimeout(700); }
            const after = await chosen();
            console.log('tap picks ' + orient + ': ' + (target && after !== before ? 'ok' : 'FAILED') + ' (chosen: ' + after + ')');
            if (!(target && after !== before)) problems.push(orient + ' a tap on a subtitle row did not pick it');
            void ok;
          }
        } finally { await pctx.close(); }
      });

      c = await open('/?x=1' + CLOCK);
      await attempt('settings', async () => {
        await show(c.page, 'settings', {});
        await c.page.waitForTimeout(800);
        await shot(c.page, 'settings');
        await toEnd(c.page, 'settings', '.sg-screen', '[data-group="about"]');
        await c.page.evaluate(() => window.__alder.router.push('diagnostics', {}));
        await c.page.waitForTimeout(1200);
        await shot(c.page, 'diagnostics');
        await toEnd(c.page, 'diagnostics', '.screen:last-child', '.dg-line:last-of-type');
      });
      await c.ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
    await webServer.close();
    rmSync(dist, { recursive: true, force: true });
    rmSync(webDist, { recursive: true, force: true });
  }
  console.log(n + ' screenshot(s) in .run/1.9/phone, ' + problems.length + ' problem(s)');
  problems.forEach((p) => console.log('  ' + p));
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
