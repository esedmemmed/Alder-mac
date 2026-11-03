import test from 'node:test'
import assert from 'node:assert/strict'
import {
  synopsisAtSentence, homeRowName, seasons, catalogGenres, settledGenres, shortRowName, listRowCount, nextCatalogSection, tidy,
  shelf, shelvesFor, sectionsFor, episodeCode, timeLeft, elapsed, libraryItem, metaItem, heroFacts, listItems, addedAgo,
  libraryFinished, newestFirst, isAddonMessage, DOT, continueSignature,
} from '../../src/app/home-model.js'
import { Meta } from '../../src/core/addon.js'
import { fakeHttp, fixtureAddons, fixtureJson } from '../core/helpers.js'

test('synopsisAtSentence cuts at a sentence end, not after Dr. or U.S., else at a word with an ellipsis', () => {
  const t = 'Dr. Who arrives in the U.S. at dawn. Then everything changes for him and his friends in a long story.'
  assert.equal(synopsisAtSentence(t, 200), t)
  assert.equal(synopsisAtSentence(t, 60), 'Dr. Who arrives in the U.S. at dawn.')
  assert.equal(synopsisAtSentence('Dr. Who arrives in the U.S. at dawn and then everything', 30), 'Dr. Who arrives in the U.S. at…', 'no sentence end before the limit: a word boundary')
  assert.equal(synopsisAtSentence('One two three four five six', 14), 'One two three…')
  assert.equal(synopsisAtSentence('One two three, four', 14), 'One two three…', 'trailing punctuation goes before the ellipsis')
})

test('homeRowName, shortRowName, tidy, seasons', () => {
  assert.equal(homeRowName('Because you watched Crayon Shin-chan: Pursuit'), 'More like Crayon Shin-chan')
  assert.equal(homeRowName('because you watched Dune (2021)'), 'More like Dune')
  assert.equal(homeRowName('  Something else entirely that is quite long indeed yes  '), 'Something else entirely that is quit')
  assert.equal(shortRowName('Top Picks for You'), 'For you')
  assert.equal(shortRowName('Trending Now'), 'Popular')
  assert.equal(shortRowName('Recommended in India', []), 'Recommended in India')
  assert.equal(shortRowName('Short & Sweet Adventure Films', ['Adventure', 'Drama']), 'Adventure')
  assert.equal(shortRowName('A very long themed row name with nothing known', []), 'A very long themed row name'.slice(0, 28).trimEnd())
  assert.equal(shortRowName('Science Fiction'), 'Sci-Fi')
  assert.equal(tidy('TV Shows: Comedy Aftercreditsstingerwhatever'), 'Comedy')
  assert.equal(tidy('MyTrakt - Watchlist'), 'Watchlist')
  assert.equal(seasons(1), '1 season')
  assert.equal(seasons(3), '3 seasons')
})

test('catalogGenres: no All, no duplicates, the common ones first; settledGenres waits for every answer', () => {
  assert.deepEqual(catalogGenres(['Action', 'All', 'comedy', 'Comedy', 'Drama', 'Anime', 'Zeta']), ['Drama', 'comedy', 'Anime', 'Action', 'Zeta'])
  assert.equal(settledGenres(['Drama', 'Comedy'], { Drama: true }), null)
  assert.deepEqual(settledGenres(['Drama', 'Comedy'], { Drama: true, Comedy: false }), ['Drama'])
  assert.equal(nextCatalogSection(10, 0), 4)
  assert.equal(nextCatalogSection(10, 8), 10)
  assert.equal(listRowCount(115, 6), 20)
  assert.equal(listRowCount(0, 6), 0)
  assert.equal(isAddonMessage('Authentication Required: log in'), true)
})

test('shelves of the fixture account: Home has Watchly\'s item row only, Movies has Cinemeta, the examples and Watchly picks first', () => {
  const addons = fixtureAddons(fakeHttp())
  const home = shelvesFor('Home', addons)
  assert.equal(home.length, 1, 'watchly.rec is a Movies pick; only watchly.item.* rows are on Home')
  assert.equal(home[0].shelf.title, 'More like Interstellar')
  const movies = shelvesFor('Movies', addons)
  assert.ok(movies.length >= 3)
  assert.equal(movies[0].shelf.title, 'Top Picks for You', 'personal picks first (rank 0)')
  assert.ok(movies.every(m => m.shelf.page === 'Movies'))
  const shows = shelvesFor('Shows', addons)
  assert.ok(shows.length >= 2 && shows.every(s => s.catalog.type === 'series'))
})

test('sections: Shows and Movies merge by short name and end with genre rows; other pages keep one row per catalog', () => {
  const addons = fixtureAddons(fakeHttp())
  const shelves = shelvesFor('Movies', addons)
  const sections = sectionsFor('Movies', shelves)
  assert.ok(sections.length >= shelves.length - 1)
  const names = sections.map(s => s.title)
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, 'no two rows share a name')
  const genreRows = sections.filter(s => s.picked)
  assert.ok(genreRows.length > 0 && genreRows.length <= 6)
  genreRows.forEach(g => { assert.equal(g.sources.length, 1); assert.equal(g.title, g.picked); assert.ok(g.sources[0].catalog.genres.includes(g.picked)) })
  const live = sectionsFor('Home', [{ catalog: { genres: [] }, shelf: { title: 'X' } }])
  assert.deepEqual(live.map(s => s.title), ['X'])
})

test('shelf rules port Alder: Watchly items on Home, Trakt, India lists, Live for other types', () => {
  const mk = (addonId, c) => shelf({ addon: { id: addonId }, ...c })
  assert.deepEqual(mk('org.watchly', { type: 'movie', id: 'watchly.item.1', name: 'Because you watched Heat: x' }), { page: 'Home', title: 'More like Heat', rank: 0 })
  assert.deepEqual(mk('trakt.addon.x', { type: 'series', id: 'recommendations.1', name: 'n' }), { page: 'Shows', title: 'Recommended for You', rank: 1 })
  assert.deepEqual(mk('trakt.addon.x', { type: 'series', id: 'trending.1', name: 'n' }), { page: 'Shows', title: 'Trending Now', rank: 2 })
  assert.deepEqual(mk('in.rdata.indiastreams', { type: 'movie', id: 'popmov', name: 'n' }), { page: 'Movies', title: 'Popular in India', rank: 2 })
  assert.deepEqual(mk('any', { type: 'tv', id: 'c', name: 'TV Shows: Live Sport' }), { page: 'Live', title: 'Live Sport', rank: 3 })
})

test('episode code, time left, elapsed', () => {
  assert.equal(episodeCode('tt11280740:1:4'), 'S1 E4')
  assert.equal(episodeCode('tt15239678'), null)
  assert.equal(episodeCode(null), null)
  assert.equal(timeLeft(9960000, 3960000), '1h 40m left')
  assert.equal(timeLeft(3300000, 840000), '41 min left')
  assert.equal(timeLeft(0, 5000), null)
  assert.equal(timeLeft(5000000, 1), null, 'offset 1 is the "start the next episode" marker')
  assert.equal(elapsed(1894000), '31:34')
  assert.equal(elapsed(3972000), '1:06:12')
})

test('libraryItem from the fixture library: Dune in progress, Severance mid-season with its episode and time left', () => {
  const lib = fixtureJson('api.strem.io/api/datastoreGet.json').result
  const dune = libraryItem(lib.find(i => i._id === 'tt15239678'))
  assert.equal(dune.name.includes('Dune'), true)
  assert.equal(dune.resume, true)
  assert.ok(dune.progress > 0.3 && dune.progress < 0.5)
  assert.match(dune.left, /left$/)
  assert.equal(dune.logo, 'https://images.metahub.space/logo/medium/tt15239678/img')
  const sev = libraryItem(lib.find(i => i._id === 'tt11280740'))
  assert.equal(sev.videoId, 'tt11280740:1:4')
  assert.equal(sev.left.split(DOT)[0], 'S1 E4')
  assert.equal(sev.stoppedAt, 840000)
  const done = libraryItem(lib.find(i => libraryFinished(i)))
  assert.equal(done.finished, true)
  assert.equal(done.resume, false)
})

test('metaItem and heroFacts', () => {
  const meta = new Meta(fixtureJson('v3-cinemeta.strem.io/meta/series/tt11280740.json').meta)
  const item = metaItem(meta)
  assert.equal(item.type, 'series')
  assert.ok(item.facts.length >= 2)
  assert.equal(item.logo !== null, true)
  const line = heroFacts(item, meta, null)
  assert.match(line, /^\d{4}/)
  assert.match(line, /\d+ seasons?$/)
  const resumed = libraryItem(fixtureJson('api.strem.io/api/datastoreGet.json').result.find(i => i._id === 'tt11280740'))
  const ep = meta.videos.find(v => v.id === 'tt11280740:1:4')
  assert.equal(heroFacts(resumed, meta, ep), 'S1 E4' + DOT + ep.title)
})

test('My List: filters, sorts (recent, A-Z, unwatched first) and what counts as in the list', () => {
  const lib = fixtureJson('api.strem.io/api/datastoreGet.json').result
  const all = listItems(lib, 'all', 'recent')
  assert.ok(all.every(i => !i.removed && ['movie', 'series'].includes(i.type)))
  assert.deepEqual(all.map(i => i._ctime), all.map(i => i._ctime).slice().sort().reverse())
  assert.ok(listItems(lib, 'movies', 'recent').every(i => i.type === 'movie'))
  assert.ok(listItems(lib, 'shows', 'recent').every(i => i.type === 'series'))
  const names = listItems(lib, 'all', 'name').map(i => i.name.toLowerCase())
  assert.deepEqual(names, names.slice().sort())
  const unwatched = listItems(lib, 'all', 'unwatched')
  const firstFinished = unwatched.findIndex(libraryFinished)
  assert.ok(firstFinished === -1 || unwatched.slice(firstFinished).every(libraryFinished), 'finished titles come last')
})

test('addedAgo', () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0)
  // the same clock time on other days, so the machine's time zone cannot move a date across midnight
  assert.equal(addedAgo('2026-10-29T11:30:00.000Z', now), 'today')
  assert.equal(addedAgo('2026-10-28T12:00:00.000Z', now), 'yesterday')
  assert.equal(addedAgo('2026-10-26T12:00:00.000Z', now), '3 days ago')
  assert.equal(addedAgo('2026-06-19T12:00:00.000Z', now), 'Jun 19, 2026')
  assert.equal(addedAgo('garbage', now), 'recently')
})

test('continueSignature changes with progress, removal and mtime', () => {
  const lib = fixtureJson('api.strem.io/api/datastoreGet.json').result
  const a = continueSignature(lib)
  const copy = JSON.parse(JSON.stringify(lib))
  copy[0].state.timeOffset += 1000
  assert.notEqual(continueSignature(copy), a)
  assert.equal(continueSignature(lib), a)
})

test('newestFirst runs at most n jobs and takes the newest waiting one first', () => {
  const pool = newestFirst(2)
  const order = []
  const dones = []
  for (let i = 0; i < 5; i++) pool.run(done => { order.push(i); dones.push(done) })
  assert.deepEqual(order, [0, 1])
  assert.equal(pool.active(), 2)
  dones[0]()
  assert.deepEqual(order, [0, 1, 4], 'the newest waiting job goes next')
  dones[1](); dones[1]()
  assert.deepEqual(order, [0, 1, 4, 3])
  const cancelled = newestFirst(1)
  const ran = []
  let release
  cancelled.run(done => { release = done })
  cancelled.run(() => ran.push('x'), () => true)
  release()
  assert.deepEqual(ran, [], 'a job whose card is gone is skipped')
})
