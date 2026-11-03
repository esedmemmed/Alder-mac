import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSettings, nextSettingIndex, PRESETS, STREAMING, PICTURE_AND_SOUND, SUBTITLES, ADVANCED } from '../../src/core/settings.js'
import { KEYS } from '../../src/core/keys.js'
import { memoryStore } from './helpers.js'

const make = (initial, profile = '1', tvLanguage = () => 'en') => {
  const store = memoryStore(initial)
  let id = profile
  const settings = createSettings({ store, activeProfileId: () => id, tvLanguage })
  return { store, settings, setProfile: p => { id = p } }
}

test('defaults: no limits, no preference, HDR on, subtitles on at medium size, AV1 off', () => {
  const { settings } = make()
  assert.equal(settings.maxHeight(), 0)
  assert.equal(settings.maxSizeGb(), 0)
  assert.equal(settings.hdrPref(), '')
  assert.equal(settings.hdr(), true)
  assert.equal(settings.release(), '')
  assert.equal(settings.dub(), '')
  assert.equal(settings.alwaysList(), false)
  assert.equal(settings.subtitles(), true)
  assert.equal(settings.subtitleSize(), 100)
  assert.equal(settings.subtitleBackground(), true)
  assert.equal(settings.av1(), false)
})

test('hdr(): only "off" turns HDR and Dolby Vision off', () => {
  for (const [pref, hdr] of [['', true], ['dv', true], ['hdr10', true], ['off', false]]) {
    const { settings } = make({ 'settings/hdrPref': pref })
    assert.equal(settings.hdr(), hdr, pref)
  }
})

test('taste is per profile (release, dub, audio language); the rest is shared', () => {
  const { settings, setProfile } = make()
  settings.set(settings.choice('release'), 'remux')
  settings.set(settings.choice('maxHeight'), 1080)
  setProfile('2')
  assert.equal(settings.release(), '')
  assert.equal(settings.maxHeight(), 1080)
  settings.set(settings.choice('release'), 'web')
  assert.equal(settings.release(), 'web')
  setProfile('1')
  assert.equal(settings.release(), 'remux')
})

test('storage keys are the names Alder used', () => {
  const { settings, store } = make()
  settings.set(settings.choice('release'), 'encode')
  settings.set(settings.choice('maxSizeGb'), 20)
  settings.set(settings.choice('subBackground'), false)
  assert.equal(store.get('settings/release@1'), 'encode')
  assert.equal(store.get('settings/maxSizeGb'), 20)
  assert.equal(store.get('settings/subBackground'), false)
  assert.equal(settings.subtitleBackground(), false)
})

test('a stored value of the wrong type reads as the default (SharedPreferences are typed)', () => {
  const { settings } = make({ 'settings/maxHeight': '1080', 'settings/hdrPref': 5, 'settings/alwaysList': 'yes' })
  assert.equal(settings.maxHeight(), 0)
  assert.equal(settings.hdrPref(), '')
  assert.equal(settings.alwaysList(), false)
})

test('audioLanguage: this profile\'s pick, else the older shared key, else the TV language', () => {
  const a = make({}, '1', () => 'de')
  assert.equal(a.settings.audioLanguage(), 'de') // TV language
  a.store.set('settings/audioLang', 'fr')
  assert.equal(a.settings.audioLanguage(), 'fr') // legacy shared key
  a.store.set('settings/audioLang@1', 'ja')
  assert.equal(a.settings.audioLanguage(), 'ja')
  a.setProfile('2')
  assert.equal(a.settings.audioLanguage(), 'fr')
})

test('presets: four, each sets the same four keys', () => {
  assert.deepEqual(PRESETS.map(p => p[0]), ["Add-on's order", 'Best picture', 'Balanced', 'Fast start'])
  for (const [, rows] of PRESETS) assert.deepEqual(Object.keys(rows).sort(), ['hdrPref', 'maxHeight', 'maxSizeGb', 'release'])
  assert.deepEqual(PRESETS[1][1], { release: 'remux', hdrPref: 'dv', maxHeight: 0, maxSizeGb: 0 })
  assert.deepEqual(PRESETS[2][1], { release: 'encode', hdrPref: '', maxHeight: 0, maxSizeGb: 20 })
  assert.deepEqual(PRESETS[3][1], { release: 'web', hdrPref: '', maxHeight: 1080, maxSizeGb: 10 })
})

test('presetName: each preset by its settings, anything else is Custom', () => {
  const { settings } = make()
  assert.equal(settings.presetName(), "Add-on's order")
  settings.shiftPreset(1)
  assert.equal(settings.presetName(), 'Best picture')
  assert.equal(settings.release(), 'remux')
  assert.equal(settings.hdrPref(), 'dv')
  settings.shiftPreset(1)
  assert.equal(settings.presetName(), 'Balanced')
  assert.equal(settings.maxSizeGb(), 20)
  settings.shiftPreset(1)
  assert.equal(settings.presetName(), 'Fast start')
  assert.equal(settings.maxHeight(), 1080)
  assert.equal(settings.release(), 'web')
  settings.shiftPreset(1) // wraps
  assert.equal(settings.presetName(), "Add-on's order")
  settings.shiftPreset(-1)
  assert.equal(settings.presetName(), 'Fast start')
  settings.set(settings.choice('maxSizeGb'), 5)
  assert.equal(settings.presetName(), 'Custom')
  assert.equal(settings.presetIndex(), -1)
})

test('presets: from Custom, Right goes to the first and Left to the last', () => {
  const { settings } = make({ 'settings/maxHeight': 720 })
  assert.equal(settings.presetName(), 'Custom')
  assert.equal(settings.shiftPreset(1), "Add-on's order")
  settings.set(settings.choice('maxHeight'), 720)
  assert.equal(settings.shiftPreset(-1), 'Fast start')
})

test('presets set the per-profile release for the active profile only', () => {
  const { settings, setProfile } = make()
  settings.shiftPreset(1) // Best picture for profile 1
  setProfile('2')
  assert.equal(settings.release(), '') // profile 2 untouched
  assert.equal(settings.hdrPref(), 'dv') // but hdrPref and the limits are shared
  assert.equal(settings.presetName(), 'Custom')
})

test('shift: steps through a choice\'s values and wraps', () => {
  const { settings } = make()
  const size = settings.choice('maxSizeGb')
  assert.deepEqual(settings.shift(size, 1), [40, '40 GB'])
  assert.deepEqual(settings.shift(size, 1), [20, '20 GB'])
  assert.equal(settings.maxSizeGb(), 20)
  assert.deepEqual(settings.shift(size, -1), [40, '40 GB'])
  settings.set(size, 5)
  assert.deepEqual(settings.shift(size, 1), [0, 'No limit'])
  assert.deepEqual(settings.shift(size, -1), [5, '5 GB'])
  const play = settings.choice('alwaysList')
  settings.shift(play, 1)
  assert.equal(settings.alwaysList(), true)
})

test('nextSettingIndex', () => {
  assert.equal(nextSettingIndex(0, 4, 1), 1)
  assert.equal(nextSettingIndex(3, 4, 1), 0)
  assert.equal(nextSettingIndex(0, 4, -1), 3)
  assert.equal(nextSettingIndex(-1, 4, 1), 0)
  assert.equal(nextSettingIndex(-1, 4, -1), 3)
  assert.throws(() => nextSettingIndex(0, 0, 1))
  assert.throws(() => nextSettingIndex(0, 4, 0))
  assert.throws(() => nextSettingIndex(0, 4, 2))
})

test('choice lists: Alder\'s wording, matchFrameRate and passthrough dropped, AV1 added', () => {
  const keys = [].concat(STREAMING, PICTURE_AND_SOUND, SUBTITLES, ADVANCED).map(c => c.key)
  assert.deepEqual(keys, ['alwaysList', 'maxHeight', 'maxSizeGb', 'release', 'hdrPref', 'audioLang', 'dub', 'pictureSize', 'subtitles', 'subSize', 'subBackground', 'av1'])
  assert.ok(!keys.includes('matchFrameRate'))
  assert.ok(!keys.includes('passthrough'))
  const c = STREAMING.find(x => x.key === 'maxHeight')
  assert.deepEqual(c.values, [[0, 'No limit'], [2160, '4K'], [1080, '1080p'], [720, '720p']])
  assert.equal(c.label, 'Highest quality')
  assert.deepEqual(STREAMING.filter(x => x.perProfile).map(x => x.key), ['release'])
  assert.deepEqual(PICTURE_AND_SOUND.filter(x => x.perProfile).map(x => x.key), ['audioLang', 'dub', 'pictureSize'])
  for (const choice of [].concat(STREAMING, PICTURE_AND_SOUND, SUBTITLES, ADVANCED))
    assert.ok(choice.values.every(v => typeof v[0] === typeof choice.values[0][0]), choice.key) // one type per choice, as Kotlin requires
})

test('forget removes a profile\'s taste only', () => {
  const { settings, store } = make()
  settings.set(settings.choice('release'), 'remux')
  settings.set(settings.choice('maxHeight'), 720)
  settings.forget('1')
  assert.equal(store.get(KEYS.profileSetting('release', '1')), undefined)
  assert.equal(settings.maxHeight(), 720)
})

test('picture size: Fit by default, per profile, a stored junk value reads as Fit, and a removed profile takes it along', () => {
  const { settings, store, setProfile } = make()
  assert.equal(settings.pictureSize(), 'fit')
  const c = settings.choice('pictureSize')
  assert.equal(c.label, 'Picture size')
  assert.deepEqual(c.values, [['fit', 'Fit'], ['fill', 'Fill']])
  assert.equal(c.perProfile, true)
  settings.set(c, 'fill')
  assert.equal(store.get('settings/pictureSize@1'), 'fill')
  assert.equal(settings.pictureSize(), 'fill')
  assert.equal(settings.stored(c), 'fill')
  setProfile('2')
  assert.equal(settings.pictureSize(), 'fit', 'another profile starts with Fit')
  store.set('settings/pictureSize@2', 'stretch')
  assert.equal(settings.pictureSize(), 'fit', 'only "fill" means Fill')
  settings.forget('1')
  setProfile('1')
  assert.equal(settings.pictureSize(), 'fit')
  assert.equal(settings.shift(c, 1)[0], 'fill')
  assert.equal(settings.shift(c, 1)[0], 'fit')
})
