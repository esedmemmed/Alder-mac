/*
 * Phase 4B: the title page (movie and series with its episode guide), the sources page, search, settings and the add-ons manager,
 * on the fixture account (dev/fixtures): Dune: Part Two in progress, Severance mid-season. Screens are opened on the router with
 * their params, over whatever 4A's boot screen is; the session (context.session) supplies the fixture profile.
 */
const CLOCK = '/?clock=11:26%20PM';
const AUTH = 'FIXTURE-AUTH-KEY-0001';

const wordmark = (text) => '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="150" viewBox="0 0 900 150"><text x="0" y="110" font-family="Georgia,serif" font-size="100" letter-spacing="6" fill="#f3eee6">' + text + '</text></svg>';

/** The fixture server's placeholder "logo" is just the IMDb id in big type; stand in a real-looking wordmark for the titles used here. */
const WORDMARKS = { tt11280740: 'SEVERANCE', tt15239678: 'DUNE: PART TWO', tt0816692: 'INTERSTELLAR', tt1160419: 'DUNE', tt0142032: "FRANK HERBERT'S DUNE" };
async function logos(page) {
  await page.route('**/images.metahub.space/logo/**', (route) => {
    const id = /logo\/\w+\/(tt\d+)/.exec(route.request().url());
    const text = id && WORDMARKS[id[1]];
    if (!text) return route.continue();
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: wordmark(text) });
  });
}

/** The fixture profile, signed in and active, and a clean store for settings, then one screen as the bottom of the stack. */
async function open(page, name, params = {}) {
  await page.evaluate(([n, p, auth]) => {
    const s = window.__alder.context.session;
    if (!s.profiles.all().length) s.profiles.add('Enough', auth);
    s.profiles.setActive(s.profiles.all()[0].id);
    window.__alder.router.reset(n, p);
  }, [name, params, AUTH]);
  await page.waitForTimeout(200);
}

const names = (page) => page.evaluate(() => window.__alder.router.names().join());
const WALK = `(e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const out = []; let n; while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) out.push(t); } return out.join(' ').replace(/\\s+/g, ' ').trim(); }`;
const text = (page, sel) => page.evaluate(`(() => { const f = ${WALK}; const e = document.querySelector(${JSON.stringify(sel)}); return e ? f(e) : null; })()`);
const texts = (page, sel) => page.evaluate(`(() => { const f = ${WALK}; return Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map(f); })()`);
const requests = (page) => page.evaluate(() => fetch('/__fx/_requests').then((r) => r.json()));
const focusText = async (api) => { const f = await api.focused(); return f ? f.text : null; };

const scenarios = [
  {
    name: 'phase4b-title-movie',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, press, hold, shot, expect, wait } = api;
      await logos(page);
      await open(page, 'details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two', poster: 'https://images.metahub.space/poster/medium/tt15239678/img', background: 'https://images.metahub.space/background/medium/tt15239678/img' });
      await page.waitForSelector('.dt-buttons .pill', { timeout: 8000 });
      await page.waitForFunction(() => document.querySelector('.dt-logo.on') && document.querySelector('.dt-more'), null, { timeout: 8000 });
      await wait(600);
      expect((await text(page, '.dt-buttons .pill')) === 'Resume', 'a title with progress offers Resume: "' + (await text(page, '.dt-buttons .pill')) + '"');
      expect(/^2024 · Action · 2h 46m/.test(await text(page, '.dt-facts')) && /8\.5$/.test(await text(page, '.dt-facts')), 'facts: ' + (await text(page, '.dt-facts')));
      expect(/1h 40m left/.test(await text(page, '.dt-where')), 'where you are: "' + (await text(page, '.dt-where')) + '"');
      expect((await page.evaluate(() => document.querySelectorAll('.dt-buttons .btn-round').length)) === 3, 'Start over, My List and More information sit beside Resume');
      expect((await focusText(api)) === 'Resume', 'Resume has focus');
      expect((await text(page, '.dt-more')) === '▾ More like this', 'an add-on with "similar" adds More like this');
      expect((await text(page, '.b-clock')) === '11:26 PM', 'the clock');
      await shot('01-title-movie');

      // More like this: Down opens a poster row, Up closes it
      await press('down');
      await wait(300);
      expect(await page.evaluate(() => !!document.querySelector('.dt-similar.on')), 'Down opens More like this');
      expect((await page.evaluate(() => document.querySelectorAll('.dt-similar .card').length)) >= 3, 'with posters');
      await shot('02-title-similar');
      await press('up');
      expect(!(await page.evaluate(() => !!document.querySelector('.dt-similar.on'))), 'Up closes it');
      expect((await focusText(api)) === 'Resume', 'and focus returns to Resume');

      // the story
      await press('right', 3);
      expect((await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'More information', 'Right x3 reaches More information');
      await press('ok');
      await wait(300);
      expect(/The story/.test(await text(page, '.dt-info')) && /Timothée Chalamet/.test(await text(page, '.dt-info')), 'the story page shows the description and the cast');
      await shot('03-title-story');
      await press('back');
      expect(!(await page.evaluate(() => !!document.querySelector('.dt-info'))), 'Back closes the story');
      expect((await names(page)) === 'details', 'and stays on the title page (' + (await names(page)) + ')');

      // My List: Dune is in the library; the toggle removes and saves it to Stremio
      await press('left');
      const label = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
      expect(label === 'My List', 'Left from More information is My List (' + label + ')');
      await press('ok');
      await wait(400);
      const saved = (await requests(page)).filter((r) => /datastorePut/.test(r.url));
      expect(saved.length >= 1, 'toggling My List saves the library item to Stremio');

      // Resume starts the player itself (the sources page is replaced), at the saved position
      await press('left', 2);
      await press('ok');
      await page.waitForFunction(() => window.__alder.router.names().join() === 'details,player', null, { timeout: 8000 });
      const rp = await page.evaluate(() => window.__alder.router.top().params);
      expect(rp.resumeAt === undefined && rp.metaId === 'tt15239678', 'the player gets the title (and resumes from the library position: resumeAt ' + rp.resumeAt + ')');
      await wait(2500); // let it open and start: leaving a player that is still opening is the player's own business (Phase 3)
      await page.evaluate(() => window.__alder.router.pop());
      await wait(200);
    },
  },
  {
    name: 'phase4b-title-series',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, press, hold, shot, expect, wait } = api;
      await logos(page);
      await open(page, 'details', { type: 'series', id: 'tt11280740', name: 'Severance' });
      await page.waitForFunction(() => document.querySelector('.dt-logo.on') && document.querySelector('.dt-buttons .pill') && document.querySelector('.dt-more'), null, { timeout: 8000 });
      await wait(700);
      expect((await text(page, '.dt-buttons .pill')) === 'Resume', 'Severance resumes');
      expect(/S1 E4/.test(await text(page, '.dt-where')), 'the episode Continue Watching points at: "' + (await text(page, '.dt-where')) + '"');
      expect(/2 seasons/.test(await text(page, '.dt-facts')), 'facts count seasons: ' + (await text(page, '.dt-facts')));
      expect((await text(page, '.dt-more')) === '▾ Episodes', 'Episodes below');
      await shot('04-title-series');

      await press('down');
      await wait(500);
      expect(await page.evaluate(() => !!document.querySelector('.eg.on')), 'Down opens the episode guide');
      const chips = await texts(page, '.eg-seasons .chip');
      expect(chips.join('|') === '•Season 1|2|Specials' || /Season 1/.test(chips[0]) && chips.length === 3, 'season chips: ' + chips.join(' | '));
      const rows = await texts(page, '.eg-row');
      expect(rows.length === 9, 'nine episodes in season 1 (' + rows.length + ')');
      expect(rows.slice(0, 3).every((r) => /✓$/.test(r)), 'S1 E1 to E3 are ticked as watched (bitfield): ' + rows.slice(0, 3).join(' / '));
      expect(/left$/.test(rows[3]), 'E4 shows the time left: ' + rows[3]);
      expect(/^04/.test((await focusText(api)) || ''), 'focus is on episode 4: ' + (await focusText(api)));
      expect(/S1 E4/.test(await text(page, '.eg-pfacts')), 'the preview names it: ' + (await text(page, '.eg-pfacts')));
      await shot('05-episodes');

      // hold OK on an episode lists its sources (E5 here), with the next episode behind it
      await press('down');
      await hold('ok', 800);
      await page.waitForFunction(() => window.__alder.router.names().join() === 'details,streams', null, { timeout: 5000 });
      const p = await page.evaluate(() => window.__alder.router.top().params);
      expect(p.pick === true && p.videoId === 'tt11280740:1:5' && p.nextVideoId === 'tt11280740:1:6', 'hold OK opens the sources page with pick, the episode and the next one (' + p.videoId + ' ' + p.nextVideoId + ')');
      await page.waitForSelector('.st-row', { timeout: 8000 });
      await wait(300);
      expect(/^S1 E5/.test(await text(page, '.st-info')), 'the header names the episode: ' + (await text(page, '.st-info')));
      await page.evaluate(() => window.__alder.router.pop());
      await wait(400);
      expect(await page.evaluate(() => !!document.querySelector('.eg.on')), 'Back from the sources lands on the open guide');

      // Up to the chips, Right to season 2
      await press('up', 5);
      expect(await page.evaluate(() => document.activeElement.hasAttribute('data-season')), 'Up from the first rows reaches the season chips');
      await press('right');
      await press('ok');
      await wait(300);
      const s2 = await texts(page, '.eg-row');
      expect(s2.length === 10 && /^0?1/.test(s2[0]), 'season 2 lists its episodes: ' + s2.length);
      await shot('06-episodes-season2');
      await press('back');
      await wait(400);
      expect(!(await page.evaluate(() => !!document.querySelector('.eg.on'))), 'Back closes the guide');
      expect((await text(page, '.dt-buttons .pill')) === 'Resume' && (await focusText(api)) === 'Resume', 'and returns to Resume');

    },
  },
  {
    name: 'phase4b-sources',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await logos(page);
      const DUNE = { type: 'movie', id: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two', runtime: '2h 46m', poster: 'https://images.metahub.space/poster/medium/tt15239678/img', background: 'https://images.metahub.space/background/medium/tt15239678/img' };
      await open(page, 'details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' });
      await page.evaluate((p) => window.__alder.router.push('streams', p), Object.assign({}, DUNE, { pick: true, message: "3 sources didn't play" }));
      await page.waitForSelector('.st-row', { timeout: 8000 });
      await wait(500);
      const rows = await texts(page, '.st-row');
      expect(rows.length >= 12, 'the playable sources are listed (' + rows.length + ')');
      expect(/BEST MATCH/.test(rows[0]), 'the first is the BEST MATCH: ' + rows[0]);
      expect(rows.filter((r) => /BEST MATCH/.test(r)).length === 1, 'only one BEST MATCH');
      expect(rows.some((r) => /No sound on this TV/.test(r)), 'DTS and TrueHD releases say "No sound on this TV"');
      expect(rows.some((r) => /May not play/.test(r)), 'a release needing a Referer header says "May not play"');
      const order = rows.map((r, i) => /No sound/.test(r) ? i : -1).filter((i) => i >= 0);
      expect(order.length > 0 && order[0] >= rows.length - order.length - 0 && order.every((v, i) => v === order[0] + i), 'no-sound sources are listed last (' + order.join(',') + ' of ' + rows.length + ')');
      expect(/sources$/.test(await text(page, '.st-count')) && (await text(page, '.st-count')) === rows.length + ' sources', 'the count: ' + (await text(page, '.st-count')));
      expect((await text(page, '.st-preset')) === "Add-on's order", 'the preset name in the help line');
      expect((await text(page, '.st-message')) === "3 sources didn't play", 'the message line: ' + (await text(page, '.st-message')));
      expect((await text(page, '.st-title')) === 'Dune: Part Two', 'the header names the title');
      await shot('07-sources');

      // to the end of the list: the sources with no sound
      await press('down', rows.length - 1, 25);
      await wait(400);
      await shot('08-sources-nosound');
      expect(/No sound/.test((await focusText(api)) || '') || (await page.evaluate(() => /No sound/.test(document.activeElement.textContent))), 'focus reached a no-sound source');

      // OK plays that source alone; Back from the player returns to this list
      await press('ok');
      await wait(500);
      expect((await names(page)) === 'details,streams,player', 'OK plays the chosen source (' + (await names(page)) + ')');
      const pp = await page.evaluate(() => { const t = window.__alder.router.top().params; return { picked: t.picked, n: t.sources.length, meta: t.metaId }; });
      expect(pp.picked === true && pp.n === 1 && pp.meta === 'tt15239678', 'the player gets that one source, picked');
      await page.evaluate(() => window.__alder.router.pop());
      await wait(300);
      expect((await names(page)) === 'details,streams', 'Back from the player returns to the list');
    },
  },
  {
    name: 'phase4b-sources-auto',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, expect, wait } = api;
      await open(page, 'details', { type: 'movie', id: 'tt15239678', name: 'Dune: Part Two' });
      await page.evaluate(() => window.__alder.router.push('streams', { type: 'movie', id: 'tt15239678', videoId: 'tt15239678', name: 'Dune: Part Two', afterVideoId: null }));
      await page.waitForFunction(() => window.__alder.router.names().join() === 'details,player', null, { timeout: 8000 });
      expect(true, 'Play starts the player itself, replacing the sources page (details,player)');
      const p = await page.evaluate(() => { const t = window.__alder.router.top().params; return { n: t.sources.length, first: t.sources[0].filename, picked: !!t.picked }; });
      expect(p.n === 3 && !p.picked, 'with the first three ranked sources to fall back on (' + p.n + ')');
      expect(!/DTS-HD|TrueHD|HDCAM|3D/i.test(p.first), 'the first is not a no-sound, cam or 3D release: ' + p.first);
      expect(/1080p|2160p/.test(p.first), 'a good one: ' + p.first);
      await page.evaluate(() => window.__alder.router.pop());
      await wait(300);
      expect((await names(page)) === 'details', 'Back from the player lands on the title page');
    },
  },
  {
    name: 'phase4b-search',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await logos(page);
      await open(page, 'search', {});
      await page.waitForSelector('.sr-card', { timeout: 8000 });
      await wait(500);
      expect((await texts(page, '.sr-label .caps')).join() === 'Popular', 'nothing typed shows Popular');
      expect(((await focusText(api)) || '') === 'a', 'focus starts on the first key');

      // the grid: OK types. d-u-n-e is spelled with raw keys so only "dune" is ever searched (the search waits for a typing pause)
      const raw = async (keys) => { for (const key of keys) { await page.keyboard.press(key); await page.waitForTimeout(60); } };
      await raw(['ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter']); // d
      await raw(['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'Enter']); // u
      await raw(['ArrowUp', 'ArrowLeft', 'Enter']); // n
      await raw(['ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Enter']); // e
      expect((await page.evaluate(() => document.querySelector('.sr-input').value)) === 'dune', 'OK on the letter grid types "dune": ' + (await page.evaluate(() => document.querySelector('.sr-input').value)));
      await page.waitForFunction(() => document.querySelectorAll('.sr-section').length === 2, null, { timeout: 9000 });
      await wait(800);
      expect((await texts(page, '.sr-label .caps')).join() === 'Movies,Shows', 'results come in Movies and Shows: ' + (await texts(page, '.sr-label .caps')).join());
      expect(/titles$/.test(await text(page, '.sr-count')), 'the field counts them: ' + (await text(page, '.sr-count')));
      const first = await page.evaluate(() => document.querySelector('.sr-section .card .card-name').textContent);
      expect(/^Dune/.test(first), 'the best match leads: ' + first);
      expect(/^Dune/.test(await page.evaluate(() => document.querySelector('.sr-heroname').textContent)), 'the hero names the first title');
      await shot('09-search');

      // Right from the grid's edge to the posters, then open one
      await press('right', 2);
      const edge = await page.evaluate(() => document.activeElement.className);
      expect(/sr-card/.test(edge), 'Right from the right edge of the grid reaches the posters');
      await press('right', 2);
      await press('down');
      await wait(400);
      expect(/Shows/.test(await text(page, '.sr-section:nth-child(2) .sr-label')) && (await page.evaluate(() => { const c = document.activeElement.closest('.sr-section'); return c && c.querySelector('.sr-label .caps').textContent; })) === 'Shows', 'Down moves to the Shows row');
      await shot('10-search-shows');
      await press('ok');
      await wait(300);
      expect((await names(page)) === 'search,details' || (await names(page)) === 'details,search'.split(',').reverse().join(','), 'OK opens the title page (' + (await names(page)) + ')');
      await page.evaluate(() => window.__alder.router.pop());
      await wait(300);
      expect((await texts(page, '.sr-recent')).join() === 'dune', 'the search is remembered under Recent: ' + (await texts(page, '.sr-recent')).join());
      await shot('11-search-recent');
    },
  },
  {
    name: 'phase4b-settings',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await open(page, 'settings', {});
      await wait(400);
      const downTo = async (re, max = 12) => { for (let i = 0; i < max && !re.test((await focusText(api)) || ''); i++) await press('down'); return re.test((await focusText(api)) || ''); };
      const rowsOf = async () => (await texts(page, '.sg-row')).map((r) => r.replace(/\s*›$/, ''));
      expect((await texts(page, '.sg-group')).map((t) => t.replace(/^•\s*/, '')).join() === 'Streams,Picture & Sound,Subtitles,Add-ons,Profile,Language,Storage,About', 'the groups: ' + (await texts(page, '.sg-group')).join());
      expect((await text(page, '.sg-profile')) === 'Profile Enough', 'the profile name: ' + (await text(page, '.sg-profile')));
      expect((await rowsOf()).join('|') === "Source choice Add-on's order|When I press Play Best source|Highest quality No limit|Largest file No limit|Release type THIS PROFILE No preference|Share my streaming sources Off|More filters", 'Streams rows: ' + (await rowsOf()).join(' | '));
      expect((await text(page, '.sg-hint')) === 'Choose how Alder finds and starts a source.', 'the help line: ' + (await text(page, '.sg-hint')));
      await shot('12-settings-streams');

      // presets: Right on Source choice steps to Best picture and sets four keys
      await press('right');
      expect(/^Source choice/.test((await focusText(api)) || ''), 'Right from the groups enters the rows');
      await press('right');
      expect(/Best picture/.test((await rowsOf())[0]), 'Right steps the preset: ' + (await rowsOf())[0]);
      const kept = await page.evaluate(() => { const s = window.__alder.context.session.settings; return [s.release && s.release(), s.hdrPref && s.hdrPref(), s.maxHeight && s.maxHeight(), s.maxSizeGb && s.maxSizeGb()].join(); });
      console.log('   preset keys: ' + kept);
      await press('down', 2);
      await press('right'); // Highest quality steps
      expect(/Custom/.test((await rowsOf())[0]), 'changing a row by hand reads Custom: ' + (await rowsOf())[0]);
      await press('down');
      expect(/^Largest file/.test((await focusText(api)) || ''), 'focus on Largest file');
      expect(/slow connections|big files/i.test(await text(page, '.sg-hint')), 'the help follows the row: ' + (await text(page, '.sg-hint')));

      // Back returns to the groups; Down to Picture & Sound
      await press('back');
      expect((await names(page)) === 'settings', 'Back from a row goes to the groups, not out');
      await press('down');
      await wait(200);
      const picture = await rowsOf();
      expect(picture.some((r) => /HDR and Dolby Vision/.test(r)) && picture.some((r) => /Audio language THIS PROFILE/.test(r)) && picture.some((r) => /My TV plays AV1 Off/.test(r)), 'Picture & Sound rows incl. the AV1 toggle: ' + picture.join(' | '));
      expect(!picture.some((r) => /frame rate|Audio output|Updates/i.test(r)), 'no frame rate, passthrough or updates rows');
      await shot('13-settings-picture');
      await press('right');
      expect(await downTo(/AV1/), 'focus on AV1');
      await press('ok');
      expect((await page.evaluate(() => window.__alder.context.session.settings.av1())) === true, 'OK toggles AV1 on');
      await press('ok');
      await press('back');

      // Subtitles, Add-ons
      await press('down');
      const subs = await rowsOf();
      expect(subs.length >= 2 && /Subtitles by default/.test(subs[0]), 'Subtitles rows: ' + subs.join(' | '));
      await press('down');
      await page.waitForFunction(() => /\d+ installed/.test(document.querySelector('.sg-row').textContent), null, { timeout: 5000 }).catch(() => {});
      expect(/My add-ons 6 installed/.test((await rowsOf())[0]), 'Add-ons: ' + (await rowsOf())[0]);
      await shot('14-settings-addons');

      // About with Diagnostics
      await press('down', 4);
      await wait(200);
      const about = await rowsOf();
      expect(/Version/.test(about[0]) && about.some((r) => /^Diagnostics/.test(r)), 'About: version and Diagnostics: ' + about.join(' | '));
      await shot('15-settings-about');
      await press('right');
      await press('down');
      await press('ok');
      await wait(300);
      expect((await names(page)) === 'settings,diagnostics', 'the Diagnostics row opens Diagnostics (' + (await names(page)) + ')');
      await page.evaluate(() => window.__alder.router.pop());
      await wait(300);

      // the Add-ons row opens the manager
      await press('back');
      await press('up', 4);
      await press('right');
      await press('ok');
      await wait(300);
      expect((await names(page)) === 'settings,addons', 'My add-ons opens the manager (' + (await names(page)) + ')');
    },
  },
  {
    name: 'phase4b-addons',
    dir: 'phase4b',
    url: CLOCK,
    async run(api) {
      const { page, press, shot, expect, wait } = api;
      await open(page, 'addons', {});
      await page.waitForSelector('.ad-row', { timeout: 8000 });
      await wait(500);
      const rows = await texts(page, '.ad-row');
      expect(rows.length === 7, 'six add-ons and Add by URL (' + rows.length + ')');
      expect(/^1\s*Cinemeta/.test(rows[0]) && /Built-in/.test(rows[0]) && /Titles and details/.test(rows[0]), 'Cinemeta first, built-in: ' + rows[0]);
      expect(/^2\s*Torrentio\s*Streams/.test(rows[1]), 'the account order: ' + rows[1]);
      expect(/OpenSubtitles\s*Subtitles/.test(rows[3]) && /v3/.test(rows[3]), 'OpenSubtitles v3: ' + rows[3]);
      expect(/It answers first/.test(await text(page, '.ad-help-body')), 'the help pane: ' + (await text(page, '.ad-help-body')));
      await shot('16-addons');

      // Cinemeta cannot be removed: OK offers Move down only
      await press('ok');
      await wait(300);
      const menu = await texts(page, '.panel .row-item');
      expect(menu.join() === 'Move down', 'a protected add-on can only be moved: ' + menu.join());
      await press('back');
      await press('down');
      await press('ok');
      await wait(300);
      expect((await texts(page, '.panel .row-item')).join() === 'Move up,Move down,Remove', 'Torrentio: Move up, Move down, Remove');
      await shot('17-addons-menu');
      await press('down');
      await press('ok'); // Move down
      await wait(700);
      const after = await texts(page, '.ad-row');
      expect(/^2\s*AIOStreams/.test(after[1]) && /^3\s*Torrentio/.test(after[2]), 'Torrentio moved down: ' + after[1] + ' / ' + after[2]);
      const sets = (await requests(page)).filter((r) => /addonCollectionSet/.test(r.url));
      expect(sets.length >= 1, 'the new order is saved to Stremio (addonCollectionSet)');
      expect(/Torrentio/.test(await page.evaluate(() => document.activeElement.textContent)), 'focus stays on the moved add-on');

      // Add by URL: the dialog, an address already installed
      await press('down', 5);
      await wait(200);
      expect(/Add by URL/.test(await page.evaluate(() => document.activeElement.textContent)), 'focus on Add by URL');
      await press('ok');
      await wait(300);
      expect(await page.evaluate(() => !!document.querySelector('.b-dialog .b-field')), 'OK opens the address dialog');
      await page.keyboard.type('torrentio.strem.fun', { delay: 10 });
      await shot('18-addons-add');
      await press('down'); // to the buttons
      await press('right');
      await press('ok');
      await wait(400);
      expect(/Already installed/.test(await text(page, '.ad-message')), 'a known address says so: ' + (await text(page, '.ad-message')));
    },
  },
];

/**
 * These screens need src/main.js to register `screensB` and to set `context.session` (docs/CONTEXT.md). Until the shell does
 * (Phase 4A's file), each scenario says so and stops instead of failing on a page it cannot open.
 */
const wired = (page) => page.evaluate(() => !!(window.__alder.context.session && window.__alder.context.session.profiles));
export default scenarios.map((scenario) => ({
  ...scenario,
  async run(api) {
    if (!(await wired(api.page))) { console.log('  SKIP ' + scenario.name + ': src/main.js does not set context.session / register screensB yet'); return; }
    return scenario.run(api);
  },
}));
