// Web device profile, for the module swap in scripts/build.mjs (npm run build:web): same exports as src/platform/mac/device.js.
// Built once at start from what the browser says it can play (canPlayType) and from the screen. No webapis here.

const TEN_BIT = /10.?bit|hi10|main.?10/
const HIGH_FPS = /\b(?:5\d|[6-9]\d|1[0-2]\d)\s?fps\b|\b(?:50|60)p\b|(?:720|1080|2160)p(?:50|60)\b/ // 50 fps and up (48 and 49 pass: fps < 50)

/** The browser's canPlayType for [type] ('' when it has no <video>). */
function can(doc, type) {
  try {
    const video = doc.createElement('video')
    return video && typeof video.canPlayType === 'function' ? String(video.canPlayType(type)) : ''
  } catch (e) {
    return ''
  }
}

/** The profile (named like the Mac module's, so both export the same names). env: { doc, screen, dpr } (defaults: the page's document, screen and devicePixelRatio). */
export function macProfile({ doc = typeof document !== 'undefined' ? document : null, screen: scr = typeof screen !== 'undefined' ? screen : null, dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1 } = {}) {
  const ask = type => (doc ? can(doc, type) : '')
  const hevcAnswer = ask('video/mp4; codecs="hvc1.1.6.L93.B0"')
  const hevcAnswer2 = ask('video/mp4; codecs="hev1.1.6.L93.B0"')
  const isYes = a => a === 'probably' || a === 'maybe'
  const hevc = isYes(hevcAnswer) || isYes(hevcAnswer2)
  const av1 = ask('video/mp4; codecs="av01.0.05M.08"') !== ''
  const audio = ['AAC', 'MP3', 'OPUS', 'FLAC', 'VORBIS', 'PCM']
  if (ask('audio/mp4; codecs="ac-3"') !== '') audio.push('AC3')
  if (ask('audio/mp4; codecs="ec-3"') !== '') audio.push('EAC3')
  const wide = scr && Number.isFinite(scr.width) ? scr.width * (Number.isFinite(dpr) && dpr > 0 ? dpr : 1) : 0
  const profile = {
    hevc, av1, dolbyVision: false, hdr: false, height: wide >= 3000 ? 2160 : 1080, preferHeight: 1080, fps: 30, codec: 'H.264 8-bit' + (hevc ? ', HEVC 8-bit' : ''),
    audio: new Set(audio), source: 'browser profile', notes: ['the browser decides what plays: DTS and TrueHD never'],
  }
  profile.autoOk = s => autoOkFor(profile, s)
  return profile
}

/** May auto-play / BEST MATCH try it: H.264 8-bit and (when the browser plays it) HEVC 8-bit, at most the screen's height, under 50 fps. */
function autoOkFor(profile, s) {
  if (s.av1 || s.isHdr) return false
  if (s.hevc && !profile.hevc) return false
  if (s.height > 0 && s.height > profile.height) return false
  return !TEN_BIT.test(s.words) && !HIGH_FPS.test(s.words)
}

/** Stream-level check without a profile in hand: H.264 only (hevc false). Same name as the Mac module's autoOk. */
export function autoOk(s) {
  return autoOkFor({ hevc: false, height: 1080 }, s)
}

/** env is accepted for the same call shape as the Tizen module (webapis, av1 are ignored). env.log: (message) => void. */
export function deviceProfile(env = {}) {
  const { log = () => {} } = env
  const profile = macProfile(env.web || {})
  log('device: ' + describeDevice(profile))
  profile.notes.forEach(n => log('device: ' + n))
  return profile
}

export function describeDevice(d) {
  return d.height + 'p' + (d.fps ? d.fps : '') + (d.hdr ? ' HDR' : '') + (d.hevc ? ' HEVC' : '') + (d.av1 ? ' AV1' : '') + (d.dolbyVision ? ' DV' : '') +
    (d.codec ? ' ' + d.codec : '') + ' audio[' + Array.from(d.audio).join(',') + '] (' + d.source + ')'
}
