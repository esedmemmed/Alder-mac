/*
 * Mac layout check (npm run shots:mac). Builds the Mac bundle in dev mode (fixture-server rewrites on) into .run/1.2/, serves it
 * with the fixture server, opens it in Playwright WebKit at 1440x900 and 1440x812 (a MacBook Air with and without the notch bar),
 * saves .run/1.2/shots/<size>-<screen>.png for sign-in, home, library, add-ons, a movie page, a series episode list and a source
 * list, and asserts on each: every visible focusable ([data-focus]) lies inside the viewport and is not covered (elementFromPoint at
 * its centre is itself or a descendant). Exits 1 and prints the offenders when any fails. Navigation follows dev/scenarios/phase4*.mjs.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.run/1.2');
const SIZES = [[1440, 900], [1440, 812]];
const CLOCK = '&clock=12:03%20AM';
const AUTH = 'FIXTURE-AUTH-KEY-0001';
const DUNE = { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' };

/** Visible [data-focus] elements that leave the viewport or sit under something else: [{ what, why }]. */
function inspect() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const hidden = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || e.hasAttribute('hidden')) return true;
    }
    return false;
  };
  const out = [];
  let n = 0;
  document.querySelectorAll('[data-focus]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || hidden(el)) return;
    // a row's far cards are off the window by design (the row scrolls); only elements that reach into the viewport count
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;
    // a list row scrolled out of its clipping panel (overflow hidden/auto) is not visible either
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const cr = e.getBoundingClientRect();
      if (cx < cr.left || cx > cr.right || cy < cr.top || cy > cr.bottom) return;
    }
    n++;
    const what = el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/).join('.') + ' "' + (el.textContent || '').trim().slice(0, 24) + '"';
    const box = Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) { out.push({ what, why: 'outside the ' + vw + 'x' + vh + ' viewport (' + box + ')' }); return; }
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || !(top === el || el.contains(top))) {
      out.push({ what, why: 'covered at its centre by ' + (top ? top.tagName.toLowerCase() + '.' + String(top.className).trim().split(/\s+/).join('.') : 'nothing') + ' (' + box + ')' });
    }
  });
  return { checked: n, offenders: out };
}

async function main() {
  const { webkit } = await import('playwright');
  const { buildMac } = await import('../scripts/build.mjs');
  const { startServer } = await import('./fixture-server.mjs');
  const dist = join(OUT, 'dist-mac-dev');
  const shotDir = join(OUT, 'shots');
  mkdirSync(shotDir, { recursive: true });
  await buildMac({ dev: true, outDir: dist, log: () => {} });
  const server = await startServer({ quiet: true, staticDir: dist });
  const browser = await webkit.launch();
  const failures = [];
  let shots = 0;

  try {
    for (const [w, h] of SIZES) {
      const size = w + 'x' + h;
      const open = async (url) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => failures.push(size + ' page error: ' + e.message));
        await page.goto(server.origin + url, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
        return { ctx, page };
      };
      const press = async (page, key, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(60); } await page.waitForTimeout(300); };
      const screen = async (name, page) => {
        await page.evaluate(() => document.fonts && document.fonts.ready);
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(shotDir, size + '-' + name + '.png') });
        shots++;
        const r = await page.evaluate(inspect);
        const dims = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-h') + ' ' + document.body.style.transform);
        console.log(size + ' ' + name + ': ' + r.checked + ' focusable(s), ' + r.offenders.length + ' offender(s)  [--app-h' + dims + ']');
        r.offenders.forEach((o) => { console.log('  OFFENDER ' + o.what + ': ' + o.why); failures.push(size + ' ' + name + ': ' + o.what + ': ' + o.why); });
      };
      const show = async (page, name, params) => {
        await page.evaluate(([n, p, auth]) => {
          const s = window.__alder.context.session;
          if (!s.profiles.all().length) s.profiles.add('Enough', auth);
          s.profiles.setActive(s.profiles.all()[0].id);
          window.__alder.router.reset(n, p);
        }, [name, params, AUTH]);
        await page.waitForTimeout(300);
      };
      const homeReady = async (page) => {
        await page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 10000 });
        await page.waitForTimeout(900);
      };

      let c = await open('/?x=1' + CLOCK);
      await screen('signin', c.page);
      await c.ctx.close();

      c = await open('/?profile=fixture' + CLOCK);
      await homeReady(c.page);
      await screen('home', c.page);
      // My List: Up to the top bar, Right to the page, OK (phase4a goTo)
      await press(c.page, 'ArrowUp', 6);
      for (let i = 0; i < 6; i++) {
        const t = await c.page.evaluate(() => (document.activeElement.textContent || '').trim());
        if (t === 'My List') break;
        await press(c.page, 'ArrowRight');
      }
      await c.page.waitForTimeout(700);
      await press(c.page, 'Enter');
      await c.page.waitForTimeout(900);
      await screen('library', c.page);
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await show(c.page, 'addons', {});
      await c.page.waitForSelector('.ad-row', { timeout: 8000 });
      await screen('addons', c.page);
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await show(c.page, 'details', DUNE);
      await c.page.waitForFunction(() => document.querySelector('.dt-buttons .pill'), null, { timeout: 8000 });
      await c.page.waitForTimeout(700);
      await screen('movie', c.page);
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await show(c.page, 'details', { type: 'series', id: 'tt11280740', name: 'Severance' });
      await c.page.waitForFunction(() => document.querySelector('.dt-buttons .pill') && document.querySelector('.dt-more'), null, { timeout: 8000 });
      await c.page.waitForTimeout(700);
      await press(c.page, 'ArrowDown');
      await c.page.waitForSelector('.eg.on .eg-row', { timeout: 8000 });
      await screen('episodes', c.page);
      await c.ctx.close();

      c = await open('/?x=1' + CLOCK);
      await show(c.page, 'details', DUNE);
      await c.page.evaluate((p) => window.__alder.router.push('streams', Object.assign({ videoId: p.id, pick: true }, p)), DUNE);
      await c.page.waitForSelector('.st-row', { timeout: 8000 });
      await screen('sources', c.page);
      await c.ctx.close();
    }
    // The pointer (src/platform/mac/pointer.js) at 1440x900: hover a card (one focus), wheel a row sideways (it moves), click into a
    // details page (once), Esc back.
    {
      const check = (ok, what) => { console.log('pointer: ' + (ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push('pointer: ' + what); };
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => failures.push('pointer page error: ' + e.message));
      await page.goto(server.origin + '/?profile=fixture' + CLOCK, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 10000 });
      await page.waitForTimeout(900);
      const cursor = await page.evaluate(() => getComputedStyle(document.body).cursor);
      check(cursor !== 'none', 'the cursor shows (body cursor: ' + cursor + ')');

      // hover: the 2nd card of the first row that has one in view takes focus, and only it
      const hovered = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('[data-focus-group] .card[data-focus]')).filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
        const c = cards[1];
        c.setAttribute('data-probe', '1');
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, group: c.closest('[data-focus-group]').getAttribute('data-focus-group') };
      });
      await page.mouse.move(hovered.x - 30, hovered.y);
      await page.mouse.move(hovered.x, hovered.y, { steps: 4 });
      await page.waitForTimeout(400);
      const h1 = await page.evaluate(() => ({ probe: document.activeElement.hasAttribute('data-probe'), focused: document.querySelectorAll(':focus').length, hl: document.querySelectorAll('.nav-hl.on').length }));
      check(h1.probe && h1.focused === 1, 'hover focuses the card under the pointer, one :focus element (' + JSON.stringify(h1) + ')');
      await page.screenshot({ path: join(shotDir, 'pointer-hover.png') });
      shots++;

      // wheel a row sideways: pick the row with the most cards, hover its first card, wheel right
      const row = await page.evaluate(() => {
        let best = null;
        document.querySelectorAll('[data-focus-group]').forEach((g) => {
          const n = g.querySelectorAll('.card').length;
          const first = g.querySelector('.card[data-focus]');
          if (!first) return;
          const r = first.getBoundingClientRect();
          if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return;
          if (!best || n > best.n) best = { n, name: g.getAttribute('data-focus-group'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        return best;
      });
      await page.mouse.move(row.x - 20, row.y);
      await page.mouse.move(row.x, row.y, { steps: 3 });
      await page.waitForTimeout(300);
      const before = await page.evaluate((n) => { const g = document.querySelector('[data-focus-group="' + n + '"]'); const a = document.activeElement; return { track: g.querySelector('.row-track').style.transform, idx: a.getAttribute('data-index'), group: a.closest('[data-focus-group]') && a.closest('[data-focus-group]').getAttribute('data-focus-group') }; }, row.name);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(90, 0); await page.waitForTimeout(170); }
      await page.waitForTimeout(500);
      const after = await page.evaluate((n) => {
        const g = document.querySelector('[data-focus-group="' + n + '"]'); const a = document.activeElement; const r = a.getBoundingClientRect();
        return { track: g.querySelector('.row-track').style.transform, idx: a.getAttribute('data-index'), inView: r.left >= 0 && r.right <= innerWidth, group: a.closest('[data-focus-group]') && a.closest('[data-focus-group]').getAttribute('data-focus-group') };
      }, row.name);
      check(after.group === row.name && Number(after.idx) > Number(before.idx), 'wheel moves focus along the hovered row ' + row.name + ' (card ' + before.idx + ' -> ' + after.idx + ' of ' + row.n + ')');
      check(after.inView, 'the focused card is still in view after the wheel');
      if (row.n > 8) check(after.track !== before.track, 'the row scrolled (' + before.track + ' -> ' + after.track + ')');
      await page.screenshot({ path: join(shotDir, 'pointer-wheel.png') });
      shots++;

      // click into details: once
      const target = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const depth0 = await page.evaluate(() => window.__alder.router.depth());
      await page.mouse.click(target.x, target.y);
      await page.waitForFunction(() => document.querySelector('.dt-buttons .pill'), null, { timeout: 8000 });
      await page.waitForTimeout(600);
      const depth1 = await page.evaluate(() => window.__alder.router.depth());
      check(depth1 === depth0 + 1, 'a click opens the details page once (router depth ' + depth0 + ' -> ' + depth1 + ')');
      await page.screenshot({ path: join(shotDir, 'pointer-details.png') });
      shots++;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const depth2 = await page.evaluate(() => window.__alder.router.depth());
      check(depth2 === depth0, 'Esc goes back to the row (router depth ' + depth2 + ')');
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(dist, { recursive: true, force: true });
  }
  console.log(shots + ' screenshot(s) in .run/1.2/shots, ' + failures.length + ' failure(s)');
  return failures.length;
}

process.exit((await main().catch((e) => { console.error(e && e.stack || e); return 1; })) ? 1 : 0);
