import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Addon, Meta, Subtitle, Stream } from '../../src/core/addon.js'
import { fakeHttp, fixtureAddons, fixtureJson, fixturePath } from './helpers.js'

const byName = (list, name) => list.find(a => a.name === name)
const setup = (opts) => {
  const http = fakeHttp(opts)
  const addons = fixtureAddons(http)
  return { http, addons, cinemeta: byName(addons, 'Cinemeta'), torrentio: byName(addons, 'Torrentio'), aio: byName(addons, 'AIOStreams (example)'),
    subs: byName(addons, 'OpenSubtitles v3'), catalogs: byName(addons, 'Example Catalogs'), watchly: byName(addons, 'Watchly (example)') }
}

test('fixtures: every add-on of the account parses, descriptors are kept whole', () => {
  const { addons } = setup()
  assert.deepEqual(addons.map(a => a.name), ['Cinemeta', 'Torrentio', 'AIOStreams (example)', 'OpenSubtitles v3', 'Example Catalogs', 'Watchly (example)'])
  const raw = fixtureJson('api.strem.io/api/addonCollectionGet.json').result.addons
  addons.forEach((a, i) => assert.deepEqual(a.descriptor, raw[i]))
})

test('flags: official and locked come from the descriptor, providesStreams from the resources', () => {
  const { cinemeta, torrentio, aio, subs, watchly } = setup()
  assert.equal(cinemeta.official, true)
  assert.equal(cinemeta.locked, true)
  assert.equal(torrentio.official, false)
  assert.equal(torrentio.providesStreams, true)
  assert.equal(aio.providesStreams, true) // the plain string "stream" resource
  assert.equal(cinemeta.providesStreams, false)
  assert.equal(subs.providesStreams, false)
  assert.equal(watchly.providesStreams, true)
})

test('shareable: own stream add-ons only, never Stremio\'s or personal ones (Watchly, Trakt, Simkl, ...)', () => {
  const { addons, cinemeta, torrentio, aio, watchly } = setup()
  assert.deepEqual(addons.filter(a => a.shareable).map(a => a.name), ['Torrentio', 'AIOStreams (example)'])
  assert.equal(watchly.personal, true)
  assert.equal(cinemeta.shareable, false)
  assert.equal(torrentio.personal, false)
  for (const name of ['MyTrakt', 'SIMKL Addon', 'SyncriBullet', 'AIOLists', 'watchly']) {
    const a = new Addon({ transportUrl: 'https://x/manifest.json', manifest: { id: 'x', name, resources: ['stream'] } })
    assert.equal(a.personal, true, name)
    assert.equal(a.shareable, false, name)
  }
})

test('catalogs: only those that need no required input; paging and genres detected', () => {
  const { cinemeta, catalogs, torrentio } = setup()
  const names = cinemeta.catalogs.map(c => `${c.type}/${c.id}/${c.name}`)
  assert.deepEqual(names, ['movie/top/Popular', 'series/top/Popular', 'movie/imdbRating/Featured', 'series/imdbRating/Featured'])
  // "New" needs a genre (isRequired) and the two "Search" catalogs need a query: not on Home
  const [movieTop, seriesTop] = cinemeta.catalogs
  assert.equal(movieTop.pages, true)
  assert.equal(movieTop.genres.length, 19)
  assert.equal(movieTop.genres[0], 'Action')
  assert.equal(seriesTop.pages, true) // `extraSupported: ["search", "genre", "skip"]`
  assert.equal(seriesTop.genres.length, 19) // the older `genres` list
  assert.equal(movieTop.addon, cinemeta)
  assert.deepEqual(catalogs.catalogs.map(c => c.id + '/' + c.type), ['ex.trending/movie', 'ex.trending/series'])
  assert.deepEqual(torrentio.catalogs, [])
})

test('catalogs: extraRequired excludes a catalog, a missing name falls back to the id', () => {
  const a = new Addon({ transportUrl: 'https://x/manifest.json', manifest: { id: 'x', name: 'X', catalogs: [
    { type: 'movie', id: 'a', extraRequired: ['search'] }, { type: 'movie', id: 'b' }, { type: 'series', id: 'c', name: 'Cee', extra: [{ name: 'skip' }] }, { id: 'broken' },
  ] } })
  assert.deepEqual(a.catalogs.map(c => [c.id, c.name, c.pages]), [['b', 'b', false], ['c', 'Cee', true]])
})

test('serves: resource, type and id prefix (per resource entry first, then the manifest)', () => {
  const { cinemeta, torrentio, aio, subs } = setup()
  assert.equal(torrentio.serves('stream', 'movie', 'tt15239678'), true)
  assert.equal(torrentio.serves('stream', 'series', 'tt11280740:1:4'), true)
  assert.equal(torrentio.serves('stream', 'anime', 'kitsu:1'), true)
  assert.equal(torrentio.serves('stream', 'movie', 'yt_id:abc'), false) // prefix
  assert.equal(torrentio.serves('stream', 'tv', 'tt1'), false) // type
  assert.equal(torrentio.serves('meta', 'movie', 'tt1'), false) // resource
  assert.equal(cinemeta.serves('meta', 'movie', 'tt15239678'), true)
  assert.equal(cinemeta.serves('catalog', 'movie', 'tt-anything'), true) // plain string entry: manifest types, manifest prefixes (tt)
  assert.equal(cinemeta.serves('catalog', 'movie', 'kitsu:1'), false)
  assert.equal(aio.serves('stream', 'movie', 'tt1'), true)
  assert.equal(subs.serves('subtitles', 'series', 'tt11280740:1:4'), true)
  const noPrefix = new Addon({ transportUrl: 'https://x/manifest.json', manifest: { id: 'x', name: 'x', resources: ['stream'], types: ['movie'] } })
  assert.equal(noPrefix.serves('stream', 'movie', 'whatever'), true) // no idPrefixes: any id
  const emptyPrefix = new Addon({ transportUrl: 'https://x/manifest.json', manifest: { id: 'x', name: 'x', resources: ['stream'], types: ['movie'], idPrefixes: [] } })
  assert.equal(emptyPrefix.serves('stream', 'movie', 'tt1'), false) // an empty list matches nothing
})

test('a malformed descriptor never throws and keeps its descriptor (so a reorder cannot drop it)', () => {
  const d = { transportUrl: 'https://odd.example/manifest.json' }
  const a = new Addon(d)
  assert.equal(a.descriptor, d)
  assert.equal(a.name, '')
  assert.deepEqual(a.catalogs, [])
  assert.equal(a.serves('stream', 'movie', 'tt1'), false)
  assert.equal(new Addon({}).transportUrl, '')
})

test('catalog URLs: ids keep their colons, genres and skip are path extras', async () => {
  const { http, cinemeta } = setup()
  const [top] = cinemeta.catalogs
  const metas = await cinemeta.catalog(top)
  assert.equal(metas.length, 10)
  assert.equal(metas[0].name, 'Dune: Part Two')
  assert.equal(http.log[0].url, 'https://v3-cinemeta.strem.io/catalog/movie/top.json')
  assert.deepEqual(http.log[0].opts, { keep: true, timeoutMs: 20000 })
  const scifi = await cinemeta.catalog(top, 'Sci-Fi')
  assert.deepEqual(scifi.map(m => m.name), ['Interstellar', 'Arrival', 'Mad Max: Fury Road'])
  assert.equal(http.log[1].url, 'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Sci-Fi.json')
  const page = await cinemeta.catalogPage(top, 10)
  assert.equal(page.length, 3)
  assert.equal(http.log[2].url, 'https://v3-cinemeta.strem.io/catalog/movie/top/skip=10.json')
  assert.deepEqual(http.log[2].opts, { keep: false }) // paging is not kept
})

test('savedCatalog / savedMeta read what was kept, no network', async () => {
  const { http, cinemeta } = setup()
  const [top] = cinemeta.catalogs
  assert.equal(cinemeta.savedCatalog(top), null)
  await cinemeta.catalog(top)
  const before = http.log.length
  assert.equal(cinemeta.savedCatalog(top).length, 10)
  assert.equal(cinemeta.savedMeta('movie', 'tt15239678'), null)
  await cinemeta.meta('movie', 'tt15239678')
  assert.equal(cinemeta.savedMeta('movie', 'tt15239678').name, 'Dune: Part Two')
  assert.equal(http.log.length, before + 1)
})

test('meta: movie and series (episodes with colons in the id are fetched as streams)', async () => {
  const { cinemeta, http } = setup()
  const movie = await cinemeta.meta('movie', 'tt15239678')
  assert.equal(movie.id, 'tt15239678')
  assert.equal(movie.year, '2024')
  assert.equal(movie.runtime, '2h 46m')
  assert.equal(movie.rating, '8.5')
  assert.deepEqual(movie.genres, ['Action', 'Adventure', 'Drama'])
  assert.equal(movie.info, '2024   2h 46m   Action · Adventure · Drama')
  assert.equal(movie.logo, 'https://images.metahub.space/logo/medium/tt15239678/img')
  assert.equal(movie.cast.length, 5)
  assert.equal(movie.videos.length, 0)
  assert.equal(http.log[0].url, 'https://v3-cinemeta.strem.io/meta/movie/tt15239678.json')
  assert.equal(await cinemeta.meta('series', 'tt0000000').catch(() => 'rejected'), 'rejected') // no fixture: the request fails
})

test('Meta: "2022–" reads as 2022, videos sorted by season/episode with specials last', async () => {
  const { cinemeta } = setup()
  const sev = await cinemeta.meta('series', 'tt11280740')
  assert.equal(sev.year, '2022')
  assert.equal(sev.videos.length, 20)
  assert.equal(sev.videos[0].id, 'tt11280740:1:1')
  assert.equal(sev.videos[8].id, 'tt11280740:1:9')
  assert.equal(sev.videos[9].id, 'tt11280740:2:1')
  assert.equal(sev.videos[18].id, 'tt11280740:2:10')
  assert.equal(sev.videos[19].id, 'tt11280740:0:1') // the special, last
  assert.equal(sev.videos[3].title, 'The You You Are')
  assert.equal(sev.videos[3].season, 1)
  assert.equal(sev.videos[3].episode, 4)
  assert.match(sev.videos[3].thumbnail, /metahub/)
  assert.equal(sev.videos[3].released.slice(0, 10), '2022-03-11')
})

test('Meta: field fallbacks (title|name, overview|description, released|available) and tidy-ups', () => {
  const m = new Meta({
    id: 'tt1', type: 'series', name: 'N', releaseInfo: '2020-', runtime: '45 min', genres: ['a', 'b', 'c', 'd'], poster: '', background: null,
    videos: [{ id: 'tt1:1:2', season: 1, episode: 2, name: 'Second', description: 'D', available: '2020-01-02' }, { id: 'tt1:1:1', season: 1, episode: 1, title: 'First', overview: 'O', released: '2020-01-01' }],
  })
  assert.equal(m.year, '2020')
  assert.equal(m.runtime, '45 min')
  assert.deepEqual(m.genres, ['a', 'b', 'c'])
  assert.equal(m.poster, null)
  assert.equal(m.background, null)
  assert.deepEqual(m.videos.map(v => [v.id, v.title, v.overview, v.released]), [['tt1:1:1', 'First', 'O', '2020-01-01'], ['tt1:1:2', 'Second', 'D', '2020-01-02']])
  assert.equal(new Meta({ id: 'tt2', releaseInfo: '2019 – ' }).year, '2019')
  assert.equal(new Meta({ id: 'tt2' }).info, '')
  assert.throws(() => new Meta({ name: 'no id' }))
})

test('a catalog entry without an id is skipped instead of failing the whole row', async () => {
  const { cinemeta } = setup({ overrides: { 'https://v3-cinemeta.strem.io/catalog/movie/top.json': JSON.stringify({ metas: [{ id: 'tt1', name: 'A' }, { name: 'broken' }, { id: 'tt2', name: 'B' }] }) } })
  assert.deepEqual((await cinemeta.catalog(cinemeta.catalogs[0])).map(m => m.id), ['tt1', 'tt2'])
})

test('search: every search catalog of the add-on, in catalog order; the query is percent-encoded', async () => {
  const { cinemeta, http, catalogs } = setup()
  const results = await cinemeta.search('dune')
  assert.deepEqual(results.map(m => m.id), ['tt15239678', 'tt1160419', 'tt0142032'])
  assert.deepEqual(http.log.map(l => l.url), [
    'https://v3-cinemeta.strem.io/catalog/movie/top/search=dune.json',
    'https://v3-cinemeta.strem.io/catalog/series/top/search=dune.json',
  ])
  assert.equal(http.log[0].opts.timeoutMs, 5000)
  const other = await catalogs.search('dune')
  assert.deepEqual(other.map(m => m.id), ['tt15239678'])
  await assert.rejects(cinemeta.search('   '))
})

test('search: one failing catalog does not fail the search, all failing does', async () => {
  const one = setup({ overrides: { 'https://v3-cinemeta.strem.io/catalog/movie/top/search=dune.json': new Error('boom') } })
  assert.deepEqual((await one.cinemeta.search('dune')).map(m => m.id), ['tt0142032'])
  const all = setup({ overrides: {
    'https://v3-cinemeta.strem.io/catalog/movie/top/search=dune.json': new Error('boom'),
    'https://v3-cinemeta.strem.io/catalog/series/top/search=dune.json': '{"nometas":true}', // "Search catalog failed"
  } })
  await assert.rejects(all.cinemeta.search('dune'), /Search catalog unavailable/)
  const none = new Addon({ transportUrl: 'https://x/manifest.json', manifest: { id: 'x', name: 'x', catalogs: [{ type: 'movie', id: 'a' }] } }, { http: fakeHttp() })
  assert.deepEqual(await none.search('dune'), []) // nothing to ask is not a failure
})

test('search: the deadline leaves out slow catalogs but keeps the answers that came', async () => {
  const slow = 'https://v3-cinemeta.strem.io/catalog/movie/top/search=dune.json'
  const { cinemeta } = setup({ delays: { [slow]: 400 } })
  const results = await cinemeta.search('dune', 60)
  assert.deepEqual(results.map(m => m.id), ['tt0142032']) // the series catalog answered, the movie one did not make it
})

test('search: encodes spaces and unicode, and keeps only movie/series search catalogs once per (type, id)', async () => {
  const http = fakeHttp({ overrides: {} })
  const urls = []
  http.get = async url => { urls.push(url); return '{"metas":[]}' }
  const a = new Addon({ transportUrl: 'https://x.example/addon/manifest.json', manifest: { id: 'x', name: 'x', catalogs: [
    { type: 'movie', id: 'a', extra: [{ name: 'search' }] }, { type: 'movie', id: 'a', extra: [{ name: 'search', isRequired: true }] },
    { type: 'other', id: 'o', extra: [{ name: 'search' }] }, { type: 'series', id: 's', extraRequired: ['search'] },
    { type: 'series', id: 'g', extraRequired: ['search', 'genre'], extraSupported: ['search', 'genre'] },
    { type: 'movie', id: 'req', extra: [{ name: 'search' }, { name: 'genre', isRequired: true }] },
  ] } }, { http })
  await a.search('Amélie & Co')
  assert.deepEqual(urls, [
    'https://x.example/addon/catalog/movie/a/search=Am%C3%A9lie%20%26%20Co.json',
    'https://x.example/addon/catalog/series/s/search=Am%C3%A9lie%20%26%20Co.json',
  ])
})

test('similar: needs the required "similar" extra and a matching id prefix', async () => {
  const { catalogs, cinemeta, http } = setup()
  const more = await catalogs.similar('movie', 'tt15239678')
  assert.deepEqual(more.map(m => m.id), ['tt0816692', 'tt1856101', 'tt2543164'])
  assert.equal(http.log[0].url, 'https://catalogs.example.org/catalog/movie/ex.similar/similar=tt15239678.json')
  assert.equal(await catalogs.similar('series', 'tt11280740'), null)
  assert.equal(await catalogs.similar('movie', 'kitsu:1'), null)
  assert.equal(await cinemeta.similar('movie', 'tt15239678'), null)
})

test('streams: only streams with a url; the 20 fixture streams of the movie parse', async () => {
  const { torrentio, aio } = setup()
  const a = await torrentio.streams('movie', 'tt15239678')
  assert.equal(a.length, 16) // the two torrent-only results are dropped
  const b = await aio.streams('movie', 'tt15239678')
  assert.equal(b.length, 4)
  assert.equal(a.length + b.length, 20)
  assert.equal(b[0].isVideo, false) // the "Mark Watched" action
  assert.equal(b[1].mayNotPlay, true) // needs a Referer
  assert.equal(b[2].mayNotPlay, false) // only a User-Agent
  assert.equal(b[3].isVideo, false) // a 38 MB sample
  const ep = await torrentio.streams('series', 'tt11280740:1:4')
  assert.equal(ep.length, 3)
})

test('stream requests are not kept (links expire) and ask for the colon-bearing id as is', async () => {
  const { torrentio, http } = setup()
  await torrentio.streams('series', 'tt11280740:1:4')
  assert.equal(http.log[0].url, 'https://torrentio.strem.fun/stream/series/tt11280740:1:4.json')
  assert.equal(http.log[0].opts.keep, false)
})

test('subtitles: url + lang, "und" when missing, entries without a url dropped', async () => {
  const { subs } = setup()
  const list = await subs.subtitles('movie', 'tt15239678')
  assert.equal(list.length, 10)
  assert.equal(list[0].lang, 'eng')
  assert.equal(list[0].addon, 'OpenSubtitles v3')
  const loose = setup({ overrides: { 'https://opensubtitles-v3.strem.io/subtitles/movie/tt1.json': JSON.stringify({ subtitles: [{ url: 'https://s/a.srt' }, { lang: 'eng' }, { url: ' ', lang: 'fre' }] }) } })
  const got = await loose.subs.subtitles('movie', 'tt1')
  assert.deepEqual(got.map(s => [s.url, s.lang]), [['https://s/a.srt', 'und']])
})

test('Subtitle: language name, mime type, and "in the TV\'s language"', () => {
  const sub = (lang, url = 'https://s/a.srt') => new Subtitle(url, lang, 'OS')
  assert.equal(sub('eng').language, 'English')
  assert.equal(sub('en').language, 'English')
  assert.equal(sub('ger').language, 'German')
  assert.equal(sub('xx').language, 'xx')
  assert.equal(sub('eng', 'https://s/a.srt?x=1').mimeType, 'application/x-subrip')
  assert.equal(sub('eng', 'https://s/A.VTT?x=1').mimeType, 'text/vtt')
  assert.equal(sub('eng', 'https://s/a.ass').mimeType, 'text/x-ssa')
  assert.equal(sub('eng', 'https://s/a.ssa').mimeType, 'text/x-ssa')
  assert.equal(sub('eng', 'https://s/download/123').mimeType, 'application/x-subrip') // unknown extension: SubRip, like Alder
  assert.equal(sub('eng', 'https://s/a.vtt').format, 'vtt')
  assert.equal(sub('eng').isLocal('en'), true)
  assert.equal(sub('en').isLocal('en-US'), true)
  assert.equal(sub('ger').isLocal('de'), true)
  assert.equal(sub('deu').isLocal('de_DE'), true)
  assert.equal(sub('fre').isLocal('en'), false)
  assert.equal(sub('eng').isEnglish(), true)
  assert.equal(sub('hin').isEnglish(), false)
})

test('fixture layout: every URL the app builds for the demo account resolves to a fixture file', async () => {
  const { cinemeta } = setup()
  for (const url of [
    'https://api.strem.io/api/addonCollectionGet', 'https://api.strem.io/api/datastoreGet', 'https://api.strem.io/api/datastorePut',
    'https://link.stremio.com/api/v2/create?type=Create', 'https://link.stremio.com/api/v2/read?type=Read&code=ALDR-7K2Q',
    'https://api.introdb.app/segments?imdb_id=tt11280740&season=1&episode=4',
    'https://v3-cinemeta.strem.io/meta/series/tt11280740.json', 'https://torrentio.strem.fun/stream/movie/tt15239678.json',
    'https://opensubtitles-v3.strem.io/subtitles/series/tt11280740:1:4.json',
  ]) assert.ok(fixturePath(url), url)
  assert.equal(fixturePath('https://v3-cinemeta.strem.io/catalog/movie/nope.json'), null)
  assert.ok(cinemeta)
})
