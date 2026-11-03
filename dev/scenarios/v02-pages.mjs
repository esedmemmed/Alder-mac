/*
 * v0.2 section E: switching pages (Home / Shows / Movies / My List) from the top bar. Read at 4x CPU slowdown, the TU8000 stand-in:
 *
 *   npm run shots -- --only v02-pages --throttle 4
 *
 * Every number is taken in the page, from the key press to a produced frame (the state is seen in the DOM at the start of frame N;
 * the next frame's callback runs once frame N's style, layout, paint and commit are done: the usual "this is on screen" mark):
 *   row   the new page's first row has cards on screen (its 150 ms fade-in starts there, from 20% opacity)
 *   hero  the hero names the new page's first title
 *   art   the art layer has switched to that title's picture (the 600 ms cross-fade then runs by itself; on a page switch it is
 *         started two frames after the rows, because it is the dearest frame to draw)
 * Cases:
 *   cold      the app was just reloaded: answers are on disk (localStorage) but the page is not built and the warm-up has not run
 *   ok        the same, OK pressed on the name straight after arriving on it (opens without the wait)
 *   revisit   every page has been open and the warm-up is done: the page is kept, only shown again (median of 3 rounds of 6 switches)
 *   sweep     three presses 60 ms apart across the whole bar, first with the pages unbuilt, then built
 *   budget    cards alive in all the pages together, and what Back from a title does to a kept page
 * Assertions on time apply at throttle >= 3 (the budget is for the TV); at 1x the numbers are printed.
 */
const HOME = '/?profile=fixture&clock=11:26%20PM';

const TABS = ['Home', 'Shows', 'Movies', 'My List'];
const say = (m) => console.log('  PERF ' + m);

/** Installs the probe: key press time, then marks for the row, hero and art of an expected page. */
const PROBE = () => {
  if (window.__probe) return;
  const p = window.__probe = { want: null, marks: {}, tasks: [], running: false, keyAt: 0, seenRows: [] };
  window.addEventListener('keydown', (e) => { p.lastKeyAt = performance.now(); if (!p.keyAt) p.keyAt = p.lastKeyAt; }, true);
  try {
    new PerformanceObserver((list) => { list.getEntries().forEach((t) => p.tasks.push([t.startTime, t.duration])); }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* no long task entries */ }
  // every row heading that was ever in the document while probing (a page that was built and shown shows its first row's name)
  new MutationObserver(() => {
    if (!p.running) return;
    document.querySelectorAll('.hm-row .row-heading').forEach((h) => { if (p.seenRows.indexOf(h.textContent) < 0) p.seenRows.push(h.textContent); });
  }).observe(document.body, { childList: true, subtree: true });
  const seen = (sel, fn) => { const els = document.querySelectorAll(sel); for (let i = 0; i < els.length; i++) if (els[i].offsetParent !== null && fn(els[i])) return els[i]; return null; };
  const frame = () => {
    if (!p.running) return;
    const w = p.want;
    if (!p.keyAt) { requestAnimationFrame(frame); return; }
    const now = performance.now();
    const check = (name, ok) => { if (!p.marks[name] && ok) { p.marks[name] = 1; requestAnimationFrame(() => { p.marks[name] = performance.now() - p.keyAt; }); } };
    check('row', !!seen('.hm-row', (r) => { const h = r.querySelector('.row-heading'); return !!(h && w.headings.indexOf(h.textContent) >= 0 && r.querySelector('.card')); })
      || (w.grid && !!seen('.hm-grid-row', (r) => r.querySelector('.card'))));
    const name = document.querySelector('.hm-name');
    check('hero', !!name && name.textContent === w.name && document.querySelector('.hm-hero.on') !== null);
    check('art', !!seen('.art-img.on', (i) => i.getAttribute('src') === w.art));
    if (!(p.marks.row > 1 && p.marks.hero > 1 && p.marks.art > 1) && now - p.keyAt < 8000) requestAnimationFrame(frame); else p.running = false;
  };
  p.start = (want) => { p.want = want; p.marks = {}; p.keyAt = 0; p.tasks = []; p.seenRows = []; p.running = true; requestAnimationFrame(frame); };
};

async function home(api) {
  const { page } = api;
  await page.evaluate(PROBE);
  await page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 15000 });
  await page.waitForTimeout(900);
}

/** What the page on screen shows first: { heading, name, art, grid }. */
async function expectation(api, label) {
  return api.page.evaluate((l) => {
    const heading = Array.from(document.querySelectorAll('.hm-row')).filter((r) => r.offsetParent !== null).map((r) => (r.querySelector('.row-heading') || {}).textContent)[0] || null;
    const name = (document.querySelector('.hm-name') || {}).textContent || null;
    const on = Array.from(document.querySelectorAll('.art-img.on')).map((i) => i.getAttribute('src'));
    const headings = Array.from(document.querySelectorAll('.hm-row .row-heading')).map((x) => x.textContent); // rows answer in any order: any of the page's own rows counts as its first
    return { label: l, heading, headings, name, art: on[on.length - 1] || null, grid: l === 'My List' };
  }, label);
}

const focusedNav = (page) => page.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('nav-item') ? a.textContent.trim() : null; });

/** Puts the remote on the top bar's [label] tab. [settle]: ms to wait there (pages rest-open meanwhile). */
async function restOn(api, label, settle = 1500) {
  const { page, press, wait } = api;
  for (let i = 0; i < 8 && (await focusedNav(page)) === null; i++) await press('up', 1, 30);
  for (let i = 0; i < 8 && (await focusedNav(page)) !== label; i++) {
    const at = await focusedNav(page);
    await press(at && TABS.indexOf(at) > TABS.indexOf(label) ? 'left' : 'right', 1, 30);
  }
  await wait(settle);
}

/** Visits every page once with OK (they are built, their answers kept), noting what each shows first. */
async function tour(api) {
  const { page, press, wait } = api;
  const want = { Home: await expectation(api, 'Home') };
  for (const t of TABS.slice(1)) {
    await restOn(api, t, 700);
    await page.keyboard.press('Enter');
    await wait(1500);
    want[t] = await expectation(api, t);
    await press('up', 6, 30);
  }
  await restOn(api, 'Home', 700);
  return want;
}

/** Presses [keys] (each { key, after } ms apart) with the probe running for [want]; returns the marks and the rows seen. */
async function timed(api, keys, want, settle = 900) {
  const { page, wait } = api;
  await page.evaluate((w) => window.__probe.start(w), want);
  for (const k of keys) {
    await page.keyboard.press(k.key === 'ok' ? 'Enter' : k.key === 'right' ? 'ArrowRight' : 'ArrowLeft');
    if (k.after) await wait(k.after);
  }
  await page.waitForFunction(() => !window.__probe.running, null, { timeout: 12000 });
  const r = await page.evaluate(() => ({ row: window.__probe.marks.row, sinceLast: window.__probe.marks.row - (window.__probe.lastKeyAt - window.__probe.keyAt), hero: window.__probe.marks.hero, art: window.__probe.marks.art,
    seen: window.__probe.seenRows, rowsNow: Array.from(document.querySelectorAll('.hm-row')).map((r) => r.querySelector('.row-heading').textContent + '/' + r.querySelectorAll('.card').length + '/' + (r.offsetParent !== null)).join(';'), tasks: window.__probe.tasks.map((t) => Math.round(t[0] - window.__probe.keyAt) + '/' + Math.round(t[1])).join(' ') }));
  await wait(settle);
  return r;
}

const fmt = (v) => (v > 1 ? Math.round(v) + ' ms' : 'never');
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const p90 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
const cards = (page) => page.evaluate(() => window.__home.cards());
const attachedCards = (page) => page.evaluate(() => document.querySelectorAll('.card').length);

export default [
  {
    name: 'v02-pages-cold',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, expect, wait, throttle, shot } = api;
      await home(api);
      const want = await tour(api);
      say('first rows: ' + TABS.map((t) => t + ' "' + want[t].heading + '" / ' + want[t].name).join('; '));

      // cold: reload, then straight to Shows before the warm-up has built it (the page is built from the answers on disk)
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
      await home(api);
      await restOn(api, 'Home', 0);
      const cold = await timed(api, [{ key: 'right' }], want.Shows);
      say('cold, Home -> Shows, built from answers on disk (key press to row / hero / art): ' + fmt(cold.row) + ' / ' + fmt(cold.hero) + ' / ' + fmt(cold.art) + ', of which 150 ms is the rest before it builds');
      expect(cold.row > 1 && cold.hero > 1, 'cold switch to Shows reaches its first row and hero');
      if (throttle >= 3) expect(cold.row < 450, 'cold: the first row is up within 450 ms of the key press (150 ms rest + build) at ' + throttle + 'x: ' + fmt(cold.row));
      await shot('pages-cold-shows');

      // OK straight after arriving on the name: no rest
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
      await home(api);
      await restOn(api, 'Home', 0);
      const ok = await timed(api, [{ key: 'right', after: 30 }, { key: 'ok' }], want.Shows);
      say('cold, Right then OK on Shows (opens without the rest): ' + fmt(ok.row) + ' / ' + fmt(ok.hero) + ' / ' + fmt(ok.art));
      if (throttle >= 3) expect(ok.row < 350, 'OK opens the page without the rest: ' + fmt(ok.row));
    },
  },
  {
    name: 'v02-pages-revisit',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, expect, wait, throttle, shot } = api;
      await home(api);
      const want = await tour(api);
      await wait(6000); // the warm-up is done and every page has been open once
      const rows = [], heroes = [], arts = [];
      const order = [['Home', 'Shows', 'right'], ['Shows', 'Movies', 'right'], ['Movies', 'My List', 'right'], ['My List', 'Movies', 'left'], ['Movies', 'Shows', 'left'], ['Shows', 'Home', 'left']];
      for (let round = 0; round < 3; round++) {
        for (const [from, to, key] of order) {
          const r = await timed(api, [{ key }], want[to], 1500);
          if (round === 0) say('revisit ' + from + ' -> ' + to + ': row ' + fmt(r.row) + ', hero ' + fmt(r.hero) + ', art ' + fmt(r.art) + (r.row > 1 ? '' : ' [rows now: ' + r.rowsNow + ' wanted ' + want[to].heading + ']') + (r.tasks ? '  long tasks (start/ms after key): ' + r.tasks : ''));
          rows.push(r.row); heroes.push(r.hero); arts.push(r.art);
        }
      }
      say('revisit, ' + rows.length + ' switches: row median ' + median(rows) + ' ms, p90 ' + p90(rows) + ' ms; hero median ' + median(heroes) + ' ms, p90 ' + p90(heroes) + ' ms; art median ' + median(arts) + ' ms, p90 ' + p90(arts) + ' ms');
      expect(rows.concat(heroes, arts).every((v) => v > 1), 'every revisit reaches its first row, hero and art');
      if (throttle >= 3) {
        expect(median(rows) < 150, 'kept page: key press to first row, median ' + median(rows) + ' ms (target < 150 ms at ' + throttle + 'x)');
        expect(median(heroes) < 150, 'and to the hero: median ' + median(heroes) + ' ms');
        expect(p90(rows) < 300, 'p90 of the first row ' + p90(rows) + ' ms (< 300 ms)');
      }
      await shot('pages-revisit');
    },
  },
  {
    name: 'v02-pages-sweep',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, expect, wait, throttle, shot } = api;
      await home(api);
      const want = await tour(api);
      // unbuilt: reload and sweep Home -> Shows -> Movies -> My List 60 ms apart before the warm-up: nothing in between is built
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
      await home(api);
      await restOn(api, 'Home', 0);
      const cold = await timed(api, [{ key: 'right', after: 60 }, { key: 'right', after: 60 }, { key: 'right' }], want['My List']);
      say('sweep across the bar before anything is built: My List first row ' + fmt(cold.row) + ', rows ever drawn on the way: ' + cold.seen.join(' / '));
      expect(cold.row > 1 && cold.hero > 1, 'the sweep ends on My List with its first title');
      const own = want.Shows.headings.concat(want.Movies.headings).filter((x) => want.Home.headings.indexOf(x) < 0);
      expect(own.every((x) => cold.seen.indexOf(x) < 0), 'the pages passed over (Shows, Movies) were not built: ' + cold.seen.join(' / '));
      await shot('pages-sweep');

      // built: the same sweep, back and forth, lands on the page the remote stops on, each flip at least 90 ms after the last
      await wait(6000);
      const back = await timed(api, [{ key: 'left', after: 60 }, { key: 'left', after: 60 }, { key: 'left' }], want.Home);
      say('sweep back across built pages (first key to Home first row / hero): ' + fmt(back.row) + ' / ' + fmt(back.hero) + ', from the last key: ' + fmt(back.sinceLast) + ', long tasks (start/ms after key): ' + (back.tasks || '-'));
      expect(back.row > 1 && back.hero > 1, 'the sweep back ends on Home with its first title');
      if (throttle >= 3) expect(back.sinceLast < 300, 'three presses across built pages: Home is up within 300 ms of the last press: ' + fmt(back.sinceLast));
      const nav = await page.evaluate(() => document.querySelector('.nav-item.on').textContent.trim());
      expect(nav === 'Home', 'the dot marks the page that opened: ' + nav);
    },
  },
  {
    name: 'v02-pages-budget',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, expect, wait, shot } = api;
      await home(api);
      const want = await tour(api);
      await wait(5000);
      const stats = await page.evaluate(() => window.__home.pages());
      say('pages kept: ' + stats.map((s) => s.label + ' ' + (s.ready ? 'built' : 'not built') + ', ' + s.cards + ' cards' + (s.attached ? ' (on screen)' : ' (out of the document)')).join('; '));
      const total = await cards(page);
      say('cards alive in all pages together: ' + total + ', in the document: ' + (await attachedCards(page)));
      expect(stats.filter((s) => s.ready).length === 4, 'all four pages are built and kept');
      expect(total <= 150, 'cards alive in every page together stay within 150: ' + total);
      expect(stats.filter((s) => !s.attached).every((s) => s.cards <= 18), 'a page out of the document keeps only its row in use (<= 18 cards each)');

      // walking along a row of two pages, then back to Home: still within the budget
      for (const t of ['Shows', 'Movies']) {
        await restOn(api, t, 400);
        await press('down', 1, 30);
        await press('down', 2, 20);
        await press('right', 12, 20);
        await press('up', 8, 20);
      }
      await restOn(api, 'Home', 400);
      await press('down', 1, 30);
      const after = await cards(page);
      say('cards alive after walking Shows and Movies: ' + after);
      expect(after <= 150, 'still within 150 after walking rows on several pages: ' + after);

      // a title opened and Back: Home returns where it was, the kept pages untouched
      await restOn(api, 'Shows', 600);
      const heading = await page.evaluate(() => Array.from(document.querySelectorAll('.hm-row .row-heading')).map((h) => h.textContent)[0]);
      await page.evaluate(() => window.__alder.router.push('details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two', videoId: 'tt15239678' }));
      await wait(900);
      await page.evaluate(() => window.__alder.router.pop());
      await wait(1200);
      const row = await page.evaluate(() => Array.from(document.querySelectorAll('.hm-row .row-heading')).map((h) => h.textContent)[0]);
      expect(row === heading && want.Shows.headings.indexOf(heading) >= 0, 'Back from a title returns to the kept page (' + row + ')');
      await shot('pages-after-back');
    },
  },
];
