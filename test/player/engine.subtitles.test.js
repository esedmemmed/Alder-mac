// Add-on subtitles: the add-on list is refreshed (cache if that fails), one failing add-on does not stop the others, Diagnostics knows.
import assert from 'node:assert/strict';
import { both, makeEngine, stream } from './helpers.js';
import { Subtitle } from '../../src/core/addon.js';
import { buildReport } from '../../src/screens/diagnostics.js';
import { createStore, memoryStorage } from '../../src/lib/store.js';
import { createSourceMemory } from '../../src/core/ranking.js';
import { createSubtitleMemory } from '../../src/core/subtitle-memory.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';

const addon = (name, answer) => ({ name, serves: () => true, subtitles: async () => { if (answer instanceof Error) throw answer; return answer.map((l, i) => new Subtitle(`https://${name}/${l}${i}.srt`, l, name)); } });

async function run(addons, refresh) {
  clearSubtitleCache(); // the fetch keeps answers per add-on name and video id for ten minutes: each test asks afresh
  const t = makeEngine({ sources: [stream('Film')] });
  const asked = [];
  t.stremio.addons = async (key, fresh) => { asked.push(!!fresh); if (fresh && refresh instanceof Error) throw refresh; return fresh ? refresh : addons; };
  await t.start();
  await t.advance(10);
  return { t, asked, subs: t.engine.tracks().addonSubs };
}

both('add-on subtitles: an add-on only the refreshed list has is asked', async () => {
  const { subs, asked } = await run([addon('Old', ['eng'])], [addon('Old', ['eng']), addon('New', ['eng'])]);
  assert.deepEqual(asked, [true, false]); // the refreshed list, and the list in memory (both asked at once)
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

function recordingAddon(requests) { return { name: 'Rec', base: 'rec', serves: () => true, subtitles: async (t, v, extra) => { requests.push(extra); return []; } }; }
const hinted = (name, hash, file) => { const s = stream(name, {}, { filename: file, size: 5 }); s.videoHash = hash; return s; };

both('add-on subtitles: the playing file\'s details go to every add-on request', async () => {
  clearSubtitleCache();
  const requests = [];
  const t = makeEngine({ sources: [hinted('Film', 'h1', 'Film.mkv')] });
  t.stremio.addons = async () => [recordingAddon(requests)];
  await t.start();
  await t.advance(10);
  assert.deepEqual(requests, ['videoHash=h1&videoSize=5&filename=Film.mkv']);
  assert.ok(t.diag.snapshot().decisions.some((d) => /asked add-ons with the file's videoHash, videoSize, filename$/.test(d.text)));
});

both('add-on subtitles: failover to a source with other hints asks again, with identical hints does not', async () => {
  clearSubtitleCache();
  const requests = [];
  const t = makeEngine({ sources: [hinted('A', 'h1', 'A.mkv'), hinted('B', 'h2', 'B.mkv'), hinted('B2', 'h2', 'B.mkv')] });
  t.stremio.addons = async () => [recordingAddon(requests)];
  await t.start();
  await t.advance(3000);
  assert.equal(requests.length, 1);
  t.failNow('PLAYER_ERROR_CONNECTION_FAILED', 404);
  await t.advance(300);
  assert.equal(t.loads().length, 2);
  assert.deepEqual(requests, ['videoHash=h1&videoSize=5&filename=A.mkv', 'videoHash=h2&videoSize=5&filename=B.mkv']);
  t.failNow('PLAYER_ERROR_CONNECTION_FAILED', 404);
  await t.advance(300);
  assert.equal(t.loads().length, 3);
  assert.equal(requests.length, 2, 'identical hints: not asked again');
});

const FILE_TRACKS = {
  avplay: JSON.stringify([{ type: 'AUDIO', codec: 'AAC', lang: 'eng', channels: 2 }, { type: 'TEXT', codec: 'SRT', lang: 'eng' }, { type: 'TEXT', codec: 'SRT', lang: 'tur' }]),
  mpv: JSON.stringify([
    { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 },
    { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true },
    { type: 'sub', id: 1, lang: 'eng', title: 'English', codec: 'subrip', selected: false },
    { type: 'sub', id: 2, lang: 'tur', title: 'Turkish', codec: 'subrip', selected: false },
  ]),
};

both('subtitle language: Turkish add-on subtitles come first and the Turkish file track starts, with the TV in English', async (adapter) => {
  const t = makeEngine({ sources: [stream('Film', { tracks: FILE_TRACKS[adapter] })], tvLanguage: 'en' });
  t.store.set('settings/subLang@p1', 'tr');
  t.stremio.addons = async () => [addon('A', ['eng', 'tur'])];
  await t.start();
  await t.advance(3000);
  assert.deepEqual(t.engine.tracks().addonSubs.map((s) => s.lang), ['tur', 'eng']);
  const tr = t.engine.tracks();
  assert.equal(tr.subMode, 'file');
  assert.equal(tr.text.find((x) => x.index === tr.textIndex).language, 'tr');
});

both('subtitle language: without the setting the TV language decides', async (adapter) => {
  const t = makeEngine({ sources: [stream('Film', { tracks: FILE_TRACKS[adapter] })], tvLanguage: 'en' });
  t.stremio.addons = async () => [addon('A', ['tur', 'eng'])];
  await t.start();
  await t.advance(3000);
  assert.deepEqual(t.engine.tracks().addonSubs.map((s) => s.lang), ['eng', 'tur']);
  const tr = t.engine.tracks();
  assert.equal(tr.text.find((x) => x.index === tr.textIndex).language, 'en');
});

// ---- an add-on subtitle starts by itself when the profile picked a subtitle language and the file has none in it ----
const EN_FILE = {
  avplay: JSON.stringify([{ type: 'AUDIO', codec: 'AAC', lang: 'eng', channels: 2 }, { type: 'TEXT', codec: 'SRT', lang: 'eng' }]),
  mpv: JSON.stringify([
    { type: 'video', id: 1, codec: 'h264', selected: true, 'demux-w': 1920, 'demux-h': 1080 },
    { type: 'audio', id: 1, lang: 'eng', title: 'English', codec: 'aac', 'audio-channels': 2, selected: true },
    { type: 'sub', id: 1, lang: 'eng', title: 'English', codec: 'subrip', selected: false },
  ]),
};
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nhi\n';
function autoRig(adapter, { tracks = EN_FILE, subLang = 'tr', subtitlesOn = true, delay = 0 } = {}) {
  const memStore = createStore({ storage: memoryStorage() }); // the session's memory: the subtitle memory plans the start (the setting is its fallback)
  const memory = createSourceMemory(memStore);
  memory.subtitles = createSubtitleMemory(memStore, { report: () => {} });
  const t = makeEngine({ memory, sources: [stream('Film', { tracks: tracks[adapter] })], tvLanguage: 'en', http: { get: async () => SRT }, settings: { subtitles: subtitlesOn } });
  if (subLang) t.store.set('settings/subLang@p1', subLang);
  t.stremio.addons = async () => (delay ? new Promise((r) => t.clock.setTimeout(() => r([addon('A', ['eng', 'tur'])]), delay)) : [addon('A', ['eng', 'tur'])]);
  return t;
}

both('auto add-on start: no file track in the picked language, so the add-on one starts', async (adapter) => {
  const t = autoRig(adapter);
  await t.start();
  await t.advance(3000);
  const tr = t.engine.tracks();
  assert.equal(tr.subMode, 'addon');
  assert.equal(tr.chosenSub.lang, 'tur');
  assert.ok(t.diag.snapshot().decisions.some((d) => /memory: subtitles Turkish from A/.test(d.text)));
});

both('auto add-on start: a file track in the language wins, no add-on start', async (adapter) => {
  const t = autoRig(adapter, { tracks: FILE_TRACKS });
  await t.start();
  await t.advance(3000);
  assert.equal(t.engine.tracks().subMode, 'file');
  assert.ok(!t.diag.snapshot().decisions.some((d) => /memory: subtitles Turkish from A/.test(d.text)));
});

both('auto add-on start: not over a menu pick, not without the setting, not with subtitles off', async (adapter) => {
  const picked = autoRig(adapter, { delay: 2000 });
  await picked.start();
  await picked.advance(1000);
  await picked.engine.selectSubtitle({ kind: 'off' });
  await picked.advance(3000);
  assert.equal(picked.engine.tracks().subMode, 'off');
  const none = autoRig(adapter, { subLang: '' });
  await none.start();
  await none.advance(3000);
  assert.notEqual(none.engine.tracks().subMode, 'addon'); // the normal rule: the English file track
  const off = autoRig(adapter, { subtitlesOn: false });
  await off.start();
  await off.advance(3000);
  assert.equal(off.engine.tracks().subMode, 'off');
});

both('auto add-on start: the add-ons answering before the tracks are known start it once they are', async (adapter) => {
  const t = autoRig(adapter);
  await t.start();
  await t.advance(3000);
  assert.equal(t.engine.tracks().subMode, 'addon');
  assert.equal(t.diag.snapshot().decisions.filter((d) => /memory: subtitles Turkish from A/.test(d.text)).length, 1);
});

both('Diagnostics: the add-on and service of the stream and the file details sent', async () => {
  const s = hinted('Film', 'h1', 'Film.mkv');
  s.addonName = 'Torrentio';
  s.title = 'Torrentio TB+ 4K';
  const t = makeEngine({ sources: [s] });
  t.stremio.addons = async () => [addon('A', ['eng'])];
  await t.start();
  await t.advance(3000);
  const snap = t.diag.snapshot();
  assert.equal(snap.stream.addon, 'Torrentio');
  assert.equal(snap.stream.service, 'TorBox');
  assert.deepEqual(snap.subtitleExtra, ['videoHash', 'videoSize', 'filename']);
  const rep = buildReport({ log: { lines: () => [] }, diag: snap });
  assert.ok(rep.find((x) => x.title === 'STREAM').lines.some((l) => l.text === 'Add-on: Torrentio'));
  assert.ok(rep.find((x) => x.title === 'STREAM').lines.some((l) => l.text === 'Service: TorBox'));
  assert.equal(rep.find((x) => x.title === 'SUBTITLE ADD-ONS').lines[0].text, 'File details sent: videoHash, videoSize, filename');
});
