import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SourceFinder, streamAddonsFor, GAP_WAIT_MS } from '../../src/core/finder.js'
import { createRanker } from '../../src/core/ranking.js'
import { Addon } from '../../src/core/addon.js'
import { fakeHttp, fixtureAddons, manualTime, settingsStub, stream, tv } from './helpers.js'

/** An add-on whose streams() answer is controlled by the test. */
function fakeAddon(name) {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { name, streams: () => promise, give: list => resolve(list), fail: e => reject(e) }
}
const tick = () => new Promise(r => setImmediate(r))

function setup({ count = 2, pick = false, settings } = {}) {
  const addons = Array.from({ length: count }, (_, i) => fakeAddon('addon' + i))
  const time = manualTime()
  const events = []
  const ranker = createRanker({ settings: settings || settingsStub(), device: tv(), memory: null, videoId: 'v', metaId: 'm' })
  const finder = new SourceFinder({
    addons, type: 'movie', videoId: 'v', ranker, pick, timers: time.timers,
    onPlay: streams => events.push(['play', streams.map(s => s.filename)]),
    onList: model => events.push(['list', model.streams.map(s => s.filename), model]),
    onStatus: code => events.push(['status', code]),
  })
  return { addons, time, events, finder }
}
const web = n => stream(`Movie.1080p.WEB-DL.DDP5.1.x264-${n}.mkv`)

test('one add-on answers: play at once with the best three, in rank order', async () => {
  const { addons, finder, events } = setup({ count: 1 })
  finder.start()
  addons[0].give([web('A'), web('B'), web('C'), web('D'), web('E')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-A.mkv', 'Movie.1080p.WEB-DL.DDP5.1.x264-B.mkv', 'Movie.1080p.WEB-DL.DDP5.1.x264-C.mkv']]])
})

test('add-on order is kept: an earlier add-on that answers inside the 800 ms window plays first', async () => {
  const { addons, finder, events, time } = setup()
  finder.start()
  addons[1].give([web('LATE')])
  await tick()
  assert.deepEqual(events, []) // the earlier add-on has not answered yet: wait
  assert.equal(time.pending(), 1) // the 800 ms timer
  time.advance(GAP_WAIT_MS - 100)
  addons[0].give([web('FIRST')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-FIRST.mkv', 'Movie.1080p.WEB-DL.DDP5.1.x264-LATE.mkv']]])
  time.advance(2000) // the timer must not fire a second play
  assert.equal(events.length, 1)
})

test('after 800 ms a playable later answer starts without the slow earlier add-on', async () => {
  const { addons, finder, events, time } = setup()
  finder.start()
  addons[1].give([web('LATE')])
  await tick()
  time.advance(GAP_WAIT_MS - 1)
  assert.deepEqual(events, [])
  time.advance(1)
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-LATE.mkv']]])
  addons[0].give([web('TOO-LATE')]) // ignored: playing already
  await tick()
  assert.equal(events.length, 1)
})

test('a later answer with nothing wanted does not start the 800 ms wait', async () => {
  const { addons, finder, events, time } = setup()
  finder.start()
  addons[1].give([stream('Movie.2024.HDCAM.x264.mkv'), stream('mark.mp4', { size: 1000 })])
  await tick()
  assert.equal(time.pending(), 0)
  assert.deepEqual(events, [])
})

test('every add-on empty or unplayable: the list opens (with cams and no-sound sources shown)', async () => {
  const { addons, finder, events } = setup()
  finder.start()
  addons[0].give([])
  await tick()
  assert.deepEqual(events, [])
  addons[1].give([stream('Movie.2024.HDCAM.x264.mkv'), stream('Movie.1080p.DTS.mkv')])
  await tick()
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'list')
  assert.deepEqual(events[0][1], ['Movie.2024.HDCAM.x264.mkv', 'Movie.1080p.DTS.mkv'])
  assert.equal(events[0][2].best, null) // the cam is not wanted, the DTS one has no sound
})

test('only no-sound sources: no auto-play, the list shows them with the tag', async () => {
  const { addons, finder, events } = setup({ count: 1 })
  finder.start()
  addons[0].give([stream('Movie.2160p.UHD.BluRay.REMUX.TrueHD.Atmos.mkv'), stream('Movie.1080p.BluRay.DTS-HD.MA.mkv')])
  await tick()
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'list')
  assert.deepEqual(events[0][2].rows.map(r => r.warnings[0]), ['No sound on this TV', 'No sound on this TV'])
})

test('a no-sound source never starts ahead of a playable one from a later add-on', async () => {
  const { addons, finder, events } = setup()
  finder.start()
  addons[0].give([stream('Movie.2160p.REMUX.TrueHD.mkv')])
  await tick()
  assert.deepEqual(events, []) // nothing to play from add-on 0, add-on 1 pending
  addons[1].give([web('GOOD')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-GOOD.mkv']]])
})

test('pick (hold OK on Play): never plays, lists once everything answered', async () => {
  const { addons, finder, events, time } = setup({ pick: true })
  finder.start()
  addons[0].give([web('A')])
  await tick()
  assert.deepEqual(events, [])
  assert.equal(time.pending(), 0)
  addons[1].give([web('B')])
  await tick()
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'list')
  assert.equal(events[0][2].best.filename, 'Movie.1080p.WEB-DL.DDP5.1.x264-A.mkv')
})

test('an add-on that fails just has no sources', async () => {
  const { addons, finder, events } = setup()
  finder.start()
  addons[0].fail(new Error('timeout'))
  addons[1].give([web('B')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-B.mkv']]])
})

test('no stream add-ons: a status, nothing else', () => {
  const { finder, events } = setup({ count: 0 })
  finder.start()
  assert.deepEqual(events, [['status', 'no-addons']])
})

test('cancel (the screen was left) stops the pending wait and any later play', async () => {
  const { addons, finder, events, time } = setup()
  finder.start()
  addons[1].give([web('LATE')])
  await tick()
  assert.equal(time.pending(), 1)
  finder.cancel()
  assert.equal(time.pending(), 0)
  addons[0].give([web('FIRST')])
  await tick()
  time.advance(5000)
  assert.deepEqual(events, [])
})

test('Settings limits apply to auto-play: Highest quality 1080p skips 4K', async () => {
  const { addons, finder, events } = setup({ count: 1, settings: settingsStub({ maxHeight: () => 1080 }) })
  finder.start()
  addons[0].give([stream('Movie.2160p.WEB-DL.DDP5.1.HDR.mkv'), web('HD')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-HD.mkv']]])
})

// ---- which add-ons are asked ----
const stremioFor = (lists, http) => ({
  addons: async key => { if (!lists[key]) throw new Error('offline'); return lists[key] },
  savedAddons: key => (lists.saved && lists.saved[key]) || null,
})

test('streamAddonsFor: the account\'s own stream add-ons that serve the video', async () => {
  const http = fakeHttp()
  const own = fixtureAddons(http)
  const list = await streamAddonsFor(stremioFor({ ME: own }), 'ME', [], 'movie', 'tt15239678')
  assert.deepEqual(list.map(a => a.name), ['Torrentio', 'AIOStreams (example)', 'Watchly (example)'])
  const episode = await streamAddonsFor(stremioFor({ ME: own }), 'ME', [], 'series', 'tt11280740:1:4')
  assert.deepEqual(episode.map(a => a.name), ['Torrentio', 'AIOStreams (example)', 'Watchly (example)'])
  const none = await streamAddonsFor(stremioFor({ ME: own }), 'ME', [], 'movie', 'yt_id:abc')
  assert.deepEqual(none, [])
})

test('streamAddonsFor: lenders\' shareable stream add-ons come first; the same add-on id is asked once', async () => {
  const http = fakeHttp()
  const mine = fixtureAddons(http).filter(a => a.name === 'Torrentio' || a.name === 'Cinemeta')
  const extra = new Addon({ transportUrl: 'https://debrid.example.org/manifest.json', manifest: { id: 'org.example.debrid', name: 'Debrid Search', resources: ['stream'], types: ['movie'], idPrefixes: ['tt'] } }, { http })
  const personal = fixtureAddons(http).find(a => a.name === 'Watchly (example)')
  const theirs = [fixtureAddons(http).find(a => a.name === 'Torrentio'), extra, personal, fixtureAddons(http).find(a => a.name === 'Cinemeta')]
  const stremio = stremioFor({ ME: mine, THEM: theirs })
  const list = await streamAddonsFor(stremio, 'ME', [{ authKey: 'THEM' }], 'movie', 'tt15239678')
  // theirs: Torrentio, Debrid Search (Watchly is personal, Cinemeta is official); mine adds nothing new (Torrentio is already there)
  assert.deepEqual(list.map(a => a.name), ['Torrentio', 'Debrid Search'])
  assert.equal(list[0], theirs[0]) // the lender's instance is the one used
})

test('streamAddonsFor: a lender that cannot be read is skipped; saved lists are used first', async () => {
  const http = fakeHttp()
  const mine = fixtureAddons(http).filter(a => a.name === 'AIOStreams (example)')
  const savedTheirs = fixtureAddons(http).filter(a => a.name === 'Torrentio')
  const stremio = stremioFor({ ME: mine, saved: { THEM: savedTheirs } })
  const list = await streamAddonsFor(stremio, 'ME', [{ authKey: 'GONE' }, { authKey: 'THEM' }], 'movie', 'tt15239678')
  assert.deepEqual(list.map(a => a.name), ['Torrentio', 'AIOStreams (example)'])
})
