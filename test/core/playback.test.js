import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAYER, lowerSourceHeight, upNextWindow, plausibleEpisode, nextVideo, chooseAddonSubtitles, parseSegments, introDbUrl } from '../../src/core/playback.js'
import { Subtitle, Video } from '../../src/core/addon.js'
import { fixtureJson } from './helpers.js'

test('constants are PlayerActivity\'s', () => {
  assert.deepEqual(PLAYER, {
    TICK: 10000, PUSH_EVERY: 6, RESUME_SLACK: 10000, SKIP: 10000, SEEK_SETTLE: 600, SKIP_SHOWN: 10000, HIDE: 5000, START_WAIT: 12000,
    RETRIES: 2, RETRY_WAIT: 1500, TRY: 3, STALLS_FOR_LOWER: 3, STALL_WINDOW: 60000,
  })
  assert.ok(Object.isFrozen(PLAYER))
})

test('lowerSourceHeight: one step down from the playing height (4K -> 1080 -> 720 -> 480), none below', () => {
  assert.equal(lowerSourceHeight(2160), 1080)
  assert.equal(lowerSourceHeight(1081), 1080)
  assert.equal(lowerSourceHeight(1080), 720)
  assert.equal(lowerSourceHeight(720), 480)
  assert.equal(lowerSourceHeight(480), null)
  assert.equal(lowerSourceHeight(576), 480)
  assert.equal(lowerSourceHeight(0), null) // unknown height: nothing to offer
})

test('upNextWindow: a 25th of the length, between 30 s and 60 s', () => {
  assert.equal(upNextWindow(0), 30000)
  assert.equal(upNextWindow(10 * 60000), 30000) // 24 s, raised to the floor
  assert.equal(upNextWindow(12.5 * 60000), 30000)
  assert.equal(upNextWindow(15 * 60000), 36000)
  assert.equal(upNextWindow(20 * 60000), 48000)
  assert.equal(upNextWindow(25 * 60000), 60000)
  assert.equal(upNextWindow(44 * 60000), 60000) // 105.6 s, cut to the ceiling
  assert.equal(upNextWindow(166 * 60000), 60000)
})

test('plausibleEpisode: two minutes or more', () => {
  assert.equal(plausibleEpisode(119999), false)
  assert.equal(plausibleEpisode(120000), true)
  assert.equal(plausibleEpisode(0), false)
})

const v = (season, episode) => new Video(`s:${season}:${episode}`, '', season, episode, null, null, null)
test('nextVideo: the next episode, not from the finale into specials, null at the end', () => {
  const videos = [v(1, 1), v(1, 2), v(2, 1), v(0, 1), v(0, 2)]
  assert.equal(nextVideo(videos, 's:1:1').id, 's:1:2')
  assert.equal(nextVideo(videos, 's:1:2').id, 's:2:1')
  assert.equal(nextVideo(videos, 's:2:1'), null) // the special after the last real episode is not offered
  assert.equal(nextVideo(videos, 's:0:1').id, 's:0:2') // inside the specials it goes on
  assert.equal(nextVideo(videos, 's:0:2'), null)
  assert.equal(nextVideo(videos, 'nope'), null)
  assert.equal(nextVideo(null, 's:1:1'), null)
  assert.equal(nextVideo([], 's:1:1'), null)
})

test('chooseAddonSubtitles: three in the TV\'s language, then three English, add-on order kept', () => {
  const sub = (lang, n) => new Subtitle(`https://s/${lang}${n}.srt`, lang, 'OS')
  const all = [sub('eng', 1), sub('ger', 1), sub('eng', 2), sub('ger', 2), sub('fre', 1), sub('ger', 3), sub('ger', 4), sub('eng', 3), sub('eng', 4), sub('en', 5)]
  assert.deepEqual(chooseAddonSubtitles(all, 'de').map(s => s.url.split('/').pop()),
    ['ger1.srt', 'ger2.srt', 'ger3.srt', 'eng1.srt', 'eng2.srt', 'eng3.srt'])
  assert.deepEqual(chooseAddonSubtitles(all, 'en').map(s => s.url.split('/').pop()), ['eng1.srt', 'eng2.srt', 'eng3.srt']) // English is the local one: no extra
  assert.deepEqual(chooseAddonSubtitles(all, 'fr').map(s => s.url.split('/').pop()), ['fre1.srt', 'eng1.srt', 'eng2.srt', 'eng3.srt'])
  assert.deepEqual(chooseAddonSubtitles([], 'en'), [])
})

test('parseSegments: IntroDB seconds -> milliseconds, recap before intro, outro start', () => {
  const r = parseSegments(fixtureJson('api.introdb.app/segments.json'))
  assert.deepEqual(r.segments, [{ label: 'Skip recap', start: 0, end: 41500 }, { label: 'Skip intro', start: 52000, end: 128400 }])
  assert.equal(r.outroAt, 2958000)
  assert.deepEqual(parseSegments(fixtureJson('api.introdb.app/segments-empty.json')), { segments: [], outroAt: 0 })
  assert.deepEqual(parseSegments(null), { segments: [], outroAt: 0 })
  // a part is used only when 0 <= start < end
  assert.deepEqual(parseSegments({ intro: { start_sec: 10, end_sec: 10 }, recap: { start_sec: -1, end_sec: 5 }, outro: { start_sec: 5 } }), { segments: [], outroAt: 0 })
  assert.deepEqual(parseSegments({ intro: { start_sec: 0, end_sec: 0.5 } }).segments, [{ label: 'Skip intro', start: 0, end: 500 }])
})

test('introDbUrl: series with an IMDb id and a season:episode video id only', () => {
  assert.equal(introDbUrl('series', 'tt11280740', 'tt11280740:1:4'), 'https://api.introdb.app/segments?imdb_id=tt11280740&season=1&episode=4')
  assert.equal(introDbUrl('movie', 'tt15239678', 'tt15239678'), null)
  assert.equal(introDbUrl('series', 'kitsu:1', 'kitsu:1:1:2'), null)
  assert.equal(introDbUrl('series', 'tt1', 'tt1'), null)
})
