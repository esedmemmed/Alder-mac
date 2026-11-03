/*
 * Drives the dev build in headless Chromium at 1920x1080, sends remote-control key presses, checks what is on screen
 * and saves PNGs to shots/<dir>/. `npm run shots` runs every scenario in dev/scenarios/*.mjs (each phase adds its
 * own file there); it exits 1 when a check fails, the page logs an error, or a screenshot cannot be taken.
 *
 *   npm run shots                       all scenarios
 *   npm run shots -- --only phase1      scenarios whose name contains "phase1"
 *   npm run shots -- --throttle 4       4x CPU slowdown (a TU8000 proxy for the performance pass)
 *   npm run shots -- --no-build         reuse dist/dev as it is
 *
 * A scenario file default-exports an array of { name, dir, url, run({ page, press, hold, shot, expect, focused, ... }) }.
 * See dev/README.md.
 */
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';

import { readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const KEYS = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', ok: 'Enter', back: 'Escape',
  playpause: 'Space', rw: '[', ff: ']' };

export async function runScenarios({ only = null, throttle = 1, build = true, outRoot = join(ROOT, 'shots'), log = console.log } = {}) {
  const { chromium } = await import('playwright');
  if (build) await (await import('../scripts/build.mjs')).build({ dev: true, log: () => {} });
  const { startServer } = await import('./fixture-server.mjs');
  const files = readdirSync(join(HERE, 'scenarios')).filter((f) => f.endsWith('.mjs')).sort();
  let scenarios = [];
  for (const f of files) scenarios = scenarios.concat((await import(pathToFileURL(join(HERE, 'scenarios', f)).href)).default);
  if (only) scenarios = scenarios.filter((s) => s.name.includes(only));

  const server = await startServer({ quiet: true });
  const browser = await chromium.launch();
  const failures = [];
  let shots = 0;

  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push('page error: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
      page.on('requestfailed', (r) => problems.push('request failed: ' + r.url().slice(0, 100)));
      if (throttle > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      }
      const dir = join(outRoot, scenario.dir || scenario.name);
      mkdirSync(dir, { recursive: true });
      const failed = [];
      const api = {
        page, server,
        expect(cond, message) { if (!cond) { failed.push(message); log('  FAIL ' + message); } else log('  ok   ' + message); },
        async press(key, times = 1, gap = 40) {
          for (let i = 0; i < times; i++) { await page.keyboard.press(KEYS[key] || key); if (gap) await page.waitForTimeout(gap); }
          await page.waitForTimeout(280); // the row slide and the focus fade
        },
        /** Holds OK longer than the hold threshold (600 ms). */
        async hold(key = 'ok', ms = 800) {
          await page.keyboard.down(KEYS[key] || key);
          await page.waitForTimeout(ms);
          await page.keyboard.up(KEYS[key] || key);
          await page.waitForTimeout(300);
        },
        async shot(name) {
          await page.evaluate(() => document.fonts && document.fonts.ready);
          await page.screenshot({ path: join(dir, name + '.png') });
          shots++;
          log('  shot ' + scenario.dir + '/' + name + '.png');
        },
        /** What has focus: { text, index, group, nav } read from the DOM. */
        focused: () => page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const group = el.closest && el.closest('[data-focus-group]');
          return { text: (el.textContent || '').trim().slice(0, 40), index: el.getAttribute('data-index') === null ? null : Number(el.getAttribute('data-index')),
            group: group ? group.getAttribute('data-focus-group') : null, nav: el.getAttribute('data-nav'), cls: el.className };
        }),
        wait: (ms) => page.waitForTimeout(ms),
        throttle,
      };
      log('scenario ' + scenario.name);
      try {
        await page.goto(server.origin + (scenario.url || '/'), { waitUntil: 'load' });
        await page.waitForFunction(() => window.__alder, null, { timeout: 10000 });
        await scenario.run(api);
      } catch (e) {
        failed.push('scenario threw: ' + (e && e.stack || e));
        log('  FAIL scenario threw: ' + (e && e.message || e));
      }
      problems.forEach((p) => { failed.push(p); log('  FAIL ' + p); });
      failed.forEach((f) => failures.push(scenario.name + ': ' + f));
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  log(shots + ' screenshot(s), ' + failures.length + ' failure(s)');
  return { failures, shots };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const val = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const { failures } = await runScenarios({ only: val('--only'), throttle: Number(val('--throttle')) || 1, build: !args.includes('--no-build') });
  process.exit(failures.length ? 1 : 0);
}
