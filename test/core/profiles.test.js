import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProfiles, MAX, COLORS } from '../../src/core/profiles.js'
import { createSettings } from '../../src/core/settings.js'
import { KEYS } from '../../src/core/keys.js'
import { memoryStore } from './helpers.js'

const make = () => {
  const store = memoryStore()
  return { store, profiles: createProfiles({ store }) }
}

test('constants: at most 5 profiles, Alder\'s five colours', () => {
  assert.equal(MAX, 5)
  assert.deepEqual(COLORS, ['#F3D9B1', '#C98E6A', '#8FA39A', '#A6A2BD', '#D3A66B'])
})

test('add: first free number, becomes active, at most five', () => {
  const { profiles, store } = make()
  const a = profiles.add('Ana', 'key-a')
  assert.deepEqual([a.id, a.name, a.color, a.authKey, a.pin], ['1', 'Ana', COLORS[0], 'key-a', null])
  assert.equal(profiles.active().id, '1')
  const b = profiles.add('Ben', 'key-b', COLORS[2])
  assert.equal(b.id, '2')
  assert.equal(b.color, COLORS[2])
  assert.equal(profiles.active().id, '2')
  profiles.remove('1')
  const c = profiles.add('Cy', 'key-c')
  assert.equal(c.id, '1') // the freed number is reused
  assert.deepEqual(profiles.all().map(p => p.id), ['2', '1'])
  profiles.add('D', 'k'); profiles.add('E', 'k'); profiles.add('F', 'k')
  assert.equal(profiles.all().length, 5)
  assert.throws(() => profiles.add('G', 'k'), /At most 5/)
  assert.ok(Array.isArray(store.get(KEYS.profiles)))
})

test('active: the one picked last, or the only one there is, else none', () => {
  const { profiles, store } = make()
  assert.equal(profiles.active(), null)
  assert.equal(profiles.activeId(), null)
  profiles.add('Ana', 'a')
  store.remove(KEYS.active)
  assert.equal(profiles.active().id, '1') // the only one
  profiles.add('Ben', 'b')
  store.remove(KEYS.active)
  assert.equal(profiles.active(), null) // two, none picked
  profiles.setActive('1')
  assert.equal(profiles.active().name, 'Ana')
  profiles.setActive('9') // stale id
  assert.equal(profiles.active(), null)
})

test('update: rename, PIN set and cleared, colour, keeping the place in the list', () => {
  const { profiles } = make()
  profiles.add('Ana', 'a'); profiles.add('Ben', 'b'); profiles.add('Cy', 'c')
  profiles.update('2', { name: 'Benny', pin: '1234' })
  assert.deepEqual(profiles.all().map(p => [p.id, p.name, p.pin]), [['1', 'Ana', null], ['2', 'Benny', '1234'], ['3', 'Cy', null]])
  profiles.update('2', { color: COLORS[4] })
  assert.equal(profiles.all()[1].color, COLORS[4])
  assert.equal(profiles.all()[1].pin, '1234') // untouched
  profiles.update('2', { clearPin: true })
  assert.equal(profiles.all()[1].pin, null)
  profiles.update('9', { name: 'ghost' }) // unknown id: nothing happens
  assert.equal(profiles.all().length, 3)
})

test('an unknown colour reads as the first colour; broken entries are skipped', () => {
  const store = memoryStore({ [KEYS.profiles]: [
    { id: '1', name: 'Ana', color: '#123456', authKey: 'a', pin: '' },
    { id: '2', name: 'NoKey', color: COLORS[1] },
    'junk',
    { id: '3', name: 'Cy', color: COLORS[3], authKey: 'c', pin: '0000' },
  ] })
  const profiles = createProfiles({ store })
  assert.deepEqual(profiles.all().map(p => [p.id, p.color, p.pin]), [['1', COLORS[0], null], ['3', COLORS[3], '0000']])
})

test('sharing: a profile lends its stream add-ons; lenders are the others who share', () => {
  const { profiles } = make()
  profiles.add('Ana', 'a'); profiles.add('Ben', 'b'); profiles.add('Cy', 'c')
  assert.deepEqual(profiles.streamLenders(), [])
  profiles.setSharesStreams('1', true)
  profiles.setSharesStreams('3', true)
  assert.equal(profiles.active().id, '3') // Cy
  assert.deepEqual(profiles.streamLenders().map(p => p.name), ['Ana']) // not itself
  profiles.setActive('2')
  assert.deepEqual(profiles.streamLenders().map(p => p.name), ['Ana', 'Cy'])
  profiles.setSharesStreams('1', false)
  assert.deepEqual(profiles.streamLenders().map(p => p.name), ['Cy'])
  assert.equal(profiles.sharesStreams('3'), true)
  assert.equal(profiles.sharesStreams('2'), false)
})

test('remove: the profile, its sharing flag, its taste in Settings and its recent searches all go', () => {
  const { profiles, store } = make()
  profiles.add('Ana', 'a'); profiles.add('Ben', 'b')
  const settings = createSettings({ store, activeProfileId: profiles.activeId })
  profiles.setActive('2')
  settings.set(settings.choice('release'), 'remux')
  settings.set(settings.choice('dub'), 'original')
  settings.set(settings.choice('audioLang'), 'de')
  settings.set(settings.choice('maxHeight'), 1080) // shared by every profile: stays
  profiles.setSharesStreams('2', true)
  store.set(KEYS.recentSearches('2'), 'dune\nsevence')
  profiles.remove('2')
  assert.deepEqual(profiles.all().map(p => p.id), ['1'])
  assert.equal(store.get(KEYS.active), undefined)
  for (const k of [KEYS.shareStreams('2'), KEYS.profileSetting('release', '2'), KEYS.profileSetting('dub', '2'), KEYS.profileSetting('audioLang', '2'), KEYS.recentSearches('2')])
    assert.equal(store.get(k), undefined, k)
  assert.equal(store.get(KEYS.setting('maxHeight')), 1080)
  // a new profile in its place starts with no taste
  profiles.add('New', 'n')
  assert.equal(profiles.active().id, '2')
  assert.equal(settings.release(), '')
  settings.set(settings.choice('release'), 'web')
  profiles.setActive('1')
  assert.equal(settings.release(), '')
})
