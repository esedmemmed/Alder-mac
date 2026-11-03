// Mac device profile, for the module swap in scripts/build.mjs (npm run build:mac): same exports as src/core/device.js.
// The Mac player (mpv) can decode more than this says, but the profile is deliberately conservative: H.264 8-bit, 1080p30,
// no HEVC / AV1 / Dolby Vision / HDR, so source ranking prefers what is sure to play. HEVC and 4K sources are still listed:
// they are manual picks, never hidden. No webapis here.

import { TU8000_AUDIO } from '../../core/audio.js'

export function macProfile() {
  return {
    hevc: false, av1: false, dolbyVision: false, hdr: false, height: 1080, fps: 30, codec: 'H.264 8-bit',
    audio: new Set(TU8000_AUDIO), source: 'Mac profile', notes: ['HEVC and 4K sources are manual picks, not hidden'],
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
