// The "find sources for one video" flow of Alder's StreamsActivity.onCreate, without the views: which add-ons to ask
// (household sharing), when to start playing, when to show the list. Normally it picks sources and hands the player a short
// list to fall back on, so Play is one click; with `pick` (held OK on Play, or after three sources failed) it lists them all.

import { readyStreams, TRY } from './ranking.js'

/**
 * The stream add-ons to ask for [type]/[videoId]: shared ones from the profiles lending theirs first (their own stream
 * add-ons, not Stremio's or personal ones), then this account's own that aren't already covered by id.
 *   stremio   createStremio(...)
 *   lenders   Profiles.streamLenders()
 * Resolves to Addon[]. A lender whose list can't be read is skipped.
 */
export async function streamAddonsFor(stremio, authKey, lenders, type, videoId) {
  const own = (await stremio.addons(authKey)).filter(a => a.serves('stream', type, videoId))
  const household = []
  for (const lender of lenders) {
    try {
      const list = stremio.savedAddons(lender.authKey) || await stremio.addons(lender.authKey)
      for (const a of list) {
        if (a.shareable && a.serves('stream', type, videoId) && !household.some(h => h.id === a.id)) household.push(a)
      }
    } catch (e) { /* a lender that can't be reached just lends nothing */ }
  }
  return household.concat(own.filter(mine => !household.some(h => h.id === mine.id)))
}

export const GAP_WAIT_MS = 800 // after this long, a playable later answer can start without waiting for earlier add-ons

/**
 * Collects add-on answers and decides what happens.
 *   addons    Addon[] in the order to prefer (see streamAddonsFor)
 *   ranker    core/ranking.js createRanker(...)
 *   pick      list everything, never auto-play (hold OK, Settings "Show sources")
 *   timers    { setTimeout, clearTimeout } (defaults to the globals)
 * Callbacks:
 *   onPlay(streams)  the sources for the player, best first (at most TRY)
 *   onList(model)    ranker.listModel(...) for the Sources page
 *   onStatus(code)   "no-addons" when there is nothing to ask
 */
export class SourceFinder {
  constructor({ addons, type, videoId, ranker, pick = false, onPlay, onList, onStatus = () => {}, timers = null }) {
    this.addons = addons
    this.type = type
    this.videoId = videoId
    this.ranker = ranker
    this.pick = pick
    this.onPlay = onPlay
    this.onList = onList
    this.onStatus = onStatus
    this.timers = timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id) }
    this.answers = addons.map(() => null)
    this.started = false
    this.listed = false
    this.waitingForEarlier = false
    this.timer = null
  }

  start() {
    if (this.addons.length === 0) { this.onStatus('no-addons'); return }
    this.addons.forEach((addon, i) => {
      addon.streams(this.type, this.videoId).then(
        streams => this.answer(i, streams),
        () => this.answer(i, []), // an add-on that fails just has no sources
      )
    })
  }

  /** Stops the pending 800 ms wait (the screen was left). */
  cancel() {
    this.started = true
    if (this.timer !== null) { this.timers.clearTimeout(this.timer); this.timer = null }
  }

  answer(i, streams) {
    this.answers[i] = streams
    if (this.answers.every(a => a !== null)) {
      if (this.pick || this.listed) this.showList()
      else this.tryStart()
    } else if (!this.pick) {
      this.tryStart()
      if (!this.started && !this.waitingForEarlier && readyStreams(this.answers, true).some(s => this.ranker.playable(s) && this.ranker.wanted(s))) {
        this.waitingForEarlier = true
        this.timer = this.timers.setTimeout(() => { this.timer = null; this.tryStart(true) }, GAP_WAIT_MS)
      }
    }
  }

  showList() {
    this.listed = true
    const entries = []
    this.addons.forEach((addon, i) => (this.answers[i] || []).forEach(stream => entries.push({ stream, addon: addon.name })))
    this.onList(this.ranker.listModel(entries))
  }

  /** Keep add-on order when earlier ones answer promptly; after 800 ms, a playable later answer can start. */
  tryStart(allowGaps = false) {
    if (this.started || this.pick || this.listed) return
    const ready = readyStreams(this.answers, allowGaps)
    const best = this.ranker.autoCandidates(ready)
    if (best.length === 0 && this.answers.some(a => a === null)) return
    if (best.length === 0) { this.showList(); return }
    this.started = true
    this.onPlay(best.slice(0, TRY))
  }
}
