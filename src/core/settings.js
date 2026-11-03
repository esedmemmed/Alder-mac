// Port of the `object Settings` and the choice lists / presets of Alder's SettingsActivity.kt.
//
// Choices kept on this TV. Most are shared by every profile (they're about the TV and the sound system); taste (release
// type, dubs, audio language and picture size) is kept per profile under "key@profileId".
//
// Dropped for Tizen (PLAN.md section 1): matchFrameRate (AVPlay can't switch display modes) and passthrough (the TU8000
// can't pass DTS/TrueHD to a receiver), so the receiver term of Alder's preference() score is gone too. Added: `av1`
// ("My TV plays AV1", off) under Advanced, read by core/device.js. Not ported: the old On/Off "hdr" key migration.
//
// createSettings({ store, activeProfileId, tvLanguage }) -> Settings
//   activeProfileId: () => id | null   (Profiles.activeId)
//   tvLanguage:      () => "en"        (the TV's menu language; Tizen: from tizen.systeminfo LOCALE)

import { KEYS } from './keys.js'

// A Choice: { key, label, hint, values: [[value, label], ...], perProfile }. The first value is the default.
const choice = (key, label, hint, values, perProfile = false) => ({ key, label, hint, values, perProfile })

export const STREAMING = [
  choice('alwaysList', 'When I press Play', 'What Play and Resume do. Holding OK always shows every source.',
    [[false, 'Best source'], [true, 'Show sources']]),
  choice('maxHeight', 'Highest quality', 'Releases above this are skipped when picking a source.',
    [[0, 'No limit'], [2160, '4K'], [1080, '1080p'], [720, '720p']]),
  choice('maxSizeGb', 'Largest file', 'For slow connections: big files take longer to start.',
    [[0, 'No limit'], [40, '40 GB'], [20, '20 GB'], [10, '10 GB'], [5, '5 GB']]),
  choice('release', 'Release type', 'Which kind of file is tried first for this profile. REMUX is the full Blu-ray.',
    [['', 'No preference'], ['remux', 'Full Blu-ray (REMUX)'], ['encode', 'Smaller encodes'], ['web', 'Web releases']], true),
]

export const PICTURE_AND_SOUND = [
  choice('hdrPref', 'HDR and Dolby Vision', 'Which goes first when a title has both. Off picks plain releases.',
    [['', 'On'], ['dv', 'Dolby Vision first'], ['hdr10', 'HDR10 first'], ['off', 'Off']]),
  choice('audioLang', 'Audio language', 'The dub to start with when a file has several. Changeable while watching.',
    [['', 'TV language'], ['en', 'English'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'], ['ko', 'Korean']], true),
  choice('dub', 'Dubbed releases', "Original first puts dubbed releases last; My language first uses this profile's audio language.",
    [['', 'No preference'], ['original', 'Original first'], ['mine', 'My language first']], true),
  // Tizen only (v0.2). Fit shows the whole picture, with black bars when the film is wider than the TV; Fill zooms in until
  // the picture covers the screen and cuts what overflows (never stretches it). Changeable while watching, which saves it here.
  choice('pictureSize', 'Picture size', 'Fit shows the whole picture. Fill zooms in to cover the screen and cuts the edges of the film.',
    [['fit', 'Fit'], ['fill', 'Fill']], true),
]

export const SUBTITLES = [
  choice('subtitles', 'Subtitles by default', "Subtitles in the TV's language start with the video when available.",
    [[true, 'On'], [false, 'Off']]),
  choice('subSize', 'Subtitle size', 'How big subtitles are on screen.',
    [[100, 'Medium'], [130, 'Large'], [160, 'Extra large'], [80, 'Small']]),
  choice('subBackground', 'Subtitle background', 'A dark box behind subtitles keeps them readable in bright scenes.',
    [[true, 'On'], [false, 'Off']]),
]

/** Tizen only. AV1 hardware decode on 2020 sets is unverified, so it is opt-in. */
export const ADVANCED = [
  choice('av1', 'My TV plays AV1', 'Allows AV1 releases. Leave off unless an AV1 test file plays on this TV.',
    [[false, 'Off'], [true, 'On']]),
]

/** Source choice presets: each sets the same four keys, so "Custom" is any other combination. */
export const PRESETS = [
  ["Add-on's order", { release: '', hdrPref: '', maxHeight: 0, maxSizeGb: 0 }],
  ['Best picture', { release: 'remux', hdrPref: 'dv', maxHeight: 0, maxSizeGb: 0 }],
  ['Balanced', { release: 'encode', hdrPref: '', maxHeight: 0, maxSizeGb: 20 }],
  ['Fast start', { release: 'web', hdrPref: '', maxHeight: 1080, maxSizeGb: 10 }],
]

export const PRESET_HINT = "Best picture: full Blu-ray and Dolby Vision first. Balanced: smaller files. Fast start: web releases. Add-on's order: follow the add-on."

const ALL_CHOICES = STREAMING.concat(PICTURE_AND_SOUND, SUBTITLES, ADVANCED)

/** The index to move to from [current] by [direction] (-1 or 1), wrapping; from "none selected" (-1) the first or the last. */
export function nextSettingIndex(current, size, direction) {
  if (!(size > 0 && (direction === -1 || direction === 1))) throw new Error('Bad settings step')
  return current < 0 ? (direction < 0 ? size - 1 : 0) : (current + direction + size) % size
}

export function createSettings({ store, activeProfileId = () => null, tvLanguage = () => 'en' }) {
  const read = key => { const v = store.get(key); return v === undefined ? null : v }
  /** A stored value of the default's type, else the default (SharedPreferences are typed; localStorage JSON is not). */
  const typed = (key, fallback) => {
    const v = read(key)
    return v !== null && typeof v === typeof fallback ? v : fallback
  }

  const Settings = {
    profileKey: name => KEYS.profileSetting(name, activeProfileId()),

    maxHeight: () => typed(KEYS.setting('maxHeight'), 0), // 0: no limit
    maxSizeGb: () => typed(KEYS.setting('maxSizeGb'), 0), // 0: no limit
    /** "": as the add-on orders them, "dv" or "hdr10": that first, "off": plain releases only. */
    hdrPref: () => typed(KEYS.setting('hdrPref'), ''),
    hdr: () => Settings.hdrPref() !== 'off',
    /** "": no preference, "remux", "encode" (smaller BluRay and web encodes) or "web". */
    release: () => typed(Settings.profileKey('release'), ''),
    /** "": no preference, "original": dubs last, "mine": the audio language first. */
    dub: () => typed(Settings.profileKey('dub'), ''),
    /** "fit" (the whole picture, bars when the shapes differ) or "fill" (zoomed to cover the screen). Per profile. */
    pictureSize: () => (typed(Settings.profileKey('pictureSize'), 'fit') === 'fill' ? 'fill' : 'fit'),
    alwaysList: () => typed(KEYS.setting('alwaysList'), false),
    subtitles: () => typed(KEYS.setting('subtitles'), true),
    /** Two-letter code of the dub to start with: the TV's language unless one is picked. */
    audioLanguage() {
      const own = typed(Settings.profileKey('audioLang'), typed(KEYS.setting('audioLang'), ''))
      return own || tvLanguage()
    },
    subtitleSize: () => typed(KEYS.setting('subSize'), 100), // percent of the default size
    subtitleBackground: () => typed(KEYS.setting('subBackground'), true),
    av1: () => typed(KEYS.setting('av1'), false),

    /** A removed profile's taste goes with it, so a new profile in its place starts with none. */
    forget(profileId) {
      ['release', 'dub', 'audioLang', 'pictureSize'].forEach(n => store.remove(KEYS.profileSetting(n, profileId)))
    },

    // ---- for the Settings screen ----

    choice: key => ALL_CHOICES.find(c => c.key === key),
    keyOf: c => (c.perProfile ? Settings.profileKey(c.key) : KEYS.setting(c.key)),

    /** The stored value of a Choice (its default when unset). audioLang falls back to the older shared key like Alder. */
    stored(c) {
      const fallback = c.values[0][0]
      if (c.key === 'audioLang') return Settings.audioLanguageChoice()
      return typed(Settings.keyOf(c), fallback)
    },
    audioLanguageChoice: () => typed(Settings.profileKey('audioLang'), typed(KEYS.setting('audioLang'), '')),

    set(c, value) { store.set(Settings.keyOf(c), value) },

    /** Index in PRESETS of the current combination, -1 for "Custom". */
    presetIndex() {
      return PRESETS.findIndex(([, rows]) => Object.keys(rows).every(key => Settings.stored(Settings.choice(key)) === rows[key]))
    },
    /** "Add-on's order", "Best picture", "Balanced", "Fast start" or "Custom". */
    presetName() {
      const i = Settings.presetIndex()
      return i >= 0 ? PRESETS[i][0] : 'Custom'
    },
    /** Left/Right on the Source choice row: step through the presets (from Custom: the first or the last). */
    shiftPreset(by) {
      const next = nextSettingIndex(Settings.presetIndex(), PRESETS.length, by)
      const rows = PRESETS[next][1]
      Object.keys(rows).forEach(key => Settings.set(Settings.choice(key), rows[key]))
      return PRESETS[next][0]
    },
    /** Left/Right on an ordinary row: the next value (wrapping). */
    shift(c, by) {
      const index = Math.max(0, c.values.findIndex(v => v[0] === Settings.stored(c)))
      const next = nextSettingIndex(index, c.values.length, by)
      Settings.set(c, c.values[next][0])
      return c.values[next]
    },
  }
  return Settings
}
