/*
 * v0.2 picture size: the Picture row in the player's Audio & subtitles panel, the Info card with the source's shape, the
 * Settings row and the Diagnostics lines. The film is a 1920x800 file (2.40:1), so the black bars the owner saw are in it.
 * The dev build offers Fill only with ?fill=1 (the shipped build has it off, docs/DECISIONS.md "Picture size"); one scenario
 * checks that without the flag there is no Picture row and no Settings row. The mock draws no picture, so the shots show
 * the layout and text; what Fit and Fill asked of AVPlay is read from the mock (webapis.avplay.__mock.display).
 */
const FILL = '/?profile=fixture&clock=11:26%20PM&fill=1';
const PLAIN = '/?profile=fixture&clock=11:26%20PM';

const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.style.display !== 'none' && e.getBoundingClientRect().width > 0; }, sel);
const names = (page) => page.evaluate(() => window.__alder.router.names().join());
const display = (page) => page.evaluate(() => { const d = window.webapis.avplay.__mock.display; return { method: d.method, rect: d.rect.slice(), roi: d.roi.slice() }; });
const started = (page) => page.waitForFunction(() => { const s = window.__alder.router.top().screen; return s.engine && s.engine() && s.engine().state.started; }, null, { timeout: 14000 });

const DUNE = { type: 'movie', metaId: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two' };
const stream = (name, file, mock) => ({ name, description: '', url: 'https://media.fixture.test/' + file + '?' + Object.keys(mock).map((k) => 'mock.' + k + '=' + encodeURIComponent(mock[k])).join('&'), headers: {}, size: 3e9, filename: file, binge: null });
const WIDE = () => Object.assign({}, DUNE, { sources: [stream('Torrentio (1080p)', 'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.mkv', { tracks: 'eac3+subs', duration: 9960, res: '1920x800' })] });

async function playWide(page) {
  await page.waitForFunction(() => window.__alder.router.names().join() === 'home' && document.querySelectorAll('.card-img.on').length > 0, null, { timeout: 10000 });
  await page.evaluate((p) => { window.__alder.router.push('player', p); }, WIDE());
  await started(page);
}

export default [
  {
    name: 'v02-picture-player',
    dir: 'v02',
    url: FILL,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await playWide(page);
      let d = await display(page);
      expect(d.method === 'PLAYER_DISPLAY_MODE_LETTER_BOX' && d.roi.join() === '0,0,1,1' && d.rect.join() === '0,0,1920,1080', 'the film starts in Fit: LETTER_BOX, the whole frame, the whole screen (' + JSON.stringify(d) + ')');

      await press('ok'); // pause, controls up on Play
      const before = await page.evaluate(() => window.__alder.router.top().screen.engine().snapshot().position);
      await press('left', 2);
      await press('ok');
      await wait(400);
      expect(await visible(page, '.pl-options'), 'the Audio & subtitles panel opens');
      const headings = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-heading')).map((e) => e.textContent));
      expect(headings.join() === 'Audio,Subtitles,Picture', 'a Picture section follows Subtitles (' + headings.join() + ')');
      // a row is a name span and a tag span with no space between them in textContent: read them apart
      const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).map((r) => Array.from(r.querySelectorAll('.pl-opt-name, .pl-opt-tag')).map((e) => e.textContent.trim()).join(' | ') || r.textContent.trim()));
      const focusIndex = () => page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).findIndex((r) => r.classList.contains('focus')));
      const all = await rows();
      const fit = all.findIndex((r) => /^Fit \|/.test(r));
      const fill = all.findIndex((r) => /^Fill \|/.test(r));
      expect(fit > 0 && fill === fit + 1, 'the rows are Fit and Fill: ' + all.slice(fit, fill + 1).join(' | '));
      expect(/1920×800 · 2\.40:1/.test(await text(page, '.pl-opt-list')) && /black bars are part of the film/.test(await text(page, '.pl-opt-list')), 'the panel says the film is 1920×800 · 2.40:1 and the bars are part of it');
      expect(/cuts 26% of the picture/.test(all[fill]), 'Fill says what it cuts: ' + all[fill]);
      await press('down', fill - (await focusIndex())); // the list scrolls to the focused row: Fill, with Fit still ticked
      await wait(200);
      expect(await page.evaluate(() => { const f = document.querySelector('.pl-opt-panel .pl-row.focus'); const p = document.querySelector('.pl-opt-panel').getBoundingClientRect(); const r = f.getBoundingClientRect(); return /^Fill/.test(f.textContent) && r.bottom <= p.bottom; }), 'Fill is focused and fully inside the panel');
      expect(await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row.chosen')).some((r) => /^Fit/.test(r.textContent))), 'Fit has the tick');
      await shot('picture-01-options-fit');
      await press('ok');
      await wait(300);
      d = await display(page);
      expect(d.method === 'PLAYER_DISPLAY_MODE_LETTER_BOX' && d.roi[1] === 0 && d.roi[3] === 1 && Math.abs(d.roi[2] - (16 / 9) / 2.4) < 1e-3 && Math.abs(d.roi[0] - (1 - d.roi[2]) / 2) < 1e-3, 'OK on Fill crops the middle of the frame at once, still LETTER_BOX (' + JSON.stringify(d) + ')');
      expect(await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row.chosen')).some((r) => /^Fill/.test(r.textContent))), 'Fill has the tick');
      expect(await page.evaluate(() => { const f = document.querySelector('.pl-opt-panel .pl-row.focus'); const p = document.querySelector('.pl-opt-panel').getBoundingClientRect(); const r = f.getBoundingClientRect(); return /^Fill/.test(f.textContent) && r.bottom <= p.bottom && r.top >= p.top; }), 'and the list stays scrolled to it after the pick');
      expect(await page.evaluate(() => window.__alder.router.top().screen.engine().snapshot().position) - before < 2000, 'the film did not restart or jump');
      await shot('picture-02-options-fill');

      // Back to the controls, then Info: the shape of the picture, in words
      await press('back');
      await wait(300);
      await press('right', 3);
      expect((await page.evaluate(() => document.querySelector('.pl-btn.focus').getAttribute('aria-label'))) === 'Info', 'focus is on Info');
      await press('ok');
      await wait(300);
      expect(await visible(page, '.pl-info'), 'OK on Info opens the Info card, not the title page (' + (await names(page)) + ')');
      const info = await text(page, '.pl-info');
      expect(/Picture · 1920×800 · 2\.40:1/.test(info), 'the card shows the shape: ' + info);
      expect(/black bars above and below are part of the film/.test(info), 'and says in words that the bars are in the film');
      expect(/Fill · zoomed in, 26% of the picture is cut off/.test(info), 'and what Fill is doing now');
      await shot('picture-03-info');
      await press('right');
      expect((await text(page, '.pl-info .pl-chip.focus')) === 'Title page', 'Right: Title page');
      await press('back');
      expect(!(await visible(page, '.pl-info')), 'Back closes the card');
      expect((await names(page)) === 'home,player', 'and the player stays');
      // the choice is kept as the profile default, so the next film starts in Fill
      expect((await page.evaluate(() => window.__alder.context.session.settings.pictureSize())) === 'fill', 'Fill is remembered for this profile');
    },
  },
  {
    name: 'v02-picture-fit-only',
    dir: 'v02',
    url: PLAIN,
    async run(api) {
      const { page, press, expect, wait } = api;
      await playWide(page);
      await press('ok');
      await press('left', 2);
      await press('ok');
      await wait(400);
      const headings = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-heading')).map((e) => e.textContent));
      expect(headings.indexOf('Picture') < 0, 'the shipped build offers no Picture row: Fill is not offered (' + headings.join() + ')');
      expect((await display(page)).roi.join() === '0,0,1,1', 'and the picture stays Fit');
      await press('back');
      await wait(300);
      await press('right', 3);
      await press('ok');
      await wait(300);
      expect(/1920×800 · 2\.40:1/.test(await text(page, '.pl-info')) && /black bars above and below are part of the film/.test(await text(page, '.pl-info')), 'Info still says the film\'s shape and that the bars are in it: ' + (await text(page, '.pl-info')));
      expect(/Fit · the whole picture, black bars where the shapes differ/.test(await text(page, '.pl-info')), 'and that Fit shows the whole picture');
    },
  },
  {
    name: 'v02-picture-settings',
    dir: 'v02',
    url: FILL,
    async run(api) {
      const { page, press, shot, expect, wait, focused } = api;
      await page.evaluate(() => { window.__alder.router.reset('settings', {}); });
      await wait(500);
      await press('down'); // Picture & Sound
      await wait(200);
      const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('.sg-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim().replace(/\s*›$/, '')));
      const list = await rows();
      expect(list.some((r) => /^Picture size\s*THIS PROFILE\s*Fit$/.test(r)), 'Picture & Sound has a per-profile Picture size row: ' + list.join(' | '));
      await press('right');
      for (let i = 0; i < 8 && !/^Picture size/.test(((await focused()) || {}).text || ''); i++) await press('down');
      expect(/^Picture size/.test(((await focused()) || {}).text || ''), 'focus on Picture size');
      expect(/Fit shows the whole picture/.test(await text(page, '.sg-hint')), 'the help line explains the two: ' + (await text(page, '.sg-hint')));
      await shot('picture-04-settings-row');
      await press('right');
      expect((await page.evaluate(() => window.__alder.context.session.settings.pictureSize())) === 'fill', 'Right steps it to Fill');
      expect(/Fill/.test((await rows()).find((r) => /^Picture size/.test(r))), 'the row reads Fill');
      await shot('picture-05-settings-fill');
      await press('right');
      expect((await page.evaluate(() => window.__alder.context.session.settings.pictureSize())) === 'fit', 'and back to Fit');
    },
  },
  {
    name: 'v02-picture-settings-fit-only',
    dir: 'v02',
    url: PLAIN,
    async run(api) {
      const { page, expect, wait, press } = api;
      await page.evaluate(() => { window.__alder.router.reset('settings', {}); });
      await wait(500);
      await press('down');
      await wait(200);
      const list = await page.evaluate(() => Array.from(document.querySelectorAll('.sg-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
      expect(!list.some((r) => /Picture size/.test(r)) && list.some((r) => /HDR and Dolby Vision/.test(r)), 'without Fill there is no Picture size row (a choice of one is not a choice): ' + list.join(' | '));
    },
  },
  {
    name: 'v02-picture-diagnostics',
    dir: 'v02',
    url: FILL,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await playWide(page);
      await press('back'); // leaves the player: Diagnostics keeps the last stream
      await wait(300);
      await page.evaluate(() => window.__alder.router.push('diagnostics'));
      await wait(400);
      const report = await page.evaluate(() => document.querySelector('.dg-content').textContent);
      const section = report.slice(report.indexOf('PICTURE'), report.indexOf('AVPLAY TRACKS'));
      expect(/1920×800 · 2\.40:1/.test(section), 'Diagnostics has a PICTURE section with the source shape: ' + section);
      expect(/black bars above and below are part of the film/.test(section), 'and says the bars are in the film');
      expect(/asked\s*Fit/.test(section) && /showing\s*Fit via LETTER_BOX/.test(section), 'and what was asked and what is showing');
      expect(/picture: source 1920×800 · 2\.40:1/.test(report) && /picture: Fit \(PLAYER_DISPLAY_MODE_LETTER_BOX\)/.test(report), 'the decisions list says it too');
      await shot('picture-06-diagnostics');
    },
  },
];
