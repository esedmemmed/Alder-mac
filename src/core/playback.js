// The pure helpers of Alder's PlayerActivity.kt (the player itself is Phase 3), kept in core so they are unit-tested in Node:
// constants, lowerSourceHeight, upNextWindow, plausibleEpisode, nextVideo, the add-on subtitle choice and IntroDB's answer.
// bestAudio (the audio track order) lives in core/audio.js because it also has to skip tracks the TV can't decode.

/** PlayerActivity's companion constants, in milliseconds (RETRIES and TRY are counts). */
export const PLAYER = Object.freeze({
  TICK: 10000, // progress is recorded every tick, pushed to Stremio every 6th (a minute)
  PUSH_EVERY: 6,
  RESUME_SLACK: 10000, // how far apart the saved and fresh resume points may be before it jumps
  SKIP: 10000, // a Left/Right press on the bar moves this far
  SEEK_SETTLE: 600, // after the last skip before seeking
  SKIP_SHOWN: 10000, // the Skip intro pill stays, as in NuvioTV
  HIDE: 5000, // the controls stay up while playing
  START_WAIT: 12000, // for a source to show a picture before the next is tried (4K DV from debrid took 6 s)
  RETRIES: 2,
  RETRY_WAIT: 1500,
  TRY: 3,
  STALLS_FOR_LOWER: 3, // stalls within STALL_WINDOW offer a lower quality
  STALL_WINDOW: 60000,
})

/** The next quality step down from [height], or null when there is none (the player offers "Switch to 1080p?"). */
export function lowerSourceHeight(height) {
  const lower = [1080, 720, 480].find(h => h < height)
  return lower === undefined ? null : lower
}

/** How close to the end the Up Next card appears: 1/25 of the length, between 30 s and 60 s. */
export function upNextWindow(durationMs) {
  return Math.min(60000, Math.max(30000, Math.trunc(durationMs / 25)))
}

/** A series "episode" shorter than two minutes is a trailer or a broken link: nothing is saved for it. */
export function plausibleEpisode(durationMs) {
  return durationMs >= 2 * 60000
}

/** The episode after [videoId], or null for a film, the last episode, or before the episode list is in. */
export function nextVideo(videos, videoId) {
  if (!videos) return null
  const at = videos.findIndex(v => v.id === videoId)
  if (at < 0) return null
  const next = videos[at + 1]
  // not from the finale into specials
  return next && (next.season !== 0 || videos[at].season === 0) ? next : null
}

/** The TV's language and English, three files each in the add-on's order (a language picker if asked). */
export function chooseAddonSubtitles(all, tvLanguage) {
  const local = all.filter(s => s.isLocal(tvLanguage))
  const english = all.filter(s => !s.isLocal(tvLanguage) && s.isEnglish())
  return local.slice(0, 3).concat(english.slice(0, 3))
}

/**
 * IntroDB's answer (api.introdb.app/segments?imdb_id=tt…&season=1&episode=2) as { segments, outroAt } in milliseconds.
 * `segments` are the "Skip recap" and "Skip intro" pills in that order; `outroAt` is when the credits start (0 if unknown),
 * which is when Up Next appears, rather than the last-4% guess. A part is used only if 0 <= start < end.
 */
export function parseSegments(json) {
  const part = name => {
    const p = json && typeof json === 'object' ? json[name] : null
    if (!p || typeof p !== 'object') return null
    const a = Number(p.start_sec === undefined ? -1 : p.start_sec)
    const b = Number(p.end_sec === undefined ? -1 : p.end_sec)
    return a >= 0 && b > a ? [Math.trunc(a * 1000), Math.trunc(b * 1000)] : null
  }
  const intro = part('intro'), recap = part('recap'), outro = part('outro')
  const segments = []
  if (recap) segments.push({ label: 'Skip recap', start: recap[0], end: recap[1] })
  if (intro) segments.push({ label: 'Skip intro', start: intro[0], end: intro[1] })
  return { segments, outroAt: outro ? outro[0] : 0 }
}

/** The IntroDB request for a series video id such as "tt11280740:1:3", or null (films, other id schemes). */
export function introDbUrl(type, metaId, videoId) {
  const parts = String(videoId).split(':')
  if (type !== 'series' || !String(metaId).startsWith('tt') || parts.length < 3) return null
  return 'https://api.introdb.app/segments?imdb_id=' + parts[0] + '&season=' + parts[1] + '&episode=' + parts[2]
}
