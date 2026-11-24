import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SourceFinder, streamAddonsFor, GAP_WAIT_MS } from '../../src/core/finder.js'
import { createRanker } from '../../src/core/ranking.js'
import { Addon, Stream } from '../../src/core/addon.js'
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
  const reports = []
  const ranker = createRanker({ settings: settings || settingsStub(), device: tv(), memory: null, videoId: 'v', metaId: 'm' })
  const finder = new SourceFinder({
    addons, type: 'movie', videoId: 'v', ranker, pick, timers: time.timers, now: time.now,
    onPlay: (streams, report) => { reports.push(report); events.push(['play', streams.map(s => s.filename)]) },
    onList: (model, report) => { reports.push(report); events.push(['list', model.streams.map(s => s.filename), model]) },
    onStatus: code => events.push(['status', code]),
  })
  return { addons, time, events, finder, reports }
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

test('each stream carries the name of the add-on it came from (not part of toJson)', async () => {
  const { addons, finder, events } = setup({ count: 2, pick: true })
  finder.start()
  const a = web('A'), b = web('B')
  addons[0].give([a])
  addons[1].give([b])
  await tick()
  assert.equal(a.addonName, 'addon0')
  assert.equal(b.addonName, 'addon1')
  assert.ok(!('addonName' in a.toJson()))
})

// ---- early start ----
const hot = n => stream(`Movie.1080p.WEB-DL.DDP5.1.x264-${n}.mkv`, { title: '[TB+] 1080p' })

test('early start: a cached, sound, fitting answer from a later add-on plays at once, without the 800 ms wait', async () => {
  const { addons, finder, events, time } = setup({ count: 3 })
  finder.start()
  addons[1].give([hot('FAST')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.1080p.WEB-DL.DDP5.1.x264-FAST.mkv']]])
  assert.equal(time.pending(), 0)
  addons[0].give([web('SLOW')]) // ignored: playing already
  await tick()
  assert.equal(events.length, 1)
})

test('early start: an uncached later answer still waits 800 ms', async () => {
  const { addons, finder, events, time } = setup({ count: 3 })
  finder.start()
  addons[1].give([web('PLAIN')])
  await tick()
  assert.deepEqual(events, [])
  assert.equal(time.pending(), 1)
})

test('early start: the remembered-release hold keeps its precedence', async () => {
  const addons = [fakeAddon('a0'), fakeAddon('a1'), fakeAddon('a2')]
  const time = manualTime()
  const events = []
  let held = 0
  const memory = { file: () => null, binge: () => null, level: () => 0, pending: () => true, noteHeld: () => { held++ } }
  const ranker = createRanker({ settings: settingsStub(), device: tv(), memory, videoId: 'v', metaId: 'm' })
  const finder = new SourceFinder({ addons, type: 'movie', videoId: 'v', ranker, timers: time.timers, onPlay: s => events.push(['play', s.length]), onList: () => {} })
  finder.start()
  addons[0].give([web('A0')]) // the first add-on answered without the remembered release: held
  await tick()
  assert.equal(held, 1)
  addons[1].give([hot('FAST')])
  await tick()
  assert.deepEqual(events, [])
  assert.equal(held, 1)
  time.advance(GAP_WAIT_MS)
  assert.deepEqual(events, [['play', 2]])
})

// ---- the report for Diagnostics ----
test('report: an early start says so, with one entry per add-on that answered (ms, count, error), and onPlay gets it', async () => {
  const { addons, finder, events, time, reports } = setup({ count: 3 })
  finder.start()
  time.advance(300)
  addons[1].give([hot('FAST'), web('B')])
  await tick()
  assert.equal(events.length, 1)
  assert.equal(reports[0], finder.report)
  assert.equal(finder.report.start, 'early (good cached source)')
  assert.deepEqual(finder.report.addons, [{ name: 'addon1', ms: 300, count: 2, error: null }])
  time.advance(200)
  addons[0].fail(new Error('boom'))
  await tick()
  assert.deepEqual(finder.report.addons[1], { name: 'addon0', ms: 500, count: 0, error: 'failed' })
})

test('report: a timeout says "timed out"; 800 ms gap start; all answered; list', async () => {
  const gap = setup()
  gap.finder.start()
  gap.addons[1].give([web('LATE')])
  await tick()
  gap.time.advance(GAP_WAIT_MS)
  assert.equal(gap.finder.report.start, 'gap 800 ms')
  assert.equal(gap.reports[0], gap.finder.report)
  gap.addons[0].fail(Object.assign(new Error('x'), { kind: 'timeout' }))
  await tick()
  assert.deepEqual(gap.finder.report.addons.map(a => [a.name, a.ms, a.count, a.error]), [['addon1', 0, 1, null], ['addon0', GAP_WAIT_MS, 0, 'timed out']])

  const all = setup()
  all.finder.start()
  all.addons[0].give([web('A')])
  await tick()
  assert.equal(all.finder.report.start, 'in add-on order') // add-on 0 was first in order: plays without waiting for add-on 1
  assert.equal(all.reports[0], all.finder.report)

  const done = setup()
  done.finder.start()
  done.addons[1].give([])
  done.addons[0].give([web('A')])
  await tick()
  assert.equal(done.finder.report.start, 'all answered')

  const list = setup({ count: 1 })
  list.finder.start()
  list.addons[0].give([stream('Movie.2024.HDCAM.x264.mkv')])
  await tick()
  assert.equal(list.finder.report.start, 'list')
  assert.equal(list.reports[0], list.finder.report)
  assert.equal(list.events[0][0], 'list')
})

// ---- anonymous sources (no resolution, no filename, no videoSize) never win the early or gap start ----
const smartPlay = () => new Stream('⚡ SmartPlay — Auto Verified [TB+]', '', 'https://flixnest.app/smart-play', {}, 0, null, null)
const cached1080 = n => stream(`Movie.2024.1080p.WEB-DL.DDP5.1.HEVC-${n}.mkv`, { title: '[TB+] 1080p' })

test('anonymous cached SmartPlay answers first: nothing starts until a named source answers, and that one is chosen', async () => {
  const { addons, time, events, finder, reports } = setup({ count: 3 })
  finder.start()
  addons[0].give([smartPlay()])
  await tick()
  time.advance(GAP_WAIT_MS)
  assert.deepEqual(events, [])
  time.advance(600) // 1400 ms: add-on B answers
  addons[1].give([cached1080('B')])
  await tick()
  assert.deepEqual(events, [['play', ['Movie.2024.1080p.WEB-DL.DDP5.1.HEVC-B.mkv', null]]]) // the anonymous one stays as the last fallback
  assert.equal(reports[0].start, 'early (good cached source)')
})

test('only an anonymous source exists: it plays once every add-on has answered', async () => {
  const { addons, time, events, finder } = setup({ count: 3 })
  finder.start()
  addons[0].give([smartPlay()])
  await tick()
  time.advance(GAP_WAIT_MS)
  addons[1].give([])
  await tick()
  assert.deepEqual(events, [])
  addons[2].give([])
  await tick()
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'play')
  assert.equal(events[0][1][0], null)
})
