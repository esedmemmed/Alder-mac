// Port of Alder's Profiles.kt: the profiles on this TV, kept in app storage. Each one is its own Stremio account, so history,
// Continue Watching, add-ons and recommendations (Watchly) all stay per person without anything of our own in the cloud.
//
// createProfiles({ store }) -> Profiles. Not ported: Alder's migrate() (one old single sign-in becoming profile 1, and the
// pre-2026-10-26 per-add-on sharing keys): a fresh Tizen install has no such data.

import { KEYS, PER_PROFILE_SETTINGS } from './keys.js'
import { isObject, text } from './util.js'

export const MAX = 5
/** Alder's five avatar colours (0xFFF3D9B1 ... as CSS hex). */
export const COLORS = Object.freeze(['#F3D9B1', '#C98E6A', '#8FA39A', '#A6A2BD', '#D3A66B'])

export function createProfiles({ store }) {
  const read = key => { const v = store.get(key); return v === undefined ? null : v }

  function save(list) {
    store.set(KEYS.profiles, list.map(p => ({ id: p.id, name: p.name, color: p.color, authKey: p.authKey, pin: p.pin || '' })))
  }

  const Profiles = {
    MAX,
    COLORS,

    all() {
      const raw = read(KEYS.profiles)
      return (Array.isArray(raw) ? raw : []).filter(isObject)
        .filter(p => text(p, 'id') && text(p, 'name') !== null && text(p, 'authKey'))
        .map(p => ({
          id: String(p.id), name: String(p.name), color: COLORS.indexOf(p.color) >= 0 ? p.color : COLORS[0],
          authKey: String(p.authKey), pin: text(p, 'pin'),
        }))
    },

    /** The profile in use: the one picked last, or the only one there is. */
    active() {
      const list = Profiles.all()
      const id = read(KEYS.active)
      return list.find(p => p.id === id) || (list.length === 1 ? list[0] : null)
    },

    activeId() {
      const p = Profiles.active()
      return p ? p.id : null
    },

    setActive(id) { store.set(KEYS.active, id) },

    add(name, authKey, color = COLORS[0]) {
      const list = Profiles.all()
      let number = null
      for (let n = 1; n <= MAX; n++) if (!list.some(p => p.id === String(n))) { number = n; break }
      if (number === null) throw new Error('At most ' + MAX + ' profiles')
      const profile = { id: String(number), name, color, authKey, pin: null }
      save(list.concat(profile))
      Profiles.setActive(profile.id)
      return profile
    },

    /** Removes the profile and what is kept per profile: its taste in Settings, search history and add-on sharing. */
    remove(id) {
      save(Profiles.all().filter(p => p.id !== id))
      if (read(KEYS.active) === id) store.remove(KEYS.active)
      store.remove(KEYS.shareStreams(id))
      PER_PROFILE_SETTINGS.forEach(name => store.remove(KEYS.profileSetting(name, id)))
      store.remove(KEYS.recentSearches(id))
    },

    /** Whether [id] lends its stream add-ons (`Addon.shareable`) to the other profiles on this TV. */
    sharesStreams(id) { return read(KEYS.shareStreams(id)) === true },

    setSharesStreams(id, on) { store.set(KEYS.shareStreams(id), !!on) },

    /** The other profiles lending their stream add-ons to the active one; watch progress still uses the active account. */
    streamLenders() {
      const current = Profiles.active()
      if (!current) return []
      return Profiles.all().filter(p => p.id !== current.id && Profiles.sharesStreams(p.id))
    },

    /** Rename or set the PIN of a profile (clearPin removes it), keeping its place in the list. */
    update(id, { name = null, pin = null, clearPin = false, color = null } = {}) {
      save(Profiles.all().map(p => p.id !== id ? p : {
        id: p.id, name: name === null ? p.name : name, color: color === null ? p.color : color, authKey: p.authKey,
        pin: clearPin ? null : (pin === null ? p.pin : pin),
      }))
    },
  }
  return Profiles
}
