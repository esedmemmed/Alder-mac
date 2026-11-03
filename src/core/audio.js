// Audio rules for the Tizen TV (PLAN.md section 5). Alder plays everything because ExoPlayer's ffmpeg extension decodes DTS
// and TrueHD in software. Samsung's AVPlay is hardware only: a 2020 TU8000 decodes AAC, AC3, E-AC3 (incl. DD+ Atmos), MP3,
// FLAC, Opus, Vorbis and PCM, and plays *silence* (or errors) on DTS, DTS-HD MA, DTS:X and TrueHD. Two stages avoid that:
//
//   Stage A, before playing: classifyAudio() reads the audio named in a stream's file name / title / description.
//            good (a playable codec, no unplayable one), bad (only DTS/TrueHD), mixed (both: multi-audio releases
//            usually carry an AC3 track next to the DTS one) or unknown (audio not named).
//   Stage B, after AVPlay prepared: parseAudioTracks() reads getTotalTrackInfo(), decideAudio() picks the best
//            *playable* track by Alder's bestAudio rules, or says there is none (the source then counts as failed).
//
// Pure functions only; the player (Phase 3) feeds them AVPlay's data and logs the returned `reason` strings.

import { toIso1 } from './lang.js'

/** What the TU8000 plays, by codec id (the ids used throughout this file). core/device.js builds the device's Set from this. */
export const TU8000_AUDIO = Object.freeze(['AAC', 'AC3', 'EAC3', 'MP3', 'FLAC', 'OPUS', 'VORBIS', 'PCM'])

/** Codec ids that exist but no 2020 Samsung decodes: shown to people as "No sound on this TV". */
export const UNPLAYABLE_AUDIO = Object.freeze(['DTS', 'DTS-HD', 'DTS:X', 'TRUEHD'])

// ---------------------------------------------------------------------------------------------------------------------
// Stage A: names
// ---------------------------------------------------------------------------------------------------------------------

// Each pattern is tried on the lowercased text in this order and what it matches is blanked out, so "dts-hd.ma" is not
// also read as plain DTS and "e-ac-3" not also as AC3. (?<![a-z0-9]) is a "starts a word" test that, unlike \b, also
// works in front of "+" and digits ("dd+", "ddp5.1").
const START = '(?<![a-z0-9])'
const PATTERNS = [
  ['TRUEHD', new RegExp(START + 'true[ ._-]?hd(?![a-z])')],
  ['DTS:X', new RegExp(START + 'dts[ :._-]?x(?![a-z0-9])')], // not "DTS.x264": a digit after the x means a video codec
  ['DTS-HD', new RegExp(START + 'dts[ ._-]?(?:hd(?:[ ._-]?ma)?|ma|hra)(?![a-z])')],
  ['DTS', new RegExp(START + 'dts')],
  ['EAC3', new RegExp(START + '(?:e[ ._-]?ac[ ._-]?3|dd\\+|ddp|dolby[ ._-]?digital[ ._-]?plus)(?![a-z])')],
  ['AC3', new RegExp(START + '(?:ac[ ._-]?3|dd|dolby[ ._-]?digital)(?![a-z+])')],
  ['AAC', new RegExp(START + 'aac')],
  ['FLAC', new RegExp(START + 'flac')],
  ['OPUS', new RegExp(START + 'opus(?![a-z])')],
  ['MP3', new RegExp(START + 'mp3(?![a-z])')],
  ['PCM', new RegExp(START + 'l?pcm(?![a-z])')],
]

/** The audio codecs a release names, e.g. ["EAC3", "DTS-HD"], in the order of PATTERNS (unplayable families first). */
export function audioCodecsIn(text) {
  let rest = String(text || '').toLowerCase()
  const found = []
  for (const [codec, re] of PATTERNS) {
    if (re.test(rest)) {
      found.push(codec)
      rest = rest.replace(new RegExp(re.source, 'g'), ' ')
    }
  }
  return found
}

/**
 * Stage A. [playable] is the device's Set (or array) of playable codec ids; default is the TU8000's.
 * Returns { kind: "good" | "bad" | "mixed" | "unknown", codecs, playable, unplayable }.
 */
export function classifyAudio(text, playable = TU8000_AUDIO) {
  const ok = playable instanceof Set ? playable : new Set(playable)
  const codecs = audioCodecsIn(text)
  const good = codecs.filter(c => ok.has(c))
  const bad = codecs.filter(c => !ok.has(c))
  const kind = good.length && bad.length ? 'mixed' : good.length ? 'good' : bad.length ? 'bad' : 'unknown'
  return { kind, codecs, playable: good, unplayable: bad }
}

/** Ranking order of the kinds: good, then mixed (playable after the track check), then unknown, bad last. */
export const AUDIO_SCORE = Object.freeze({ good: 3, mixed: 2, unknown: 1, bad: 0 })

/** The tag people see on a source that will have no sound. */
export const NO_SOUND_TAG = 'No sound on this TV'

// ---------------------------------------------------------------------------------------------------------------------
// Stage B: AVPlay tracks
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Codec id from the codec/fourCC string AVPlay reports. Samsung does not document the exact strings, so this is generous:
 * fourCCs ("ec-3", "mp4a", "dtsh"), Matroska ids ("A_EAC3"), WAVE format tags ("0x2001") and plain names all work.
 * Returns { codec, playable: "yes" | "no" | "maybe" } where "maybe" is a codec nobody has told us about.
 */
export function classifyCodecId(id, playable = TU8000_AUDIO) {
  const ok = playable instanceof Set ? playable : new Set(playable)
  // AVPlay's fourCC can be MIME-like ("audio/mpeg", "audio/mp4a-latm", "audio/x-ac3"): drop the type, keep the subtype.
  const s = String(id == null ? '' : id).trim().toLowerCase().replace(/^audio\/(x-)?/, '')
  const verdict = codec => ({ codec, playable: ok.has(codec) ? 'yes' : 'no' })
  if (!s) return { codec: '', playable: 'maybe' }
  if (/truehd|mlpa|^mlp|a_truehd/.test(s)) return verdict('TRUEHD')
  if (/dts[ :._-]?x|^dtsx/.test(s)) return verdict('DTS:X')
  if (/dts[ ._-]?(hd|ma|hra)|^dts[hl]$|^dtsh|^dtsl|a_dts\/(hd|ma)/.test(s)) return verdict('DTS-HD')
  if (/^dts|^dtse|^dtsc|^dtsm|a_dts|^0x2001$|^2001$/.test(s)) return verdict('DTS')
  if (/^(ec-?3|e-?ac-?3|eac3)$|a_eac3|^ec-3/.test(s)) return verdict('EAC3')
  if (/^(ac-?3|ac_3)$|a_ac3|^0x2000$|^2000$/.test(s)) return verdict('AC3')
  if (/^mp4a\.(6b|69)/.test(s)) return verdict('MP3')
  if (/^(mp4a|aac|aacl|aach|adts|latm)|a_aac|^mp4a/.test(s)) return verdict('AAC')
  if (/^(\.?mp3|mpga|mp2|mpa|mpeg)|a_mpeg|^0x55$|^55$|^0x50$/.test(s)) return verdict('MP3')
  if (/flac/.test(s)) return verdict('FLAC')
  if (/opus/.test(s)) return verdict('OPUS')
  if (/vorb/.test(s)) return verdict('VORBIS')
  if (/pcm|^twos$|^sowt$|^in24$|^in32$|^fl32$|^fl64$|^ipcm|^raw$/.test(s)) return verdict('PCM')
  // The text may not be a codec id at all but a name ("Dolby Digital Plus 5.1"); the Stage A patterns know those.
  const named = audioCodecsIn(s)
  if (named.length) return verdict(named[0])
  return { codec: s.toUpperCase(), playable: 'maybe' }
}

// Keys AVPlay's extra_info may carry the codec under. fourCC is the documented one; the rest are belt and braces.
const CODEC_KEYS = ['fourCC', 'fourcc', 'FourCC', 'codec', 'codec_name', 'audio_codec', 'format', 'mime', 'codecName']
const LANG_KEYS = ['language', 'track_lang', 'lang', 'Language']
const LABEL_KEYS = ['name', 'title', 'label', 'track_name', 'handler_name']

/** AVPlay's extra_info is a JSON string; parse it, or pull "key":"value" pairs out of text that is not quite JSON. */
export function parseExtraInfo(extra) {
  if (extra && typeof extra === 'object') return extra
  const s = String(extra == null ? '' : extra)
  try {
    const parsed = JSON.parse(s)
    if (parsed && typeof parsed === 'object') return parsed
  } catch (e) { /* fall through to the lenient reader */ }
  const out = {}
  const re = /"?([A-Za-z_][\w ]*)"?\s*[:=]\s*"?([^",}\n]*)"?/g
  let m
  while ((m = re.exec(s))) out[m[1].trim()] = m[2].trim()
  return out
}

function firstOf(info, keys) {
  for (const k of keys) {
    const v = info[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/**
 * AVPlay getTotalTrackInfo() -> the AUDIO tracks as { index, codec, playable, language, channels, label, isDefault, raw }.
 * [options.currentIndex]: the audio track AVPlay selected by itself (getCurrentStreamInfo), standing in for ExoPlayer's
 * "default" selection flag. [options.playable]: the device's playable codec ids. [options.toLanguage]: normaliser to two
 * letters (default core/lang.js toIso1), so "eng" matches Settings' "en".
 */
export function parseAudioTracks(totalTrackInfo, options = {}) {
  const { currentIndex = null, playable = TU8000_AUDIO, toLanguage = toIso1 } = options
  const list = Array.isArray(totalTrackInfo) ? totalTrackInfo : []
  return list
    .filter(t => t && String(t.type).toUpperCase() === 'AUDIO')
    .map(t => {
      const info = parseExtraInfo(t.extra_info !== undefined ? t.extra_info : t.extraInfo)
      const codecText = firstOf(info, CODEC_KEYS)
      let verdict = classifyCodecId(codecText, playable)
      // No usable codec field: read the whole extra_info like a release name, so "DTS-HD MA" in a track title still counts.
      if (verdict.playable === 'maybe') {
        const named = audioCodecsIn(typeof t.extra_info === 'string' ? t.extra_info : JSON.stringify(info))
        if (named.length) verdict = classifyCodecId(named[0], playable)
      }
      const language = firstOf(info, LANG_KEYS)
      const channels = parseInt(firstOf(info, ['channels', 'channel', 'channel_count', 'Channels']), 10)
      const index = Number(t.index)
      return {
        index,
        codec: verdict.codec,
        playable: verdict.playable,
        language: language && language.toLowerCase() !== 'und' ? toLanguage(language) : '',
        channels: Number.isFinite(channels) ? channels : 0,
        label: firstOf(info, LABEL_KEYS),
        isDefault: currentIndex !== null && index === Number(currentIndex),
        raw: t.extra_info,
      }
    })
}

const RANK_PLAYABLE = { yes: 2, maybe: 1, no: 0 }

/**
 * Alder's bestAudio (PlayerActivity.kt), plus "must be playable here":
 * never a commentary (releases only say so in the track name), then the audio language, then the track the file marks
 * default, then the most channels. Ties keep the earlier track. Unplayable codecs and [failed] indexes are skipped;
 * a codec we have no verdict on ("maybe") only beats nothing.
 * Returns the track, or null when no track can be played.
 */
export function bestAudio(tracks, { language = '', failed = new Set() } = {}) {
  const usable = tracks.filter(t => t.playable !== 'no' && !failed.has(t.index))
  // Alder drops commentaries outright. Here a file whose only playable track is a "commentary" still beats no sound.
  const clean = usable.filter(t => !/commentary/i.test(t.label || ''))
  const pool = clean.length ? clean : usable
  let best = null
  let bestKey = null
  for (const t of pool) {
    const key = [
      RANK_PLAYABLE[t.playable],
      language && t.language && t.language.startsWith(language) ? 1 : 0,
      t.isDefault ? 1 : 0,
      t.channels,
    ]
    if (!best || compareKeys(bestKey, key) < 0) { best = t; bestKey = key }
  }
  return best
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** One line per track for the Diagnostics screen: "#1 EAC3 eng 6ch (default)". */
export function describeTracks(tracks) {
  return tracks.map(t => '#' + t.index + ' ' + (t.codec || '?') + (t.playable === 'no' ? ' (not playable)' : t.playable === 'maybe' ? ' (unknown)' : '') +
    (t.language ? ' ' + t.language : '') + (t.channels ? ' ' + t.channels + 'ch' : '') + (t.isDefault ? ' default' : '') +
    (t.label ? ' "' + t.label + '"' : '')).join('; ')
}

/**
 * Stage B decision after prepare. [tracks] come from parseAudioTracks.
 *  { ok: true,  index, change, reason }   play with `index`; `change` says setSelectTrack('AUDIO', index) is needed first
 *  { ok: true,  index: null, change: false, reason }   AVPlay listed no audio tracks: nothing to judge, play as is
 *  { ok: false, reason }                  nothing playable: the source failed ("no playable audio"), go to the next one
 */
export function decideAudio(tracks, { language = '', failed = new Set(), currentIndex = null } = {}) {
  if (!tracks.length) return { ok: true, index: null, change: false, reason: 'no audio tracks reported; playing as is', tracks }
  const best = bestAudio(tracks, { language, failed })
  const listing = describeTracks(tracks)
  if (!best) return { ok: false, reason: 'no playable audio: ' + listing, tracks }
  const current = currentIndex === null || currentIndex === undefined ? null : Number(currentIndex)
  const change = best.index !== current
  const currentTrack = tracks.find(t => t.index === current)
  let why
  if (!change) why = 'kept #' + best.index + ' ' + best.codec
  else if (currentTrack && currentTrack.playable === 'no') why = 'default #' + currentTrack.index + ' ' + currentTrack.codec + ' cannot play here; chose #' + best.index + ' ' + best.codec
  else why = 'chose #' + best.index + ' ' + best.codec + ' (' + (language ? 'language ' + language + ', ' : '') + 'default flag, channels)'
  return { ok: true, index: best.index, change, reason: why + ' of [' + listing + ']', track: best, tracks }
}

/** A track failed mid-film (decoder error): the next best at the same second, or { ok: false } when none is left. */
export function afterAudioError(tracks, failedIndex, { language = '', failed = new Set() } = {}) {
  const now = new Set(failed)
  now.add(failedIndex)
  const decision = decideAudio(tracks, { language, failed: now, currentIndex: failedIndex })
  return Object.assign(decision, { failed: now })
}
