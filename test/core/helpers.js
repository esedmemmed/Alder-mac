// Shared test doubles for the core tests. No network: a fake `http` that answers from dev/fixtures, an in-memory store and
// a manual clock/timer. Only Node built-ins.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Addon, Stream } from '../../src/core/addon.js'
import { tu8000Profile } from '../../src/core/device.js'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dev', 'fixtures')

export function readFixture(rel) {
  return fs.readFileSync(path.join(FIXTURES, rel), 'utf8')
}
export const fixtureJson = rel => JSON.parse(readFixture(rel))

/**
 * Where a request URL lives under dev/fixtures, or null: `<host>/<path>`, with `.json` added when the path has no extension.
 * (dev/fixture-server.mjs tries a few more names for POSTs; the files here only need these two.)
 */
export function fixturePath(url) {
  const u = new URL(url)
  let p = decodeURIComponent(u.pathname)
  if (!p.endsWith('.json')) p += '.json'
  const rel = u.hostname + p.replace(/:/g, '__') // same rule as dev/fixture-server.mjs findFixture: ':' is '__' on disk
  return fs.existsSync(path.join(FIXTURES, rel)) ? rel : null
}

/**
 * http double with the contract the core expects: get / post / saved / keep. `log` records every request.
 * Unknown URLs reject like a network error; `overrides[url]` can be a string (answer) or an Error / function.
 */
export function fakeHttp({ overrides = {}, delays = {} } = {}) {
  const log = []
  const saved = new Map()
  const answer = (url, body) => {
    const o = overrides[url]
    if (o instanceof Error) throw o
    if (typeof o === 'function') return o(url, body)
    if (typeof o === 'string') return o
    const rel = fixturePath(url)
    if (!rel) throw new Error('No fixture for ' + url)
    return readFixture(rel)
  }
  const respond = async (method, url, body, opts) => {
    log.push({ method, url, body, opts })
    const delay = delays[url]
    if (delay) await new Promise(r => setTimeout(r, delay))
    const text = await answer(url, body)
    if (opts && opts.keep) saved.set(url + '\n' + (body || ''), text)
    return text
  }
  return {
    log,
    savedMap: saved,
    get: (url, opts = {}) => respond('GET', url, null, opts),
    post: (url, body, opts = {}) => respond('POST', url, body, opts),
    saved: (url, body) => (saved.has(url + '\n' + (body || '')) ? saved.get(url + '\n' + (body || '')) : null),
    keep: (url, body, text) => { saved.set(url + '\n' + (body || ''), text) },
  }
}

export function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: k => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : undefined),
    set: (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))) },
    remove: k => { data.delete(k) },
  }
}

/** A clock and a timer queue that only move when told to. */
export function manualTime(start = Date.UTC(2026, 9, 29, 12, 0, 0)) {
  let now = start
  let nextId = 1
  const timers = new Map()
  return {
    now: () => now,
    advance(ms) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
    timers: {
      setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id },
      clearTimeout: id => { timers.delete(id) },
    },
    pending: () => timers.size,
  }
}

export const tv = (over = {}) => Object.assign(tu8000Profile(), over)

/** A Stream from a release name (filename) plus the optional add-on title / description / size. */
export function stream(filename, { title = '', description = '', size = 8 * 1024 ** 3, bingeGroup = null, headers = {}, url } = {}) {
  return new Stream(title, description, url || 'https://media.fixture.test/' + encodeURIComponent(filename), headers, size, filename, bingeGroup)
}

/** Add-on objects from the fixture account, wired to a fake http. */
export function fixtureAddons(http) {
  const list = fixtureJson('api.strem.io/api/addonCollectionGet.json').result.addons
  return list.map(d => new Addon(d, { http }))
}

/** Ranker settings stub: just the getters the ranking reads. */
export function settingsStub(over = {}) {
  return Object.assign({
    release: () => '', hdrPref: () => '', dub: () => '', audioLanguage: () => 'en', maxHeight: () => 0, maxSizeGb: () => 0, hdr: () => true,
  }, over)
}
