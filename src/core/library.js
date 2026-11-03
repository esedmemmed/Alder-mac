// Port of Alder's Library.kt: Stremio library items (each title's watch history), following stremio-core's player rules so
// progress made here shows up in Stremio on other devices. Items stay raw JSON objects so fields this app doesn't use
// survive the trip; the functions mutate the item they are given, as Alder does.
//
// createLibrary({ now }) -> Library. [now] returns the current time in milliseconds (default Date.now) and is formatted
// like Alder does, "2026-10-29T12:34:56.789Z".

import { inflate, deflate } from 'pako'
import { sortBy, base64Encode, base64Decode, obj, text, optInt, optBoolean } from './util.js'

const WATCHED = 0.7 // stremio-core WATCHED_THRESHOLD_COEF: watched this much, it counts as seen
const CREDITS = 0.9 // CREDITS_THRESHOLD_COEF: stopped past this, it's finished

/** `state` of an item, created when missing (Kotlin's getter did the same). */
function stateOf(item) {
  if (!item.state || typeof item.state !== 'object') item.state = {}
  return item.state
}
/** Read-only view for filters and sorts that must not touch the item. */
const peek = item => obj(item, 'state') || {}

/** Videos in the order stremio-core numbers them for the watched bitfield: by season, then episode. */
const bitOrder = videos => sortBy(videos, [[v => v.season, 'asc'], [v => v.episode, 'asc']]).map(v => v.id)

/**
 * The episodes Stremio has ticked as watched, read from stremio-core's watched bitfield (`state.watched`):
 * `{anchor video id}:{anchor length}:{base64 zlib bits}`, one bit per episode in season-then-episode order (least
 * significant bit first), shifted so the anchor (the last one watched) lines up even after new episodes come out.
 * Returns a Set of video ids. Anything unreadable counts as nothing watched.
 */
export function watchedIds(item, videos) {
  const field = text(obj(item, 'state'), 'watched')
  if (field === null) return new Set()
  const parts = field.split(':')
  if (parts.length < 3) return new Set()
  try {
    const bits = inflate(base64Decode(parts[parts.length - 1]))
    const anchorLength = parseInt(parts[parts.length - 2], 10)
    if (!Number.isFinite(anchorLength)) return new Set()
    const anchor = parts.slice(0, -2).join(':') // ids may hold ':' themselves
    const ids = bitOrder(videos)
    const anchorAt = ids.indexOf(anchor)
    if (anchorAt < 0) return new Set() // stremio-core: anchor gone, nothing counts as watched
    const offset = anchorLength - anchorAt - 1
    const out = new Set()
    ids.forEach((id, i) => {
      const bit = i + offset
      // Alder also required `bit < ids.length`, comparing a position in the OLD field with the NEW list length: after
      // episodes were removed before the anchor that dropped the anchor itself. stremio-core's constructAndResize reads
      // bit i + offset from the old field with no such bound, so only the field's own length limits it here (DECISIONS).
      if (bit >= 0 && (bit >> 3) < bits.length && ((bits[bit >> 3] >> (bit & 7)) & 1) === 1) out.add(id)
    })
    return out
  } catch (e) {
    return new Set()
  }
}

export function createLibrary({ now = () => Date.now() } = {}) {
  const stamp = () => new Date(now()).toISOString()

  const Library = {
    watched: watchedIds,

    continueWatching(list) {
      return sortBy(
        list.filter(it => it.type !== 'other' && (!optBoolean(it, 'removed') || optBoolean(it, 'temp')) && optInt(peek(it), 'timeOffset') > 0),
        [[it => text(peek(it), 'lastWatched'), 'desc']])
    },

    /** A title that isn't in the library yet: Stremio keeps those as temporary, hidden items. */
    newItem(id, type, name, poster) {
      const at = stamp()
      return {
        _id: id, name, type, poster: poster || '', posterShape: 'poster', removed: true, temp: true, _ctime: at, _mtime: at,
        behaviorHints: {},
        state: {
          lastWatched: at, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0,
          video_id: null, watched: null, noNotif: false,
        },
      }
    },

    /** In the library ("My List") rather than only remembered for Continue Watching. */
    inList(item) { return !!item && !optBoolean(item, 'removed') },

    /** Adds the title to the library or takes it out; its watch history stays either way. */
    setInList(item, on) {
      item.removed = !on
      item.temp = false
      item._mtime = stamp()
    },

    /** Marks the current title complete without discarding its watch history. */
    markTitleWatched(item, videos = []) {
      const s = stateOf(item)
      const id = text(s, 'video_id')
      if (id !== null && videos.some(v => v.id === id)) Library.markWatched(item, videos, id)
      s.timesWatched = Math.max(1, optInt(s, 'timesWatched'))
      s.flaggedWatched = 1
      s.timeOffset = 0
      item._mtime = stamp()
    },

    /** Where to resume [videoId] in milliseconds, 0 to start from the beginning. */
    resumeAt(item, videoId) {
      const s = peek(item)
      const offset = optInt(s, 'timeOffset')
      const duration = optInt(s, 'duration')
      const unfinished = duration === 0 || offset < duration * CREDITS
      return text(s, 'video_id') === videoId && offset > 0 && unfinished ? offset : 0
    },

    /** Ticks [videoId] as watched in that bitfield, as stremio-core's `set_video` does, so other devices show the check mark. */
    markWatched(item, videos, videoId) {
      const ids = bitOrder(videos)
      const seen = watchedIds(item, videos)
      seen.add(videoId)
      const bits = new Uint8Array(Math.ceil(ids.length / 8))
      ids.forEach((id, i) => { if (seen.has(id)) bits[i >> 3] |= 1 << (i & 7) })
      let last = -1
      ids.forEach((id, i) => { if (seen.has(id)) last = i })
      if (last < 0) return
      const zipped = deflate(bits, { level: 6 })
      stateOf(item).watched = ids[last] + ':' + (last + 1) + ':' + base64Encode(zipped)
    },

    /** Playback progress, called every few seconds. [playedMs] is time actually watched since the last call. */
    record(item, videoId, positionMs, durationMs, playedMs) {
      const s = stateOf(item)
      const at = stamp()
      s.lastWatched = at
      if (text(s, 'video_id') !== videoId) {
        s.video_id = videoId
        s.overallTimeWatched = optInt(s, 'overallTimeWatched') + optInt(s, 'timeWatched')
        s.timeWatched = 0
        s.flaggedWatched = 0
      }
      s.timeWatched = optInt(s, 'timeWatched') + playedMs
      s.overallTimeWatched = optInt(s, 'overallTimeWatched') + playedMs
      s.timeOffset = positionMs
      if (durationMs > 0) s.duration = durationMs
      const duration = optInt(s, 'duration')
      if (optInt(s, 'flaggedWatched') === 0 && duration > 0 && optInt(s, 'timeWatched') > duration * WATCHED) {
        s.flaggedWatched = 1
        s.timesWatched = optInt(s, 'timesWatched') + 1
        // Alder: the per-episode "watched" ticks (the bitfield) are written by the player once flaggedWatched turns 1,
        // through markWatched, so episodes finished here get Stremio's check mark.
      }
      if (optBoolean(item, 'temp') && optInt(s, 'timesWatched') === 0) item.removed = true
      if (optBoolean(item, 'removed')) item.temp = true
      item._mtime = at
    },

    /** When playback stops: past the credits it's finished, and a series moves on to [nextVideoId]. */
    stopped(item, nextVideoId) {
      const s = stateOf(item)
      if (optInt(s, 'duration') === 0 || optInt(s, 'timeOffset') <= optInt(s, 'duration') * CREDITS) return
      s.timeOffset = 0
      if (nextVideoId !== null && nextVideoId !== undefined) {
        s.video_id = nextVideoId
        s.overallTimeWatched = optInt(s, 'overallTimeWatched') + optInt(s, 'timeWatched')
        s.timeWatched = 0
        s.flaggedWatched = 0
        s.timeOffset = 1 // stremio-core's marker for "start the next episode", which keeps it in Continue Watching
      }
      item._mtime = stamp()
    },
  }
  return Library
}
