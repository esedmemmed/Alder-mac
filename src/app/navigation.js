// Where the app goes: the first screen at launch, and what happens when the player is done (docs/CONTEXT.md "Screens").
// Pure over a router and the profiles, so it is tested without a DOM.

/**
 * The launch screen (Alder's ProfilesActivity as the launcher): no profile yet is the sign-in; several profiles, or a profile
 * with a PIN, is the picker; a single plain profile goes straight to Home. -> { name, params, open?: Profile }
 */
export function firstScreen(profiles) {
  const list = profiles.all()
  if (!list.length) return { name: 'signin', params: {} }
  if (list.length > 1 || list[0].pin) return { name: 'profiles', params: {} }
  return { name: 'home', params: {}, open: list[0] }
}

/** "S1 E5  ·  Title" for the sources page's header (Alder: the episode line of StreamsActivity). */
export function episodeLine(video) {
  if (!video) return null
  const code = 'S' + video.season + ' E' + video.episode
  return video.title && video.title.trim() ? code + '  ·  ' + video.title : code
}

/**
 * The player's `onNavigate(nav, context)` (src/player/engine.js 'navigate'): the player is done, go here.
 *   exit                                  back to where we came from
 *   sources { pick, resumeAt, maxHeight, message }   the sources page, for the same video (Change stream, a lower quality, all failed)
 *   next { video, afterVideoId }          the sources page for the next episode, which starts it (the release the last one used is
 *                                         preferred through the source memory: Alder's `binge:<id>` preference)
 *   details                               the title page
 * The player's own params (what the sources page gave it) say which title and video this was.
 */
export function playerNavigation(router) {
  const player = () => { const top = router.top(); return top && top.name === 'player' ? top.params || {} : null }

  /** The sources page under the player (a picked source: Back returned there) is replaced, not stacked. */
  function toSources(params) {
    const names = router.names()
    if (names[names.length - 2] === 'streams') { router.pop(); router.replace('streams', params) } else router.replace('streams', params)
  }

  return function onNavigate(nav) {
    const p = player()
    if (!p) { router.pop(); return }
    const title = { type: p.type, id: p.metaId, name: p.name, poster: p.poster || null, background: p.background || null, logo: p.logo || null, runtime: p.runtime || null }
    switch (nav.kind) {
      case 'sources':
        toSources(Object.assign({}, title, {
          videoId: p.videoId, episode: p.episode || null, nextVideoId: p.nextVideoId || null,
          pick: !!nav.pick, resumeAt: nav.resumeAt, maxHeight: nav.maxHeight, message: nav.message || null,
        }))
        return
      case 'next':
        toSources(Object.assign({}, title, {
          videoId: nav.video.id, episode: episodeLine(nav.video), nextVideoId: nav.afterVideoId || null, pick: false,
          label: [p.name, 'S' + nav.video.season + ' E' + nav.video.episode].join('  ·  '),
        }))
        return
      case 'details': {
        const names = router.names()
        const below = names.slice(0, -1).lastIndexOf('details')
        if (below >= 0) { while (router.top() && router.top().name !== 'details') router.pop() } else router.replace('details', title)
        return
      }
      default:
        router.pop()
    }
  }
}
