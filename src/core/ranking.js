// Port of the ranking and selection logic in Alder's StreamsActivity.kt: readyStreams, rank, preference, wanted,
// presetName, and what the Sources page shows (rows, BEST MATCH, tags). Plus the two Tizen rules of PLAN.md section 5:
//   - the audio key (core/audio.js, Stage A) in rank(), and "No sound on this TV" sources left out of auto-play and listed last;
//   - streams that need request headers AVPlay can't send rank last ("may not play").
// Pure: settings, device and the "what played last time" memory are passed in.

import { sortBy } from './util.js'
import { languageName } from './lang.js'
import { AUDIO_SCORE, NO_SOUND_TAG } from './audio.js'
import { KEYS } from './keys.js'
import { sourceSize, sourceSummary, providerLabel } from './addon.js'

/** Sources handed to the player to try in order (PlayerActivity: failover walks this short list). */
export const TRY = 3

/**
 * The answers add-ons have given so far, flattened: Alder keeps the add-ons' order, so unless [allowGaps] it stops at the
 * first add-on that hasn't answered yet (null). `answers` has one slot per add-on, null until it answered.
 */
export function readyStreams(answers, allowGaps) {
  const used = allowGaps ? answers : takeWhile(answers, a => a !== null)
  return used.reduce((all, a) => all.concat(a || []), [])
}

function takeWhile(list, ok) {
  const out = []
  for (const e of list) { if (!ok(e)) break; out.push(e) }
  return out
}

/** The memory of what played: the file played last time for a video, and the release (bingeGroup) a series last used. */
export function createSourceMemory(store) {
  const read = key => { const v = store.get(key); return typeof v === 'string' ? v : null }
  return {
    file: videoId => read(KEYS.sourceFile(videoId)),
    binge: metaId => read(KEYS.sourceBinge(metaId)),
    /** Called by the player once a source shows a picture. */
    remember(videoId, metaId, stream) {
      if (stream.filename !== null) store.set(KEYS.sourceFile(videoId), stream.filename)
      else store.remove(KEYS.sourceFile(videoId))
      if (stream.bingeGroup !== null) store.set(KEYS.sourceBinge(metaId), stream.bingeGroup)
      else store.remove(KEYS.sourceBinge(metaId))
    },
  }
}

/** Settings' stream preferences as a score, higher first. At "No preference", every source scores 0. */
export function preferenceScore(settings, names = languageName) {
  const release = settings.release()
  const hdr = settings.hdrPref()
  const dub = settings.dub()
  const language = settings.audioLanguage()
  return s => {
    const byRelease = release === 'remux' ? (s.remux ? 3 : s.bluray ? 1 : 0)
      : release === 'encode' ? (s.remux ? -2 : (s.bluray || s.web) ? 2 : 0)
      : release === 'web' ? (s.web && !s.remux ? 2 : s.remux ? -2 : 0)
      : 0
    const byHdr = hdr === 'dv' ? (s.dolbyVision ? 2 : s.hdr ? 1 : 0) : hdr === 'hdr10' ? (s.hdr ? 2 : 0) : 0
    const byDub = dub === 'original' ? (s.dubbed ? -2 : 0)
      : dub === 'mine' ? (s.mentions(language, names) ? 2 : s.multiAudio ? 1 : 0)
      : 0
    return byRelease + byHdr + byDub // Alder adds 1 for bigAudio when a receiver is set; Tizen has no receiver option
  }
}

/**
 * Everything the Sources page and auto-play need to order and filter streams for one video.
 *   settings   core/settings.js
 *   device     core/device.js profile
 *   memory     createSourceMemory(store)
 *   videoId, metaId   the video being played and its title (for the "played last time" keys)
 *   maxHeight  the player asked for a lower quality (PlayerActivity.lowerQuality): the tallest that's left first
 */
export function createRanker({ settings, device, memory, videoId, metaId = '', maxHeight = 0, names = languageName }) {
  const tv = device

  /**
   * The order to try sources in: when the player asked for a lower quality, the tallest that's left first; then the
   * file played last time for this video (debrid links expire, so the link is fresh but the release is the same), then
   * the release the previous episode used (AIOStreams' bingeGroup), then the add-on's own order, with 3D and hard-coded
   * subtitles last, then streams that need headers AVPlay can't send [Tizen], then releases above the screen's
   * resolution or HDR on a screen without it moved down, then the audio key [Tizen: good, mixed, unknown, "no sound"
   * last], and then Settings' stream preferences. The sort is stable, so ties keep the add-on's order.
   */
  function rank(streams) {
    const file = memory ? memory.file(videoId) : null
    const binge = memory ? memory.binge(metaId) : null
    const lower = maxHeight > 0 // the player asked for less: the tallest that's left
    const prefer = preferenceScore(settings, names)
    // Scores are worked out once per stream, not once per comparison: the engine on a TV is slow, a sort asks many times.
    const info = new Map(streams.map(s => [s, { fit: s.fit(tv), audio: AUDIO_SCORE[s.audioKind(tv)], pref: prefer(s) }]))
    return sortBy(streams, [
      [s => (lower ? s.height : 0), 'desc'],
      [s => file !== null && s.filename === file, 'desc'],
      [s => binge !== null && s.bingeGroup === binge, 'desc'],
      [s => s.awkward, 'asc'],
      [s => s.mayNotPlay, 'asc'],
      [s => info.get(s).fit, 'desc'],
      [s => info.get(s).audio, 'desc'],
      [s => info.get(s).pref, 'desc'],
    ])
  }

  /** Within Settings' limits (quality, file size, HDR), and never a cam or screener. Unknown sizes and resolutions pass. */
  function wanted(s) {
    const limit = maxHeight > 0 ? maxHeight : settings.maxHeight() // the player asks for less
    const maxBytes = settings.maxSizeGb() * 1073741824
    return (limit === 0 || s.height === 0 || s.height <= limit) && (maxBytes === 0 || s.size === 0 || s.size <= maxBytes) &&
      (settings.hdr() || !s.isHdr) && !s.cam
  }

  const playable = s => s.isVideo && s.playableOn(tv)
  const noSound = s => s.audioKind(tv) === 'bad'

  return {
    tv,
    rank,
    wanted,
    noSound,

    /** The streams worth listing: real videos this TV can decode. */
    playable,

    /**
     * What auto-play may try, best first: ranked, within Settings' limits, and never a source with no playable audio
     * (PLAN.md section 5 Stage A). The player gets the first TRY of them.
     */
    autoCandidates(streams) {
      return rank(streams.filter(s => playable(s) && wanted(s))).filter(s => !noSound(s))
    },

    /**
     * The rows of the Sources page. `entries` are { stream, addon } with addon the provider's name. Order: wanted sources
     * in rank order, then the ones outside Settings' limits, then sources with no sound on this TV last (still selectable).
     * The first wanted source with sound is BEST MATCH.
     */
    listModel(entries) {
      const available = entries.filter(e => playable(e.stream))
      const providers = new Map(available.map(e => [e.stream, e.addon]))
      const ranked = rank(available.map(e => e.stream))
      const eligible = ranked.filter(wanted)
      const others = ranked.filter(s => !wanted(s))
      const quiet = s => !noSound(s)
      const ordered = eligible.filter(quiet).concat(others.filter(quiet), eligible.filter(noSound), others.filter(noSound))
      const best = eligible.find(quiet) || null
      return {
        count: ordered.length,
        best,
        rows: ordered.map(s => sourceRow(s, providers.get(s) || '', s === best, tv)),
        streams: ordered,
      }
    },
  }
}

/** One row of the Sources page: what StreamsActivity.streamRow prints, as data. */
export function sourceRow(s, addon, best, tv) {
  const warnings = []
  if (tv && s.audioKind(tv) === 'bad') warnings.push(NO_SOUND_TAG)
  if (s.mayNotPlay) warnings.push('May not play')
  return {
    stream: s,
    best,
    quality: s.height > 0 ? s.height + 'p' : 'Auto',
    summary: sourceSummary(s),
    // The release-type tags are in the summary already; the rest are shown as small pills (one on the best match row).
    tags: s.tags.filter(t => t !== 'BluRay' && t !== 'WEB').slice(0, best ? 1 : 2),
    warnings,
    provider: providerLabel(s, addon),
    size: sourceSize(s.size),
    dim: s.height >= 1 && s.height <= 719, // low resolutions are drawn at 48% opacity until focused
  }
}

/** The name of the current stream preferences: "Add-on's order", "Best picture", "Balanced", "Fast start" or "Custom". */
export function presetName(settings) {
  return settings.presetName()
}
