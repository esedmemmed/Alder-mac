// Android device profile, for the module swap in scripts/build.mjs (node scripts/build.mjs --mac --android): same exports as src/core/device.js.
// The phone's ExoPlayer (hardware MediaCodec) plays H.264, HEVC 8/10-bit, HDR10 and AV1 up to 4K60, and its FFmpeg audio decoder plays
// AC3, E-AC3, DTS, DTS-HD and TrueHD, so unlike the Mac profile nothing here is kept out of auto-play except Dolby Vision without an
// HDR10 base (playableOn handles that) and 100/120 fps markers.

import { TU8000_AUDIO, UNPLAYABLE_AUDIO } from '../../core/audio.js'

const HIGH_FPS = /\b(?:1[0-2]\d)\s?fps\b|\b(?:100|120)p\b|(?:720|1080|2160)p(?:100|120)\b/

/** May auto-play / BEST MATCH try it: anything but Dolby Vision without HDR10 and 100/120 fps releases. */
export function autoOk(s) {
  return !(s.dolbyVision && !s.hdr) && !HIGH_FPS.test(s.words)
}

export function macProfile() {
  return {
    hevc: true, av1: true, dolbyVision: false, hdr: true, height: 2160, preferHeight: 1080, fps: 60, codec: 'H.264, HEVC, AV1 (hardware)',
    audio: new Set(TU8000_AUDIO.concat(UNPLAYABLE_AUDIO)), source: 'Android profile', notes: ['ExoPlayer with FFmpeg audio: DTS and TrueHD play'],
    autoOk,
    startWait: { cached: 15000, other: 20000 },
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
