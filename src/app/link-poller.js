// Stremio's TV sign-in as Alder's ProfilesActivity.showSignIn/poll runs it, without the views: get a code and its link, show them,
// ask `readLink` every 3 seconds until the person approves it on their phone, and ask for a fresh code every 5 minutes
// (Stremio does not say when a code expires: waiting and expired look the same, so a new code is simply made).
// A network blip while polling counts as "not approved yet"; a code that cannot be made is retried after 5 seconds.
//
//   createLinkPoller({ stremio, timers, now, onCode({ code, url }), onTick(secondsLeft), onApproved(authKey), onTrouble(message) })
//   .start()   .stop()

export const POLL_MS = 3000
export const EXPIRE_MS = 5 * 60 * 1000
export const RETRY_MS = 5000

export function createLinkPoller({
  stremio, onCode = () => {}, onTick = () => {}, onApproved, onTrouble = () => {},
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id) }, now = () => Date.now(),
}) {
  let generation = 0 // anything older than the current code or a stop() is ignored when it answers
  let pollTimer = null
  let tickTimer = null
  let retryTimer = null

  const clear = () => {
    [pollTimer, tickTimer, retryTimer].forEach(t => { if (t !== null) timers.clearTimeout(t) })
    pollTimer = tickTimer = retryTimer = null
  }

  async function begin() {
    const mine = ++generation
    clear()
    let link
    try { link = await stremio.createLink() } catch (e) {
      if (mine !== generation) return
      onTrouble("Can't reach Stremio. Trying again…")
      retryTimer = timers.setTimeout(() => { if (mine === generation) begin() }, RETRY_MS)
      return
    }
    if (mine !== generation) return
    const startedAt = now()
    onCode(link)
    const tick = () => {
      if (mine !== generation) return
      onTick(Math.max(0, Math.trunc((EXPIRE_MS - (now() - startedAt)) / 1000)))
      tickTimer = timers.setTimeout(tick, 1000)
    }
    tick()
    const poll = () => {
      pollTimer = timers.setTimeout(async () => {
        if (mine !== generation) return
        let key = null
        try { key = await stremio.readLink(link.code) } catch (e) { key = null }
        if (mine !== generation) return
        if (key) { generation++; clear(); onApproved(key); return }
        if (now() - startedAt > EXPIRE_MS) { begin(); return }
        poll()
      }, POLL_MS)
    }
    poll()
  }

  return { start: begin, stop() { generation++; clear() } }
}
