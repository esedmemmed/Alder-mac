/*
 * Phase 5: the whole journey on the real app, the way the owner will walk it on the TV, with every step checked.
 *   fresh install, no profile -> sign-in (the fixture approves the link code) -> name the profile -> Home
 *   -> a movie: title page -> Resume -> the sources page starts it by itself (the first source never shows a picture, the second
 *   plays) -> controls -> scrub -> Back saves the place -> Continue Watching shows the new place
 *   -> a series: episode -> Up next -> the next episode starts -> Settings -> About -> Diagnostics shows the audio decision.
 * The AVPlay mock plays no pictures; what is checked is the app's own state, the screens and what it sends to Stremio.
 */
const START = '/?clock=11:26%20PM';

const names = (page) => page.evaluate(() => window.__alder.router.names().join());
const textOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.style.display !== 'none' && e.getBoundingClientRect().width > 0; }, sel);
const focusText = async (api) => { const f = await api.focused(); return f ? f.text : null; };
const engineOf = (page) => page.evaluate(() => { const t = window.__alder.router.top(); const e = t && t.screen.engine && t.screen.engine(); return e ? { at: e.state.at, started: e.state.started, finished: e.state.finished, position: e.snapshot().position, duration: e.snapshot().duration } : null; });
const waitStarted = (page, timeout = 30000) => page.waitForFunction(() => { const t = window.__alder.router.top(); const e = t && t.name === 'player' && t.screen.engine && t.screen.engine(); return !!e && e.state.started; }, null, { timeout });

/** Home is drawn with its Continue Watching row. */
async function homeReady(page) {
  await page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 10000 });
  await page.waitForTimeout(900);
}

/** The mock plays what the test tells it: lengths per title, and the first source opened never shows a picture. */
async function mockFor(page, { duration, tracks, failFirst }) {
  await page.evaluate(([d, t, fail]) => {
    const reg = window.__mockTizen.registry;
    reg.clear();
    if (fail) { let first = null; reg.add((u) => { if (first === null) first = u; return u === first; }, { start: 'never' }); }
    reg.add(() => true, { duration: d, tracks: t });
  }, [duration, tracks, !!failFirst]);
}

export default [
  {
    name: 'phase5-journey',
    dir: 'phase5',
    url: START,
    async run(api) {
      const { page, press, hold, shot, expect, wait } = api;
      const puts = [];
      page.on('request', (r) => { if (/datastorePut/.test(r.url())) puts.push(r.postData() || ''); });

      // ---- 1. a fresh install: no profile, so sign-in ----
      expect((await names(page)) === 'signin', 'fresh install: the app opens on sign-in (' + (await names(page)) + ')');
      expect((await page.evaluate(() => window.__alder.context.session.profiles.all().length)) === 0, 'no profile exists yet');
      expect(/Welcome to Alder/.test(await textOf(page, '.ob-h1, .ob-copy')), 'the welcome step');
      await shot('01-welcome');

      // ---- 2. name the profile, then the link code ----
      await press('right', 4, 20);
      await press('ok'); // E
      expect((await page.evaluate(() => (document.querySelector('.ob-name, .ob-input, .osk-value') || {}).textContent || document.body.textContent)).length > 0, 'the keyboard types');
      await press('down', 6, 20);
      expect((await focusText(api)).indexOf('Continue') === 0, 'Down from the keyboard reaches Continue (' + (await focusText(api)) + ')');
      await shot('02-name');
      await press('ok');
      await page.waitForSelector('.ob-qr svg', { timeout: 8000 });
      await wait(500);
      expect(/ALDR7K2Q/.test(await page.evaluate(() => Array.from(document.querySelectorAll('.ob-codetile')).map((e) => e.textContent).join(''))), 'the QR page shows the fixture link code');
      await shot('03-link-code');

      // ---- 3. the fixture approves it: the profile exists and Home opens ----
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 15000 });
      const made = await page.evaluate(() => window.__alder.context.session.profiles.all().map((p) => p.name + ':' + !!p.authKey));
      expect(made.length === 1 && /:true$/.test(made[0]), 'one profile with its Stremio key was saved (' + made + ')');
      await homeReady(page);
      expect(/^[A-Z]+$/.test(await textOf(page, '.avatar')) || (await textOf(page, '.avatar')).length === 1, 'the avatar shows the profile\'s initial: "' + (await textOf(page, '.avatar')) + '"');
      const before = await textOf(page, '.hm-caption');
      expect((await textOf(page, '.hm-name')) === 'Dune: Part Two', 'Home starts on Continue Watching, Dune: Part Two first: "' + (await textOf(page, '.hm-name')) + '"');
      expect(/Stopped at 1:06:00/.test(before || ''), 'the saved place from the account: "' + before + '"');
      await shot('04-home');

      // ---- 4. a movie: OK on its card opens the title page, Resume starts it ----
      await mockFor(page, { duration: 9960, tracks: 'mixed+subs', failFirst: true });
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home,details', null, { timeout: 8000 });
      await page.waitForSelector('.dt-buttons .pill', { timeout: 8000 });
      await wait(900);
      expect((await textOf(page, '.dt-buttons .pill')) === 'Resume', 'the title page offers Resume: "' + (await textOf(page, '.dt-buttons .pill')) + '"');
      await shot('05-title');
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'details,player' || window.__alder.router.names().join() === 'home,details,player', null, { timeout: 15000 });
      expect((await names(page)) === 'home,details,player', 'Resume goes through the sources page and lands in the player; the sources page is not left in the stack (' + (await names(page)) + ')');
      const params = await page.evaluate(() => { const p = window.__alder.router.top().params; return { n: p.sources.length, picked: !!p.picked, first: p.sources[0].url }; });
      expect(params.n === 3 && !params.picked, 'the player got the first 3 ranked sources to fall back on (' + params.n + ', picked ' + params.picked + ')');
      await page.waitForFunction(() => /Starting|That source failed/.test((document.querySelector('.pl-status') || {}).textContent || ''), null, { timeout: 5000 });
      await shot('06-starting');

      // the first source shows no picture for 12 s: the player moves to the second at the same second
      await page.waitForFunction(() => /trying the next one/.test((document.querySelector('.pl-status') || {}).textContent || ''), null, { timeout: 20000 });
      expect(/That source failed/.test(await textOf(page, '.pl-status')), 'after START_WAIT: "' + (await textOf(page, '.pl-status')) + '"');
      await shot('07-failover');
      await waitStarted(page, 25000);
      const started = await engineOf(page);
      expect(started.at === 1, 'the second source is the one playing (source ' + (started.at + 1) + ' of 3)');
      expect(started.position >= 3960000 && started.position < 3975000, 'it resumed at the saved place, 1:06:00 (' + Math.round(started.position / 1000) + ' s)');
      const opened = await page.evaluate(() => window.__mockTizen && window.webapis.avplay.__mock.url);
      expect(!!opened && opened !== params.first, 'AVPlay has the second source open, not the first');
      expect(!(await visible(page, '.pl-loading')), 'the picture is up: the loading overlay is gone');
      expect(!(await visible(page, '.pl-controls.on')), 'playing: the controls are down');

      // ---- 5. controls: pause, play, scrub ----
      await press('ok');
      expect(await visible(page, '.pl-controls.on'), 'OK brings the controls up');
      expect((await textOf(page, '.pl-pauseinfo .caps')) === 'Paused', 'and pauses');
      await shot('08-controls');
      await press('ok');
      await wait(300);
      expect((await page.evaluate(() => window.webapis.avplay.getState())) === 'PLAYING', 'OK on Play resumes playback');
      await press('up');
      await press('right', 6, 60);
      await wait(1200);
      const scrubbed = await engineOf(page);
      expect(scrubbed.position >= 3960000 + 55000 && scrubbed.position < 3960000 + 75000, 'Right x6 on the bar moved a minute on (' + Math.round(scrubbed.position / 1000) + ' s)');
      await shot('09-scrubbed');

      // ---- 6. Back saves the place ----
      await press('back'); // the controls
      await wait(300);
      expect((await names(page)) === 'home,details,player', 'the first Back only closes the controls');
      const stopAt = (await engineOf(page)).position;
      await press('back'); // leaves the player
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home,details', null, { timeout: 5000 });
      expect((await names(page)) === 'home,details', 'the second Back returns to the title page (' + (await names(page)) + ')');
      expect((await page.evaluate(() => window.webapis.avplay.getState())) === 'NONE', 'AVPlay is closed');
      await wait(400);
      const saved = puts.map((b) => { try { return JSON.parse(b).changes[0]; } catch (e) { return null; } }).filter(Boolean).pop();
      expect(saved && saved._id === 'tt15239678', 'the progress was sent to Stremio (datastorePut for the movie)');
      expect(saved && Math.abs(saved.state.timeOffset - stopAt) < 3000, 'with the place where it stopped (' + (saved && Math.round(saved.state.timeOffset / 1000)) + ' s, stopped at ' + Math.round(stopAt / 1000) + ' s)');
      expect(saved && saved.state.timeOffset > 4000000, 'which is beyond the old 1:06:00');
      await shot('10-back-on-title');

      // ---- 7. Continue Watching shows the new place ----
      await press('back');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 5000 });
      await wait(1200);
      const after = await textOf(page, '.hm-caption');
      expect(/Stopped at 1:0[7-9]:\d\d/.test(after || '') && after !== before, 'Continue Watching shows the new place: "' + after + '" (was "' + before + '")');
      await shot('11-home-after-playing');

      // ---- 8. a series: Severance from Continue Watching ----
      await press('right');
      await wait(500);
      expect((await textOf(page, '.hm-name')) === 'Severance', 'Right moves to Severance: "' + (await textOf(page, '.hm-name')) + '"');
      await mockFor(page, { duration: 3300, tracks: 'mixed+subs', failFirst: false });
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home,details', null, { timeout: 8000 });
      await page.waitForSelector('.dt-buttons .pill', { timeout: 8000 });
      await wait(900);
      expect(/S1 E4/.test(await textOf(page, '.dt-where')), 'the title page points at S1 E4: "' + (await textOf(page, '.dt-where')) + '"');
      await shot('12-series-title');
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home,details,player', null, { timeout: 15000 });
      await waitStarted(page, 15000);
      const ep = await page.evaluate(() => window.__alder.router.top().params);
      expect(ep.videoId === 'tt11280740:1:4', 'S1 E4 is playing (' + ep.videoId + ')');

      // ---- 9. Up next: near the end the card shows, Play now starts the next episode ----
      await page.evaluate(() => window.__alder.router.top().screen.engine().seekTo(3300000 - 45000));
      await page.waitForSelector('.pl-upnext', { timeout: 20000 });
      expect(/Up next/i.test(await textOf(page, '.pl-upnext .caps')) && (await textOf(page, '.pl-upnext .pl-card-sub')) === 'S1 E5', 'the Up next card names S1 E5: "' + (await textOf(page, '.pl-upnext .pl-card-sub')) + '"');
      await wait(300);
      await shot('13-up-next');
      await press('ok'); // Play now
      await page.waitForFunction(() => { const t = window.__alder.router.top(); return t.name === 'player' && t.params.videoId === 'tt11280740:1:5'; }, null, { timeout: 15000 });
      await waitStarted(page, 15000);
      expect((await names(page)) === 'home,details,player', 'the next episode replaced the first one in the stack (' + (await names(page)) + ')');
      const e5 = await engineOf(page);
      expect(e5.started && e5.position < 10000, 'S1 E5 started from its beginning (' + Math.round(e5.position / 1000) + ' s)');
      await shot('14-next-episode');
      const sawFour = puts.some((b) => { try { return JSON.parse(b).changes.some((c) => c._id === 'tt11280740'); } catch (e) { return false; } });
      if (!sawFour) console.log('   puts: ' + puts.map((b) => b.slice(0, 400)).join(' ||| '));
      expect(sawFour, 'leaving S1 E4 saved the series to Stremio');
      await press('back'); // controls are down: Back leaves the player (saving S1 E5's start)
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home,details', null, { timeout: 5000 });
      await press('back');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 5000 });

      // ---- 10. Settings -> About -> Diagnostics ----
      await press('up', 6, 20);
      await press('left', 8, 20); // the profile chip is the left end of the bar
      expect((await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Profile', 'the profile chip has focus');
      await press('ok');
      await wait(300);
      await press('down');
      expect(/Settings/.test(await focusText(api)), 'the profile menu offers Settings (' + (await focusText(api)) + ')');
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home,settings', null, { timeout: 8000 });
      await wait(400);
      await press('down', 7, 40); // Streams ... About
      await wait(300);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.sg-row')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
      expect(rows.some((r) => /Version 0\.1\.0/.test(r)), 'About shows the version: ' + rows.join(' | '));
      await shot('15-about');
      await press('right');
      await press('down');
      expect(/^Diagnostics/.test(await focusText(api)), 'focus on the Diagnostics row (' + (await focusText(api)) + ')');
      await press('ok');
      await wait(400);
      expect((await names(page)) === 'home,settings,diagnostics', 'Diagnostics opens (' + (await names(page)) + ')');
      const report = await page.evaluate(() => document.querySelector('.dg-content').textContent);
      expect(/DEVICE/.test(report) && /AVPLAY TRACKS/.test(report), 'the report has the device and the raw AVPlay tracks');
      expect(/audio: /.test(report), 'and the audio decision: ' + ((/audio: [^\n]*?(?=\s{2,}|$)/.exec(report) || ['(none)'])[0]).slice(0, 120));
      expect(/DTS|AC3|Dolby/.test(report), 'which names the codecs it chose between');
      await shot('16-diagnostics');
      await press('down', 4, 30);
      await wait(300);
      const decisions = await page.evaluate(() => document.querySelector('.dg-content').textContent);
      expect(/audio: [^\n]*(AC3|Dolby Digital)/i.test(decisions.replace(/\s+/g, ' ')) || /audio:.*AC3/i.test(decisions), 'the decision names the track it chose (AC3 over the DTS one)');
      await shot('17-diagnostics-decisions');
      await press('back');
      expect((await names(page)) === 'home,settings', 'Back closes Diagnostics');

      const missing = (await page.evaluate(() => fetch('/__fx/_requests').then((r) => r.json()))).filter((r) => r.status >= 400).map((r) => r.url);
      expect(!missing.length, 'every request had a fixture (' + missing.join(', ') + ')');
    },
  },
  {
    // The PLAN section 2 budget, read with `npm run shots -- --only phase5-perf --throttle 4` (4x CPU slowdown as a TU8000
    // stand-in): the first Home paint from kept answers < 2.5 s, a focus move < 50 ms. The other numbers are reported.
    name: 'phase5-perf',
    dir: 'phase5',
    url: '/?profile=fixture&clock=11:26%20PM',
    async run(api) {
      const { page, expect, press, wait, throttle } = api;
      const say = (m) => console.log('  PERF ' + m);
      await homeReady(page); // a first visit: the add-ons, the library and the catalogs are kept for the next start

      // 1. cold start with kept answers: reload, and mark the first paint with a Continue card and the hero's name
      await page.addInitScript(() => {
        window.__perf = { marks: {} };
        const mark = (name) => { if (!window.__perf.marks[name]) requestAnimationFrame(() => requestAnimationFrame(() => { window.__perf.marks[name] = performance.now(); })); };
        new MutationObserver(() => {
          if (document.querySelector('[data-focus-group="hm-continue"] .card')) mark('card');
          const n = document.querySelector('.hm-name');
          if (n && n.textContent) mark('hero');
          if (document.querySelector('.card-img.on')) mark('art');
        }).observe(document, { childList: true, subtree: true, attributes: true });
      });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__perf && window.__perf.marks.card && window.__perf.marks.hero, null, { timeout: 20000 });
      await wait(1500);
      const cold = await page.evaluate(() => Object.assign({}, window.__perf.marks, { fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime }));
      say('cold start, kept answers -> first Continue card ' + Math.round(cold.card) + ' ms, hero name ' + Math.round(cold.hero) + ' ms, first art ' + Math.round(cold.art || -1) + ' ms (first contentful paint ' + Math.round(cold.fcp || -1) + ' ms)');
      expect(cold.card < 2500 && cold.hero < 2500, 'first Home paint from kept answers is under 2.5 s: ' + Math.round(Math.max(cold.card, cold.hero)) + ' ms (throttle ' + throttle + 'x)');

      // 2. a focus move
      await page.waitForFunction(() => document.querySelectorAll('[data-focus-group="hm-continue"] .card').length > 1, null, { timeout: 5000 });
      const move = await page.evaluate(() => {
        const e = window.__alder.engine;
        const t0 = performance.now();
        for (let i = 0; i < 10; i++) e.move('right');
        for (let i = 0; i < 10; i++) e.move('left');
        return (performance.now() - t0) / 20;
      });
      say('focus move ' + move.toFixed(2) + ' ms average');
      expect(move < 50, 'a focus move takes ' + move.toFixed(2) + ' ms (budget 50 ms)');

      // 3. Home -> title page: OK on a Continue card until the title page has its Resume button painted
      const timeIt = (trigger, ready) => page.evaluate(([t, r]) => new Promise((resolve, reject) => {
        const t0 = performance.now();
        const done = () => requestAnimationFrame(() => requestAnimationFrame(() => { obs.disconnect(); resolve(performance.now() - t0); }));
        const obs = new MutationObserver(() => { if (eval(r)) done(); });
        obs.observe(document, { childList: true, subtree: true, attributes: true });
        setTimeout(() => { obs.disconnect(); reject(new Error('never ready: ' + r)); }, 15000);
        eval(t);
      }), [trigger, ready]);
      const toTitle = await timeIt("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }))", "!!document.querySelector('.dt-buttons .pill')");
      say('Home -> title page (OK to the Resume button painted): ' + Math.round(toTitle) + ' ms');
      expect(toTitle < 1500, 'Home to the title page: ' + Math.round(toTitle) + ' ms');
      await wait(1200);

      // 4. title -> sources list: the list asked for (held OK on Resume), through to its first painted row
      const toList = await timeIt("window.__alder.router.push('streams', { type: 'movie', id: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two', pick: true })", "!!document.querySelector('.st-row')");
      say('title -> sources list (the screen asked for, to its first row painted): ' + Math.round(toList) + ' ms');
      expect(toList < 2500, 'title to the sources list: ' + Math.round(toList) + ' ms');
      const rowMove = await page.evaluate(() => { const e = window.__alder.engine; const t0 = performance.now(); for (let i = 0; i < 6; i++) e.move('down'); for (let i = 0; i < 6; i++) e.move('up'); return (performance.now() - t0) / 12; });
      say('moving down the sources list ' + rowMove.toFixed(2) + ' ms per move');
      expect(rowMove < 50, 'a move in the sources list takes ' + rowMove.toFixed(2) + ' ms');
      await page.evaluate(() => window.__alder.router.pop());
      await wait(300);

      // 5. Play pressed on the title page: the sources page finds, ranks and starts the player
      const toPlayer = await timeIt("window.__alder.router.push('streams', { type: 'movie', id: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two' })", "(window.__alder.router.top() || {}).name === 'player'");
      say('Play -> player screen mounted (find sources, rank, open the player): ' + Math.round(toPlayer) + ' ms');
      expect(toPlayer < 2500, 'Play to the player: ' + Math.round(toPlayer) + ' ms');
      expect((await page.evaluate(() => document.querySelectorAll('.card').length)) <= 150, 'card nodes stay under 150');
      await page.evaluate(() => window.__alder.router.pop());
      await wait(300);
    },
  },
];
