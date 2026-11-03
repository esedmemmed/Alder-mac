import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { createLibrary, watchedIds } from '../../src/core/library.js'
import { Video, Meta } from '../../src/core/addon.js'
import { fixtureJson, manualTime } from './helpers.js'

const time = manualTime()
const lib = createLibrary({ now: time.now })
const NOW = '2026-10-29T12:00:00.000Z'

const vid = (season, episode, show = 'tt1') => new Video(`${show}:${season}:${episode}`, '', season, episode, null, null, null)
const season1 = n => Array.from({ length: n }, (_, i) => vid(1, i + 1))
const idsOf = set => Array.from(set).sort()

/** A watched field built with node:zlib, independent of pako: bit i of the list is (bits[i >> 3] >> (i & 7)) & 1. */
function field(anchor, anchorLength, setBits, totalBits = anchorLength) {
  const bytes = Buffer.alloc(Math.ceil(totalBits / 8))
  for (const b of setBits) bytes[b >> 3] |= 1 << (b & 7)
  return `${anchor}:${anchorLength}:${zlib.deflateSync(bytes, { level: 6 }).toString('base64')}`
}
const itemWith = watched => ({ _id: 'tt1', state: { watched } })

// ---- the watched bitfield ----

test('watched bitfield: a field built independently (node:zlib) is read as stremio-core defines it', () => {
  const videos = season1(10)
  const item = itemWith(field('tt1:1:10', 10, [0, 2, 9]))
  assert.deepEqual(idsOf(watchedIds(item, videos)), ['tt1:1:1', 'tt1:1:10', 'tt1:1:3'])
  assert.deepEqual(idsOf(lib.watched(item, videos)), ['tt1:1:1', 'tt1:1:10', 'tt1:1:3'])
})

test('watched bitfield: the demo account\'s library item (Severance S1E1-E3) with the special sorted first', () => {
  const item = fixtureJson('api.strem.io/api/datastoreGet.json').result.find(i => i._id === 'tt11280740')
  assert.match(item.state.watched, /^tt11280740:1:3:4:[A-Za-z0-9+/]+=*$/)
  const meta = new Meta(fixtureJson('v3-cinemeta.strem.io/meta/series/tt11280740.json').meta)
  assert.deepEqual(idsOf(watchedIds(item, meta.videos)), ['tt11280740:1:1', 'tt11280740:1:2', 'tt11280740:1:3'])
})

test('watched bitfield: new episodes after the anchor are not watched; the anchor holds its place', () => {
  const item = itemWith(field('tt1:1:5', 5, [0, 1, 4]))
  assert.deepEqual(idsOf(watchedIds(item, season1(5))), ['tt1:1:1', 'tt1:1:2', 'tt1:1:5'])
  assert.deepEqual(idsOf(watchedIds(item, season1(9))), ['tt1:1:1', 'tt1:1:2', 'tt1:1:5']) // E6-E9 are new
})

test('watched bitfield: an episode inserted before the anchor shifts the bits (anchor shift)', () => {
  // saved when the list was E1..E5 (anchor E5, length 5); now a special S0E1 sorts first, so everything moves one place
  const withSpecial = [vid(0, 1)].concat(season1(5))
  const item = itemWith(field('tt1:1:5', 5, [0, 1, 4]))
  assert.deepEqual(idsOf(watchedIds(item, withSpecial)), ['tt1:1:1', 'tt1:1:2', 'tt1:1:5'])
  // the opposite: the list lost its first episode (E1 withdrawn): offset grows, E2 and E5 stay ticked
  const lost = season1(5).slice(1)
  assert.deepEqual(idsOf(watchedIds(item, lost)), ['tt1:1:2', 'tt1:1:5'])
})

test('watched bitfield: anchor gone means nothing is watched; unreadable fields mean nothing too', () => {
  const videos = season1(5)
  assert.equal(watchedIds(itemWith(field('tt1:1:9', 9, [0, 8])), videos).size, 0) // anchor E9 is not in the list
  for (const bad of [null, '', 'tt1:1:5', 'tt1:1:5:notbase64!!', 'tt1:1:5:5:AAAA', 'tt1:1:x:eJzjAwAADwAP', 'justtext']) {
    assert.equal(watchedIds(itemWith(bad), videos).size, 0, String(bad))
  }
  assert.equal(watchedIds(null, videos).size, 0)
  assert.equal(watchedIds({ _id: 'x' }, videos).size, 0)
})

test('watched bitfield: ids that hold colons are rebuilt from every part before the last two', () => {
  const videos = [vid(1, 1, 'kitsu:123'), vid(1, 2, 'kitsu:123')]
  const item = itemWith(field('kitsu:123:1:2', 2, [1]))
  assert.deepEqual(idsOf(watchedIds(item, videos)), ['kitsu:123:1:2'])
})

test('watched bitfield: fewer stored bits than episodes never throws or ticks the missing ones', () => {
  const item = itemWith(field('tt1:1:3', 3, [0, 1, 2]))
  const got = watchedIds(item, season1(3))
  assert.equal(got.size, 3)
  const three = itemWith(`tt1:1:3:3:${zlib.deflateSync(Buffer.alloc(0)).toString('base64')}`)
  assert.equal(watchedIds(three, season1(3)).size, 0)
})

test('markWatched writes `anchor:length:base64(zlib)`; stremio-core can inflate it (bit i = episode i, low bit first)', () => {
  const item = { _id: 'tt1', state: { watched: null } }
  const videos = season1(10)
  lib.markWatched(item, videos, 'tt1:1:3')
  assert.match(item.state.watched, /^tt1:1:3:3:[A-Za-z0-9+/]+=*$/)
  const parts = item.state.watched.split(':')
  const raw = Buffer.from(parts[parts.length - 1], 'base64')
  assert.equal(raw[0], 0x78) // zlib header
  assert.equal(raw[1], 0x9c) // level 6 (Deflater(6) in Alder)
  assert.deepEqual(Array.from(zlib.inflateSync(raw)), [0b00000100, 0])
  lib.markWatched(item, videos, 'tt1:1:1')
  assert.equal(item.state.watched.startsWith('tt1:1:3:3:'), true) // the anchor is the last watched episode in list order
  assert.deepEqual(Array.from(zlib.inflateSync(Buffer.from(item.state.watched.split(':').pop(), 'base64'))), [0b00000101, 0])
  lib.markWatched(item, videos, 'tt1:1:10')
  assert.equal(item.state.watched.startsWith('tt1:1:10:10:'), true)
  assert.deepEqual(Array.from(zlib.inflateSync(Buffer.from(item.state.watched.split(':').pop(), 'base64'))), [0b00000101, 0b00000010])
})

test('markWatched base64 is padded (stremio-core\'s decoder requires it)', () => {
  const videos = season1(30)
  for (let n = 1; n <= 30; n++) {
    const item = { state: {} }
    lib.markWatched(item, videos, `tt1:1:${n}`)
    const b64 = item.state.watched.split(':').pop()
    assert.equal(b64.length % 4, 0, `length ${b64.length} for ${n}`)
  }
})

test('markWatched keeps what was already ticked and is idempotent', () => {
  const item = itemWith(field('tt1:1:5', 5, [0, 1, 4]))
  const videos = season1(9)
  lib.markWatched(item, videos, 'tt1:1:7')
  assert.deepEqual(idsOf(watchedIds(item, videos)), ['tt1:1:1', 'tt1:1:2', 'tt1:1:5', 'tt1:1:7'])
  const once = item.state.watched
  lib.markWatched(item, videos, 'tt1:1:7')
  assert.equal(item.state.watched, once)
})

test('markWatched: a video that is not in the list changes nothing when nothing else is ticked', () => {
  const item = { state: { watched: null } }
  lib.markWatched(item, season1(3), 'tt1:9:9')
  assert.equal(item.state.watched, null)
})

test('markWatched -> watched round trip for many shapes (encode/decode symmetry)', () => {
  const videos = []
  for (let s = 1; s <= 3; s++) for (let e = 1; e <= 13; e++) videos.push(vid(s, e))
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let round = 0; round < 40; round++) {
    const item = { state: {} }
    const picked = videos.filter(() => rnd() < 0.3)
    picked.forEach(v => lib.markWatched(item, videos, v.id))
    assert.deepEqual(idsOf(watchedIds(item, videos)), idsOf(new Set(picked.map(v => v.id))), 'round ' + round)
  }
})

test('markWatched then the list grows: ticks stay on the right episodes', () => {
  const item = { state: {} }
  const first = season1(8)
  lib.markWatched(item, first, 'tt1:1:2')
  lib.markWatched(item, first, 'tt1:1:8')
  const grown = first.concat([vid(2, 1), vid(2, 2)])
  assert.deepEqual(idsOf(watchedIds(item, grown)), ['tt1:1:2', 'tt1:1:8'])
  const withSpecial = [vid(0, 1)].concat(first)
  assert.deepEqual(idsOf(watchedIds(item, withSpecial)), ['tt1:1:2', 'tt1:1:8'])
})

// ---- continueWatching / resume / list ----

test('continueWatching: the demo library, newest first, no removed/other/zero-progress items', () => {
  const items = fixtureJson('api.strem.io/api/datastoreGet.json').result
  assert.equal(items.length, 7)
  assert.deepEqual(lib.continueWatching(items).map(i => i.name), ['Dune: Part Two', 'Severance', 'Top Gun: Maverick'])
  // the Dark Knight has progress but was removed from My List without being a temp item; "other" never shows
  assert.ok(items.some(i => i.name === 'The Dark Knight' && i.state.timeOffset > 0 && i.removed && !i.temp))
  assert.equal(items.filter(i => i.type === 'other').length, 1)
})

test('continueWatching does not modify the items it reads', () => {
  const items = [{ _id: 'a', type: 'movie' }, { _id: 'b', type: 'movie', state: { timeOffset: 5, lastWatched: '2026-01-01T00:00:00.000Z' } }]
  const before = JSON.stringify(items)
  assert.deepEqual(lib.continueWatching(items).map(i => i._id), ['b'])
  assert.equal(JSON.stringify(items), before)
})

test('resumeAt: only the video that was playing, only while unfinished', () => {
  const item = { state: { video_id: 'tt1:1:4', timeOffset: 840000, duration: 3000000 } }
  assert.equal(lib.resumeAt(item, 'tt1:1:4'), 840000)
  assert.equal(lib.resumeAt(item, 'tt1:1:5'), 0)
  item.state.timeOffset = 3000000 * 0.9 // 90% is finished
  assert.equal(lib.resumeAt(item, 'tt1:1:4'), 0)
  item.state.timeOffset = 3000000 * 0.9 - 1
  assert.equal(lib.resumeAt(item, 'tt1:1:4'), 3000000 * 0.9 - 1)
  assert.equal(lib.resumeAt({ state: { video_id: 'v', timeOffset: 500, duration: 0 } }, 'v'), 500) // unknown duration: trust the offset
  assert.equal(lib.resumeAt({ state: { video_id: 'v', timeOffset: 0, duration: 100 } }, 'v'), 0)
  assert.equal(lib.resumeAt({}, 'v'), 0)
  assert.equal(lib.resumeAt({ state: { video_id: 'v', timeOffset: '700', duration: '9000' } }, 'v'), 700) // numbers as strings
})

test('newItem: Stremio\'s temporary, hidden item for a title not in the library yet', () => {
  const item = lib.newItem('tt1', 'movie', 'Name', null)
  assert.deepEqual(Object.keys(item), ['_id', 'name', 'type', 'poster', 'posterShape', 'removed', 'temp', '_ctime', '_mtime', 'behaviorHints', 'state'])
  assert.equal(item.poster, '')
  assert.equal(item.removed, true)
  assert.equal(item.temp, true)
  assert.equal(item._ctime, NOW)
  assert.equal(item._mtime, NOW)
  assert.deepEqual(item.state, { lastWatched: NOW, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false })
  assert.equal(lib.inList(item), false)
})

test('inList / setInList: My List keeps the watch history either way', () => {
  const item = lib.newItem('tt1', 'movie', 'N', 'https://p')
  time.advance(5000)
  lib.setInList(item, true)
  assert.equal(lib.inList(item), true)
  assert.equal(item.temp, false)
  assert.equal(item._mtime, '2026-10-29T12:00:05.000Z')
  item.state.timeOffset = 99
  lib.setInList(item, false)
  assert.equal(lib.inList(item), false)
  assert.equal(item.state.timeOffset, 99)
  assert.equal(lib.inList(null), false)
  assert.equal(lib.inList(undefined), false)
})

// ---- record / stopped ----

test('record: progress accumulates; a new video resets the per-video counters', () => {
  const item = lib.newItem('tt1', 'series', 'S', null)
  lib.record(item, 'tt1:1:1', 10000, 3000000, 10000)
  lib.record(item, 'tt1:1:1', 20000, 3000000, 10000)
  assert.equal(item.state.video_id, 'tt1:1:1')
  assert.equal(item.state.timeOffset, 20000)
  assert.equal(item.state.timeWatched, 20000)
  assert.equal(item.state.overallTimeWatched, 20000)
  assert.equal(item.state.duration, 3000000)
  lib.record(item, 'tt1:1:2', 5000, 2900000, 5000)
  assert.equal(item.state.video_id, 'tt1:1:2')
  assert.equal(item.state.timeWatched, 5000) // reset, then this tick
  // Alder's arithmetic, kept as is: each tick adds to overallTimeWatched, and a switch adds timeWatched again (20000 + 20000), then this tick.
  assert.equal(item.state.overallTimeWatched, 45000)
  assert.equal(item.state.duration, 2900000)
  assert.equal(item.state.flaggedWatched, 0)
})

test('record: unknown duration (0) keeps the previous one', () => {
  const item = lib.newItem('tt1', 'movie', 'S', null)
  lib.record(item, 'tt1', 1000, 5000000, 1000)
  lib.record(item, 'tt1', 2000, 0, 1000)
  assert.equal(item.state.duration, 5000000)
})

test('record: past 70% of the duration watched it is flagged watched once (timesWatched + 1)', () => {
  const item = lib.newItem('tt1', 'movie', 'M', null)
  lib.record(item, 'tt1', 0, 1000000, 0)
  lib.record(item, 'tt1', 700000, 1000000, 700000)
  assert.equal(item.state.flaggedWatched, 0) // exactly 70% is not past it
  lib.record(item, 'tt1', 710000, 1000000, 10000)
  assert.equal(item.state.flaggedWatched, 1)
  assert.equal(item.state.timesWatched, 1)
  lib.record(item, 'tt1', 720000, 1000000, 10000)
  assert.equal(item.state.timesWatched, 1)
  lib.record(item, 'tt2', 1000, 1000000, 1000) // another video of the title: flag resets
  assert.equal(item.state.flaggedWatched, 0)
})

test('record: a temp item that was never watched through stays hidden; a removed one stays temp', () => {
  const item = lib.newItem('tt1', 'movie', 'M', null)
  item.removed = false // pretend it was in My List
  item.temp = true
  lib.record(item, 'tt1', 1000, 1000000, 1000)
  assert.equal(item.removed, true) // temp and timesWatched == 0 -> removed
  assert.equal(item.temp, true)
  const listed = lib.newItem('tt2', 'movie', 'M', null)
  lib.setInList(listed, true)
  lib.record(listed, 'tt2', 1000, 1000000, 1000)
  assert.equal(listed.removed, false)
  assert.equal(listed.temp, false)
})

test('record stamps lastWatched and _mtime with the injected clock', () => {
  const item = lib.newItem('tt1', 'movie', 'M', null)
  time.advance(60000)
  lib.record(item, 'tt1', 1000, 1000000, 1000)
  assert.equal(item.state.lastWatched, '2026-10-29T12:01:05.000Z')
  assert.equal(item._mtime, item.state.lastWatched)
})

test('stopped: below the credits nothing changes; past 90% it is finished and a series moves on', () => {
  const mk = (offset) => ({ _id: 'tt1', state: { video_id: 'tt1:1:1', timeOffset: offset, duration: 1000000, timeWatched: 800000, overallTimeWatched: 800000, flaggedWatched: 1 } })
  const early = mk(900000) // exactly 90% is not past it
  lib.stopped(early, 'tt1:1:2')
  assert.equal(early.state.timeOffset, 900000)
  assert.equal(early.state.video_id, 'tt1:1:1')

  const film = mk(950000)
  lib.stopped(film, null)
  assert.equal(film.state.timeOffset, 0)
  assert.equal(film.state.video_id, 'tt1:1:1') // a film with no next video stays on itself

  const episode = mk(950000)
  lib.stopped(episode, 'tt1:1:2')
  assert.equal(episode.state.video_id, 'tt1:1:2')
  assert.equal(episode.state.timeOffset, 1) // stremio-core's "start the next episode" marker keeps it in Continue Watching
  assert.equal(episode.state.timeWatched, 0)
  assert.equal(episode.state.flaggedWatched, 0)
  assert.equal(episode.state.overallTimeWatched, 1600000)
  assert.equal(episode._mtime, '2026-10-29T12:01:05.000Z')
  assert.deepEqual(lib.continueWatching([episode]).length, 1)

  const unknown = { state: { timeOffset: 5, duration: 0 } }
  lib.stopped(unknown, 'x')
  assert.equal(unknown.state.timeOffset, 5)
})

test('markTitleWatched: complete without discarding the history', () => {
  const videos = season1(4)
  const item = { _id: 'tt1', state: { video_id: 'tt1:1:2', timeOffset: 1234, timesWatched: 0, flaggedWatched: 0 } }
  lib.markTitleWatched(item, videos)
  assert.equal(item.state.timesWatched, 1)
  assert.equal(item.state.flaggedWatched, 1)
  assert.equal(item.state.timeOffset, 0)
  assert.deepEqual(idsOf(watchedIds(item, videos)), ['tt1:1:2'])
  assert.equal(item.state.video_id, 'tt1:1:2')
  const again = { state: { timesWatched: 3 } }
  lib.markTitleWatched(again)
  assert.equal(again.state.timesWatched, 3)
  const noVideo = { state: { video_id: 'tt9:1:1' } }
  lib.markTitleWatched(noVideo, videos) // not one of this list's videos: no bitfield written
  assert.equal(noVideo.state.watched, undefined)
  const bare = {}
  lib.markTitleWatched(bare)
  assert.equal(bare.state.flaggedWatched, 1)
})
