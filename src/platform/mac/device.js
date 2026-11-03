// Mac device profile, for the module swap in scripts/build.mjs (npm run build:mac): same exports as src/core/device.js.
// The Mac player (mpv) can decode more than this says, but the profile is deliberately conservative: H.264 8-bit, 1080p30,
// no AV1 / Dolby Vision / HDR. HEVC is listed (mpv plays it) but only as a manual pick: autoOk keeps auto-play and BEST MATCH on
// H.264 (scripts/build.mjs RANKING_PATCHES applies it). 4K sources are listed too, never hidden. No webapis here.

import { TU8000_AUDIO, UNPLAYABLE_AUDIO } from '../../core/audio.js'

const TEN_BIT = /10.?bit|hi10|main.?10/
const HIGH_FPS = /\b(?:4[89]|5\d|[6-9]\d|1[0-2]\d)\s?fps\b|\b(?:50|60)p\b|(?:720|1080|2160)p(?:50|60)\b/

/**
 * May auto-play / BEST MATCH try it: H.264 8-bit, at most 1080p, at most 30 fps, as far as the names say. An unnamed codec or frame rate
 * counts as fine: most releases omit them and H.264 1080p30 is the default case, so requiring a marker would empty the auto list.
 */
export function autoOk(s) {
  return !s.hevc && !s.av1 && !s.isHdr && (s.height === 0 || s.height <= 1080) && !TEN_BIT.test(s.words) && !HIGH_FPS.test(s.words)
}

export function macProfile() {
  return {
    hevc: true, av1: false, dolbyVision: false, hdr: false, height: 1080, fps: 30, codec: 'H.264 8-bit',
    audio: new Set(TU8000_AUDIO.concat(UNPLAYABLE_AUDIO)), source: 'Mac profile', notes: ['HEVC and 4K sources are manual picks, not hidden'],
    autoOk,
  }
}

/** env is accepted for the same call shape as the Tizen module (webapis, av1 are ignored). env.log: (message) => void. */
export function deviceProfile(env = {}) {
  const { log = () => {} } = env
  const profile = macProfile()
  log('device: ' + describeDevice(profile))
  profile.notes.forEach(n => log('device: ' + n))
  return profile
}

export function describeDevice(d) {
  return d.height + 'p' + (d.fps ? d.fps : '') + (d.hdr ? ' HDR' : '') + (d.hevc ? ' HEVC' : '') + (d.av1 ? ' AV1' : '') + (d.dolbyVision ? ' DV' : '') +
    (d.codec ? ' ' + d.codec : '') + ' audio[' + Array.from(d.audio).join(',') + '] (' + d.source + ')'
}
