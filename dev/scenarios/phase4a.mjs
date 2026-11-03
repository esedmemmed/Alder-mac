/*
 * Phase 4A: the way in and Home. Sign-in with the QR (the fixture link answers on its second poll), the profile picker, the PIN pad,
 * Home with Continue, Shows with genre chips, My List as a grid, the list menu, and switching profile. The fixture account:
 * dev/fixtures (Dune: Part Two and Severance in progress). `?profile=fixture` (dev only) adds its profile so a scenario can start
 * at Home. The performance numbers (focus-move latency, card nodes) are checked here and read with `--throttle 4`.
 */
const CLOCK = '/?clock=12:03%20AM';
const FIXTURE = '/?profile=fixture&clock=12:03%20AM';

const names = (page) => page.evaluate(() => window.__alder.router.names().join());
const cardCount = (page) => page.evaluate(() => document.querySelectorAll('.card').length);
const textOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const focusText = async (api) => { const f = await api.focused(); return f ? f.text : null; };

/** Home's first row is on screen with its art. */
async function homeReady(page) {
  await page.waitForFunction(() => document.querySelectorAll('.hm-continue .card, [data-focus-group="hm-continue"] .card').length > 0 && document.querySelector('.hm-name') && document.querySelector('.hm-name').textContent, null, { timeout: 10000 });
  await page.waitForTimeout(900);
}

/** Moves focus to a top-bar page by name (the remote: Up to the bar, Right to the page, OK). */
async function goTo(api, label) {
  const { page, press } = api;
  await press('up', 6, 20);
  for (let i = 0; i < 6 && (await focusText(api)) !== label; i++) await press('right', 1, 20);
  await page.waitForTimeout(700); // resting on a page's name opens it (Alder: switchPage), and OK then steps down into it
  await press('ok');
  await page.waitForTimeout(900);
}

export default [
  {
    name: 'phase4a-signin',
    dir: 'phase4a',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      expect((await names(page)) === 'signin', 'no profile: the app opens on sign-in (' + (await names(page)) + ')');
      expect(/Welcome to Alder/.test(await textOf(page, '.ob-h1, .ob-copy')), 'the welcome step: "Welcome to Alder"');
      await shot('01-welcome-name');
      await press('right', 4, 20);
      await press('ok'); // the letter E
      await press('down', 6, 20); // the keyboard, the colours, Continue
      expect((await focusText(api)).indexOf('Continue') === 0, 'Down from the keyboard reaches Continue (' + (await focusText(api)) + ')');
      await press('ok');
      await page.waitForSelector('.ob-qr svg', { timeout: 8000 });
      await wait(500);
      expect(/ALDR7K2Q/.test((await page.evaluate(() => Array.from(document.querySelectorAll('.ob-codetile')).map((e) => e.textContent).join('')))), 'the code under the QR is the fixture link code');
      expect(/Waiting for your phone/.test(await textOf(page, '.ob-statusrow')), 'it says it is waiting for the phone');
      await shot('02-signin-qr');
      // the fixture link answers on its next poll: the profile exists and Home opens
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 12000 });
      const profiles = await page.evaluate(() => window.__alder.context.session.profiles.all().map((p) => p.name + ':' + !!p.authKey));
      expect(profiles.join() === 'E:true', 'the profile is saved with its key (' + profiles + ')');
      await homeReady(page);
      await shot('03-home-after-signin');
    },
  },
  {
    name: 'phase4a-picker',
    dir: 'phase4a',
    url: FIXTURE,
    async run(api) {
      const { page, press, hold, shot, expect, wait } = api;
      await homeReady(page);
      // a second profile with a PIN, then the picker as a launch would show it
      await page.evaluate(() => {
        const s = window.__alder.context.session;
        const first = s.profiles.active();
        const p = s.profiles.add('Mira', 'FIXTURE-AUTH-KEY-0002');
        s.profiles.update(p.id, { pin: '2580', color: '#8FA39A' });
        s.profiles.setActive(first.id);
        window.__alder.router.reset('profiles', {});
      });
      await wait(600);
      expect((await names(page)) === 'profiles', 'the picker');
      expect(/Who/.test(await textOf(page, '.pk-title')), 'the title asks who is watching: "' + (await textOf(page, '.pk-title')) + '"');
      expect((await page.evaluate(() => document.querySelectorAll('.pk-tile').length)) === 3, 'two portraits and Add');
      await shot('04-picker');
      await press('right');
      expect(/Mira/.test(await focusText(api)), 'focus moves to Mira (' + (await focusText(api)) + ')');
      await shot('05-picker-locked');
      await press('ok');
      expect(/PIN/.test(await textOf(page, '.pin')), 'a locked profile asks for its PIN');
      await shot('06-pin');
      for (const k of ['1', '1', '1', '1']) await press(k, 1, 20); // a wrong code, typed
      await wait(400);
      expect((await names(page)) === 'profiles', 'a wrong PIN stays on the PIN screen');
      expect(/Incorrect PIN/.test((await textOf(page, '.pin-error')) || ''), 'and says so: "' + (await textOf(page, '.pin-error')) + '"');
      await shot('07-pin-wrong');
      // the right one, turned on the remote: Up/Down change the digit, Right moves on (2 5 8 0)
      await press('up', 3, 20); await press('right', 1, 20);
      await press('up', 6, 20); await press('right', 1, 20);
      await press('down', 1, 20); await press('down', 1, 20); await press('right', 1, 20);
      await press('up', 1, 20);
      expect((await page.evaluate(() => Array.from(document.querySelectorAll('.pin-box')).map((b) => b.textContent).join('|'))) === '\u2022|\u2022|\u2022|0', 'the boxes show dots and the digit being turned');
      await shot('07b-pin-turned');
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 8000 });
      expect(await page.evaluate(() => window.__alder.context.session.profiles.active().name) === 'Mira', 'the right PIN opens Home as Mira');
      await page.evaluate(() => { const s = window.__alder.context.session; s.profiles.setActive(s.profiles.all()[0].id); window.__alder.router.reset('profiles', {}); });
      await wait(500);
      // hold OK on a portrait: Rename / PIN / Colour / Remove
      await hold('ok');
      expect(/Rename/.test((await textOf(page, '.panel')) || ''), 'hold OK on a portrait opens its menu: "' + (await textOf(page, '.panel')) + '"');
      await shot('08-picker-menu');
      await press('back');
      await press('ok'); // Enough has no PIN: Home
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 8000 });
      await homeReady(page);
      expect(await page.evaluate(() => window.__alder.context.session.profiles.active().name) === 'Enough', 'OK on a plain portrait opens Home as that profile');
    },
  },
  {
    name: 'phase4a-home',
    dir: 'phase4a',
    url: FIXTURE,
    async run(api) {
      const { page, press, hold, shot, expect, wait, focused } = api;
      await homeReady(page);
      expect((await names(page)) === 'home', 'one plain profile: straight to Home');
      let f = await focused();
      expect(f && f.group === 'hm-continue' && f.index === 0, 'Home starts on the first Continue card (' + JSON.stringify(f) + ')');
      expect((await textOf(page, '.hm-name')) === 'Dune: Part Two', 'the hero is the focused title: "' + (await textOf(page, '.hm-name')) + '"');
      expect(/Stopped at|left/.test((await textOf(page, '.hm-caption')) || ''), 'the line under the card: "' + (await textOf(page, '.hm-caption')) + '"');
      await shot('09-home-continue');

      // focus moves along the row and the hero follows
      await press('right');
      f = await focused();
      expect(f.index === 1, 'Right moves to the next card');
      await wait(400);
      expect((await textOf(page, '.hm-name')) === 'Severance', 'the hero follows: "' + (await textOf(page, '.hm-name')) + '"');
      await press('left');

      // the rows below load; Down goes to the next row, and the next row's name is shown on the right
      await page.waitForFunction(() => document.querySelectorAll('[data-focus-group]').length > 1 || document.querySelector('.hm-next:not([hidden])'), null, { timeout: 10000 });
      await press('down');
      f = await focused();
      expect(f && f.group && f.group !== 'hm-continue', 'Down opens the next row (' + (f && f.group) + ')');
      await shot('10-home-next-row');
      await press('up');
      f = await focused();
      expect(f && f.group === 'hm-continue', 'Up returns to Continue');

      // hold OK on a Continue card: the sources page to pick a stream (Alder: play(item, pick = true))
      await hold('ok');
      expect((await names(page)) === 'home,streams', 'hold OK on Continue opens the sources page (' + (await names(page)) + ')');
      await shot('11-home-hold-sources');
      await press('back');
      await wait(400);

      // OK opens the title page
      await press('ok');
      expect((await names(page)).indexOf('home,details') === 0 || (await names(page)) === 'home,streams', 'OK on Continue opens a title screen (' + (await names(page)) + ')');
      await press('back');
      await wait(400);
      expect((await names(page)) === 'home', 'Back returns to Home');

      // Shows: genre chips
      await goTo(api, 'Shows');
      expect((await textOf(page, '.hm-chips')) !== null && /All/.test(await textOf(page, '.hm-chips')), 'Shows has genre chips: "' + (await textOf(page, '.hm-chips')) + '"');
      await page.waitForFunction(() => document.querySelectorAll('.hm-row .card').length > 3, null, { timeout: 10000 });
      await wait(800);
      await shot('12-shows-chips');
      f = await focused();
      expect(f && /All/.test(f.text), 'OK on the open page\'s name steps down to its chips (' + JSON.stringify(f) + ')');
      await press('up');
      expect(await page.evaluate(() => document.querySelector('.hm-caption').hidden), 'no caption while the remote is in the top bar');
      await press('down'); // the chips
      f = await focused();
      expect(f && /All/.test(f.text), 'Down from the bar lands on the chips (' + (f && f.text) + ')');
      await press('right');
      await press('ok'); // a genre: the rows jump to it
      await wait(1200);
      await shot('13-shows-genre');
      expect((await cardCount(page)) <= 150, 'card nodes on Shows stay under 150 (' + (await cardCount(page)) + ')');

      // Movies, and a long walk along a row: only a window of cards exists
      await goTo(api, 'Movies');
      await page.waitForFunction(() => document.querySelectorAll('.hm-row .card').length > 3, null, { timeout: 10000 });
      await press('down', 2, 20);
      await press('right', 30, 20);
      expect((await cardCount(page)) <= 150, 'after 30 Rights, card nodes are still under 150 (' + (await cardCount(page)) + ')');
      await press('left', 30, 20);

      // My List: the grid, filter and sort chips
      await goTo(api, 'My List');
      expect(/Movies/.test(await textOf(page, '.hm-chips')) && /A–Z/.test(await textOf(page, '.hm-chips')), 'My List has filter and sort chips');
      expect(/Row 1 of 1 · 4 titles/.test((await textOf(page, '.hm-count')) || ''), 'the count line: "' + (await textOf(page, '.hm-count')) + '"');
      await press('down');
      f = await focused();
      expect(f && f.cls.indexOf('card') >= 0, 'Down from the chips lands on a card');
      await wait(500);
      await shot('14-mylist-grid');
      await press('right', 3, 20);
      await hold('ok');
      expect(/Remove from My List/.test((await textOf(page, '.panel')) || '') && /Mark as watched|unwatched/i.test((await textOf(page, '.panel')) || ''), 'the list menu: "' + (await textOf(page, '.panel')) + '"');
      await shot('15-mylist-menu');
      await press('back');
      // filter by Shows
      await press('up');
      await press('right', 2, 20);
      await press('ok');
      await wait(600);
      expect(/Row 1 of 1 · [12] titles?/.test((await textOf(page, '.hm-count')) || ''), 'the Shows filter narrows the list: "' + (await textOf(page, '.hm-count')) + '"');
      await shot('16-mylist-shows');

      // the profile chip: Switch profile / Settings
      await press('up');
      await press('left', 6, 20);
      await press('ok');
      await wait(300);
      expect(/Switch profile/.test((await textOf(page, '.panel')) || ''), 'the profile chip opens its menu: "' + (await textOf(page, '.panel')) + '"');
      await shot('17-profile-menu');
      await press('ok'); // Switch profile
      await wait(500);
      expect((await names(page)) === 'home,profiles', 'Switch profile opens the picker over Home (' + (await names(page)) + ')');
      await shot('18-profile-switch');
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'home', null, { timeout: 8000 });
      expect(true, 'choosing a profile returns to Home');
      const missing = (await page.evaluate(() => fetch('/__fx/_requests').then((r) => r.json()))).filter((r) => r.status >= 400).map((r) => r.url);
      expect(!missing.length, 'every request had a fixture (' + missing.join(', ') + ')');
    },
  },
  {
    name: 'phase4a-focus-latency',
    dir: 'phase4a',
    url: FIXTURE,
    async run(api) {
      const { page, expect, press, wait, throttle } = api;
      await homeReady(page);
      await page.waitForFunction(() => document.querySelector('.hm-next:not([hidden])'), null, { timeout: 10000 });
      await goTo(api, 'Movies');
      await page.waitForFunction(() => document.querySelectorAll('.hm-row .card').length > 3, null, { timeout: 10000 });
      await press('down');
      // timed in the page: a focus move (the engine moves focus; the row's slide is a transform)
      const ms = await page.evaluate(() => {
        const e = window.__alder.engine;
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) e.move('right');
        for (let i = 0; i < 20; i++) e.move('left');
        return (performance.now() - t0) / 40;
      });
      console.log('  focus move: ' + ms.toFixed(2) + ' ms average (throttle ' + throttle + 'x)');
      expect(ms < 50, 'a focus move takes ' + ms.toFixed(2) + ' ms on average (budget 50 ms, throttle ' + throttle + 'x)');
      // the same with real key events through the page
      const t = await page.evaluate(() => new Promise((resolve) => {
        const times = [];
        let n = 0;
        const fire = () => {
          const t0 = performance.now();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true }));
          requestAnimationFrame(() => { times.push(performance.now() - t0); if (++n < 15) setTimeout(fire, 60); else resolve(times); });
        };
        fire();
      }));
      const worst = Math.max.apply(null, t);
      const avg = t.reduce((a, b) => a + b, 0) / t.length;
      console.log('  key to next frame: ' + avg.toFixed(1) + ' ms average, ' + worst.toFixed(1) + ' ms worst (throttle ' + throttle + 'x)');
      expect(avg < 100, 'a key press reaches the next frame in ' + avg.toFixed(1) + ' ms on average (budget 100 ms at 4x)');
      expect((await page.evaluate(() => document.querySelectorAll('.card').length)) <= 150, 'card nodes stay under 150');
      await wait(200);
    },
  },
];
