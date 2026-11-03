/*
 * v0.2 player polish (docs/PLAN-v0.2.md section D) and the exit confirmation.
 *   - icons: every <svg> on screen has a non-zero box, a numeric width and height and a sized .icon wrapper (the 0.1.0 player's
 *     buttons were empty circles on the TV: a bare <svg> in a flex circle collapsed there), on Home, the title page, Search,
 *     Settings, Diagnostics and every player surface; the Diagnostics ICONS block draws all of them three ways;
 *   - focus returns to Play/Pause: when the controls come up (Left/Right while hidden are the quick seek: bar focused, first step at once), after Audio & subtitles and Info close, after a seek;
 *   - OK toggles, OK while hidden brings the controls up on Play/Pause, the Play/Pause media key toggles with the controls down;
 *   - the centre glyph: pause fades in at the centre while paused, play flashes on resume and fades (transform/opacity only);
 *   - Back at the bottom of the stack asks "Exit Alder?" (Stay focused) before leaving.
 * Shots: shots/v02/player-*.png and shots/v02/exit-confirm.png. The mock draws no picture, so the page behind is the dark base.
 */
const HOME = '/?profile=fixture&clock=11:26%20PM';

const names = (page) => page.evaluate(() => window.__alder.router.names().join());
const stream = (name, file, mock) => ({ name, description: '', url: 'https://media.fixture.test/' + file + '?' + Object.keys(mock).map((k) => 'mock.' + k + '=' + encodeURIComponent(mock[k])).join('&'), headers: {}, size: 3e9, filename: file, binge: null });
const SEVERANCE = () => ({
  type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4', name: 'Severance', episode: 'S1 E4  ·  The You You Are', nextVideoId: 'tt11280740:1:5',
  sources: [stream('Torrentio (1080p)', 'Severance.S01E04.1080p.WEB-DL.DDP5.1.H264-GROUP.mkv', { tracks: 'eac3+subs', duration: 3300 })],
});

async function homeReady(page) {
  await page.waitForFunction(() => window.__alder.router.names().join() === 'home' && document.querySelectorAll('.card-img.on').length > 0, null, { timeout: 10000 });
}

/** Opens the player over Home and waits until the film is playing. Controls are down (a film that plays hides them). */
async function play(page) {
  await homeReady(page);
  await page.evaluate((p) => window.__alder.router.push('player', p), SEVERANCE());
  await page.waitForFunction(() => { const s = window.__alder.router.top().screen; return s.engine && s.engine() && s.engine().state.started; }, null, { timeout: 14000 });
  await page.waitForTimeout(300);
}

const engineState = (page) => page.evaluate(() => { const s = window.__alder.router.top().screen.engine().snapshot(); return { playing: s.playing, position: s.position }; });
const controlsUp = (page) => page.evaluate(() => { const c = document.querySelector('.pl-controls'); return !!c && c.style.display !== 'none' && c.classList.contains('on'); });
const focusLabel = (page) => page.evaluate(() => { const f = document.querySelector('.pl-btn.focus'); return f ? f.getAttribute('aria-label') : (document.querySelector('.pl-mainbar.focus') ? 'bar' : null); });
const centre = (page) => page.evaluate(() => { const c = document.querySelector('.pl-centre'); const s = getComputedStyle(c); const r = c.getBoundingClientRect(); return { on: c.classList.contains('on'), fade: c.classList.contains('fade'), opacity: Number(s.opacity), visibility: s.visibility, x: r.left + r.width / 2, y: r.top + r.height / 2, glyph: (c.querySelector('path') || {}).getAttribute ? c.querySelector('path').getAttribute('d') : '', transition: s.transitionProperty }; });

/**
 * Every <svg> that is on screen: a non-zero box, a numeric width and height of its own, and a sized .icon wrapper (the three
 * ways an icon could still end up empty on the TV's Chromium M69). Returns { n, bad: [what is wrong] }.
 */
const audit = (page) => page.evaluate(() => {
  const bad = [];
  let n = 0;
  document.querySelectorAll('svg').forEach((svg) => {
    if (!svg.getClientRects().length) return; // inside something hidden
    n++;
    const r = svg.getBoundingClientRect();
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    const wrap = svg.closest('.icon');
    const wr = wrap ? wrap.getBoundingClientRect() : null;
    const where = (svg.parentNode.className || svg.parentNode.tagName) + ' > svg';
    if (!(r.width > 0 && r.height > 0)) bad.push(where + ': no box (' + r.width + 'x' + r.height + ')');
    if (!(w > 0 && h > 0)) bad.push(where + ': no numeric width and height attributes');
    if (!wrap || !(wr.width > 0 && wr.height > 0)) bad.push(where + ': not inside a sized .icon wrapper');
    else if (Math.abs(wr.width - r.width) > 1 || Math.abs(wr.height - r.height) > 1) bad.push(where + ': box ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' is not its wrapper\'s ' + Math.round(wr.width) + 'x' + Math.round(wr.height));
  });
  return { n, bad };
});

async function auditOk(api, label) {
  const a = await audit(api.page);
  api.expect(a.n > 0 && a.bad.length === 0, label + ': ' + a.n + ' icon(s) drawn, every one with a box, its own size and a sized wrapper' + (a.bad.length ? ' | ' + a.bad.join('; ') : ''));
  return a;
}

export default [
  {
    name: 'v02-player-icons',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await play(page);
      await press('ok'); // pause: the controls come up on Play/Pause
      expect(await controlsUp(page), 'OK while the controls are hidden brings them up');
      expect((await focusLabel(page)) === 'Pause' || (await focusLabel(page)) === 'Play', 'on Play/Pause (' + (await focusLabel(page)) + ')');

      // the icons: five buttons (Next episode is there for an episode), each a sized .icon with an <svg> of the same size in it
      const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-btn')).filter((b) => b.getClientRects().length).map((b) => {
        const icon = b.querySelector('.icon'); const svg = icon && icon.querySelector('svg'); const sr = svg && svg.getBoundingClientRect(); const scale = svg ? sr.width / (parseFloat(svg.getAttribute('width')) || 1) : 1;
        return { label: b.getAttribute('aria-label'), directSvg: !!b.querySelector(':scope > svg'), wrap: icon ? icon.offsetWidth + 'x' + icon.offsetHeight : null, svg: svg ? Math.round(sr.width / scale) + 'x' + Math.round(sr.height / scale) : null, drawn: svg ? Math.round(sr.width) : 0,
          attr: svg ? svg.getAttribute('width') + 'x' + svg.getAttribute('height') + ' ' + svg.getAttribute('xmlns') : null, ns: svg ? svg.namespaceURI : null, fill: svg ? svg.getAttribute('fill') : null, paths: svg ? svg.querySelectorAll('path').length : 0 };
      }));
      expect(buttons.length === 5, 'five buttons are drawn: ' + buttons.map((b) => b.label).join(', '));
      expect(buttons.every((b) => !b.directSvg && b.wrap && b.wrap === b.svg && b.paths > 0), 'each button\'s <svg> is inside an .icon box of its own size, never bare in the circle: ' + JSON.stringify(buttons.map((b) => [b.label, b.wrap, b.svg])));
      expect(buttons.filter((b) => b.label === 'Pause' || b.label === 'Play').every((b) => b.svg === '50x50') && buttons.filter((b) => b.label !== 'Pause' && b.label !== 'Play').every((b) => b.svg === '40x40'), 'Play/Pause icon is 50 px, the others 40 px');
      expect(buttons.every((b) => b.attr === (b.svg + ' http://www.w3.org/2000/svg') && b.ns === 'http://www.w3.org/2000/svg'), 'created with createElementNS: SVG namespace, xmlns and numeric width and height attributes equal to the box');
      expect(buttons.every((b) => /^rgb\(/.test(b.fill)), 'and an explicit fill colour, resolved: ' + buttons.map((b) => b.fill).join(' | '));

      // paused: the pause glyph shows in the centre (Play/Pause now says Play)
      await wait(250);
      expect((await focusLabel(page)) === 'Play', 'the focused button now reads Play');
      await shot('player-01-controls-play-focused');

      // focus on another button: dark ink on the warm-white circle, the others stay light on dark glass; the fill is resolved per state
      await press('left', 2);
      expect((await focusLabel(page)) === 'Audio & subtitles', 'Left twice: Audio & subtitles');
      const ink = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-btn')).filter((b) => b.getClientRects().length).map((b) => ({ label: b.getAttribute('aria-label'), focus: b.classList.contains('focus'), fill: b.querySelector('svg').getAttribute('fill'), color: getComputedStyle(b).color })));
      expect(ink.every((b) => b.fill === b.color), 'every icon\'s fill is the colour its circle has in its state: ' + JSON.stringify(ink.map((b) => [b.label, b.focus, b.fill])));
      const dark = ink.find((b) => b.focus);
      expect(dark && dark.fill === 'rgb(21, 17, 14)', 'the focused one is dark ink (' + (dark && dark.fill) + ')');
      expect(ink.filter((b) => !b.focus && b.label !== 'Play').every((b) => b.fill === 'rgb(243, 238, 230)'), 'the unfocused ones are light');
      await shot('player-02-controls-audio-focused');

      await auditOk(api, 'player controls');
      // the pause <-> play swap keeps the icon sized and painted
      await press('right', 2);
      await press('ok'); // resume
      await press('ok'); // hidden or not: whichever, the controls are up again on Play/Pause
      const swapped = await page.evaluate(() => { const b = document.querySelector('.pl-btn.primary'); const svg = b.querySelector('svg'); const r = svg.getBoundingClientRect(); return { r: Math.round(r.width) > 0 && Math.round(r.height) > 0, wrap: b.querySelector('.icon').offsetWidth, attr: svg.getAttribute('width'), fill: svg.getAttribute('fill'), paths: svg.querySelectorAll('path').length, direct: !!b.querySelector(':scope > svg') }; });
      expect(swapped.r && swapped.wrap === 50 && swapped.attr === '50' && /^rgb\(/.test(swapped.fill) && swapped.paths > 0 && !swapped.direct, 'after Play <-> Pause swaps the icon is still there, 50 px, painted (' + JSON.stringify(swapped) + ')');
    },
  },
  {
    name: 'v02-player-glyph',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await play(page);
      expect(!(await controlsUp(page)), 'a film that is playing has no controls up');
      let c = await centre(page);
      expect(c.opacity === 0, 'and no centre glyph');

      // the Play/Pause media key (Space here) toggles at once and leaves the controls down
      await page.keyboard.press('Space');
      await wait(260);
      expect(!(await engineState(page)).playing, 'the media key paused at once');
      expect(!(await controlsUp(page)), 'with the controls still down');
      c = await centre(page);
      expect(c.on && c.opacity === 1 && c.visibility === 'visible', 'the pause glyph is at the centre, fully in (opacity ' + c.opacity + ')');
      expect(Math.abs(c.x - 960) < 1 && Math.abs(c.y - 540) < 1, 'at the centre of the picture (' + Math.round(c.x) + ',' + Math.round(c.y) + ')');
      const pauseGlyph = c.glyph;
      const disc = await page.evaluate(() => { const e = document.querySelector('.pl-centre'); const s = getComputedStyle(e); return { bg: s.backgroundColor, w: Math.round(e.getBoundingClientRect().width), radius: s.borderTopLeftRadius, size: Math.round(e.querySelector('svg').getBoundingClientRect().width) }; });
      expect(/rgba\(14, 12, 10, 0\.6\d*\)/.test(disc.bg) && disc.w === 176 && disc.size === 96, 'a dark translucent disc (' + disc.bg + ') with a 96 px glyph: ' + JSON.stringify(disc));
      expect(/^opacity, transform$|^opacity,\s*transform$/.test(c.transition) || /opacity/.test(c.transition) && !/(color|width|height|left|top|shadow)/.test(c.transition), 'it animates opacity and transform only (' + c.transition + ')');
      await shot('player-03-centre-paused');

      // pressing it again resumes: the play glyph flashes, then fades out
      await page.keyboard.press('Space');
      await wait(160);
      c = await centre(page);
      expect((await engineState(page)).playing && !(await controlsUp(page)), 'the media key resumed, controls still down');
      expect(c.on && c.glyph !== pauseGlyph && c.opacity > 0.9, 'the play glyph shows on resume (opacity ' + c.opacity + ')');
      await shot('player-04-centre-resuming');
      await wait(1100);
      c = await centre(page);
      expect(!c.on && c.fade && c.opacity === 0, 'and has faded out after ~600 ms (opacity ' + c.opacity + ')');

      // OK while the controls are hidden: pauses and brings them up on Play/Pause (Alder's showControls(playPause))
      await press('ok');
      expect(!(await engineState(page)).playing && (await controlsUp(page)) && (await focusLabel(page)) === 'Play', 'OK while hidden pauses and shows the controls on Play/Pause');
      await press('ok');
      expect((await engineState(page)).playing && (await focusLabel(page)) === 'Pause', 'OK on Play/Pause resumes (focus stays on it)');
    },
  },
  {
    name: 'v02-player-focus-return',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await play(page);
      const onPlay = async () => { const l = await focusLabel(page); return l === 'Pause' || l === 'Play'; };

      // Up and Down bring the controls up on Play/Pause; Left and Right are the quick seek (next block)
      for (const key of ['up', 'down']) {
        await press(key);
        expect((await controlsUp(page)) && (await onPlay()), key + ' while hidden brings the controls up on Play/Pause (' + (await focusLabel(page)) + ')');
        await press('back'); // Back hides them
        expect(!(await controlsUp(page)), 'Back hides the controls');
        await wait(300);
      }

      // the quick seek: Right while hidden shows the controls with the bar focused AND steps 10 s at once; 1.2 s after, Play/Pause
      const t0 = (await engineState(page)).position;
      await page.keyboard.press('ArrowRight');
      await wait(150);
      let t1 = (await engineState(page)).position;
      expect((await controlsUp(page)) && (await focusLabel(page)) === 'bar', 'Right while hidden shows the controls with the bar focused (' + (await focusLabel(page)) + ')');
      expect(t1 - t0 >= 9500 && t1 - t0 < 12000, 'and has stepped 10 s at once (' + Math.round((t1 - t0) / 1000) + ' s)');
      await shot('player-08-quick-seek-bar');
      await page.keyboard.press('ArrowRight');
      await wait(150);
      expect((await engineState(page)).position - t1 >= 9500 && (await focusLabel(page)) === 'bar', 'a second Right keeps seeking on the bar');
      await wait(1500);
      expect(await onPlay(), 'about 1.2 s after the last step focus is back on Play/Pause (' + (await focusLabel(page)) + ')');
      await shot('player-09-quick-seek-settled');
      await press('back');
      await page.keyboard.press('ArrowLeft');
      await wait(150);
      expect((await focusLabel(page)) === 'bar' && (await engineState(page)).position < t1 + 10000, 'Left while hidden is the quick seek back');
      await wait(1500);
      await press('back');
      await wait(300);

      // Audio & subtitles: open from its button, close with Back: focus is on Play/Pause, not on Audio
      await press('down'); // controls up on Play/Pause
      await press('left', 2);
      expect((await focusLabel(page)) === 'Audio & subtitles', 'focus on Audio & subtitles');
      await press('ok');
      await wait(400);
      expect(await page.evaluate(() => !!document.querySelector('.pl-options')), 'the panel is open');
      await press('back');
      await wait(300);
      expect((await controlsUp(page)) && (await onPlay()), 'after closing Audio & subtitles focus is on Play/Pause (' + (await focusLabel(page)) + ')');
      await shot('player-05-after-options');

      // Info: Right to it, OK opens the card (controls down), Back closes it and the controls come back on Play/Pause
      await press('right');
      expect((await focusLabel(page)) === 'Next episode', 'Right: Next episode (this is an episode)');
      await press('right');
      expect((await focusLabel(page)) === 'Info', 'Right: Info');
      await press('ok');
      await wait(300);
      expect(await page.evaluate(() => !!document.querySelector('.pl-info')) && !(await controlsUp(page)), 'Info opens its card and the controls go down');
      await press('back');
      await wait(300);
      expect(!(await page.evaluate(() => !!document.querySelector('.pl-info'))) && (await controlsUp(page)) && (await onPlay()), 'closing the Info card brings the controls back on Play/Pause (' + (await focusLabel(page)) + ')');
      await shot('player-06-after-info');
      // ... and so does its Close button
      await press('right', 2);
      await press('ok');
      await wait(250);
      await press('ok'); // Close
      await wait(300);
      expect((await controlsUp(page)) && (await onPlay()), 'the card\'s Close button does the same');

      // OK on Play/Pause toggles
      const was = (await engineState(page)).playing;
      await press('ok');
      expect((await engineState(page)).playing === !was, 'OK on Play/Pause toggles');
      await press('ok');
      expect((await engineState(page)).playing === was, 'and back');

      // a seek: up to the bar, step with Right; a moment after the last step focus is on Play/Pause again
      await press('up');
      expect((await focusLabel(page)) === 'bar', 'Up: the bar');
      const before = (await engineState(page)).position;
      await press('right', 2, 60);
      expect((await focusLabel(page)) === 'bar', 'stepping on the bar keeps focus there while the keys keep coming');
      expect((await engineState(page)).position > before + 15000, 'two steps of 10 s');
      await wait(1500);
      expect(await onPlay(), 'a moment after the seek, focus is back on Play/Pause (' + (await focusLabel(page)) + ')');

      // fast-forward on the remote with focus elsewhere: the seek brings focus to Play/Pause as well
      await press('right');
      expect((await focusLabel(page)) === 'Next episode', 'focus on Next episode');
      await press('ff');
      expect(await onPlay(), 'fast-forward puts focus on Play/Pause (' + (await focusLabel(page)) + ')');

      // Up next closed with "Watch the credits": the next time the controls come up, focus is on Play/Pause
      await page.evaluate(() => window.__alder.router.top().screen.engine().seekTo(3300000 - 45000));
      await page.waitForSelector('.pl-upnext', { timeout: 20000 });
      await wait(300);
      await press('right'); // Watch the credits
      await press('ok');
      await wait(300);
      expect(!(await page.evaluate(() => !!document.querySelector('.pl-upnext'))), 'Up next is closed');
      await press('down');
      expect((await controlsUp(page)) && (await onPlay()), 'afterwards the controls come up on Play/Pause (' + (await focusLabel(page)) + ')');
    },
  },
  {
    name: 'v02-icons-audit',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await homeReady(page);
      await wait(600);
      await auditOk(api, 'Home');
      await page.evaluate(() => window.__alder.router.reset('details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' }));
      await page.waitForSelector('.btn-round .icon svg', { timeout: 10000 });
      await wait(600);
      await auditOk(api, 'title page');
      await page.evaluate(() => window.__alder.router.reset('search', {}));
      await wait(600);
      await auditOk(api, 'Search');
      await page.evaluate(() => window.__alder.router.reset('settings', {}));
      await wait(600);
      await auditOk(api, 'Settings');
      await page.evaluate(() => window.__alder.router.reset('home', {}));
      await homeReady(page);
      await page.evaluate((p) => window.__alder.router.push('player', p), SEVERANCE());
      await page.waitForFunction(() => { const s = window.__alder.router.top().screen; return s.engine && s.engine() && s.engine().state.started; }, null, { timeout: 14000 });
      await press('ok');
      await auditOk(api, 'player controls');
      await press('left', 2);
      await press('ok');
      await wait(400);
      await auditOk(api, 'Audio & subtitles panel (ticks)');
      await press('back');
      await press('right', 3);
      await press('ok');
      await wait(300);
      await auditOk(api, 'Info card');
      await press('back');
      await page.evaluate(() => window.__alder.router.top().screen.engine().seekTo(3300000 - 45000));
      await page.waitForSelector('.pl-upnext', { timeout: 20000 });
      await wait(400);
      expect(await page.evaluate(() => !!document.querySelector('.pl-upnext .pl-pill .icon svg')), 'Up next\'s Play now pill has its icon');
      await auditOk(api, 'Up next');
    },
  },
  {
    name: 'v02-icons-diagnostics',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, shot, expect, wait } = api;
      await homeReady(page);
      await page.evaluate(() => window.__alder.router.push('diagnostics'));
      await wait(700);
      const heads = await page.evaluate(() => Array.from(document.querySelectorAll('.dg-heading')).map((e) => e.textContent));
      expect(heads[0] === 'APP' && heads[1] === 'ICONS', 'Diagnostics has an ICONS section right under APP (' + heads.slice(0, 3).join(', ') + ')');
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.dg-icons .dg-line')).map((e) => e.textContent));
      expect(rows.length === 3 && rows.every((r) => /36\/36/.test(r)), 'three rows, each counting all 36 icons (18, light on dark and dark on light) drawn: ' + rows.join(' | '));
      const strips = await page.evaluate(() => Array.from(document.querySelectorAll('.dg-strip')).map((s) => ({ cls: s.className, n: s.children.length, bg: getComputedStyle(s).backgroundColor, r: s.getBoundingClientRect().width })));
      expect(strips.length === 6 && strips.every((s) => s.n === 18), 'six strips (light on dark and dark on light, three ways) of 18 icons');
      const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('.dg-strip img')).map((i) => i.complete && i.naturalWidth > 0));
      expect(imgs.length === 36 && imgs.every(Boolean), 'all 36 data: URI images decoded');
      const inView = await page.evaluate(() => { const v = document.querySelector('.dg-viewport').getBoundingClientRect(); const last = Array.from(document.querySelectorAll('.dg-strip')).pop().getBoundingClientRect(); return last.bottom <= v.bottom; });
      expect(inView, 'the whole block is on the first screen: one photo shows it');
      await auditOk(api, 'Diagnostics');
      await shot('player-07-diagnostics-icons');
    },
  },
  {
    name: 'v02-exit-confirm',
    dir: 'v02',
    url: HOME,
    async run(api) {
      const { page, press, shot, expect, wait, focused } = api;
      await homeReady(page);
      await wait(500);
      const exits = () => page.evaluate(() => window.__mockExitRequested || 0);
      const dialog = () => page.evaluate(() => { const p = document.querySelector('.panel'); return p ? { title: (p.querySelector('.bold') || {}).textContent, rows: Array.from(p.querySelectorAll('.row-item')).map((r) => r.textContent.trim()) } : null; });
      expect((await names(page)) === 'home', 'Home is the only screen');
      // Back from Home's rows first goes up to the top bar (Alder), a second one is Back at the bottom of the stack
      const back = async () => { for (let i = 0; i < 3 && !(await dialog()); i++) { await page.keyboard.press('Escape'); await wait(450); } };
      await back();
      let d = await dialog();
      expect(d && d.title === 'Exit Alder?' && d.rows.join() === 'Stay,Exit', 'Back asks "Exit Alder?" with Stay and Exit (' + JSON.stringify(d) + ')');
      expect((await exits()) === 0, 'and has not left the app');
      expect((await focused() || {}).text === 'Stay', 'Stay is focused');
      const fill = await page.evaluate(() => { const r = document.querySelector('.row-item:focus'); return r ? getComputedStyle(r, '::before').opacity + ' ' + getComputedStyle(r).color : null; });
      expect(fill && /^1 rgb\(21, 17, 14\)/.test(fill), 'the filled focus style: solid fill, dark ink (' + fill + ')');
      await shot('exit-confirm');

      await press('ok'); // Stay
      expect(!(await dialog()) && (await exits()) === 0, 'OK on Stay closes it and stays');
      await back();
      expect(!!(await dialog()), 'Back asks again');
      await page.keyboard.press('Escape'); // another Back closes it
      await wait(450);
      expect(!(await dialog()) && (await exits()) === 0 && (await names(page)) === 'home', 'another Back closes it and stays');
      await back();
      await press('down');
      expect((await focused() || {}).text === 'Exit', 'Down: Exit');
      await press('ok');
      expect((await exits()) === 1, 'OK on Exit leaves the app: tizen.application.getCurrentApplication().exit() (' + (await exits()) + ' request)');
    },
  },
];
