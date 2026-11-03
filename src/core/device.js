// Port of Alder's Device.kt, adapted for Tizen (PLAN.md section 5): what this TV can decode and show.
//
// Alder asks MediaCodecList and the display. A Samsung web app asks webapis.productinfo / webapis.avinfo, which only
// say "4K panel?" and "HDR?", and the codec list is a fact about the model: the 2020 TU8000 decodes HEVC, not AV1, no
// Dolby Vision, no DTS/TrueHD. So the static TU8000 profile is both the default and the fallback when webapis is missing
// (desktop dev) or throws; webapis may only upgrade height/hdr. AV1 follows Settings' "My TV plays AV1" toggle.

import { TU8000_AUDIO } from './audio.js'

/** The profile of the owner's TV: 4K panel, HDR10, HEVC, no AV1 / Dolby Vision, AAC/AC3/E-AC3/MP3/FLAC/Opus/Vorbis/PCM. */
export function tu8000Profile() {
  return { hevc: true, av1: false, dolbyVision: false, hdr: true, height: 2160, audio: new Set(TU8000_AUDIO), source: 'static TU8000 profile', notes: [] }
}

/**
 * Builds the device profile once per launch.
 *   env.webapis   window.webapis (or undefined)
 *   env.av1       Settings' "My TV plays AV1" (default false)
 *   env.log       optional (message) => void for the diagnostics ring buffer
 */
export function deviceProfile(env = {}) {
  const { webapis, av1 = false, log = () => {} } = env
  const profile = tu8000Profile()
  profile.av1 = !!av1
  if (!webapis) {
    profile.notes.push('webapis missing: using the TU8000 profile as is')
    log('device: ' + profile.notes[0])
    return profile
  }
  try {
    const info = webapis.productinfo
    if (info && typeof info.isUdPanelSupported === 'function') {
      profile.height = info.isUdPanelSupported() ? 2160 : 1080
      profile.source = 'webapis.productinfo'
    } else profile.notes.push('productinfo.isUdPanelSupported unavailable: height from the TU8000 profile')
  } catch (e) {
    profile.notes.push('productinfo failed (' + errorText(e) + '): height from the TU8000 profile')
  }
  try {
    const av = webapis.avinfo
    if (av && typeof av.isHdrTvSupport === 'function') {
      profile.hdr = !!av.isHdrTvSupport()
      profile.source = 'webapis'
    } else profile.notes.push('avinfo.isHdrTvSupport unavailable: hdr from the TU8000 profile')
  } catch (e) {
    profile.notes.push('avinfo failed (' + errorText(e) + '): hdr from the TU8000 profile')
  }
  log('device: ' + describeDevice(profile))
  profile.notes.forEach(n => log('device: ' + n))
  return profile
}

export function describeDevice(d) {
  return d.height + 'p' + (d.hdr ? ' HDR' : '') + (d.hevc ? ' HEVC' : '') + (d.av1 ? ' AV1' : '') + (d.dolbyVision ? ' DV' : '') +
    ' audio[' + Array.from(d.audio).join(',') + '] (' + d.source + ')'
}

function errorText(e) { return e && e.message ? e.message : String(e) }
