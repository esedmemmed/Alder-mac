import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession, coreHttp } from '../../src/app/session.js'
import { fakeHttp, memoryStore } from '../core/helpers.js'

const KEY = 'FIXTURE-AUTH-KEY-0001'
const make = (over = {}) => {
  const http = over.http || fakeHttp()
  const store = over.store || memoryStore()
  const session = createSession({ store, http, webapis: over.webapis, tvLanguage: () => 'en' })
  return { session, http, store }
}
const posts = (http, method) => http.log.filter(r => r.method === 'POST' && r.url.endsWith('/' + method))

test('no profile: nothing active, account calls refuse', async () => {
  const { session } = make()
  assert.equal(session.profile(), null)
  assert.equal(session.authKey(), null)
  assert.equal(session.savedAddons(), null)
  assert.equal(session.savedLibrary(), null)
  await assert.rejects(session.addons(), /No profile/)
  await assert.rejects(session.library(), /No profile/)
})

test('profile(): the only profile is active; add makes the new one active', () => {
  const { session } = make()
  const a = session.profiles.add('Ann', KEY)
  assert.equal(session.profile().id, a.id)
  assert.equal(session.authKey(), KEY)
  const b = session.profiles.add('Bob', 'OTHER-KEY')
  assert.equal(session.profile().id, b.id)
  assert.equal(session.authKey(), 'OTHER-KEY')
  session.profiles.setActive(a.id)
  assert.equal(session.profile().name, 'Ann')
})

test('onProfileChange fires on switch, add and removing the active profile; not on no-ops; unsubscribe works', () => {
  const { session } = make()
  const seen = []
  const off = session.onProfileChange(p => seen.push(p ? p.name : null))
  session.profiles.add('Ann', KEY)
  session.profiles.add('Bob', 'K2')
  session.profiles.setActive('2')
  assert.deepEqual(seen, ['Ann', 'Bob'])
  session.profiles.setActive('1')
  session.profiles.setActive('1')
  assert.deepEqual(seen, ['Ann', 'Bob', 'Ann'])
  session.profiles.remove('1') // the active one: the one profile left is the active one
  assert.equal(seen.length, 4)
  assert.equal(seen[3], 'Bob')
  session.profiles.add('Cy', 'K3')
  assert.equal(seen.length, 5)
  off()
  session.profiles.setActive('2')
  assert.equal(seen.length, 5)
})

test('addons: the network once, then the kept list; refresh asks again', async () => {
  const { session, http } = make()
  session.profiles.add('Ann', KEY)
  assert.equal(session.savedAddons(), null)
  const first = await session.addons()
  assert.equal(first.length, 6)
  assert.equal(first[0].name, 'Cinemeta')
  assert.equal(posts(http, 'addonCollectionGet').length, 1)
  assert.ok(session.savedAddons(), 'the answer was kept')
  const again = await session.addons()
  assert.equal(again.length, 6)
  assert.equal(posts(http, 'addonCollectionGet').length, 1, 'no second request')
  await session.addons({ refresh: true })
  assert.equal(posts(http, 'addonCollectionGet').length, 2)
})

test('meta: first add-on serving it; kept copy when the request fails', async () => {
  const { session, http } = make()
  session.profiles.add('Ann', KEY)
  assert.equal(session.savedMeta('movie', 'tt15239678'), null)
  const meta = await session.meta('movie', 'tt15239678')
  assert.match(meta.name, /Dune/)
  assert.equal(session.savedMeta('movie', 'tt15239678').id, 'tt15239678')
  assert.equal(await session.meta('movie', 'tt0000000x'), null, 'no such file: null, not a throw')
  // a failing network falls back to the kept copy
  const failing = fakeHttp({ overrides: { 'https://v3-cinemeta.strem.io/meta/movie/tt15239678.json': new Error('offline') } })
  failing.keep = http.keep
  failing.saved = http.saved
  const down = createSession({ store: memoryStore(), http: Object.assign(failing, { get: (u, o) => (u.includes('/meta/') ? Promise.reject(new Error('offline')) : http.get(u, o)), post: http.post }) })
  down.profiles.add('Ann', KEY)
  const kept = await down.meta('movie', 'tt15239678')
  assert.equal(kept && kept.id, 'tt15239678')
})

test('library: fetched, kept, saved back to Stremio', async () => {
  const { session, http } = make()
  session.profiles.add('Ann', KEY)
  assert.equal(session.savedLibrary(), null)
  const items = await session.library()
  assert.equal(items.length, 7)
  assert.equal(session.savedLibrary().length, 7)
  await session.library()
  assert.equal(posts(http, 'datastoreGet').length, 1, 'the kept library answers')
  await session.library({ refresh: true })
  assert.equal(posts(http, 'datastoreGet').length, 2)
  const dune = items.find(i => i._id === 'tt15239678')
  assert.ok(session.books.continueWatching(items).some(i => i._id === 'tt15239678'))
  session.books.setInList(dune, true)
  await session.saveLibrary([dune])
  const put = posts(http, 'datastorePut')
  assert.equal(put.length, 1)
  const body = JSON.parse(put[0].body)
  assert.equal(body.authKey, KEY)
  assert.equal(body.changes[0]._id, 'tt15239678')
})

test('settings follow the active profile (taste is per profile); device.av1 follows the toggle', () => {
  const { session } = make()
  session.profiles.add('Ann', KEY)
  session.profiles.add('Bob', 'K2')
  const release = session.settings.choice('release')
  session.profiles.setActive('1')
  session.settings.set(release, 'remux')
  assert.equal(session.settings.release(), 'remux')
  session.profiles.setActive('2')
  assert.equal(session.settings.release(), '')
  session.profiles.setActive('1')
  assert.equal(session.settings.release(), 'remux')
  assert.equal(session.device.av1, false)
  session.settings.set(session.settings.choice('av1'), true)
  assert.equal(session.device.av1, true)
  assert.equal(session.device.height, 2160)
})

test('coreHttp gives the core its `saved` from lib/http savedAnswer', () => {
  const raw = { savedAnswer: (u, j) => 'kept:' + u + ':' + j, get: () => 1 }
  const http = coreHttp(raw)
  assert.equal(http.saved('u', 'j'), 'kept:u:j')
  assert.equal(http.get(), 1)
})

test('ranker: bound to settings, device and memory', async () => {
  const { session } = make()
  session.profiles.add('Ann', KEY)
  const ranker = session.ranker({ videoId: 'tt15239678', metaId: 'tt15239678' })
  assert.equal(typeof ranker.rank, 'function')
  assert.equal(ranker.tv, session.device)
})

test('finder: Play finds sources across the stream add-ons and hands over a short list', async () => {
  const { session } = make()
  session.profiles.add('Ann', KEY)
  const played = await new Promise((resolve, reject) => {
    const finder = session.finder({ type: 'movie', id: 'tt15239678', videoId: 'tt15239678', onPlay: resolve, onList: m => reject(new Error('listed: ' + m.count)), onStatus: reject })
    finder.start()
  })
  assert.ok(played.length >= 1 && played.length <= 3)
  assert.ok(played.every(s => s.url))
})

test('finder with pick lists every playable source, BEST MATCH first', async () => {
  const { session } = make()
  session.profiles.add('Ann', KEY)
  const model = await new Promise((resolve, reject) => {
    session.finder({ type: 'movie', id: 'tt15239678', videoId: 'tt15239678', pick: true, onPlay: () => reject(new Error('played')), onList: resolve }).start()
  })
  assert.ok(model.count >= 10)
  assert.ok(model.best)
  assert.equal(model.rows[0].best, true)
})

test('finder: sharing profiles lend their stream add-ons, and a cancelled finder stays silent', async () => {
  const { session, http } = make()
  session.profiles.add('Ann', KEY)
  session.profiles.add('Bob', 'KEY-BOB')
  session.profiles.setSharesStreams('1', true)
  const played = await new Promise((resolve, reject) => {
    session.finder({ type: 'movie', id: 'tt15239678', videoId: 'tt15239678', onPlay: resolve, onList: reject, onStatus: reject }).start()
  })
  assert.ok(played.length > 0)
  const asked = posts(http, 'addonCollectionGet').map(r => JSON.parse(r.body).authKey)
  assert.ok(asked.includes('KEY-BOB') && asked.includes(KEY), 'both accounts were read: ' + asked)

  let called = false
  const f = session.finder({ type: 'movie', id: 'tt15239678', videoId: 'tt15239678', onPlay: () => { called = true }, onList: () => { called = true } })
  f.start()
  f.cancel()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(called, false)
})

test('finder: no profile, or an account whose add-on list fails, says so', async () => {
  const { session } = make()
  const codes = []
  session.finder({ type: 'movie', id: 'x', videoId: 'x', onStatus: c => codes.push(c) }).start()
  assert.deepEqual(codes, ['no-addons'])

  const failing = fakeHttp({ overrides: { 'https://api.strem.io/api/addonCollectionGet': new Error('offline') } })
  const s2 = createSession({ store: memoryStore(), http: failing })
  s2.profiles.add('Ann', KEY)
  const code = await new Promise(resolve => s2.finder({ type: 'movie', id: 'x', videoId: 'x', onStatus: resolve }).start())
  assert.equal(code, 'addons-failed')
})

test('removeProfile: gone, kept answers forgotten, Stremio told', async () => {
  const http = fakeHttp()
  let forgotten = 0
  http.forget = () => { forgotten++ }
  const { session } = make({ http })
  session.profiles.add('Ann', KEY)
  session.profiles.add('Bob', 'KEY-BOB')
  session.removeProfile('2')
  assert.deepEqual(session.profiles.all().map(p => p.name), ['Ann'])
  assert.equal(forgotten, 1)
  await new Promise(r => setTimeout(r, 20))
  const out = posts(http, 'logout')
  assert.equal(out.length, 1)
  assert.equal(JSON.parse(out[0].body).authKey, 'KEY-BOB')
})

test('sign-in flow pieces: createLink then readLink through the session stremio', async () => {
  const { session } = make()
  const link = await session.stremio.createLink()
  assert.equal(link.code, 'ALDR-7K2Q')
  assert.equal(await session.stremio.readLink(link.code), KEY)
})

test('login: e-mail and password give the auth key; a refusal is an ApiException; the request body is Stremio\'s', async () => {
  const { session, http } = make()
  assert.equal(await session.login(' viewer@fixture.test ', 'secret'), KEY)
  const sent = JSON.parse(posts(http, 'login')[0].body)
  assert.deepEqual(sent, { type: 'Login', email: 'viewer@fixture.test', password: 'secret', facebook: false })
  const refused = fakeHttp({ overrides: { 'https://api.strem.io/api/login': '{"error":{"code":2,"message":"Wrong e-mail or password"}}' } })
  const s2 = createSession({ store: memoryStore(), http: refused })
  await assert.rejects(s2.login('a@b.c', 'x'), e => e.name === 'ApiException' && e.code === 2 && /Wrong/.test(e.message))
})

test('the add-on list is parsed once: savedMeta and meta do not re-read the kept answer', async () => {
  const { session, http } = make()
  session.profiles.add('Ann', KEY)
  await session.addons()
  let reads = 0
  const saved = http.saved
  session.http.saved = (...a) => { reads++; return saved(...a) }
  for (let i = 0; i < 20; i++) session.savedMeta('movie', 'tt15239678')
  assert.equal(reads <= 22, true)
  const before = reads
  session.savedMeta('movie', 'tt15239678')
  assert.equal(reads - before <= 2, true, 'one kept meta per call, no add-on list re-reads')
})
