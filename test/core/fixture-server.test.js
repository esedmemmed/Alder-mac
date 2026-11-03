// The fixtures must be reachable through the real dev server's lookup (dev/fixture-server.mjs, Phase 1), not just through the
// test helper's simpler rule. Pure file lookup: no server is started.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findFixture } from '../../dev/fixture-server.mjs'
import { FIXTURES } from './helpers.js'

const find = (host, path, method = 'GET', body = '') => findFixture(FIXTURES, host, path, method, body)

test('dev server lookup finds the Stremio API fixtures, for POST bodies with a type or a collection', () => {
  assert.match(find('api.strem.io', '/api/addonCollectionGet', 'POST', '{"type":"AddonCollectionGet","authKey":"k","update":true}'), /addonCollectionGet\.json$/)
  assert.match(find('api.strem.io', '/api/datastoreGet', 'POST', '{"authKey":"k","collection":"libraryItem","ids":[],"all":true}'), /datastoreGet\.json$/)
  assert.match(find('api.strem.io', '/api/datastorePut', 'POST', '{"authKey":"k","collection":"libraryItem","changes":[]}'), /datastorePut\.json$/)
  assert.match(find('api.strem.io', '/api/addonCollectionSet', 'POST', '{"type":"AddonCollectionSet"}'), /addonCollectionSet\.json$/)
  assert.match(find('api.strem.io', '/api/logout', 'POST', '{"type":"Logout"}'), /logout\.json$/)
  assert.match(find('link.stremio.com', '/api/v2/create'), /create\.json$/)
  assert.match(find('link.stremio.com', '/api/v2/read'), /read\.json$/)
  assert.match(find('api.introdb.app', '/segments'), /segments\.json$/)
})

test('dev server lookup finds add-on manifests, catalogs, metas, streams and subtitles by host', () => {
  for (const [host, path] of [
    ['v3-cinemeta.strem.io', '/catalog/movie/top.json'],
    ['v3-cinemeta.strem.io', '/catalog/movie/top/genre=Sci-Fi.json'],
    ['v3-cinemeta.strem.io', '/catalog/movie/top/search=dune.json'],
    ['v3-cinemeta.strem.io', '/meta/series/tt11280740.json'],
    ['torrentio.strem.fun', '/manifest.json'],
    ['torrentio.strem.fun', '/stream/movie/tt15239678.json'],
    ['torrentio.strem.fun', '/stream/series/tt11280740:1:4.json'],
    ['aio.example.org', '/stream/movie/tt15239678.json'],
    ['opensubtitles-v3.strem.io', '/subtitles/series/tt11280740:1:4.json'],
    ['catalogs.example.org', '/catalog/movie/ex.similar/similar=tt15239678.json'],
    ['subs.fixture.test', '/dune2/eng-1.srt'],
  ]) assert.ok(find(host, path), host + path)
  assert.equal(find('v3-cinemeta.strem.io', '/catalog/movie/nope.json'), null)
})

test('every subtitle file the OpenSubtitles fixtures name exists', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = path.join(FIXTURES, 'opensubtitles-v3.strem.io', 'subtitles')
  const missing = []
  for (const kind of fs.readdirSync(dir)) {
    for (const file of fs.readdirSync(path.join(dir, kind))) {
      const answer = JSON.parse(fs.readFileSync(path.join(dir, kind, file), 'utf8'))
      for (const sub of answer.subtitles || []) {
        const u = new URL(sub.url)
        if (!fs.existsSync(path.join(FIXTURES, u.host, u.pathname))) missing.push(sub.url)
      }
    }
  }
  assert.deepEqual(missing, [])
})
