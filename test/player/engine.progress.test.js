// Progress (tick 10 s, push 60 s), resume, stalls, Up next, Skip intro, suspend: the rest of PlayerActivity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, stream, libraryItem, severanceMeta } from './helpers.js';
import { PLAYER, upNextWindow } from '../../src/core/playback.js';

const FILM = 5400000;

test('constants are Alder\'s', () => {
  assert.deepEqual([PLAYER.TICK, PLAYER.RESUME_SLACK, PLAYER.SKIP, PLAYER.SEEK_SETTLE, PLAYER.SKIP_SHOWN, PLAYER.HIDE, PLAYER.START_WAIT, PLAYER.RETRIES, PLAYER.RETRY_WAIT, PLAYER.TRY],
    [10000, 10000, 10000, 600, 10000, 5000, 12000, 2, 1500, 3]);
});

test('progress: recorded every 10 s, pushed to Stremio every 60 s', async () => {
  const t = makeEngine({ sources: [stream('Film')], item: libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } }) });
  await t.start();
  await t.advance(9900);
  assert.equal(t.item.state.timeOffset, 0, 'nothing recorded before the first tick');
  await t.advance(200); // t = 10.1 s
  const first = t.item.state.timeOffset;
  assert.ok(first > 8000 && first < 10100, 'position at the first tick: ' + first);
  assert.equal(t.item.state.duration, FILM);
  assert.equal(t.item.state.video_id, 'tt15239678');
  assert.equal(t.item.state.timeWatched, first, 'all of it was viewed, so all of it is watched time');
  await t.advance(10000);
  assert.ok(t.item.state.timeOffset > first + 9000, 'the second tick moved on');
  assert.ok(Math.abs(t.item.state.timeWatched - t.item.state.timeOffset) < 50, 'watched time follows the position');
  assert.equal(t.puts.length, 0, 'no push yet (5 ticks)');
  await t.advance(40000); // 60.1 s: the 6th tick
  assert.equal(t.puts.length, 1, 'pushed at the sixth tick');
  assert.equal(t.puts[0].at, 60000);
  assert.equal(t.puts[0].items.length, 1);
  assert.equal(t.puts[0].items[0]._id, 'tt15239678');
  assert.equal(t.puts[0].items[0].state.timeOffset, t.item.state.timeOffset, 'the pushed copy has the progress');
  await t.advance(60000);
  assert.equal(t.puts.length, 2, 'and again a minute later');
  assert.equal(t.puts[1].at, 120000);
});

test('a seek is not watched time: the jump moves the position but not timeWatched', async () => {
  const t = makeEngine({ sources: [stream('Film')], item: libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } }) });
  await t.start();
  await t.advance(10100);
  const before = t.item.state.timeWatched;
  t.engine.scrub(600000);
  await t.advance(700); // SEEK_SETTLE = 600 ms
  assert.equal(t.callsOf('seekTo').filter((c) => c.args[0] > 500000).length, 1, 'one seek after the presses stop');
  await t.advance(10000);
  assert.ok(t.item.state.timeOffset > 600000, 'the position is after the jump: ' + t.item.state.timeOffset);
  assert.ok(t.item.state.timeWatched - before < 25000, 'watched time grew by one tick, not by 10 minutes: ' + (t.item.state.timeWatched - before));
});

test('scrub: presses within SEEK_SETTLE add up and make one seek', async () => {
  const t = makeEngine({ sources: [stream('Film')] });
  await t.start();
  await t.advance(3000);
  const here = t.av.__mock.position;
  t.engine.scrub(10000); await t.advance(200);
  t.engine.scrub(10000); await t.advance(200);
  t.engine.scrub(-10000); await t.advance(200);
  t.engine.scrub(30000);
  assert.equal(t.callsOf('seekTo').length, 0 + 0, 'no seek while the presses go on (only the resume seek, which is 0 here)');
  assert.equal(t.engine.snapshot().scrubbing, true);
  assert.ok(Math.abs(t.engine.snapshot().position - (here + 40000)) < 600, 'the bar shows the target at once');
  await t.advance(700);
  const seeks = t.callsOf('seekTo');
  assert.equal(seeks.length, 1);
  assert.ok(Math.abs(seeks[0].args[0] - (here + 40000)) < 1500, 'target ' + seeks[0].args[0]);
  assert.equal(t.engine.snapshot().scrubbing, false);
});

test('scrub is bounded by the length of the film', async () => {
  const t = makeEngine({ sources: [stream('Film', { duration: 100 })] });
  await t.start();
  await t.advance(2000);
  t.engine.scrub(10 * 60000);
  await t.advance(700);
  assert.deepEqual(t.callsOf('seekTo').map((c) => c.args[0]), [99000], 'duration - 1 s');
  t.engine.scrub(-10 * 60000);
  await t.advance(700);
  assert.equal(t.callsOf('seekTo').pop().args[0], 0);
});

test('nothing is saved until a picture shows', async () => {
  const t = makeEngine({ sources: [stream('Dead', { start: 'never' })], params: { picked: true }, item: libraryItem() });
  const original = JSON.parse(JSON.stringify(t.item));
  await t.start();
  await t.advance(130000);
  assert.equal(t.puts.length, 0, 'no push, though 2 minutes passed');
  assert.deepEqual(t.item.state, original.state, 'the library item is untouched');
  t.engine.exit();
  assert.equal(t.puts.length, 0, 'and none on the way out');
  assert.equal(t.item.state.timeOffset, original.state.timeOffset);
});

test('nothing is saved for a series stream shorter than two minutes (an add-on placeholder)', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: { video_id: 'tt11280740:1:4', timeOffset: 840000, duration: 3000000 } });
  const t = makeEngine({ sources: [stream('Placeholder', { duration: 90 })], params: { type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4' }, item: it, meta });
  await t.start();
  await t.advance(30000);
  assert.equal(it.state.timeOffset, 840000);
  assert.equal(t.puts.length, 0);
});

test('a placeholder that ends moves on to the next source from the original resume point', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: { video_id: 'tt11280740:1:4', timeOffset: 840000, duration: 3000000 } });
  const t = makeEngine({ sources: [stream('Placeholder', { duration: 30 }), stream('Real')], params: { type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4' }, item: it, meta, saved: it });
  await t.start();
  await t.advance(40000);
  assert.equal(t.opens().length, 2);
  assert.ok(/Real/.test(t.opens()[1].args[0]));
  const seeks = t.callsOf('seekTo').map((c) => c.args[0]);
  assert.deepEqual(seeks, [29000, 840000], 'the first is clamped to the 30 s placeholder; the next source starts from the resume point, not the placeholder\'s end');
});

test('stopped on exit: past the credits the film is finished and a series moves on to the next episode', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: { video_id: 'tt11280740:1:4', timeOffset: 0, duration: 0 } });
  const t = makeEngine({ sources: [stream('Ep', { duration: 600 })], params: { type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4', resumeAt: 590000 }, item: it, meta });
  await t.start();
  await t.advance(5000);
  assert.ok(t.item.state.timeOffset === 0 || t.item.state.timeOffset > 580000);
  t.engine.exit();
  assert.equal(t.item.state.video_id, 'tt11280740:1:5', 'the next episode');
  assert.equal(t.item.state.timeOffset, 1, 'stremio-core marker: start the next one');
  assert.equal(t.puts.length, 1, 'pushed on the way out');
  assert.equal(t.puts[0].items[0].state.video_id, 'tt11280740:1:5');
  assert.equal(t.events.navigate[0].kind, 'exit');
  assert.equal(t.av.getState(), 'NONE', 'AVPlay closed');
});

test('exit mid-film saves the place without finishing it', async () => {
  const t = makeEngine({ sources: [stream('Film')], item: libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } }) });
  await t.start();
  await t.advance(25000);
  t.engine.exit();
  assert.equal(t.puts.length, 1);
  assert.ok(t.item.state.timeOffset > 23000 && t.item.state.timeOffset < 26000, 'saved the position at exit: ' + t.item.state.timeOffset);
  assert.equal(t.puts[0].items[0].state.timeOffset, t.item.state.timeOffset);
  await t.advance(70000);
  assert.equal(t.puts.length, 1, 'nothing after exit');
});

// ---- resume ----

test('resume: Library.resumeAt of the saved item starts the stream at once', async () => {
  const saved = libraryItem({ state: { timeOffset: 100000, duration: FILM, video_id: 'tt15239678' } });
  const t = makeEngine({ sources: [stream('Film')], saved, item: libraryItem({ state: { timeOffset: 100000, duration: FILM, video_id: 'tt15239678' } }), libraryDelay: 5000 });
  await t.start();
  await t.advance(1000);
  assert.deepEqual(t.callsOf('seekTo').map((c) => c.args[0]), [100000], 'did not wait for the account');
});

test('resume slack: Stremio says elsewhere (> 10 s apart) before the picture: start from there', async () => {
  const saved = libraryItem({ state: { timeOffset: 100000, duration: FILM, video_id: 'tt15239678' } });
  const fresh = libraryItem({ state: { timeOffset: 300000, duration: FILM, video_id: 'tt15239678' } });
  const t = makeEngine({ sources: [stream('Film')], saved, item: fresh });
  await t.start();
  await t.advance(1500);
  assert.deepEqual(t.callsOf('seekTo').map((c) => c.args[0]), [300000]);
});

test('resume slack: within 10 s, the TV\'s own copy stands', async () => {
  const saved = libraryItem({ state: { timeOffset: 100000, duration: FILM, video_id: 'tt15239678' } });
  const fresh = libraryItem({ state: { timeOffset: 109000, duration: FILM, video_id: 'tt15239678' } });
  const t = makeEngine({ sources: [stream('Film')], saved, item: fresh });
  await t.start();
  await t.advance(3000);
  assert.deepEqual(t.callsOf('seekTo').map((c) => c.args[0]), [100000]);
});

test('resume slack: a late answer moves a stream that has barely started, not one that has been watched', async () => {
  const mk = (delay) => makeEngine({
    sources: [stream('Film')],
    saved: libraryItem({ state: { timeOffset: 100000, duration: FILM, video_id: 'tt15239678' } }),
    item: libraryItem({ state: { timeOffset: 300000, duration: FILM, video_id: 'tt15239678' } }),
    libraryDelay: delay,
  });
  const soon = mk(2500);
  await soon.start(); await soon.advance(5000);
  assert.deepEqual(soon.callsOf('seekTo').map((c) => c.args[0]), [100000, 300000], 'a few seconds in: goes to where the phone got to');
  const late = mk(20000);
  await late.start(); await late.advance(25000);
  assert.deepEqual(late.callsOf('seekTo').map((c) => c.args[0]), [100000], 'already 19 s further on: stays');
});

test('resume: params win over the account (a lower-quality switch carries its own second); Start Over is 0', async () => {
  const fresh = libraryItem({ state: { timeOffset: 300000, duration: FILM, video_id: 'tt15239678' } });
  const a = makeEngine({ sources: [stream('Film')], item: fresh, params: { resumeAt: 42000 } });
  await a.start(); await a.advance(2000);
  assert.deepEqual(a.callsOf('seekTo').map((c) => c.args[0]), [42000]);
  const b = makeEngine({ sources: [stream('Film')], item: fresh, params: { startOver: true, resumeAt: 42000 } });
  await b.start(); await b.advance(2000);
  assert.equal(b.callsOf('seekTo').length, 0, 'from the beginning: no seek at all');
});

test('resume: a finished film (past 90%) starts from the beginning; a different video id too', async () => {
  const done = libraryItem({ state: { timeOffset: FILM * 0.95, duration: FILM, video_id: 'tt15239678' } });
  const t = makeEngine({ sources: [stream('Film')], item: done });
  await t.start(); await t.advance(2000);
  assert.equal(t.callsOf('seekTo').length, 0);
  const other = libraryItem({ state: { timeOffset: 100000, duration: FILM, video_id: 'tt0000000' } });
  const u = makeEngine({ sources: [stream('Film')], item: other });
  await u.start(); await u.advance(2000);
  assert.equal(u.callsOf('seekTo').length, 0);
});

test('when the library cannot be read the film still starts, and nothing is saved', async () => {
  const t = makeEngine({ sources: [stream('Film')], libraryFails: true });
  await t.start();
  await t.advance(70000);
  assert.equal(t.events.started.length, 1);
  assert.equal(t.puts.length, 0);
  t.engine.exit();
  assert.equal(t.puts.length, 0);
});

test('a title not in the library yet gets a temporary item (Stremio keeps those hidden)', async () => {
  const t = makeEngine({ sources: [stream('Film')], item: null, params: { name: 'New Film', poster: 'https://p/x.jpg' } });
  await t.start();
  await t.advance(12000);
  const s = t.engine.state.item;
  assert.ok(s && s.temp === true && s._id === 'tt15239678');
  assert.ok(s.state.timeOffset > 8000);
});

// ---- stalls ----

test('three stalls in a minute offer a lower quality, once', async () => {
  const t = makeEngine({ sources: [stream('Dune 2160p', { stall: '10:3,20:3,30:3,40:3' })] });
  await t.start();
  await t.advance(30000);
  assert.equal(t.events.stall.length, 0, 'two stalls so far');
  await t.advance(12000);
  assert.equal(t.events.stall.length, 1, 'the third (at 30 s of film)');
  assert.equal(t.events.stall[0].height, 2160);
  assert.equal(t.events.stall[0].lower, 1080);
  await t.advance(15000);
  assert.equal(t.events.stall.length, 1, 'the fourth does not offer again');
  assert.equal(t.engine.state.offeringLower, true);
});

test('stalls spread over more than a minute do not offer anything', async () => {
  const t = makeEngine({ sources: [stream('Dune 2160p', { stall: '5:2,40:2,80:2,120:2' })] });
  await t.start();
  await t.advance(130000);
  assert.equal(t.events.stall.length, 0);
});

test('no lower quality to offer from 480p and below', async () => {
  const t = makeEngine({ sources: [stream('Dune 480p', { stall: '5:1,10:1,15:1' })] });
  await t.start();
  await t.advance(30000);
  assert.equal(t.events.stall.length, 0);
});

test('a buffering right after a seek is the seek, not a stall', async () => {
  const t = makeEngine({ sources: [stream('Dune 2160p')] });
  await t.start();
  await t.advance(3000);
  for (let i = 0; i < 4; i++) { t.engine.seekTo(1000000 + i * 60000); await t.advance(300); }
  assert.equal(t.events.stall.length, 0);
});

test('accepting the offer leaves for the sources page with the lower height and the same second', async () => {
  const t = makeEngine({ sources: [stream('Dune 2160p', { stall: '10:1,15:1,20:1' })] });
  await t.start();
  await t.advance(25000);
  assert.equal(t.events.stall.length, 1);
  t.engine.lowerQuality();
  const nav = t.events.navigate[0];
  assert.equal(nav.kind, 'sources');
  assert.equal(nav.maxHeight, 1080);
  assert.equal(nav.pick, false);
  assert.ok(nav.resumeAt > 18000 && nav.resumeAt < 30000, 'resumeAt ' + nav.resumeAt);
});

test('declining resets the offer: keeping the quality hides the card', async () => {
  const t = makeEngine({ sources: [stream('Dune 1080p', { stall: '10:1,15:1,20:1' })] });
  await t.start();
  await t.advance(25000);
  t.engine.dismissStall();
  assert.equal(t.events.stallHide.length, 1);
  assert.equal(t.engine.state.offeringLower, false);
});

test('Change stream leaves with the current second', async () => {
  const t = makeEngine({ sources: [stream('Film')] });
  await t.start();
  await t.advance(15000);
  t.engine.changeStream();
  const nav = t.events.navigate[0];
  assert.equal(nav.kind, 'sources');
  assert.equal(nav.pick, true);
  assert.ok(nav.resumeAt > 13000 && nav.resumeAt < 16000);
});

// ---- Up next ----

const EP4 = { type: 'series', metaId: 'tt11280740', videoId: 'tt11280740:1:4' };
const noSegments = { get: async () => '{}' };

test('Up next: offered in the last upNextWindow of the episode, from the episode list', async () => {
  assert.equal(upNextWindow(300000), 30000);
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: { video_id: 'tt11280740:1:4', timeOffset: 0, duration: 0 } });
  const t = makeEngine({ sources: [stream('Ep', { duration: 300 })], params: Object.assign({ resumeAt: 240000 }, EP4), item: it, meta, http: noSegments });
  await t.start();
  await t.advance(25000);
  assert.equal(t.events.upNext.length, 0, 'not yet: 265 s of 300');
  await t.advance(16000); // the tick at 40 s sees 280 s of 300
  assert.equal(t.events.upNext.length, 1);
  assert.equal(t.events.upNext[0].video.id, 'tt11280740:1:5');
  await t.advance(30000);
  assert.equal(t.events.upNext.length, 1, 'once');
});

test('Up next: IntroDB gives the credits, which is when it appears (the last minute at the earliest)', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: { video_id: 'tt11280740:1:4', timeOffset: 0, duration: 0 } });
  const http = { get: async () => JSON.stringify({ outro: { start_sec: 245, end_sec: 295 } }) };
  const t = makeEngine({ sources: [stream('Ep', { duration: 300 })], params: Object.assign({ resumeAt: 240000 }, EP4), item: it, meta, http });
  await t.start();
  await t.advance(3000);
  assert.equal(t.events.upNext.length, 0, 'at 243 s the credits have not started');
  await t.advance(4000);
  assert.equal(t.events.upNext.length, 1, 'credits at 245 s, 55 s from the end: now');
});

test('Up next: a film never shows it; neither does the last episode', async () => {
  const film = makeEngine({ sources: [stream('Film', { duration: 300 })], params: { resumeAt: 280000 } });
  await film.start(); await film.advance(15000);
  assert.equal(film.events.upNext.length, 0);
  const meta = severanceMeta();
  const last = meta.videos.filter((v) => v.season !== 0).pop();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: {} });
  const t = makeEngine({ sources: [stream('Ep', { duration: 300 })], params: { type: 'series', metaId: 'tt11280740', videoId: last.id, resumeAt: 280000 }, item: it, meta, http: noSegments });
  await t.start(); await t.advance(15000);
  assert.equal(t.events.upNext.length, 0, last.id + ' is not followed by an episode (specials do not count)');
});

test('Up next: Play now leaves for the next episode, with the one after it', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: {} });
  const t = makeEngine({ sources: [stream('Ep', { duration: 300 })], params: Object.assign({ resumeAt: 280000 }, EP4), item: it, meta, http: noSegments });
  await t.start();
  await t.advance(15000);
  assert.equal(t.events.upNext.length, 1);
  t.engine.playNext();
  const nav = t.events.navigate[0];
  assert.equal(nav.kind, 'next');
  assert.equal(nav.video.id, 'tt11280740:1:5');
  assert.equal(nav.afterVideoId, 'tt11280740:1:6');
});

test('Up next: "Watch the credits" keeps playing and the end of the stream then leaves without starting the next', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: {} });
  const t = makeEngine({ sources: [stream('Ep', { duration: 300 })], params: Object.assign({ resumeAt: 280000 }, EP4), item: it, meta, http: noSegments });
  await t.start();
  await t.advance(12000);
  t.engine.dismissUpNext();
  assert.equal(t.events.upNextHide.length, 1);
  await t.advance(15000);
  assert.equal(t.events.upNext.length, 1, 'not offered again');
  await t.advance(15000);
  assert.equal(t.events.navigate.length, 1);
  assert.equal(t.events.navigate[0].kind, 'exit');
});

test('end of an episode starts the next one on its own', async () => {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: {} });
  const t = makeEngine({ sources: [stream('Ep', { duration: 300 })], params: Object.assign({ resumeAt: 285000 }, EP4), item: it, meta, http: noSegments });
  await t.start();
  await t.advance(30000);
  assert.equal(t.events.navigate[0].kind, 'next');
  assert.equal(t.events.navigate[0].video.id, 'tt11280740:1:5');
  assert.equal(t.item.state.video_id, 'tt11280740:1:5');
});

// ---- Skip intro ----

const SEGMENTS = JSON.stringify({ recap: { start_sec: 0, end_sec: 20 }, intro: { start_sec: 52, end_sec: 128.4 }, outro: { start_sec: 280, end_sec: 295 } });

function skipEngine(resumeAt, extra = {}) {
  const meta = severanceMeta();
  const it = libraryItem({ id: 'tt11280740', type: 'series', state: {} });
  return makeEngine(Object.assign({ sources: [stream('Ep', { duration: 600 })], params: Object.assign({ resumeAt }, EP4), item: it, meta, http: { get: async () => SEGMENTS } }, extra));
}

test('Skip intro: the pill shows inside the intro, for 10 s, once', async () => {
  const t = skipEngine(60000);
  await t.start();
  await t.advance(1500);
  const shown = t.events.skip.filter((e) => e.visible);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].label, 'Skip intro');
  await t.advance(9000);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, true, 'still up before 10 s');
  await t.advance(1500);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, false, 'gone after SKIP_SHOWN');
  await t.advance(30000);
  assert.equal(t.events.skip.filter((e) => e.visible).length, 1, 'not offered again');
});

test('Skip intro: OK jumps to the end of the intro', async () => {
  const t = skipEngine(60000);
  await t.start();
  await t.advance(2000);
  assert.equal(t.engine.skipSegment(), true);
  await t.advance(500);
  const seeks = t.callsOf('seekTo').map((c) => c.args[0]);
  assert.equal(seeks[seeks.length - 1], 128400);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, false);
  assert.equal(t.engine.skipSegment(), false, 'nothing to skip now');
});

test('Skip recap comes first at the start of an episode', async () => {
  const t = skipEngine(1000);
  await t.start();
  await t.advance(1500);
  assert.equal(t.events.skip.filter((e) => e.visible)[0].label, 'Skip recap');
});

test('Skip intro: the controls take over, and a seek back into the intro offers it again', async () => {
  const t = skipEngine(60000);
  await t.start();
  await t.advance(1500);
  t.engine.setControlsShown(true);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, false);
  await t.advance(1500);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, false, 'hidden while the controls are up');
  t.engine.setControlsShown(false);
  await t.advance(1500);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, true, 'back when they go');
  await t.advance(11000);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, false);
  t.engine.seekTo(70000);
  await t.advance(2000);
  assert.equal(t.events.skip[t.events.skip.length - 1].visible, true, 'seeking back into the intro: offered again');
});

test('IntroDB failing changes nothing: no pill, and playing goes on', async () => {
  const t = skipEngine(60000, { http: { get: async () => { throw new Error('CORS'); } } });
  await t.start();
  await t.advance(5000);
  assert.equal(t.events.skip.filter((e) => e.visible).length, 0);
  assert.equal(t.events.started.length, 1);
});

test('IntroDB is only asked for series with an IMDb id', async () => {
  const asked = [];
  const http = { get: async (u) => { asked.push(u); return '{}'; } };
  const film = makeEngine({ sources: [stream('Film')], http });
  await film.start(); await film.advance(1000);
  assert.deepEqual(asked, []);
  const series = makeEngine({ sources: [stream('Ep')], http, params: EP4 });
  await series.start(); await series.advance(1000);
  assert.deepEqual(asked, ['https://api.introdb.app/segments?imdb_id=tt11280740&season=1&episode=4']);
});

// ---- hiding the app ----

test('suspend (the app was hidden): paused, progress saved and pushed; restore carries on from there', async () => {
  const t = makeEngine({ sources: [stream('Film')], item: libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } }) });
  await t.start();
  await t.advance(15000);
  t.engine.suspend();
  assert.equal(t.av.getState(), 'PAUSED');
  assert.equal(t.callsOf('suspend').length, 1);
  assert.equal(t.puts.length, 1);
  const saved = t.item.state.timeOffset;
  assert.ok(saved > 13000);
  await t.advance(60000);
  assert.equal(t.puts.length, 1, 'no ticks while hidden');
  assert.equal(t.item.state.timeOffset, saved);
  t.engine.resume();
  assert.equal(t.callsOf('restore').length, 1);
  await t.advance(11000);
  assert.equal(t.av.getState(), 'PAUSED', 'Alder stays paused after the app comes back');
  t.engine.play();
  await t.advance(21000);
  assert.ok(t.item.state.timeOffset > saved + 9000, 'ticks again');
});

test('play and pause', async () => {
  const t = makeEngine({ sources: [stream('Film')] });
  await t.start();
  await t.advance(3000);
  t.engine.togglePlay();
  assert.equal(t.av.getState(), 'PAUSED');
  assert.equal(t.events.playing[t.events.playing.length - 1].playing, false);
  const frozen = t.av.__mock.position;
  await t.advance(5000);
  assert.equal(t.av.__mock.position, frozen);
  t.engine.togglePlay();
  assert.equal(t.av.getState(), 'PLAYING');
  assert.equal(t.events.playing[t.events.playing.length - 1].playing, true);
});

test('history is written onto this title\'s own library item, never onto another one the answer happens to list first', async () => {
  // Stremio is asked for one id and answers with that item; a server (or a fixture) that lists others too must not make the
  // first of them the item that gets the progress.
  const other = libraryItem({ id: 'tt0000001', type: 'movie' });
  const mine = libraryItem({ state: { timeOffset: 0, duration: 0, video_id: null } });
  const t = makeEngine({ sources: [stream('Film')], item: mine, libraryList: [other, mine] });
  await t.start();
  await t.advance(70000);
  assert.ok(mine.state.timeOffset > 0, 'this title\'s item got the progress');
  assert.equal(other.state.timeOffset, 0, 'the other one is untouched');
  assert.ok(t.puts.length >= 1 && t.puts.every((p) => p.items.every((i) => i._id === 'tt15239678')), 'and only it was sent to Stremio');
});
