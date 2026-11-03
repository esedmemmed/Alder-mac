// Storage keys, named like Alder's SharedPreferences ("file" + key) so a reader of both code bases finds the same names.
// The injected store contract (core never touches localStorage itself):
//   store.get(key)        -> the stored JSON value, or undefined / null when absent
//   store.set(key, value) -> stores any JSON-serialisable value
//   store.remove(key)
// lib/store.js (Phase 1) namespaces the keys with the app prefix; these are the names inside that namespace.

export const KEYS = {
  profiles: 'account/profiles', // [{ id, name, color, authKey, pin }]
  active: 'account/active', // profile id
  shareStreams: id => 'account/shareStreams:' + id, // boolean
  setting: name => 'settings/' + name,
  profileSetting: (name, profileId) => 'settings/' + name + '@' + profileId, // taste is kept per profile
  recentSearches: profileId => 'search/recent:' + profileId, // newline separated, newest first (Alder's format)
  sourceFile: videoId => 'sources/file:' + videoId, // the file name played last time for this video
  sourceBinge: metaId => 'sources/binge:' + metaId, // the bingeGroup the previous episode used
}

/** Settings stored per profile under "key@profileId" (Settings.forget removes these with the profile). */
export const PER_PROFILE_SETTINGS = ['release', 'dub', 'audioLang']
