/*
 * The app's services, built once at boot and handed to every screen as `context.session` (docs/CONTEXT.md is the contract
 * with the Phase 4B screens). It is the glue Alder gets from its singletons (`Profiles.active(this)`, `Stremio.addons(key)`,
 * `Settings`, `Library`...): the profiles on this TV, the active profile's account, its settings, its add-ons and library, and
 * the "find sources for one video" flow. No DOM here; window things (storage, webapis, fetch) arrive as arguments, so the
 * tests run it in Node against dev/fixtures.
 *
 *   createSession({ store, http, webapis, log, tvLanguage, now }) -> session
 *     store       lib/store createStore()
 *     http        lib/http appHttp() (or a double with get/post/saved/keep)
 *     webapis     window.webapis (or undefined: the static TU8000 profile)
 *     tvLanguage  () => "en" (player/language.js createTvLanguage().get)
 *
 * Where Alder shows "last time's answer first, the fresh one when it arrives" (its savedX pattern), the session has a sync
 * `savedX()` (no network, null when nothing was kept) beside the async one:
 *   addons({refresh}) / library({refresh})   refresh false (default): what is in memory or kept from last time when there is
 *                                            something, else the network. true: the network, always.
 *   savedAddons() / savedLibrary() / savedMeta(type, id)   the kept answer, or null.
 */
import { createStremio, API, ApiException } from '../core/stremio.js'
import { createProfiles } from '../core/profiles.js'
import { createSettings } from '../core/settings.js'
import { createLibrary } from '../core/library.js'
import { SourceFinder, streamAddonsFor } from '../core/finder.js'
import { createRanker, createSourceMemory } from '../core/ranking.js'
import { deviceProfile } from '../core/device.js'
import { obj, optInt, optString, getString } from '../core/util.js'

/** The http the core modules expect: lib/http names its kept-answer reader `savedAnswer`, the core calls it `saved`. */
export function coreHttp(raw) {
  const http = Object.create(raw)
  http.saved = typeof raw.saved === 'function' ? raw.saved.bind(raw) : (url, json) => raw.savedAnswer(url, json)
  return http
}

const nothing = { info() {}, warn() {}, debug() {}, error() {} }

export function createSession({ store, http: rawHttp, webapis, log = nothing, tvLanguage = () => 'en', now = () => Date.now() }) {
  const http = coreHttp(rawHttp)
  const stremio = createStremio({ http })
  const base = createProfiles({ store })
  const library = createLibrary({ now })
  const memory = createSourceMemory(store)
  const settings = createSettings({ store, activeProfileId: () => base.activeId(), tvLanguage })
  // Settings reads the active profile each time, so one object serves every profile ("re-bound" on a switch).

  // The device profile is made once per launch; AV1 follows Settings' toggle at any time, so it is read live.
  const device = deviceProfile({ webapis, av1: settings.av1(), log: msg => log.info('device', msg) })
  Object.defineProperty(device, 'av1', { get: () => settings.av1(), enumerable: true, configurable: true })

  // ---- profiles, with change notification ----
  const listeners = new Set()
  let lastActive = base.activeId()
  const changed = () => {
    const now_ = base.activeId()
    if (now_ === lastActive) return
    lastActive = now_
    const profile = session.profile()
    listeners.forEach(fn => { try { fn(profile) } catch (e) { log.warn('session', 'profile listener failed: ' + e.message) } })
  }
  const profiles = Object.create(base)
  profiles.setActive = id => { base.setActive(id); changed() }
  profiles.add = (...args) => { const p = base.add(...args); changed(); return p }
  profiles.remove = id => { base.remove(id); changed() }

  const authKey = () => { const p = base.active(); return p ? p.authKey : null }
  // The add-on list parsed once per profile: asking for a title's details on every focus move must not re-read and re-parse
  // the kept answer each time (Stremio.savedAddons does, by design).
  const parsed = new Map() // authKey -> Addon[]
  const addonList = () => {
    const k = authKey()
    if (!k) return null
    if (!parsed.has(k)) { const kept = stremio.savedAddons(k); if (kept) parsed.set(k, kept) }
    return parsed.get(k) || null
  }
  const need = () => { const k = authKey(); if (!k) throw new Error('No profile is signed in'); return k }

  /** The first add-on serving "meta" for [type]/[id], in the account's order (Alder DetailsActivity). */
  const metaAddon = (list, type, id) => (list || []).find(a => a.serves('meta', type, id)) || null

  const session = {
    store,
    http,
    device,
    stremio,
    profiles,
    settings,
    memory,
    /** core/library.js: continueWatching, inList, setInList, markTitleWatched, markWatched, resumeAt, record, stopped. */
    books: library,

    profile: () => base.active(),
    authKey,

    /** Calls [fn](profile) whenever the active profile changes (setActive, add, removing the active one). Returns unsubscribe. */
    onProfileChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },

    savedAddons() { return addonList() },

    async addons({ refresh = false } = {}) {
      const key = need()
      if (!refresh) {
        const kept = addonList() // also fills Stremio's in-memory list, so details ask these meanwhile
        if (kept) return kept
      }
      const fresh = await stremio.addons(key, true)
      parsed.set(key, fresh)
      return fresh
    },

    savedMeta(type, id) {
      const addon = metaAddon(addonList(), type, id)
      return addon ? addon.savedMeta(type, id) : null
    },

    /** The title's details from the first add-on that serves them. A failed request gives the kept copy, else null. */
    async meta(type, id) {
      let addon = null
      try { addon = metaAddon(await session.addons(), type, id) } catch (e) { log.warn('session', 'add-ons unavailable for meta: ' + e.message) }
      if (!addon) return session.savedMeta(type, id)
      try { return await addon.meta(type, id) } catch (e) {
        log.warn('session', 'meta ' + type + '/' + id + ' failed: ' + e.message)
        return addon.savedMeta(type, id)
      }
    },

    savedLibrary() { const k = authKey(); return k ? stremio.savedLibrary(k) : null },

    /** Library items (watch history included): kept ones first when [refresh] is false and there are some, else Stremio's. */
    async library({ refresh = false } = {}) {
      const key = need()
      if (!refresh) {
        const kept = stremio.savedLibrary(key)
        if (kept) return kept
      }
      return stremio.library(key)
    },

    saveLibrary(items) { return stremio.saveLibrary(need(), items) },

    /**
     * Sign out of a profile that is being removed (Alder ProfilesActivity): the profile and what is kept per profile go, the
     * kept answers go (they are not told apart by profile), and Stremio is told to end that session, best effort.
     */
    /**
     * Stremio sign-in with an e-mail and password (the fallback when the phone link is not handy; the TV flow of Stremio's own
     * app is the link). Resolves to the account's auth key; a wrong password is an ApiException (its message is Stremio's).
     * Nothing about the request is logged: it carries the password.
     */
    async login(email, password) {
      const answer = await http.post(API + 'login', JSON.stringify({ type: 'Login', email: String(email).trim(), password, facebook: false }))
      const json = JSON.parse(answer)
      const error = obj(json, 'error')
      if (error) throw new ApiException(optInt(error, 'code'), optString(error, 'message'))
      return getString(obj(json, 'result'), 'authKey')
    },

    removeProfile(id) {
      const target = base.all().find(p => p.id === id)
      profiles.remove(id)
      http.forget && http.forget()
      if (target) stremio.logout(target.authKey).catch(e => log.warn('session', 'logout failed: ' + e.message))
    },

    ranker({ videoId, metaId = '', maxHeight = 0 } = {}) {
      return createRanker({ settings, device, memory, videoId, metaId, maxHeight })
    },

    /**
     * The "find sources for one video" flow of StreamsActivity.onCreate: a core SourceFinder whose add-ons are the household's
     * stream add-ons (lenders first) for the active profile. It is returned at once and `start()` loads the add-on list
     * first, so the screen can hold it before the network answers.
     *   opts: { type, id (the title), videoId, pick, maxHeight, onPlay(streams), onList(model), onStatus(code) }
     * onStatus gets "no-addons" (nothing to ask) or "addons-failed" (the account's add-on list could not be read).
     */
    finder(opts) {
      const { type, id = '', videoId, pick = false, maxHeight = 0, onPlay = () => {}, onList = () => {}, onStatus = () => {} } = opts
      const ranker = session.ranker({ videoId, metaId: id, maxHeight })
      const finder = new SourceFinder({ addons: [], type, videoId, ranker, pick, onPlay, onList, onStatus })
      const key = authKey()
      const lenders = base.streamLenders()
      const begin = finder.start.bind(finder)
      let cancelled = false
      finder.start = () => {
        if (!key) { onStatus('no-addons'); return }
        streamAddonsFor(stremio, key, lenders, type, videoId).then(list => {
          if (cancelled) return
          finder.addons = list
          finder.answers = list.map(() => null)
          begin()
        }, e => {
          if (cancelled) return
          log.warn('session', 'stream add-ons unavailable: ' + e.message)
          onStatus('addons-failed')
        })
      }
      const cancel = finder.cancel.bind(finder)
      finder.cancel = () => { cancelled = true; cancel() }
      return finder
    },
  }

  return session
}
