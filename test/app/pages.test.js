// Section E of docs/PLAN-v0.2.md: switching pages. The pure rules behind it (which page opens when, what a fresh answer changes,
// which hidden page lets go of its cards) are in src/app/home-model.js; the DOM half is read by dev/scenarios/v02-pages.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeClock } from '../../dev/fake-clock.js'
import {
  createPageSwitcher, sameTitle, mergeItems, pagesToTrim, stale, metaItem, libraryItem,
  SWITCH_WAIT, KEPT_GAP, CARD_BUDGET,
} from '../../src/app/home-model.js'

function switcher({ built = [] } = {}) {
  const clock = createFakeClock(1000)
  const opened = []
  const state = { built: new Set(built), allow: true }
  const s = createPageSwitcher({
    isBuilt: l => state.built.has(l),
    canCommit: () => state.allow,
    commit: (label, how) => opened.push(label + ':' + how),
    now: clock.now, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout,
  })
  return { s, clock, opened, state }
}

test('a page that is built opens the moment the remote rests on its name', () => {
  const { s, opened } = switcher({ built: ['Shows'] })
  assert.equal(s.rest('Shows', 'Home'), 'now')
  assert.deepEqual(opened, ['Shows:rest'])
  assert.equal(s.pending, null)
})

test('a page that has to be built waits SWITCH_WAIT, and passing over its name builds nothing', async () => {
  const { s, clock, opened } = switcher()
  assert.equal(s.rest('Shows', 'Home'), 'wait')
  await clock.advance(SWITCH_WAIT - 1)
  assert.deepEqual(opened, [], 'not yet')
  assert.equal(s.rest('Movies', 'Home'), 'wait', 'the remote moved on: Shows is forgotten, Movies starts its own wait')
  assert.equal(s.pending, 'Movies')
  await clock.advance(SWITCH_WAIT - 1)
  assert.deepEqual(opened, [], 'the wait started over')
  await clock.advance(2)
  assert.deepEqual(opened, ['Movies:rest'])
  assert.equal(SWITCH_WAIT, 150, 'the plan says ~150 ms')
})

test('sweeping across three tabs with one of them unbuilt builds only the one the remote stops on', async () => {
  const { s, clock, opened } = switcher({ built: ['Shows', 'My List'] })
  s.rest('Shows', 'Home')                 // built: opens now
  await clock.advance(60)
  s.rest('Movies', 'Shows')               // not built: waits
  await clock.advance(60)
  s.rest('My List', 'Shows')              // built, but a flip 120 ms ago is past KEPT_GAP
  assert.deepEqual(opened, ['Shows:rest', 'My List:rest'])
  await clock.advance(500)
  assert.deepEqual(opened, ['Shows:rest', 'My List:rest'], 'Movies was never opened or built')
})

test('built pages flip at least KEPT_GAP apart: a held key opens the last one it reaches, once', async () => {
  const { s, clock, opened } = switcher({ built: ['Shows', 'Movies', 'My List'] })
  s.rest('Shows', 'Home')
  await clock.advance(30)
  assert.equal(s.rest('Movies', 'Shows'), 'soon')
  await clock.advance(30)
  assert.equal(s.rest('My List', 'Shows'), 'soon', 'Movies is replaced by My List')
  assert.deepEqual(opened, ['Shows:rest'])
  await clock.advance(KEPT_GAP)
  assert.deepEqual(opened, ['Shows:rest', 'My List:rest'])
})

test('OK opens at once, built or not, and cancels a wait; on the page already open it opens nothing', async () => {
  const { s, clock, opened } = switcher()
  s.rest('Shows', 'Home')
  assert.equal(s.ok('Shows', 'Home'), true)
  assert.deepEqual(opened, ['Shows:ok'])
  await clock.advance(1000)
  assert.deepEqual(opened, ['Shows:ok'], 'the pending rest was cancelled')
  assert.equal(s.ok('Shows', 'Shows'), false, 'the caller goes down into the page instead')
})

test('a rest that ends after the remote left the top bar opens nothing; resting back on the open page cancels the wait', async () => {
  const { s, clock, opened, state } = switcher()
  s.rest('Shows', 'Home')
  state.allow = false // Down: the remote is in the rows
  await clock.advance(SWITCH_WAIT + 1)
  assert.deepEqual(opened, [])
  state.allow = true
  s.rest('Shows', 'Home')
  assert.equal(s.rest('Home', 'Home'), 'same')
  await clock.advance(1000)
  assert.deepEqual(opened, [])
  s.rest('Movies', 'Home')
  s.cancel()
  await clock.advance(1000)
  assert.deepEqual(opened, [])
})

const item = (id, extra = {}) => Object.assign({ id, name: 'T' + id, poster: 'p' + id, progress: 0, finished: false, left: null, stoppedAt: null, videoId: null, facts: [], filled: false, settled: false }, extra)

test('sameTitle compares what a card and the lines under it show', () => {
  assert.equal(sameTitle(item('a'), item('a')), true)
  assert.equal(sameTitle(item('a'), item('b')), false)
  assert.equal(sameTitle(item('a'), item('a', { progress: 0.4 })), false)
  assert.equal(sameTitle(item('a', { left: '31 min left' }), item('a', { left: '30 min left' })), false)
  assert.equal(sameTitle(item('a'), item('a', { art: 'x', filled: true })), true, 'details learned later are not a change')
  assert.equal(sameTitle(null, item('a')), false)
})

test('an answer that brings the same titles changes nothing and keeps every item object', () => {
  const prev = [item('a', { filled: true, art: 'A' }), item('b'), item('c')]
  const { items, changed } = mergeItems(prev, [item('a'), item('b'), item('c')])
  assert.equal(changed, false)
  assert.ok(items.every((it, i) => it === prev[i]), 'the cards (and what the meta add-on told) stay')
})

test('a changed title is patched in carrying over what was learned; a new one or a reorder is a change', () => {
  const prev = [item('a', { filled: true, settled: true, art: 'A', logo: 'L', about: 'About', facts: ['2020'] }), item('b'), item('c')]
  const m = mergeItems(prev, [item('a', { progress: 0.5, left: '10 min left' }), item('b'), item('c')])
  assert.equal(m.changed, true)
  assert.equal(m.items[1], prev[1])
  assert.equal(m.items[2], prev[2])
  assert.notEqual(m.items[0], prev[0])
  assert.equal(m.items[0].progress, 0.5)
  assert.equal(m.items[0].filled, true)
  assert.equal(m.items[0].art, 'A')
  assert.equal(m.items[0].about, 'About')
  assert.deepEqual(m.items[0].facts, ['2020'])
  assert.equal(mergeItems(prev, [item('a'), item('b'), item('c'), item('d')]).changed, true, 'a title was added')
  assert.equal(mergeItems(prev, [item('b'), item('a'), item('c')]).changed, true, 'a reorder moves cards')
  assert.equal(mergeItems(prev, [item('a'), item('c')]).changed, true, 'a title went')
  const fresh = item('z', { art: 'Z' })
  assert.equal(mergeItems(prev, [item('a'), item('b'), fresh]).items[2], fresh, 'a new title is the new object')
})

test('mergeItems with real catalog and library items (the fixture shapes)', () => {
  const lib = { _id: 'tt1', name: 'One', type: 'movie', poster: null, state: { video_id: 'tt1', duration: 6000000, timeOffset: 1200000 }, _ctime: '2026-01-01T00:00:00Z' }
  const a = libraryItem(lib)
  a.filled = true; a.art = 'ART'
  const same = mergeItems([a], [libraryItem(lib)])
  assert.equal(same.changed, false)
  assert.equal(same.items[0].art, 'ART')
  const moved = mergeItems([a], [libraryItem(Object.assign({}, lib, { state: { video_id: 'tt1', duration: 6000000, timeOffset: 2400000 } }))])
  assert.equal(moved.changed, true)
  assert.equal(moved.items[0].art, 'ART', 'the new place keeps the title\'s art')
  const meta = metaItem({ id: 'tt2', type: 'movie', name: 'Two', poster: null, background: 'B', description: 'D', genres: [], year: '2020', rating: '', logo: null })
  assert.equal(mergeItems([meta], [metaItem({ id: 'tt2', type: 'movie', name: 'Two', poster: null, background: 'B', description: 'D', genres: [], year: '2020', rating: '', logo: null })]).changed, false)
})

test('pagesToTrim: nothing while within the card budget; else the hidden page left longest goes first, never the open one', () => {
  const pages = [
    { label: 'Home', cards: 54, used: 500 },
    { label: 'Shows', cards: 14, used: 300 },
    { label: 'Movies', cards: 14, used: 100 },
    { label: 'My List', cards: 12, used: 200 },
  ]
  assert.deepEqual(pagesToTrim(pages, 'Home'), [], '94 cards: within ' + CARD_BUDGET)
  assert.deepEqual(pagesToTrim(pages, 'Home', 80), ['Movies'], 'Movies was left longest ago: 80 is met without more')
  assert.deepEqual(pagesToTrim(pages, 'Home', 70), ['Movies', 'My List'], 'then My List')
  assert.deepEqual(pagesToTrim(pages, 'Home', 10), ['Movies', 'My List', 'Shows'], 'the open page is never trimmed, even over budget')
  assert.deepEqual(pagesToTrim(pages, 'Movies', 70), ['My List', 'Shows', 'Home'].slice(0, 2), 'the open page is Movies: the others go, longest unused first')
  assert.equal(pagesToTrim([{ label: 'Home', cards: 200, used: 1 }], 'Home').length, 0)
})

test('stale: never asked is stale, then by age', () => {
  assert.equal(stale(0, 1000, 500), true)
  assert.equal(stale(600, 1000, 500), false)
  assert.equal(stale(400, 1000, 500), true)
})
