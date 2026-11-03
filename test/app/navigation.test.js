import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstScreen, playerNavigation, episodeLine } from '../../src/app/navigation.js'

const profiles = list => ({ all: () => list })

test('first screen: no profile signs in, several or a PIN pick, a single plain one opens Home', () => {
  assert.equal(firstScreen(profiles([])).name, 'signin')
  assert.equal(firstScreen(profiles([{ id: 'a', pin: null }, { id: 'b', pin: null }])).name, 'profiles')
  assert.equal(firstScreen(profiles([{ id: 'a', pin: '1234' }])).name, 'profiles')
  const one = firstScreen(profiles([{ id: 'a', pin: null }]))
  assert.equal(one.name, 'home')
  assert.equal(one.open.id, 'a')
})

test('episodeLine', () => {
  assert.equal(episodeLine({ season: 1, episode: 5, title: 'Hello, Ms. Cobel' }), 'S1 E5  ·  Hello, Ms. Cobel')
  assert.equal(episodeLine({ season: 2, episode: 1, title: ' ' }), 'S2 E1')
  assert.equal(episodeLine(null), null)
})

function fakeRouter(stack) {
  const calls = []
  return {
    calls,
    stack,
    top: () => stack[stack.length - 1] || null,
    names: () => stack.map(e => e.name),
    pop() { calls.push('pop'); if (stack.length <= 1) return false; stack.pop(); return true },
    replace(name, params) { calls.push('replace ' + name); stack.pop(); stack.push({ name, params }) },
  }
}

const PLAYER = { type: 'series', metaId: 'tt1', videoId: 'tt1:1:4', name: 'Severance', poster: 'p', episode: 'S1 E4  ·  X', nextVideoId: 'tt1:1:5' }

test('exit pops the player', () => {
  const r = fakeRouter([{ name: 'home', params: {} }, { name: 'details', params: {} }, { name: 'player', params: PLAYER }])
  playerNavigation(r)({ kind: 'exit' })
  assert.deepEqual(r.names(), ['home', 'details'])
})

test('sources replaces the player with the sources page for the same video, with the player\'s asks', () => {
  const r = fakeRouter([{ name: 'home', params: {} }, { name: 'details', params: {} }, { name: 'player', params: PLAYER }])
  playerNavigation(r)({ kind: 'sources', pick: true, resumeAt: 5000, message: '2 sources didn\'t play' })
  assert.deepEqual(r.names(), ['home', 'details', 'streams'])
  const p = r.top().params
  assert.equal(p.id, 'tt1')
  assert.equal(p.videoId, 'tt1:1:4')
  assert.equal(p.pick, true)
  assert.equal(p.resumeAt, 5000)
  assert.equal(p.message, "2 sources didn't play")
  assert.equal(p.nextVideoId, 'tt1:1:5')
})

test('sources from a player opened over the list replaces that list instead of stacking a second one', () => {
  const r = fakeRouter([{ name: 'home', params: {} }, { name: 'streams', params: {} }, { name: 'player', params: PLAYER }])
  playerNavigation(r)({ kind: 'sources', pick: false, maxHeight: 1080, resumeAt: 100 })
  assert.deepEqual(r.names(), ['home', 'streams'])
  assert.equal(r.top().params.maxHeight, 1080)
  assert.equal(r.top().params.pick, false)
})

test('next starts the next episode through the sources page, not asking to pick', () => {
  const r = fakeRouter([{ name: 'home', params: {} }, { name: 'player', params: PLAYER }])
  playerNavigation(r)({ kind: 'next', video: { id: 'tt1:1:5', season: 1, episode: 5, title: 'Trojan\'s Horse' }, afterVideoId: 'tt1:1:6' })
  assert.deepEqual(r.names(), ['home', 'streams'])
  const p = r.top().params
  assert.equal(p.videoId, 'tt1:1:5')
  assert.equal(p.nextVideoId, 'tt1:1:6')
  assert.equal(p.pick, false)
  assert.equal(p.episode, "S1 E5  ·  Trojan's Horse")
})

test('details goes back to the title page below the player, else opens one', () => {
  const r = fakeRouter([{ name: 'home', params: {} }, { name: 'details', params: {} }, { name: 'streams', params: {} }, { name: 'player', params: PLAYER }])
  playerNavigation(r)({ kind: 'details' })
  assert.deepEqual(r.names(), ['home', 'details'])
  const r2 = fakeRouter([{ name: 'home', params: {} }, { name: 'player', params: PLAYER }])
  playerNavigation(r2)({ kind: 'details' })
  assert.deepEqual(r2.names(), ['home', 'details'])
  assert.equal(r2.top().params.id, 'tt1')
})
