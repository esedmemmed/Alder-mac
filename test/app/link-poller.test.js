import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinkPoller, POLL_MS, EXPIRE_MS, RETRY_MS } from '../../src/app/link-poller.js'
import { manualTime } from '../core/helpers.js'

const settle = () => new Promise(r => setImmediate(r))

function setup(over = {}) {
  const time = manualTime()
  const events = []
  let codes = 0
  const answers = over.answers || []
  const stremio = {
    createLink: over.createLink || (async () => ({ code: 'C' + (++codes), url: 'https://link.stremio.com/?c=' + codes })),
    readLink: async code => { events.push('read ' + code); const a = answers.shift(); if (a instanceof Error) throw a; return a === undefined ? null : a },
  }
  const poller = createLinkPoller({
    stremio, timers: time.timers, now: time.now,
    onCode: l => events.push('code ' + l.code), onTick: s => events.push('tick ' + s), onApproved: k => events.push('approved ' + k),
    onTrouble: m => events.push('trouble ' + m),
  })
  return { time, events, poller, stremio }
}

test('shows the code, counts down, and polls every 3 s until approved', async () => {
  const { time, events, poller } = setup({ answers: [null, null, 'KEY'] })
  await poller.start()
  assert.deepEqual(events.slice(0, 2), ['code C1', 'tick 300'])
  time.advance(POLL_MS); await settle()
  time.advance(POLL_MS); await settle()
  time.advance(POLL_MS); await settle()
  assert.equal(events.filter(e => e.startsWith('read')).length, 3)
  assert.equal(events[events.length - 1], 'approved KEY')
  assert.ok(events.includes('tick 297'), 'the countdown ticks each second')
  const before = events.length
  time.advance(10000); await settle()
  assert.equal(events.length, before, 'after approval nothing more happens')
})

test('a network blip while polling is "not yet"', async () => {
  const { time, events, poller } = setup({ answers: [new Error('offline'), 'KEY'] })
  await poller.start()
  time.advance(POLL_MS); await settle()
  time.advance(POLL_MS); await settle()
  assert.equal(events[events.length - 1], 'approved KEY')
})

test('a fresh code every 5 minutes', async () => {
  const { time, events, poller } = setup()
  await poller.start()
  for (let t = 0; t <= EXPIRE_MS + POLL_MS; t += 1000) { time.advance(1000); await settle() }
  await settle()
  assert.ok(events.includes('code C2'), 'a second code was made')
  poller.stop()
})

test('a code that cannot be made is retried after 5 s; stop() silences everything', async () => {
  let fails = 1
  const { time, events, poller } = setup({
    createLink: async () => { if (fails-- > 0) throw new Error('offline'); return { code: 'OK1', url: 'u' } },
  })
  await poller.start()
  assert.deepEqual(events, ['trouble Can\'t reach Stremio. Trying again…'])
  time.advance(RETRY_MS); await settle(); await settle()
  assert.ok(events.includes('code OK1'))
  poller.stop()
  const n = events.length
  time.advance(30000); await settle()
  assert.equal(events.length, n)
})

test('stop() while a code is being made drops the answer', async () => {
  let release
  const { events, poller } = setup({ createLink: () => new Promise(r => { release = r }) })
  const p = poller.start()
  poller.stop()
  release({ code: 'LATE', url: 'u' })
  await p
  assert.deepEqual(events, [])
})
