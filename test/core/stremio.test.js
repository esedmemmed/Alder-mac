import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStremio, ApiException, NO_SESSION, API, LINK } from '../../src/core/stremio.js'
import { fakeHttp, fixtureJson } from './helpers.js'

const KEY = 'FIXTURE-AUTH-KEY-0001'
const setup = opts => {
  const http = fakeHttp(opts)
  return { http, stremio: createStremio({ http }) }
}

test('endpoints are Stremio\'s', () => {
  assert.equal(API, 'https://api.strem.io/api/')
  assert.equal(LINK, 'https://link.stremio.com/api/v2/')
  assert.equal(NO_SESSION, 1)
})

test('createLink: code and the URL to show (the QR encodes it)', async () => {
  const { stremio, http } = setup()
  assert.deepEqual(await stremio.createLink(), { code: 'ALDR-7K2Q', url: 'https://www.stremio.com/link?code=ALDR-7K2Q' })
  assert.equal(http.log[0].url, 'https://link.stremio.com/api/v2/create?type=Create')
  assert.equal(http.log[0].method, 'GET')
})

test('readLink: the auth key once approved; null while waiting or expired (101); other errors throw', async () => {
  const ok = setup()
  assert.equal(await ok.stremio.readLink('ALDR-7K2Q'), KEY)
  assert.equal(ok.http.log[0].url, 'https://link.stremio.com/api/v2/read?type=Read&code=ALDR-7K2Q')

  const url = 'https://link.stremio.com/api/v2/read?type=Read&code=ALDR-7K2Q'
  const waiting = setup({ overrides: { [url]: JSON.stringify(fixtureJson('link.stremio.com/api/v2/read-waiting.json')) } })
  assert.equal(await waiting.stremio.readLink('ALDR-7K2Q'), null)

  const broken = setup({ overrides: { [url]: '{"error":{"code":500,"message":"Internal error"}}' } })
  await assert.rejects(broken.stremio.readLink('ALDR-7K2Q'), e => e instanceof ApiException && e.code === 500 && e.message === 'Internal error')
})

test('addons: the exact request body, parsed in the account\'s order, cached until refresh', async () => {
  const { stremio, http } = setup()
  const list = await stremio.addons(KEY)
  assert.deepEqual(list.map(a => a.name), ['Cinemeta', 'Torrentio', 'AIOStreams (example)', 'OpenSubtitles v3', 'Example Catalogs', 'Watchly (example)'])
  assert.equal(http.log[0].method, 'POST')
  assert.equal(http.log[0].url, 'https://api.strem.io/api/addonCollectionGet')
  assert.equal(http.log[0].body, `{"type":"AddonCollectionGet","authKey":"${KEY}","update":true}`)
  assert.equal(await stremio.addons(KEY), list) // from memory
  assert.equal(http.log.length, 1)
  const fresh = await stremio.addons(KEY, true)
  assert.equal(http.log.length, 2)
  assert.notEqual(fresh, list)
  assert.equal((await stremio.addons('OTHER-KEY')).length, 6) // per auth key
  assert.equal(http.log.length, 3)
})

test('addons are wired to the same http (their requests go through the injected client)', async () => {
  const { stremio, http } = setup()
  const [cinemeta] = await stremio.addons(KEY)
  await cinemeta.catalog(cinemeta.catalogs[0])
  assert.equal(http.log[http.log.length - 1].url, 'https://v3-cinemeta.strem.io/catalog/movie/top.json')
})

test('savedAddons: last time\'s list with no network, and it primes the in-memory list', async () => {
  const first = setup()
  assert.equal(first.stremio.savedAddons(KEY), null)
  await first.stremio.addons(KEY)
  // a "next launch": a new client over the same kept answers
  const second = createStremio({ http: first.http })
  const before = first.http.log.length
  const saved = second.savedAddons(KEY)
  assert.equal(saved.length, 6)
  assert.equal(first.http.log.length, before)
  assert.equal(await second.addons(KEY), saved) // details are asked of these until the fresh list arrives
  assert.equal(first.http.log.length, before)
  assert.equal(second.savedAddons('OTHER'), null)
})

test('error answers become ApiException with Stremio\'s code', async () => {
  const body = '{"error":{"code":1,"message":"Session does not exist"}}'
  const { stremio } = setup({ overrides: { [API + 'addonCollectionGet']: body, [API + 'datastoreGet']: body } })
  await assert.rejects(stremio.addons(KEY), e => e instanceof ApiException && e.code === NO_SESSION && /Session/.test(e.message))
  await assert.rejects(stremio.library(KEY), e => e instanceof ApiException && e.code === NO_SESSION)
})

test('an error answer is never kept as the saved list', async () => {
  const { stremio, http } = setup({ overrides: { [API + 'addonCollectionGet']: '{"error":{"code":1,"message":"x"}}' } })
  await assert.rejects(stremio.addons(KEY))
  assert.equal(stremio.savedAddons(KEY), null)
  assert.equal(http.savedMap.size, 0)
})

test('setAddons: replaces the list and its order, descriptors whole', async () => {
  const { stremio, http } = setup()
  const list = await stremio.addons(KEY)
  const reordered = [list[1], list[0]].concat(list.slice(2))
  await stremio.setAddons(KEY, reordered)
  const call = http.log[http.log.length - 1]
  assert.equal(call.url, 'https://api.strem.io/api/addonCollectionSet')
  const sent = JSON.parse(call.body)
  assert.equal(sent.type, 'AddonCollectionSet')
  assert.equal(sent.authKey, KEY)
  assert.deepEqual(sent.addons, reordered.map(a => a.descriptor))
  assert.equal(sent.addons[0].manifest.name, 'Torrentio')
  assert.equal(await stremio.addons(KEY), reordered) // cached as the new truth
})

test('library: all items by default (kept), or only the given ids (not kept)', async () => {
  const { stremio, http } = setup()
  const all = await stremio.library(KEY)
  assert.equal(all.length, 7)
  assert.equal(http.log[0].body, `{"authKey":"${KEY}","collection":"libraryItem","ids":[],"all":true}`)
  assert.equal(http.savedMap.size, 1)
  const one = await stremio.library(KEY, ['tt15239678'])
  assert.equal(http.log[1].body, `{"authKey":"${KEY}","collection":"libraryItem","ids":["tt15239678"],"all":false}`)
  assert.equal(http.savedMap.size, 1) // a partial answer must not replace the saved whole library
  assert.equal(one.length, 7) // (the fixture server answers the same file)
})

test('savedLibrary: the whole library as it was last time, or null', async () => {
  const first = setup()
  assert.equal(first.stremio.savedLibrary(KEY), null)
  await first.stremio.library(KEY)
  const next = createStremio({ http: first.http })
  const saved = next.savedLibrary(KEY)
  assert.equal(saved.length, 7)
  assert.equal(saved[0]._id, 'tt15239678')
})

test('saveLibrary: datastorePut with the changes; saves not yet seen by Stremio win over older server copies', async () => {
  const { stremio, http } = setup()
  const server = fixtureJson('api.strem.io/api/datastoreGet.json').result
  const dune = JSON.parse(JSON.stringify(server.find(i => i._id === 'tt15239678')))
  dune.state.timeOffset = 7777777
  dune._mtime = '2026-10-29T12:00:00.000Z' // newer than the server's copy (2026-10-27)
  await stremio.saveLibrary(KEY, [dune])
  const put = http.log[0]
  assert.equal(put.url, 'https://api.strem.io/api/datastorePut')
  const sent = JSON.parse(put.body)
  assert.deepEqual(Object.keys(sent), ['authKey', 'collection', 'changes'])
  assert.equal(sent.collection, 'libraryItem')
  assert.equal(sent.changes[0].state.timeOffset, 7777777)

  const got = await stremio.library(KEY)
  assert.equal(got.find(i => i._id === 'tt15239678'), dune) // our newer copy, not the server's
  assert.equal(got.find(i => i._id === 'tt11280740').state.timeOffset, 840000) // others as the server has them

  dune._mtime = '2020-01-01T00:00:00.000Z' // the server's copy is newer now
  const again = await stremio.library(KEY)
  assert.notEqual(again.find(i => i._id === 'tt15239678'), dune)
  assert.equal(again.find(i => i._id === 'tt15239678').state.timeOffset, 3960000)
})

test('saveLibrary: while the put is in flight the unsaved copy already wins (the page behind the player asks at the same time)', async () => {
  const slow = API + 'datastorePut'
  const { stremio } = setup({ delays: { [slow]: 40 } })
  const item = fixtureJson('api.strem.io/api/datastoreGet.json').result[0]
  item._mtime = '2030-01-01T00:00:00.000Z'
  item.state.timeOffset = 1
  const pending = stremio.saveLibrary(KEY, [item])
  const during = await stremio.library(KEY)
  assert.equal(during[0], item)
  await pending
})

test('saveLibrary: a failed put forgets the unsaved copy and rethrows', async () => {
  const { stremio } = setup({ overrides: { [API + 'datastorePut']: new Error('offline') } })
  const item = fixtureJson('api.strem.io/api/datastoreGet.json').result[0]
  item._mtime = '2030-01-01T00:00:00.000Z'
  await assert.rejects(stremio.saveLibrary(KEY, [item]), /offline/)
  const got = await stremio.library(KEY)
  assert.notEqual(got[0], item)
})

test('saveLibrary: an error answer from Stremio is a failure too', async () => {
  const { stremio } = setup({ overrides: { [API + 'datastorePut']: '{"error":{"code":2,"message":"nope"}}' } })
  await assert.rejects(stremio.saveLibrary(KEY, [{ _id: 'x', _mtime: 'z' }]), e => e instanceof ApiException && e.code === 2)
})

test('logout: forgets the in-memory list and posts Logout', async () => {
  const { stremio, http } = setup()
  await stremio.addons(KEY)
  await stremio.logout(KEY)
  const call = http.log[http.log.length - 1]
  assert.equal(call.url, 'https://api.strem.io/api/logout')
  assert.equal(call.body, `{"type":"Logout","authKey":"${KEY}"}`)
  await stremio.addons(KEY)
  assert.equal(http.log.filter(l => l.url.endsWith('addonCollectionGet')).length, 2)
})
