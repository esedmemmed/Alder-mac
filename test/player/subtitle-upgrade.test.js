// Subtitles start incrementally, so a fast add-on's subtitle can start before the remembered add-on (or one earlier in the account's order)
// answers. Within 15 s of the start, that better add-on's subtitle in the same language replaces it, once; never after a menu pick,
// never over a name match, never later than 15 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Subtitle } from '../../src/core/addon.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createReleaseMemory } from '../../src/core/release-memory.js';
import { createSubtitleMemory } from '../../src/core/subtitle-memory.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';
import { makeEngine, stream } from './helpers.js';

// a real subtitle has at least 5 cues (the engine skips message files)
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n' + [2, 3, 4, 5, 6].map((n) => '\n' + n + '\n01:0' + n + ':00,000 --> 01:0' + n + ':02,000\nlater ' + n + '\n').join('');
const OWN = 'Show.S01E02.1080p.WEB-DL.x264-GRP';
const plainStore = () => {
  const m = new Map();
  return { m, get: k => (m.has(k) ? m.get(k) : undefined), set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
};
// one add-on: its Turkish subtitle (id, optional file label), answered after `delay` ms
const addon = (clock, { name, delay = 0, label = null }) => ({
  name, serves: () => true,
  subtitles: () => new Promise((resolve) => clock.setTimeout(() => resolve([Object.assign(new Subtitle('https://' + name.toLowerCase() + '.example/t.srt', 'tur', name), { id: name + '1', label })]), delay)),
});

async function play(adapter, { addons, remembered = null, subLang = '', hand = null, ms = 40000 }) {
  clearSubtitleCache(); // the fetch keeps answers per add-on name and video id
  const store = plainStore();
  if (remembered) store.m.set('subs/tt9', remembered);
  const reports = [];
  const mem = createReleaseMemory(store, createSourceMemory(store), { report: () => {} });
  mem.subtitles = createSubtitleMemory(store, { report: l => { if (!/^match:/.test(l)) reports.push(l); } });
  const src = stream('Show S01E02 1080p WEB-DL x264-GRP');
  const t = makeEngine({ adapter, memory: mem, sources: [src], params: { type: 'series', metaId: 'tt9', videoId: 'tt9:1:2' }, http: { get: async () => SRT } });
  if (subLang) t.store.set('settings/subLang@p1', subLang);
  t.stremio.addons = async () => addons.map(a => addon(t.clock, a));
  await t.start();
  if (hand) { await t.advance(hand.at); await t.engine.selectSubtitle({ kind: 'addon', sub: t.engine.tracks().addonSubs.find(s => s.addon === hand.addon) }); }
  await t.advance(ms);
  const decisions = t.diag.snapshot().decisions.map(d => d.text || d);
  return { t, reports, chosen: () => (t.engine.tracks().chosenSub || {}).addon, switches: decisions.filter(d => /subtitles: switched to/.test(d)) };
}
const REMEMBERED_B = { kind: 'lang', language: 'tr', addon: 'B' };

for (const adapter of ['avplay', 'mpv']) {
  test('the remembered add-on B answers after A started: switches to B once, with the decide line [' + adapter + ']', async () => {
    const r = await play(adapter, { remembered: REMEMBERED_B, addons: [{ name: 'A' }, { name: 'B', delay: 500 }, { name: 'C', delay: 2000 }] });
    assert.equal(r.chosen(), 'B');
    assert.equal(r.switches.length, 1);
    assert.match(r.switches[0], /^subtitles: switched to B \(the one picked before\)$/);
    assert.deepEqual(r.reports.filter(l => /upgraded/.test(l)), ['memory: upgraded to=B']);
    assert.equal(r.t.log.filter(l => /switched to/.test(l)).length, 1, 'C answering later switches nothing');
  });

  test('the viewer picks from the menu before B answers: no switch [' + adapter + ']', async () => {
    const r = await play(adapter, { remembered: REMEMBERED_B, addons: [{ name: 'A' }, { name: 'B', delay: 500 }], hand: { at: 200, addon: 'A' } });
    assert.equal(r.chosen(), 'A');
    assert.equal(r.switches.length, 0);
  });

  test('B answers after more than 15 s: no switch [' + adapter + ']', async () => {
    const r = await play(adapter, { remembered: REMEMBERED_B, addons: [{ name: 'A' }, { name: 'B', delay: 16000 }] });
    assert.deepEqual(r.t.engine.tracks().addonSubs.map(s => s.addon), ['A', 'B'], 'B did answer, late');
    assert.equal(r.chosen(), 'A');
    assert.equal(r.switches.length, 0);
  });

  test('no memory, Turkish picked, account order [S slow, D instant]: D starts, S answers: switches to S (earlier in your add-ons) [' + adapter + ']', async () => {
    const r = await play(adapter, { subLang: 'tr', addons: [{ name: 'S', delay: 500 }, { name: 'D' }] });
    assert.equal(r.chosen(), 'S');
    assert.equal(r.switches.length, 1);
    assert.match(r.switches[0], /^subtitles: switched to S \(earlier in your add-ons\)$/);
    assert.deepEqual(r.reports.filter(l => /upgraded/.test(l)), ['memory: upgraded to=S']);
  });

  test('the started subtitle was a name match: no switch [' + adapter + ']', async () => {
    const r = await play(adapter, { remembered: REMEMBERED_B, addons: [{ name: 'A', label: OWN }, { name: 'B', delay: 500 }] });
    assert.equal(r.chosen(), 'A');
    assert.equal(r.switches.length, 0);
  });
}
