// The file hash: a stream without a videoHash gets one from the platform (avplay.fileHash) after the picture is on, and the subtitle
// add-ons are asked again with it. Never blocks playback; one try per source.
import assert from 'node:assert/strict';
import { both, makeEngine, stream } from './helpers.js';
import { clearSubtitleCache } from '../../src/player/subtitle-fetch.js';

const recorder = (requests) => ({ name: 'Rec', base: 'rec', serves: () => true, subtitles: async (t, v, extra) => { requests.push(extra); return []; } });
const decisions = (t) => t.diag.snapshot().decisions.map((d) => d.text);

async function run(fileHash, source = stream('Film')) {
  clearSubtitleCache();
  const requests = [];
  const t = makeEngine({ sources: [source] });
  t.stremio.addons = async () => [recorder(requests)];
  if (fileHash !== undefined) t.avplay.fileHash = fileHash;
  await t.start();
  await t.advance(10000);
  return { t, requests };
}

both('file hash: computed, the add-ons are asked again with the videoHash', async () => {
  const asked = [];
  const { t, requests } = await run(async (url, size) => { asked.push(url); return '8e245d9679d31e12'; });
  assert.equal(asked.length, 1);
  assert.ok(/^https?:\/\//.test(asked[0]));
  assert.equal(requests.length, 2);
  assert.ok(!/videoHash/.test(requests[0]));
  assert.ok(/^videoHash=8e245d9679d31e12/.test(requests[1]), requests[1]);
  assert.ok(decisions(t).some((d) => /^file hash: computed in \d+ ms$/.test(d)));
});

both('file hash: failure is a decide line and the add-ons are not asked again', async () => {
  const { t, requests } = await run(async () => { throw new Error('HTTP 403 for https://host/x?token=secret'); });
  assert.equal(requests.length, 1);
  const line = decisions(t).find((d) => /^file hash: failed/.test(d));
  assert.ok(line, 'a failed line');
  assert.ok(!/secret|host/.test(line), line);
});

both('file hash: no answer in 8 s is a timeout, playback was never held', async () => {
  const { t, requests } = await run(() => new Promise(() => {}));
  assert.equal(requests.length, 1);
  assert.ok(decisions(t).some((d) => /^file hash: failed \(timeout\)$/.test(d)));
  assert.equal(t.playState(), 'PLAYING');
});

both('file hash: a stream that carries a videoHash is not hashed', async () => {
  let calls = 0;
  const s = stream('Film', {}, { filename: 'Film.mkv', size: 5 });
  s.videoHash = 'abc';
  const { t } = await run(async () => { calls++; return 'ffffffffffffffff'; }, s);
  assert.equal(calls, 0);
  assert.ok(!decisions(t).some((d) => /^file hash/.test(d)));
});

both('file hash: without the capability (a browser) the engine says so', async () => {
  const { t, requests } = await run(null);
  assert.equal(requests.length, 1);
  assert.ok(decisions(t).some((d) => d === 'file hash: not available in a browser'));
});

both('file hash: the size hint was wrong, the real one is logged once and sent on to the add-ons', async () => {
  const hinted = stream('Film', {}, { filename: 'Film.mkv', size: 5 });
  const { t, requests } = await run(async () => ({ hash: '8e245d9679d31e12', size: 3000000 }), hinted);
  assert.equal(requests.length, 2);
  assert.equal(requests[1], 'videoHash=8e245d9679d31e12&videoSize=3000000&filename=Film.mkv');
  assert.equal(decisions(t).filter((d) => d === 'file hash: size hint was wrong (5 vs 3000000)').length, 1);
});

both('file hash: a right hint says nothing about it', async () => {
  const hinted = stream('Film', {}, { filename: 'Film.mkv', size: 3000000 });
  const { t } = await run(async () => ({ hash: '8e245d9679d31e12', size: 3000000 }), hinted);
  assert.ok(!decisions(t).some((d) => /size hint/.test(d)));
});
