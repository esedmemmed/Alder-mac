// Add-on subtitles: the add-on list is refreshed (cache if that fails), one failing add-on does not stop the others, Diagnostics knows.
import assert from 'node:assert/strict';
import { both, makeEngine, stream } from './helpers.js';
import { Subtitle } from '../../src/core/addon.js';
import { buildReport } from '../../src/screens/diagnostics.js';

const addon = (name, answer) => ({ name, serves: () => true, subtitles: async () => { if (answer instanceof Error) throw answer; return answer.map((l, i) => new Subtitle(`https://${name}/${l}${i}.srt`, l, name)); } });

async function run(addons, refresh) {
  const t = makeEngine({ sources: [stream('Film')] });
  const asked = [];
  t.stremio.addons = async (key, fresh) => { asked.push(!!fresh); if (fresh && refresh instanceof Error) throw refresh; return fresh ? refresh : addons; };
  await t.start();
  await t.advance(10);
  return { t, asked, subs: t.engine.tracks().addonSubs };
}

both('add-on subtitles: an add-on only the refreshed list has is asked', async () => {
  const { subs, asked } = await run([addon('Old', ['eng'])], [addon('Old', ['eng']), addon('New', ['eng'])]);
  assert.deepEqual(asked, [true]);
  assert.deepEqual(subs.map((s) => s.addon), ['Old', 'New']);
});

both('add-on subtitles: the refresh fails, the cached list is used', async () => {
  const { subs, asked, t } = await run([addon('Cached', ['eng'])], new Error('offline'));
  assert.deepEqual(asked, [true, false]);
  assert.deepEqual(subs.map((s) => s.addon), ['Cached']);
  assert.ok(t.log.some((l) => /refresh failed/.test(l)));
});

both('add-on subtitles: one failing add-on, the others load, Diagnostics shows it without the URL', async () => {
  const list = [addon('Bad', new Error('GET https://secret.example/x?token=abc failed 500')), addon('Good', ['eng', 'eng'])];
  const { subs, t } = await run(list, list);
  assert.deepEqual(subs.map((s) => s.addon), ['Good', 'Good']);
  const snap = t.diag.snapshot();
  assert.deepEqual(snap.subtitleAddons.map((a) => a.name).sort(), ['Bad', 'Good']);
  const lines = buildReport({ log: { lines: () => [] }, diag: snap }).find((s) => s.title === 'SUBTITLE ADD-ONS').lines.map((l) => l.text);
  assert.ok(lines.some((l) => /^Good: 2 found/.test(l)));
  assert.ok(lines.some((l) => /^Bad: failed/.test(l)));
  assert.ok(!lines.join(' ').includes('secret.example'));
});
