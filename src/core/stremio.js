// Port of Alder's Stremio.kt: a thin client for Stremio's own services (request shapes from stremio-core).
//
// createStremio({ http }) -> client. http contract (see also addon.js):
//   http.get(url, { keep, timeoutMs }) -> Promise<string>
//   http.post(url, jsonString, { keep }) -> Promise<string>
//   http.saved(url, jsonString?) -> string | null       the last kept answer, never touches the network
//   http.keep(url, jsonString, body)                     keeps [body] as the answer to this request
// A request answered with an HTTP error status must still resolve with the body: Stremio puts its JSON error there
// ({"error":{"code","message"}}) and `result()` below turns it into an ApiException.

import { Addon } from './addon.js'
import { arr, obj, objects, optInt, optString, getString } from './util.js'

export const API = 'https://api.strem.io/api/'
export const LINK = 'https://link.stremio.com/api/v2/'

/** Error code for a session that no longer exists (signed out elsewhere). */
export const NO_SESSION = 1

export class ApiException extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiException'
    this.code = code
  }
}

export function createStremio(deps) {
  const { http } = deps
  const addonsCache = new Map() // per profile's auth key

  // Items saved here whose save may not have reached Stremio yet: the player saves as it closes, and the page behind
  // it asks Stremio at the same moment, so without this it showed the progress from before.
  const saving = new Map()

  // Stremio wraps every answer as {"result": …} or {"error": {"code", "message"}}.
  function result(body) {
    const json = JSON.parse(body)
    const error = obj(json, 'error')
    if (error) throw new ApiException(optInt(error, 'code'), optString(error, 'message'))
    return obj(json, 'result') || {}
  }

  const post = (method, body) => http.post(API + method, JSON.stringify(body))

  const addonsBody = authKey => JSON.stringify({ type: 'AddonCollectionGet', authKey, update: true })
  const libraryBody = (authKey, ids) => JSON.stringify({ authKey, collection: 'libraryItem', ids, all: ids.length === 0 })

  const toAddons = r => objects(arr(r, 'addons')).map(d => new Addon(d, deps))

  function libraryItems(answer) {
    const json = JSON.parse(answer)
    const error = obj(json, 'error')
    if (error) throw new ApiException(optInt(error, 'code'), optString(error, 'message'))
    const list = arr(json, 'result')
    if (!list) throw new Error('Stremio sent no library list')
    return objects(list)
  }

  const newest = (authKey, list) => list.map(item => {
    const mine = saving.get(authKey + '/' + optString(item, '_id'))
    return mine && optString(mine, '_mtime') > optString(item, '_mtime') ? mine : item
  })

  return {
    /**
     * TV sign-in, the same flow as Stremio's own TV app: show [url] or the code, the person approves it on their phone,
     * and [readLink] then returns the account's auth key. The app never sees a password.
     */
    async createLink() {
      const r = result(await http.get(LINK + 'create?type=Create'))
      return { code: getString(r, 'code'), url: getString(r, 'link') }
    },

    /** Auth key once the code is approved, null until then. Stremio answers 101 for both "waiting" and "expired". */
    async readLink(code) {
      try {
        return getString(result(await http.get(LINK + 'read?type=Read&code=' + encodeURIComponent(code))), 'authKey')
      } catch (e) {
        if (e instanceof ApiException && e.code === 101) return null
        throw e
      }
    },

    /** The add-ons installed on the account, in the account's order. Kept in memory until [refresh]. */
    async addons(authKey, refresh = false) {
      if (!refresh && addonsCache.has(authKey)) return addonsCache.get(authKey)
      const body = addonsBody(authKey)
      const answer = await http.post(API + 'addonCollectionGet', body)
      const list = toAddons(result(answer))
      addonsCache.set(authKey, list)
      http.keep(API + 'addonCollectionGet', body, answer)
      return list
    },

    /** The add-on list as it was last time (null if never fetched), so Home can start before the network answers. */
    savedAddons(authKey) {
      const answer = http.saved(API + 'addonCollectionGet', addonsBody(authKey))
      if (!answer) return null
      let list
      try { list = toAddons(result(answer)) } catch (e) { return null }
      if (!addonsCache.has(authKey)) addonsCache.set(authKey, list) // until the fresh list arrives, details are asked of these
      return list
    },

    /** Replaces the account's add-on list (and order) with [addons]. */
    async setAddons(authKey, addons) {
      result(await post('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: addons.map(a => a.descriptor) }))
      addonsCache.set(authKey, addons)
    },

    /** Library items (watch history included): the given ids, or every item when [ids] is empty. */
    async library(authKey, ids = []) {
      const body = libraryBody(authKey, ids)
      const answer = await http.post(API + 'datastoreGet', body)
      const list = libraryItems(answer)
      if (ids.length === 0) http.keep(API + 'datastoreGet', body, answer)
      return newest(authKey, list)
    },

    /** The whole library as it was last time, or null. */
    savedLibrary(authKey) {
      const answer = http.saved(API + 'datastoreGet', libraryBody(authKey, []))
      if (!answer) return null
      try { return newest(authKey, libraryItems(answer)) } catch (e) { return null }
    },

    async saveLibrary(authKey, items) {
      items.forEach(it => saving.set(authKey + '/' + optString(it, '_id'), it))
      try {
        result(await post('datastorePut', { authKey, collection: 'libraryItem', changes: items }))
      } catch (error) {
        items.forEach(it => { const k = authKey + '/' + optString(it, '_id'); if (saving.get(k) === it) saving.delete(k) })
        throw error
      }
    },

    async logout(authKey) {
      addonsCache.delete(authKey)
      await post('logout', { type: 'Logout', authKey })
    },
  }
}
