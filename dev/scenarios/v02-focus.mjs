/*
 * v0.2 focus treatment (docs/PLAN-v0.2.md section A): one solid warm-white fill with dark ink wherever the remote rests, a top-bar
 * highlight that slides, round buttons that grow and name themselves. One screenshot per state in the plan's table, saved as
 * shots/v02/focus-*.png, and every focused element is probed in the page for what the plan promises:
 *   - the fill is a ::before layer (or the nav highlight) at opacity 1, and the transitions on the element and its layers are
 *     transform / opacity only, 120-180 ms;
 *   - every text and icon inside it is >= 7:1 on the fill (secondary text, tags, ticks, switches included).
 * `v02-focus-perf` measures a focus move at 4x CPU throttle against the 50 ms budget.
 */
const HOME = '/?profile=fixture&clock=11:26%20PM';
const CLOCK = '/?clock=11:26%20PM';
const AUTH = 'FIXTURE-AUTH-KEY-0001';
const FILL = '#f2e8d8';

const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const names = (page) => page.evaluate(() => window.__alder.router.names().join());

const wordmark = (t) => '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="150" viewBox="0 0 900 150"><text x="0" y="110" font-family="Georgia,serif" font-size="100" letter-spacing="6" fill="#f3eee6">' + t + '</text></svg>';
async function logos(page) {
  const W = { tt11280740: 'SEVERANCE', tt15239678: 'DUNE: PART TWO' };
  await page.route('**/images.metahub.space/logo/**', (route) => {
    const id = /logo\/\w+\/(tt\d+)/.exec(route.request().url());
    const t = id && W[id[1]];
    return t ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: wordmark(t) }) : route.continue();
  });
}

async function open(page, name, params = {}) {
  await page.evaluate(([n, p, auth]) => {
    const s = window.__alder.context.session;
    if (!s.profiles.all().length) s.profiles.add('Enough', auth);
    s.profiles.setActive(s.profiles.all()[0].id);
    window.__alder.router.reset(n, p);
  }, [name, params, AUTH]);
  await page.waitForTimeout(200);
}

async function homeReady(page) {
  await page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 10000 });
  await page.waitForTimeout(900);
}

/** Puts the remote on [sel] (the engine's own focus, as a key move would) and lets the fade and the grow finish. */
async function focusOn(page, sel, wait = 330) {
  const ok = await page.evaluate((s) => window.__alder.engine.focus(s), sel);
  await page.waitForTimeout(wait);
  return ok;
}

/**
 * What the focused element [sel] looks like to the page, read from computed styles (the checks the plan sets):
 *   fill       opacity of the ::before layer (or 1 when [opts.fill], the nav highlight is the fill)
 *   worst      the lowest contrast of any text or icon inside it, on the fill, and which one
 *   bad        transitions that are not transform / opacity at 100-200 ms
 *   scale      the element's transform scale
 */
function probe(page, sel, opts = {}) {
  return page.evaluate(([s, o, FILL_HEX]) => {
    const el = document.querySelector(s);
    if (!el) return { missing: true };
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });

    const layer = parseFloat(getComputedStyle(el, '::before').opacity);
    const filled = o.fill || layer === 1;
    let base = filled ? hex(FILL_HEX) : (() => { let b = parse(getComputedStyle(el).backgroundColor); return b.a ? over(b, { r: 14, g: 12, b: 10, a: 1 }) : { r: 14, g: 12, b: 10, a: 1 }; })();

    let worst = { ratio: 99, what: '' };
    const nodes = [el].concat(Array.from(el.querySelectorAll('*')));
    nodes.forEach((n) => {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const own = Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.nodeValue.trim());
      const isIcon = n.classList && n.classList.contains('icon');
      if (!own && !isIcon) return;
      let bg = base;
      const chain = [];
      for (let p = n; p && p !== el.parentNode; p = p.parentNode) chain.unshift(p);
      chain.forEach((p) => { const b = parse(getComputedStyle(p).backgroundColor); if (b.a > 0 && !(p === el && filled)) bg = over(b, bg); });
      const fgc = parse(cs.color);
      const fg = over(fgc, bg);
      let op = 1;
      for (let p = n; p && p !== el.parentNode; p = p.parentNode) op *= parseFloat(getComputedStyle(p).opacity);
      const rt = ratio(op < 1 ? over({ r: fg.r, g: fg.g, b: fg.b, a: op }, bg) : fg, bg);
      if (rt < worst.ratio) worst = { ratio: Math.round(rt * 100) / 100, what: (n.className || n.tagName) + ' "' + (n.textContent || '').trim().slice(0, 24) + '"' };
    });

    const bad = [];
    const targets = [[el, null], [el, '::before'], [el, '::after']].concat((o.also || []).map((q) => [document.querySelector(q), null]));
    targets.forEach(([t, ps]) => {
      if (!t) return;
      const cs = getComputedStyle(t, ps);
      const props = cs.transitionProperty.split(',').map((x) => x.trim());
      const durs = cs.transitionDuration.split(',').map((x) => parseFloat(x) * (/ms/.test(x) ? 1 : 1000));
      props.forEach((p, i) => {
        const d = durs[i % durs.length];
        if (d > 0 && ((p !== 'transform' && p !== 'opacity') || d < 100 || d > 200)) bad.push((t.className || t.tagName) + (ps || '') + ' ' + p + ' ' + d + 'ms');
      });
    });
    const tf = getComputedStyle(el).transform;
    const m = /matrix\(([^,]+),/.exec(tf);
    return { layer, filled, worst, bad, scale: m ? Math.round(parseFloat(m[1]) * 1000) / 1000 : 1, label: el.getAttribute('aria-label'), text: el.textContent.trim().slice(0, 30) };
  }, [sel, opts, FILL]);
}

/** One state: focus it, check it, photograph it. */
async function state(api, { name, sel, fill = false, scale = null, minContrast = 7, also = [], focus = true, wait = 330 }) {
  const { page, shot, expect } = api;
  if (focus) expect(await focusOn(page, sel, wait), name + ': the remote can rest on ' + sel);
  const p = await probe(page, sel, { fill, also });
  expect(!p.missing, name + ': ' + sel + ' exists');
  if (p.missing) return p;
  expect(p.filled, name + ': the solid fill is showing (layer opacity ' + p.layer + (fill ? ', highlight' : '') + ')');
  expect(p.worst.ratio >= minContrast, name + ': every text and icon is >= ' + minContrast + ':1 on the fill (lowest ' + p.worst.ratio + ' ' + p.worst.what + ')');
  expect(p.bad.length === 0, name + ': only transform and opacity transition, 100-200 ms' + (p.bad.length ? ' (' + p.bad.join('; ') + ')' : ''));
  if (scale) expect(Math.abs(p.scale - scale) < 0.01, name + ': grown to ' + scale + ' (' + p.scale + ')');
  await shot('focus-' + name);
  return p;
}

export default [
  {
    // top bar: the highlight, tab vs current page, chips, the avatar and the profile menu
    name: 'v02-focus-home',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await homeReady(page);
      await shot('home-idle');

      // ---- the nav highlight ----
      await press('up', 6, 20);
      const f0 = await api.focused();
      expect(f0 && /Home/.test(f0.text), 'Up from the rows reaches the current tab, Home (' + (f0 && f0.text) + ')');
      const hlCount = await page.evaluate(() => document.querySelectorAll('.hm-screen .nav-hl, .topbar .nav-hl').length);
      expect(hlCount === 1, 'one highlight element in the top bar (' + hlCount + ')');
      await state(api, { name: 'nav-tab-current', sel: '.nav-item.on', fill: true, focus: false, also: ['.nav-hl', '.nav-hl .m', '.nav-hl .r'] });

      const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }, sel);
      const hlBox = () => page.evaluate(() => { const l = document.querySelector('.nav-hl .l').getBoundingClientRect(); const r = document.querySelector('.nav-hl .r').getBoundingClientRect(); return { left: l.left, right: r.right, top: l.top, bottom: l.bottom, op: getComputedStyle(document.querySelector('.nav-hl')).opacity }; });
      const near = (a, b) => Math.abs(a - b) <= 1.5;
      let tab = await box('.nav-item:focus'); let hb = await hlBox();
      expect(near(hb.left, tab.left) && near(hb.right, tab.right) && hb.op === '1', 'the highlight covers the focused tab exactly (' + Math.round(hb.left) + '-' + Math.round(hb.right) + ' vs ' + Math.round(tab.left) + '-' + Math.round(tab.right) + ')');
      const style = await page.evaluate(() => { const h = document.querySelector('.nav-hl'); return { left: getComputedStyle(h).left, width: getComputedStyle(h).width, tf: h.style.transform }; });
      expect(style.left === '0px' && style.width === '0px' && /translate3d/.test(style.tf), 'it moves by transform only (left ' + style.left + ', width ' + style.width + ', ' + style.tf + ')');

      // Search is the capsule's icon: focused, with Home still the current page (translucent pill and dot)
      await page.keyboard.press('ArrowLeft');
      await wait(330);
      const f1 = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
      expect(f1 === 'Search', 'Left reaches Search (' + f1 + ')');
      tab = await box('.nav-item:focus'); hb = await hlBox();
      expect(near(hb.left, tab.left) && near(hb.right, tab.right), 'the highlight slid to Search, a narrower tab (' + Math.round(hb.right - hb.left) + ' px wide)');
      const home = await page.evaluate(() => { const e = document.querySelector('.nav-item.on'); const b = getComputedStyle(e, '::before'); return { text: e.textContent, layer: b.opacity, bg: b.backgroundColor, dot: getComputedStyle(e, '::after').content }; });
      expect(home.text === 'Home' && home.layer === '1' && /rgba\(255, 255, 255, 0\.14\)/.test(home.bg) && home.dot !== 'none', 'Home, the current page, keeps a translucent fill and its dot (' + home.bg + ')');
      await state(api, { name: 'nav-vs-current', sel: '.nav-item:focus', fill: true, focus: false });

      // two tabs on, quickly: the highlight is on Movies while the page is still Home (the page opens after 300 ms of rest)
      await page.keyboard.press('ArrowRight'); await wait(40);
      await page.keyboard.press('ArrowRight'); await wait(40);
      await page.keyboard.press('ArrowRight');
      await wait(235);
      expect((await text(page, '.nav-item:focus')) === 'Movies', 'Right x3 from Search: Movies has the remote (' + (await text(page, '.nav-item:focus')) + ')');
      tab = await box('.nav-item:focus'); hb = await hlBox();
      expect(near(hb.left, tab.left) && near(hb.right, tab.right), 'the highlight settled under Movies');
      await state(api, { name: 'nav-tab-moved', sel: '.nav-item:focus', fill: true, focus: false });
      await wait(700); // Movies opens as its page

      // ---- chips: Movies has genre chips; one is selected, another focused ----
      await page.waitForFunction(() => document.querySelectorAll('.hm-chips .chip').length > 1, null, { timeout: 8000 });
      await press('down');
      const f2 = await api.focused();
      expect(f2 && /chip/.test(f2.cls), 'Down from the tabs reaches the genre chips (' + (f2 && f2.cls) + ')');
      const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.nav-hl')).opacity);
      expect(hidden === '0', 'the highlight fades out when the remote leaves the bar (opacity ' + hidden + ')');
      await press('right');
      const sel = await page.evaluate(() => {
        const on = document.querySelector('.hm-chips .chip.on');
        const idle = document.querySelector('.hm-chips .chip:not(.on):not(:focus)');
        return { on: !!on, bg: on && getComputedStyle(on).backgroundColor, dot: !!(on && on.querySelector('.dot')),
          idle: idle ? getComputedStyle(idle).backgroundColor : 'rgba(0, 0, 0, 0)', idleBorder: idle ? getComputedStyle(idle).borderTopColor : '(no idle chip)' };
      });
      expect(sel.on && sel.dot && /rgba\(255, 255, 255, 0\.14\)/.test(sel.bg), 'the selected chip has a translucent fill and its dot (' + sel.bg + ')');
      expect(sel.idle === 'rgba(0, 0, 0, 0)', 'an idle chip is an outline only (background ' + sel.idle + ', border ' + sel.idleBorder + ')');
      await state(api, { name: 'chip', sel: '.hm-chips .chip:focus', focus: false, scale: 1.04 });
      // the focused chip that is also the selected one keeps its dot, recoloured
      await page.keyboard.press('ArrowLeft'); await wait(330);
      await state(api, { name: 'chip-selected', sel: '.hm-chips .chip:focus', focus: false, scale: 1.04 });

      // ---- the avatar: a round icon button with its name under it; the profile menu's rows ----
      await press('up');
      await press('left', 8, 20);
      expect((await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Profile', 'Left reaches the profile avatar');
      await state(api, { name: 'avatar', sel: '.avatar:focus', focus: false, scale: 1.1 });
      const label = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.avatar:focus'), '::after'); return { content: c.content, op: c.opacity }; });
      expect(/Profile/.test(label.content) && label.op === '1', 'its name shows under it (' + label.content + ')');
      await press('ok');
      await wait(300);
      await press('down');
      await state(api, { name: 'menu-row', sel: '.panel .row-item:focus', focus: false });
    },
  },
  {
    // the title page: Play pill and the round buttons with their names; the episode guide
    name: 'v02-focus-title',
    dir: 'v02',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await logos(page);
      await open(page, 'details', { type: 'series', id: 'tt11280740', name: 'Severance' });
      await page.waitForFunction(() => document.querySelector('.dt-logo.on') && document.querySelector('.dt-buttons .pill') && document.querySelector('.dt-more'), null, { timeout: 8000 });
      await wait(700);
      // Play pill: already filled, grows, ring and glow
      await state(api, { name: 'play-pill', sel: '.dt-buttons .pill', scale: 1.06, minContrast: 7 });
      const ring = await page.evaluate(() => { const r = getComputedStyle(document.querySelector('.dt-buttons .pill > .rim')); return { op: r.opacity, bw: r.borderTopWidth, sh: r.boxShadow }; });
      expect(ring.op === '1' && ring.bw === '3px' && ring.sh !== 'none', 'the pill has its ring and glow (' + ring.bw + ', ' + ring.sh.slice(0, 40) + ')');
      // round buttons
      const rounds = await page.evaluate(() => Array.from(document.querySelectorAll('.dt-buttons .btn-round')).map((b) => b.getAttribute('aria-label')));
      expect(rounds.length >= 2, 'round buttons beside Play: ' + rounds.join(', '));
      await press('right');
      const lab = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
      expect(lab === rounds[0], 'Right from Play reaches ' + rounds[0] + ' (' + lab + ')');
      const p = await state(api, { name: 'round-button', sel: '.dt-buttons .btn-round:focus', focus: false, scale: 1.1 });
      const under = await page.evaluate(() => { const b = document.activeElement; const a = getComputedStyle(b, '::after'); return { content: a.content, op: a.opacity, top: a.top, margin: a.marginTop }; });
      expect(under.content === '"' + p.label + '"' && under.op === '1', 'its name shows under it: ' + under.content);
      const idleLabel = await page.evaluate(() => { const other = Array.from(document.querySelectorAll('.dt-buttons .btn-round')).find((b) => b !== document.activeElement); return getComputedStyle(other, '::after').opacity; });
      expect(idleLabel === '0', 'an idle round button shows no name (opacity ' + idleLabel + ')');
      await press('right');
      await state(api, { name: 'round-button-2', sel: '.dt-buttons .btn-round:focus', focus: false, scale: 1.1 });
      // Episodes (the quiet caps link)
      await state(api, { name: 'more-link', sel: '.dt-more' });
      // the episode guide: rows with secondary text and a ✓ status
      await press('down');
      await wait(500);
      await page.waitForSelector('.eg.on .eg-row', { timeout: 5000 });
      await state(api, { name: 'episode-row', sel: '.eg-row:focus', focus: false });
      await focusOn(page, '.eg-seasons .chip');
      await state(api, { name: 'season-chip', sel: '.eg-seasons .chip:focus', focus: false, scale: 1.04 });
      // a watched episode's row (✓ in tungsten becomes the dark accent)
      await focusOn(page, '.eg-row');
      await state(api, { name: 'episode-row-watched', sel: '.eg-row:focus', focus: false });
    },
  },
  {
    // settings: sidebar row, a value row, a switch row; add-ons rows; the sources page
    name: 'v02-focus-lists',
    dir: 'v02',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await logos(page);
      await open(page, 'settings', {});
      await wait(500);
      await state(api, { name: 'settings-group', sel: '.sg-group.on', focus: false });
      // the group list keeps "on" (the page shown) apart from focus: another row focused, the open one keeps its tile
      await press('down');
      await state(api, { name: 'settings-group-moved', sel: '.sg-group:focus', focus: false });
      await press('up');
      await press('right');
      expect(/sg-row/.test((await api.focused()).cls), 'Right enters the rows');
      await state(api, { name: 'settings-row', sel: '.sg-row:focus', focus: false });
      const tag = await page.evaluate(() => { const t = document.querySelector('.sg-row:focus .sg-tag'); return t ? getComputedStyle(t).backgroundColor : 'none'; });
      // a row with "THIS PROFILE" and a ‹ value › (Release type), then a real switch (Share my streaming sources)
      for (let i = 0; i < 6 && !/Release type/.test(await text(page, '.sg-row:focus')); i++) await press('down', 1, 20);
      expect(/THIS PROFILE/.test(await text(page, '.sg-row:focus')), 'a row with the THIS PROFILE tag has the remote: ' + (await text(page, '.sg-row:focus')) + ' (tag background ' + tag + ' on the first row)');
      await state(api, { name: 'settings-row-tag', sel: '.sg-row:focus', focus: false });
      // a switch lives in some other group: find it (the groups are rows on the left)
      const groups = await page.evaluate(() => Array.from(document.querySelectorAll('.sg-group')).map((g) => g.getAttribute('data-group')));
      let found = false;
      for (const g of groups) {
        await focusOn(page, '.sg-group[data-group="' + g + '"]', 150);
        found = await page.evaluate(() => { const sw = document.querySelector('.sg-row .sg-switch'); const row = sw && sw.closest('.sg-row'); if (row) { window.__alder.engine.focus(row); return true; } return false; });
        if (found) break;
      }
      expect(found, 'a switch row exists in Settings');
      await wait(330);
      await state(api, { name: 'settings-switch', sel: '.sg-row:focus', focus: false });
      const sw = await page.evaluate(() => { const t = document.querySelector('.sg-row:focus .sg-track'); const i = t.querySelector('i'); return { track: getComputedStyle(t).backgroundColor, knob: getComputedStyle(i).backgroundColor }; });
      expect(sw.track !== sw.knob, 'the switch track and knob differ on the fill (' + sw.track + ' / ' + sw.knob + ')');

      // add-ons
      await open(page, 'addons', {});
      await page.waitForSelector('.ad-row', { timeout: 8000 });
      await wait(500);
      await state(api, { name: 'addon-row', sel: '.ad-row:focus', focus: false });
      const rule = await page.evaluate(() => getComputedStyle(document.querySelector('.ad-row:focus'), '::after').opacity);
      expect(rule === '0', 'the hairline under a focused add-on row is hidden (opacity ' + rule + ')');

      // sources: BEST MATCH row with its badge and tags, and a dimmed "No sound" row
      const DUNE = { type: 'movie', id: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two', runtime: '2h 46m', poster: 'https://images.metahub.space/poster/medium/tt15239678/img', background: 'https://images.metahub.space/background/medium/tt15239678/img' };
      await open(page, 'details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' });
      await page.evaluate((p) => window.__alder.router.push('streams', p), Object.assign({}, DUNE, { pick: true, message: "3 sources didn't play" }));
      await page.waitForSelector('.st-row', { timeout: 8000 });
      await wait(600);
      await state(api, { name: 'sources-row', sel: '.st-row:focus', focus: false });
      const n = await page.evaluate(() => document.querySelectorAll('.st-row').length);
      await press('down', n - 1, 25);
      await wait(400);
      expect(await page.evaluate(() => /No sound/.test(document.activeElement.textContent)), 'the remote is on a "No sound on this TV" source');
      const dim = await page.evaluate(() => getComputedStyle(document.activeElement).opacity);
      expect(dim === '1', 'a dimmed source is full strength while it has the remote (opacity ' + dim + ')');
      await state(api, { name: 'sources-row-nosound', sel: '.st-row:focus', focus: false });
      // while one row is focused its neighbours are plain: the previous row's fill has faded
      const others = await page.evaluate(() => Array.from(document.querySelectorAll('.st-row')).filter((r) => r !== document.activeElement).every((r) => getComputedStyle(r, '::before').opacity === '0'));
      expect(others, 'only the focused source row is filled');
    },
  },
  {
    // the keyboards and the PIN
    name: 'v02-focus-keys',
    dir: 'v02',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await logos(page);
      await open(page, 'search', {});
      await page.waitForSelector('.sr-card', { timeout: 8000 });
      await wait(500);
      await press('right', 2);
      await state(api, { name: 'key', sel: '.sr-key:focus', focus: false });
      await press('down', 1, 20);
      await state(api, { name: 'key-2', sel: '.sr-key:focus', focus: false });
      // Search's own top bar slides the same highlight
      await focusOn(page, '.nav-item[data-nav="Home"]');
      const hl = await page.evaluate(() => { const h = document.querySelector('.nav-hl'); return h ? getComputedStyle(h).opacity : null; });
      expect(hl === '1', 'the Search page has the sliding highlight too (opacity ' + hl + ', focus on ' + (await text(page, '.nav-item:focus')) + ')');
      await state(api, { name: 'search-nav', sel: '.nav-item:focus', fill: true, focus: false });

      // the PIN: the box the remote is on is solid, with a dark digit
      await open(page, 'home', {});
      await page.evaluate(() => {
        const s = window.__alder.context.session;
        const first = s.profiles.active();
        const p = s.profiles.add('Mira', 'FIXTURE-AUTH-KEY-0002');
        s.profiles.update(p.id, { pin: '2580', color: '#8FA39A' });
        s.profiles.setActive(first.id);
        window.__alder.router.reset('profiles', {});
      });
      await wait(700);
      const tiles = await page.evaluate(() => document.querySelectorAll('.pk-tile').length);
      expect(tiles === 3, 'the picker has two portraits and Add');
      await state(api, { name: 'portrait', sel: '.pk-tile:focus', focus: false, minContrast: 0, fill: false });
      const ringOp = await page.evaluate(() => getComputedStyle(document.querySelector('.pk-tile:focus .pk-circle'), '::after').opacity);
      expect(ringOp === '1', 'the focused portrait has its warm-white ring (opacity ' + ringOp + ')');
      await press('right');
      await press('ok');
      await wait(300);
      expect(/PIN/.test(await text(page, '.pin')), 'a locked profile asks for its PIN');
      await press('up', 2, 20); // the first box shows a turned digit
      await state(api, { name: 'pin-box', sel: '.pin-box.now', focus: false });
      const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.pin-box')).map((b) => getComputedStyle(b, '::before').opacity));
      expect(boxes.filter((o) => o === '1').length === 1, 'exactly one PIN box is solid (' + boxes.join(',') + ')');
    },
  },
  {
    // the player: controls, the options panel, the Up next card
    name: 'v02-focus-player',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      const stream = (name, file, mock) => ({ name, description: '', url: 'https://media.fixture.test/' + file + '?' + Object.keys(mock).map((k) => 'mock.' + k + '=' + encodeURIComponent(mock[k])).join('&'), headers: {}, size: 3e9, filename: file, binge: null });
      await homeReady(page);
      await page.evaluate((p) => window.__alder.router.push('player', p), {
        type: 'movie', metaId: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two',
        sources: [stream('Torrentio (1080p)', 'Dune.Part.Two.2024.1080p.WEB-DL.DTS.DDP5.1.mkv', { tracks: 'mixed+subs', duration: 9960 })],
      });
      await page.waitForFunction(() => window.__alder.router.top().screen.engine && window.__alder.router.top().screen.engine() && window.__alder.router.top().screen.engine().state.started, null, { timeout: 14000 });
      await press('ok'); // pause, controls up on Play
      await state(api, { name: 'player-play', sel: '.pl-btn.focus', focus: false, scale: 1.1 });
      const ring = await page.evaluate(() => { const a = getComputedStyle(document.querySelector('.pl-btn.primary.focus'), '::after'); return { op: a.opacity, bw: a.borderTopWidth }; });
      expect(ring.op === '1' && ring.bw === '3px', 'the Play button, already filled, has its ring (' + ring.bw + ')');
      await press('left', 2);
      expect((await page.evaluate(() => document.querySelector('.pl-btn.focus').getAttribute('aria-label'))) === 'Audio & subtitles', 'focus is on Audio & subtitles');
      await state(api, { name: 'player-button', sel: '.pl-btn.focus', focus: false, scale: 1.1 });
      const name = await page.evaluate(() => { const l = document.querySelector('.pl-btn-label.on'); return l ? { text: l.textContent, op: getComputedStyle(l).opacity } : null; });
      expect(name && name.text === 'Audio & subtitles' && name.op === '1', 'its name shows under it: ' + JSON.stringify(name));
      await press('ok');
      await wait(450);
      await state(api, { name: 'options-row', sel: '.pl-opt-panel .pl-row.focus', focus: false });
      // a ticked row (the choice in use) and a "No sound on this TV" row
      const idx = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).findIndex((r) => /No sound/.test(r.textContent)));
      const at = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).findIndex((r) => r.classList.contains('focus')));
      expect(idx >= 0, 'a "No sound on this TV" row exists');
      await press(idx < at ? 'up' : 'down', Math.abs(idx - at), 20);
      await wait(350);
      const dimOp = await page.evaluate(() => getComputedStyle(document.querySelector('.pl-row.focus')).opacity);
      expect(dimOp === '1', 'a dimmed option is full strength while focused (opacity ' + dimOp + ')');
      await state(api, { name: 'options-row-nosound', sel: '.pl-opt-panel .pl-row.focus', focus: false });
      const last = await page.evaluate(() => document.querySelectorAll('.pl-opt-panel .pl-row').length);
      await press('down', last, 20);
      await wait(350);
      await state(api, { name: 'options-stream-row', sel: '.pl-opt-panel .pl-row.focus', focus: false });
    },
  },
  {
    name: 'v02-focus-upnext',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, expect, wait } = api;
      const stream = (name, file, mock) => ({ name, description: '', url: 'https://media.fixture.test/' + file + '?' + Object.keys(mock).map((k) => 'mock.' + k + '=' + encodeURIComponent(mock[k])).join('&'), headers: {}, size: 3e9, filename: file, binge: null });
      await homeReady(page);
      await page.evaluate((p) => window.__alder.router.push('player', p), {
        type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4', name: 'Severance', episode: 'S1 E4  ·  The You You Are', nextVideoId: 'tt11280740:1:5',
        sources: [stream('Torrentio (1080p)', 'Severance.S01E04.1080p.WEB-DL.DDP5.1.H264-GROUP.mkv', { tracks: 'eac3+subs', duration: 3300 })],
      });
      await page.waitForFunction(() => window.__alder.router.top().screen.engine && window.__alder.router.top().screen.engine() && window.__alder.router.top().screen.engine().state.started, null, { timeout: 14000 });
      await page.evaluate(() => window.__alder.router.top().screen.engine().seekTo(3300000 - 45000));
      await page.waitForSelector('.pl-upnext', { timeout: 20000 });
      await wait(400);
      await state(api, { name: 'upnext-pill', sel: '.pl-upnext .pl-pill.focus', focus: false, minContrast: 7 });
      await press('right');
      await wait(300);
      await state(api, { name: 'upnext-chip', sel: '.pl-upnext .pl-chip.focus', focus: false, scale: 1.04 });
    },
  },
  {
    // PLAN section 2: a D-pad focus move under 50 ms, at 4x CPU slowdown (a TU8000 stand-in)
    name: 'v02-focus-perf',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, expect, wait, press } = api;
      const say = (m) => console.log('  PERF ' + m);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await homeReady(page);

      /** [n] moves in [dirs] (cycled), each followed by a forced style + layout, so the cost of the new focus look is inside the number. */
      const measure = (dirs, n) => page.evaluate(async ([ds, count]) => {
        const e = window.__alder.engine;
        const sync = [];
        const frame = [];
        const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await nextFrame();
        let t = performance.now(); await nextFrame(); const vsync = performance.now() - t; // two empty frames: the floor of "to the next paint"
        for (let i = 0; i < count; i++) {
          const t0 = performance.now();
          e.move(ds[i % ds.length]);
          document.body.offsetWidth; // forces style recalc and layout
          const el = document.activeElement; if (el) getComputedStyle(el, '::before').opacity;
          const t1 = performance.now();
          sync.push(t1 - t0);
          await nextFrame();
          frame.push(performance.now() - t0);
          await new Promise((r) => setTimeout(r, 40));
        }
        const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        return { avg: avg(sync), max: Math.max.apply(null, sync), frame: avg(frame), vsync, n: count };
      }, [dirs, n]);
      const report = (label, r, reference = false) => {
        say(label + ': ' + r.avg.toFixed(2) + ' ms average, ' + r.max.toFixed(2) + ' ms worst per move (style + layout included); move -> next frame ' + r.frame.toFixed(1) + ' ms with two empty frames costing ' + r.vsync.toFixed(1) + ' ms');
        // Cards are not part of this change (they slide the row and mount neighbours, phase 5's perf scenario owns that budget): reported, not judged.
        if (!reference) expect(r.max < 50, label + ': worst focus move ' + r.max.toFixed(2) + ' ms (budget 50 ms, 4x throttle)');
      };

      // the top bar: the highlight slides under each tab
      await press('up', 6, 20);
      report('top bar tabs (highlight slides)', await measure(['left', 'right', 'right', 'right', 'left', 'left', 'right', 'right'], 24));
      // a row of cards (unchanged look) for reference
      await page.evaluate(() => window.__alder.engine.focus('[data-focus-group="hm-continue"] .card'));
      await wait(300);
      report('cards in a row (unchanged look, reference)', await measure(['right', 'left'], 12), true);

      await open(page, 'settings', {});
      await wait(500);
      await page.evaluate(() => window.__alder.engine.focus('.sg-row'));
      await wait(300);
      report('settings rows (filled row)', await measure(['down', 'up'], 12));
      await page.evaluate(() => window.__alder.engine.focus('.sg-group'));
      await wait(200);
      report('settings group list (filled row)', await measure(['down', 'down', 'up', 'up'], 12));

      const DUNE = { type: 'movie', id: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two', runtime: '2h 46m', poster: 'https://images.metahub.space/poster/medium/tt15239678/img', background: 'https://images.metahub.space/background/medium/tt15239678/img' };
      await open(page, 'details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' });
      await page.evaluate((p) => window.__alder.router.push('streams', p), Object.assign({}, DUNE, { pick: true }));
      await page.waitForSelector('.st-row', { timeout: 8000 });
      await wait(600);
      report('sources rows (filled row, badges and tags)', await measure(['down', 'down', 'up', 'up'], 16));

      await open(page, 'search', {});
      await page.waitForSelector('.sr-key', { timeout: 8000 });
      await wait(600);
      report('search keyboard (filled keys)', await measure(['right', 'down', 'left', 'up'], 16));
      expect((await page.evaluate(() => document.querySelectorAll('.card').length)) <= 150, 'card nodes stay under 150');
    },
  },
];
