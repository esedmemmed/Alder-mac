// What the views print, apart from the DOM: the clock texts, the scrub step, and the Diagnostics report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatLeft } from '../../src/player/bar.js';
import { scrubStep, wallClockText } from '../../src/player/controls.js';
import { buildReport } from '../../src/screens/diagnostics.js';
import { createDiag } from '../../src/player/diag.js';
import { createLogger } from '../../src/lib/log.js';
import { tu8000Profile } from '../../src/core/device.js';

test('times as the controls print them', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(407000), '6:47');
  assert.equal(formatClock(5989000), '1:39:49');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatLeft(407000, 6396000), '\u22121:39:49');
  assert.equal(formatLeft(7000000, 6396000), '\u22120:00', 'never negative');
  assert.equal(formatLeft(0, 0), '', 'no length (live): nothing');
});

test('the clock is 12-hour with AM / PM, as in docs/controls.jpg', () => {
  assert.equal(wallClockText(new Date(2026, 0, 1, 23, 26)), '11:26 PM');
  assert.equal(wallClockText(new Date(2026, 0, 1, 0, 5)), '12:05 AM');
  assert.equal(wallClockText(new Date(2026, 0, 1, 12, 0)), '12:00 PM');
});

test('a held Left/Right on the bar steps 10 s, then 30 s, then 60 s (Alder\'s repeat counts)', () => {
  assert.deepEqual([0, 9, 10, 29, 30, 99].map(scrubStep), [10000, 10000, 30000, 30000, 60000, 60000]);
});

test('the Diagnostics report: device, stream host and file (never the query), raw tracks, decisions, log', () => {
  let t = Date.UTC(2026, 0, 1, 12, 0, 0);
  const diag = createDiag({ now: () => t });
  diag.setStream({ url: 'https://media.example.org/a/Dune.2024.2160p.mkv?token=SECRET', label: 'Torrentio  \u00b7  2160p', at: 2, total: 3, headers: ['User-Agent'] });
  diag.setTracks([{ index: 0, type: 'AUDIO', extra_info: '{"fourCC":"A_DTS"}' }, { index: 1, type: 'AUDIO', extra_info: '{"fourCC":"A_AC3"}' }]);
  diag.decision('audio: chose #1 AC3 over #0 DTS (this TV cannot decode DTS)');
  diag.error('source 1: PLAYER_ERROR_CONNECTION_FAILED');
  const log = createLogger({ now: () => t });
  log.info('player', 'prepared');
  log.warn('player', 'seek failed');
  const report = buildReport({ log, diag: diag.snapshot(), device: tu8000Profile(), version: '1.2.3', env: 'test', agent: 'UA' });
  const text = report.map((s) => s.title + '\n' + s.lines.map((l) => l.text).join('\n')).join('\n');
  assert.deepEqual(report.map((s) => s.title.split(' (')[0]), ['APP', 'ICONS', 'DEVICE', 'STREAM', 'PICTURE', 'AVPLAY TRACKS', 'AUDIO AND SOURCE DECISIONS', 'PLAYER ERRORS', 'LOG']);
  assert.match(text, /Alder 1\.2\.3 \(test\)/);
  assert.match(text, /2160p HDR HEVC/);
  assert.match(text, /source 2 of 3/);
  assert.match(text, /host  media\.example\.org/);
  assert.match(text, /file  Dune\.2024\.2160p\.mkv/);
  assert.ok(!/SECRET|token=/.test(text), 'the query never appears');
  assert.match(text, /#0 AUDIO  \{"fourCC":"A_DTS"\}/);
  assert.match(text, /chose #1 AC3/);
  assert.match(text, /\d\d:\d\d:\d\d\.\d{3} WARN {2}player {3}seek failed/);
  assert.equal(report.find((s) => s.title === 'PLAYER ERRORS').lines[0].level, 'error');
});

test('the Diagnostics report with nothing played yet says so, in every section', () => {
  const report = buildReport({ log: createLogger(), diag: createDiag().snapshot(), device: null });
  const text = report.map((s) => s.lines.map((l) => l.text).join('\n')).join('\n');
  assert.match(text, /No device profile yet/);
  assert.match(text, /Nothing has been played yet/);
  assert.match(text, /Not read yet/);
  assert.match(text, /None yet/);
  assert.match(text, /The log is empty/);
});

test('a track list that is not a list (Tizen 5.5 "notSet") is shown as it came', () => {
  const diag = createDiag();
  diag.setStream({ url: 'https://h/f.mkv' });
  diag.setTracks('notSet');
  const report = buildReport({ log: createLogger(), diag: diag.snapshot() });
  assert.match(report.find((s) => s.title.startsWith('AVPLAY')).lines[0].text, /"notSet"/);
});

import { makeEngine, stream, severanceMeta } from './helpers.js';

test('the top-left name is the title\'s name, else the meta\'s, never a bare IMDb id', async () => {
  const a = makeEngine({ sources: [stream('X')], params: { name: 'tt11280740' }, meta: severanceMeta() });
  await a.start(); await a.advance(100);
  assert.equal(a.engine.titleInfo().name, 'Severance', 'an id in the params is skipped for the meta\'s name');
  const b = makeEngine({ sources: [stream('X')], params: { name: 'tt11280740' } });
  await b.start();
  assert.equal(b.engine.titleInfo().name, '', 'with no real name: nothing');
  const c = makeEngine({ sources: [stream('X')], params: { name: 'Dune: Part Two' } });
  assert.equal(c.engine.titleInfo().name, 'Dune: Part Two');
});
