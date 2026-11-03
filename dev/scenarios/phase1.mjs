/*
 * Phase 1: the foundation, now under the real Home (src/screens/home.js) on the fixture profile: focus across rows, Back,
 * hold OK, the exit toast, the Tizen mock. The foundation's own demo screens are gone; what they checked (a long row keeps few
 * cards mounted, a focus move is cheap) is checked here on what the owner will use.
 */
export default [{
  name: 'phase1-foundation',
  dir: 'phase1',
  url: '/?profile=fixture&clock=12:03%20AM',
  async run({ page, press, hold, shot, expect, focused, wait }) {
    const names = () => page.evaluate(() => window.__alder.router.names().join());
    const cards = () => page.evaluate(() => document.querySelectorAll('.card').length);

    // posters (through the image loader) have loaded
    await page.waitForFunction(() => document.querySelectorAll('.card-img.on').length > 1, null, { timeout: 10000 });
    await wait(600);
    let f = await focused();
    expect(f && f.group === 'hm-continue' && f.index === 0, 'Home starts on the first card of Continue Watching');
    await shot('01-home');

    await press('right');
    f = await focused();
    expect(f.group === 'hm-continue' && f.index === 1, 'Right moves to the next card (' + f.index + ')');
    await press('right', 5, 20);
    f = await focused();
    expect(f.index === 2, 'Right past the end stops on the last card (' + f.index + ')');
    await press('left', 5, 20);
    f = await focused();
    expect(f.index === 0, 'Left comes back to the first card');

    await page.waitForFunction(() => document.querySelector('.hm-next:not([hidden])'), null, { timeout: 10000 });
    await press('down');
    f = await focused();
    expect(f.group && f.group !== 'hm-continue', 'Down moves to the next row (' + f.group + ')');
    await shot('02-second-row');
    await press('up');
    f = await focused();
    expect(f.group === 'hm-continue', 'Up returns to Continue Watching');
    await press('up');
    f = await focused();
    expect(f && f.cls.indexOf('nav-item') >= 0, 'Up from the first row reaches the top bar (' + (f && f.cls) + ')');
    await shot('03-top-bar');
    await press('down');
    f = await focused();
    expect(f.group === 'hm-continue' && f.index === 0, 'Down from the top bar returns to the row');

    // OK opens the title page; Back closes it and focus is where it was
    await press('right');
    await press('ok');
    expect((await names()).indexOf('home,details') === 0, 'OK opens the title page (' + (await names()) + ')');
    await press('back');
    await wait(400);
    f = await focused();
    expect((await names()) === 'home' && f && f.group === 'hm-continue' && f.index === 1, 'Back pops and focus returns to the card it left (' + (await names()) + ', ' + (f && f.index) + ')');

    // hold OK on My List's grid opens the options panel; Back closes it
    await press('up', 2, 20);
    await press('right', 4, 20);
    await wait(500);
    await press('ok');
    await press('down');
    await hold('ok');
    const panel = await page.evaluate(() => !!document.querySelector('.panel'));
    f = await focused();
    expect(panel && f.cls.indexOf('row-item') >= 0, 'hold OK opens the panel with focus inside it');
    await shot('04-options-panel');
    await press('down');
    f = await focused();
    expect(f.text === 'Mark as watched', 'Down inside the panel moves to the next option (' + f.text + ')');
    await press('back');
    expect(!(await page.evaluate(() => !!document.querySelector('.panel'))), 'Back closes the panel');

    // Back from the content goes up to the page's name, and from there asks "Exit Alder?" (v0.2): Exit leaves the app, and a toast
    // says so on a desktop
    for (let i = 0; i < 6 && !(await page.evaluate(() => !!document.querySelector('.panel'))); i++) await press('back', 1, 20);
    expect(await page.evaluate(() => !!document.querySelector('.panel')) && !(await page.evaluate(() => window.__mockExitRequested)), 'Back on Home asks before leaving');
    await press('down');
    await press('ok'); // Exit
    const toast = await page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.textContent : null; });
    const exits = await page.evaluate(() => window.__mockExitRequested || 0);
    expect(exits === 1 && toast && /leave|exit/i.test(toast), 'Back on Home requests exit (exit calls ' + exits + ', toast "' + toast + '")');
    await shot('05-exit-toast');

    // the Tizen mock is there
    const mock = await page.evaluate(() => ({
      ud: window.webapis.productinfo.isUdPanelSupported(), hdr: window.webapis.avinfo.isHdrTvSupport(),
      keys: window.tizen.__registeredKeys().length, state: window.webapis.avplay.getState(),
    }));
    expect(mock.ud === true && mock.hdr === true && mock.keys > 10 && mock.state === 'NONE', 'the Tizen mock is installed (' + JSON.stringify(mock) + ')');

    expect((await cards()) <= 150, 'the page keeps few card nodes (' + (await cards()) + ')');
  },
}];
