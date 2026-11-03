/*
 * Phase 3: the player (src/player) on the AVPlay mock, and the Diagnostics screen. Every shot is a state the owner will see
 * on the TV: the controls, the Audio & subtitles panel, a source failing over to the next, Up next, the Skip intro pill.
 * The mock plays no picture, so the page behind shows the dark base; the layout, focus and text are what is checked.
 */
// The fixture profile (dev only: ?profile=fixture) opens Home; the player is then pushed on top of it with its own sources.
const CLOCK = '/?profile=fixture&clock=11:26%20PM';

const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.style.display !== 'none' && e.getBoundingClientRect().width > 0; }, sel);
const names = (page) => page.evaluate(() => window.__alder.router.names().join());

/** Severance S1 E4 with a first source that fails at once, so the failover shows before the picture. */
const demoParams = () => ({
  type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4', name: 'Severance', episode: 'S1 E4  ·  The You You Are', nextVideoId: 'tt11280740:1:5',
  sources: [
    stream('Torrentio (2160p)', 'Severance.S01E04.2160p.WEB-DL.DV.HEVC-GROUP.mkv', { prepare: 'fail:PLAYER_ERROR_NOT_SUPPORTED_FILE', duration: 3300 }),
    stream('Torrentio (1080p)', 'Severance.S01E04.1080p.WEB-DL.DTS.DDP5.1.H264-GROUP.mkv', { tracks: 'mixed+subs', duration: 3300, start: 'slow:2500' }),
  ],
});

/** Home as the fixture profile opens it, then the player over it with the failing first source. */
async function playDemo({ page }) {
  await page.waitForFunction(() => window.__alder.router.names().join() === 'home' && document.querySelectorAll('.card-img.on').length > 0, null, { timeout: 10000 });
  await page.evaluate((p) => { window.__alder.router.push('player', p); }, demoParams());
}

/** The player's own params, for the states the failing-first-source demo does not reach. */
function openPlayer(page, params) {
  return page.evaluate((p) => { window.__alder.router.push('player', p); }, params);
}

const SEVERANCE = { type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4', name: 'Severance', episode: 'S1 E4  ·  The You You Are', nextVideoId: 'tt11280740:1:5' };
const DUNE = { type: 'movie', metaId: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two' };
const stream = (name, file, mock) => ({ name, description: '', url: 'https://media.fixture.test/' + file + '?' + Object.keys(mock).map((k) => 'mock.' + k + '=' + encodeURIComponent(mock[k])).join('&'), headers: {}, size: 3e9, filename: file, binge: null });

export default [
  {
    name: 'phase3-controls',
    dir: 'phase3',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      // The fixture server's placeholder "logo" is just the IMDb id in big type; stand in a real-looking wordmark instead
      await page.route('**/images.metahub.space/logo/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="150" viewBox="0 0 900 150"><text x="0" y="110" font-family="Georgia,serif" font-size="100" letter-spacing="6" fill="#f3eee6">SEVERANCE</text></svg>' }));
      await playDemo(api);
      expect((await names(page)) === 'home,player', 'the player opens on top of Home (' + (await names(page)) + ')');

      // the first source fails at once: the player says so and tries the next, at the same second
      await page.waitForFunction(() => /That source failed/.test((document.querySelector('.pl-status') || {}).textContent || ''), null, { timeout: 5000 });
      expect(/trying the next one/.test(await text(page, '.pl-status')), 'a failover message: "' + (await text(page, '.pl-status')) + '"');
      await shot('01-failover');

      await page.waitForFunction(() => window.__alder.router.top().screen.engine && window.__alder.router.top().screen.engine() && window.__alder.router.top().screen.engine().state.started, null, { timeout: 12000 });
      expect(!(await visible(page, '.pl-loading')), 'the picture is up: the loading overlay is gone');
      expect(!(await visible(page, '.pl-controls.on')), 'playing: the controls are down');

      // OK: pauses and brings the controls up on the play button, as in docs/controls.jpg
      await press('ok');
      expect(await visible(page, '.pl-controls.on'), 'OK brings the controls up');
      expect((await text(page, '.pl-pauseinfo .caps')) === 'Paused', 'paused: the "Paused" block shows');
      expect(/The You You Are|Severance/.test(await text(page, '.pl-pausetitle')), 'the title shows: "' + (await text(page, '.pl-pausetitle')) + '"');
      expect((await page.evaluate(() => document.querySelector('.pl-btn.focus') && document.querySelector('.pl-btn.focus').getAttribute('aria-label'))) === 'Play', 'focus is on Play');
      expect(/^\d+:\d\d$/.test(await text(page, '.pl-elapsed')) && /^−/.test(await text(page, '.pl-length')), 'times: ' + (await text(page, '.pl-elapsed')) + ' and ' + (await text(page, '.pl-length')));
      expect((await text(page, '.pl-clock')) === '11:26 PM', 'the clock shows what ?clock= says');
      await wait(400);
      expect(await page.evaluate(() => { const l = document.querySelector('.pl-logo'); return l && l.style.display !== 'none' && l.naturalWidth > 0; }), 'the title\'s logo shows top left');
      expect(!/^tt\d+/.test(await page.evaluate(() => document.querySelector('.pl-topname').textContent)), 'the name fallback is never an id');
      await shot('02-controls-paused');

      // Up: the bar takes focus; Right scrubs 10 s after the presses settle
      await press('up');
      expect(await page.evaluate(() => document.querySelector('.pl-bar.focus') !== null), 'Up: the bar has focus');
      const before = await page.evaluate(() => window.__alder.router.top().screen.engine().snapshot().position);
      await press('right', 3, 60);
      await wait(900);
      const after = await page.evaluate(() => window.__alder.router.top().screen.engine().snapshot().position);
      expect(after - before >= 28000 && after - before < 36000, 'Right x3 on the bar scrubs 30 s (' + Math.round((after - before) / 1000) + ' s)');
      await shot('03-controls-bar');

      // Back closes the controls, then leaves the player
      await press('back');
      await wait(400);
      expect(!(await visible(page, '.pl-controls.on')), 'Back closes the controls first');
      expect((await names(page)) === 'home,player', 'and the player stays');
      await press('back');
      await wait(300);
      expect((await names(page)) === 'home', 'a second Back leaves the player (' + (await names(page)) + ')');
    },
  },
  {
    name: 'phase3-options',
    dir: 'phase3',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      // Dune: its add-on subtitle files are in the fixtures (the Severance demo has no files behind its subtitle list)
      await openPlayer(page, Object.assign({}, DUNE, { sources: [stream('Torrentio (1080p)', 'Dune.Part.Two.2024.1080p.WEB-DL.DTS.DDP5.1.mkv', { tracks: 'mixed+subs', duration: 9960 })] }));
      await page.waitForFunction(() => window.__alder.router.top().screen.engine && window.__alder.router.top().screen.engine() && window.__alder.router.top().screen.engine().state.started, null, { timeout: 14000 });
      await press('ok'); // pause, controls up on Play
      await press('left', 2); // Play -> Change stream -> Audio & subtitles
      expect((await page.evaluate(() => document.querySelector('.pl-btn.focus').getAttribute('aria-label'))) === 'Audio & subtitles', 'focus moved to Audio & subtitles');
      await shot('04-controls-audio-button');
      await press('ok');
      await wait(400);
      expect(await visible(page, '.pl-options'), 'OK opens the Audio & subtitles panel');
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
      expect(rows.some((r) => /Dolby Digital/.test(r)), 'audio rows are named like Alder: ' + rows.slice(0, 3).join(' | '));
      expect(rows.some((r) => /No sound on this TV/.test(r)), 'a DTS track is greyed with "No sound on this TV"');
      expect(rows.some((r) => /^Off/.test(r)), 'Subtitles start with Off');
      expect(rows.some((r) => /in the file/.test(r)), 'the file\'s own subtitle track is listed');
      expect(rows.some((r) => /OpenSubtitles/.test(r)), 'add-on subtitles are listed');
      expect(rows.some((r) => /^Change stream/.test(r)), 'Change stream is the last row');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.pl-opt-panel')).backdropFilter || getComputedStyle(document.querySelector('.pl-opt-panel')).webkitBackdropFilter || 'none') === 'none', 'the panel has no backdrop-filter');
      await shot('05-options-panel');

      // choose the English add-on subtitle: the timing section appears and the overlay draws cues
      const addon = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).findIndex((r) => /OpenSubtitles/.test(r.textContent)));
      const now = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-panel .pl-row')).findIndex((r) => r.classList.contains('focus')));
      await press('down', addon - now);
      await press('ok');
      await wait(700);
      const withTiming = await page.evaluate(() => Array.from(document.querySelectorAll('.pl-opt-heading')).map((e) => e.textContent));
      expect(withTiming.indexOf('Subtitle timing') >= 0, 'an add-on subtitle adds the Subtitle timing section (' + withTiming.join(', ') + ')');
      await shot('06-options-subtitle-on');

      await press('back');
      await wait(300);
      expect(!(await visible(page, '.pl-options')), 'Back closes the panel');
      expect(await visible(page, '.pl-controls.on'), 'and the controls are back');
      expect(/^(Pause|Play)$/.test(await page.evaluate(() => document.querySelector('.pl-btn.focus').getAttribute('aria-label'))), 'focus returns to Play/Pause (v0.2: it used to return to the Audio & subtitles button)');
    },
  },
  {
    name: 'phase3-up-next',
    dir: 'phase3',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await openPlayer(page, Object.assign({}, SEVERANCE, { resumeAt: 100000, sources: [stream('Torrentio (1080p)', 'Severance.S01E04.1080p.WEB-DL.DDP5.1.mkv', { tracks: 'eac3', duration: 130 })] }));
      await page.waitForSelector('.pl-upnext', { timeout: 20000 });
      expect(/Up next/i.test(await text(page, '.pl-upnext .caps')), 'the Up next card shows near the end');
      expect((await text(page, '.pl-upnext .pl-card-sub')) === 'S1 E5', 'it names the next episode: ' + (await text(page, '.pl-upnext .pl-card-sub')));
      expect((await text(page, '.pl-upnext .pl-pill.focus')) === 'Play now', 'focus is on Play now');
      await wait(300);
      await shot('07-up-next');
      await press('right');
      expect((await text(page, '.pl-upnext .pl-chip.focus')) === 'Watch the credits', 'Right: Watch the credits');
      await press('ok');
      expect(!(await visible(page, '.pl-upnext')), 'Watch the credits dismisses the card');
    },
  },
  {
    name: 'phase3-skip-intro',
    dir: 'phase3',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await openPlayer(page, Object.assign({}, SEVERANCE, { resumeAt: 60000, sources: [stream('Torrentio (1080p)', 'Severance.S01E04.1080p.WEB-DL.DDP5.1.mkv', { tracks: 'eac3', duration: 3300 })] }));
      await page.waitForFunction(() => { const e = document.querySelector('.pl-skip'); return e && e.style.display !== 'none'; }, null, { timeout: 12000 });
      expect(/Skip intro\s+OK/.test(await text(page, '.pl-skip')), 'the pill reads "' + (await text(page, '.pl-skip')) + '"');
      await wait(300);
      await shot('08-skip-intro');
      await press('ok');
      await wait(600);
      const at = await page.evaluate(() => window.__alder.router.top().screen.engine().snapshot().position);
      expect(at >= 128000 && at < 135000, 'OK skips to the end of the intro (' + Math.round(at / 1000) + ' s)');
      expect(!(await visible(page, '.pl-skip')), 'and the pill is gone');
    },
  },
  {
    name: 'phase3-diagnostics',
    dir: 'phase3',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await playDemo(api);
      await page.waitForFunction(() => window.__alder.router.top().screen.engine && window.__alder.router.top().screen.engine() && window.__alder.router.top().screen.engine().state.started, null, { timeout: 14000 });
      await press('back'); // a Back with the controls down leaves the player
      await wait(300);
      expect((await names(page)) === 'home', 'back on Home');
      await page.evaluate(() => window.__alder.router.push('diagnostics')); // 4B's Settings opens it too
      await wait(400);
      expect((await names(page)) === 'home,diagnostics', 'the Diagnostics screen opens (' + (await names(page)) + ')');
      const report = await page.evaluate(() => document.querySelector('.dg-content').textContent);
      expect(/DEVICE/.test(report) && /2160p HDR HEVC/.test(report), 'it shows the device profile');
      expect(/Severance\.S01E04\.1080p/.test(report) && /media\.fixture\.test/.test(report), 'it names the stream host and file');
      expect(!/mock\.tracks|prepare=fail/.test(report.split('LOG')[0]), 'the stream section never shows the URL\'s query');
      expect(/AVPLAY TRACKS/.test(report) && /AUDIO/.test(report) && /fourCC/.test(report), 'it shows the raw track list');
      expect(/audio: /.test(report) && /DTS|AC3/.test(report), 'it shows the audio decision and its reason');
      expect(/LOG \(last/.test(report), 'it shows the log');
      await shot('09-diagnostics');
      await press('down', 6);
      const moved = await page.evaluate(() => document.querySelector('.dg-content').style.transform);
      expect(/translate3d\(0px, -\d+/.test(moved), 'Down scrolls the report (' + moved + ')');
      await shot('10-diagnostics-scrolled');
      await press('back');
      expect((await names(page)) === 'home', 'Back closes Diagnostics');
    },
  },
];
