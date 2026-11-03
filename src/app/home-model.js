// The pure half of Alder's MainActivity.kt (Home): which catalog goes on which page and under what name, how rows are
// sectioned and the genre chips chosen, the Item every card is made from (a catalog title or a library entry), and the small
// text rules (synopsis at a sentence, "Added 3 days ago", time left). No DOM, no network: the Home screen draws what this decides,
// and test/app/home-model.test.js checks it against Alder's behaviour.
import { sharp, logoFor } from '../lib/images.js'
import { optInt, optString, optBoolean, text, obj, sortBy } from '../core/util.js'

/** Screen.kt DOT: the separator between facts. */
export const DOT = '  ·  '

// MainActivity companion constants
export const START = 9 // cards a row starts with (a screenful and a bit)
export const PAGE = 12 // cards that come at a time as the remote nears a row's end
export const AHEAD = 8 // cards from a row's end when the next page is asked for
export const FIRST = 10 // cards per row loaded before it is scrolled sideways
export const GENRE_ROWS = 6 // genre rows (and chips) at most on Shows and Movies
export const CATALOG_WAIT = 6000 // ms a catalog may take
export const LIST_COLUMNS = 6
export const SWITCH_WAIT = 150 // ms the remote rests on the name of a page that has to be built before it opens: passing over names builds nothing
export const KEPT_GAP = 90 // ms between two flips to pages that are already built (a held key repeats faster than a page can fade in)
export const WARM_AFTER = 1500 // ms after Home's first row is in before the other pages are built ahead
export const QUIET = 600 // ms without a key press before the warm-up does a piece of work
export const CARD_BUDGET = 150 // cards alive in all pages together (PLAN.md section 2)
export const ADDONS_TTL = 60 * 1000 // ms before a page asks Stremio for the add-on list again when it is shown
export const LIBRARY_TTL = 20 * 1000 // the same for the library (Continue Watching, My List)
export const CATALOGS_TTL = 30 * 60 * 1000 // and for a page's catalogs
export const PAGES = ['Home', 'Shows', 'Movies', 'Live', 'My List']
export const NAV_PAGES = ['Home', 'Shows', 'Movies', 'My List'] // Alder's top bar leaves Live out (its screenshots too)

export const isCatalogPage = p => p === 'Shows' || p === 'Movies'

/**
 * Which page the top bar opens, and when. The remote resting on a page's name opens it at once when the page is already built
 * (it is only shown again, which costs a frame), and after SWITCH_WAIT when it still has to be built, so moving across the bar
 * builds nothing in between. OK always opens at once. Flips between built pages are at least KEPT_GAP apart: a held key would
 * restart the page's fade-in on every press. `commit(label, how)` does the opening (how: 'rest' | 'ok'); `canCommit(label)` is
 * asked when a rest has ended (the remote may have left the bar meanwhile).
 */
export function createPageSwitcher({ isBuilt, commit, canCommit = () => true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, buildWait = SWITCH_WAIT, keptGap = KEPT_GAP }) {
  let timer = null
  let pending = null
  let lastCommit = -Infinity
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null } pending = null }
  const fire = (label, how) => { stop(); if (how !== 'ok' && !canCommit(label)) return false; lastCommit = now(); commit(label, how); return true }
  const later = (label, ms) => { pending = label; timer = setTimer(() => { timer = null; fire(label, 'rest') }, ms) }
  return {
    /** The remote came to [label]'s name while [current] is open. -> 'same' | 'now' | 'soon' | 'wait' */
    rest(label, current) {
      stop()
      if (label === current) return 'same'
      if (!isBuilt(label)) { later(label, buildWait); return 'wait' }
      const wait = lastCommit + keptGap - now()
      if (wait <= 0) { fire(label, 'rest'); return 'now' }
      later(label, wait)
      return 'soon'
    },
    /** OK on [label]'s name. False when it is the page already open (the caller goes down into it). */
    ok(label, current) { stop(); if (label === current) return false; return fire(label, 'ok') },
    /** The remote left the bar. */
    cancel: stop,
    get pending() { return pending },
  }
}

/** Two titles show the same card and the same lines under it: nothing to redraw when a fresh answer brings the same. */
export const sameTitle = (a, b) => !!a && !!b && ['id', 'name', 'poster', 'progress', 'finished', 'left', 'stoppedAt', 'videoId'].every(k => a[k] === b[k])

/**
 * A row's titles after a fresh answer, patched in: a title that did not change stays the very same object (its details, picture
 * and card are kept), one that changed (new progress, a new place) is the fresh object carrying over what the old one had been
 * told by the meta add-on. -> { items, changed }: changed is false when the answer is the list already shown.
 */
export function mergeItems(prev, next) {
  const byId = new Map(prev.map(p => [p.id, p]))
  let changed = prev.length !== next.length
  const items = next.map((n, i) => {
    const old = byId.get(n.id)
    if (old && sameTitle(old, n)) { if (prev[i] !== old) changed = true; return old }
    changed = true
    if (old && old.filled && !n.filled) {
      n.filled = true; n.settled = old.settled
      if (!n.art) n.art = old.art
      if (!n.logo) n.logo = old.logo
      if (!n.about) n.about = old.about
      if (!n.facts.length) n.facts = old.facts
    }
    return n
  })
  return { items, changed }
}

/**
 * Which hidden pages let go of their cards to keep the whole app within [budget]: the one longest unused first. [pages] are
 * { label, cards, used } (used: when it was last shown); the open page is never trimmed.
 */
export function pagesToTrim(pages, active, budget = CARD_BUDGET) {
  let total = pages.reduce((n, p) => n + p.cards, 0)
  const out = []
  const hidden = sortBy(pages.filter(p => p.label !== active && p.cards > 0), [[p => p.used, 'asc']])
  for (const p of hidden) {
    if (total <= budget) break
    out.push(p.label)
    total -= p.cards
  }
  return out
}

/** Has [at] (a time, 0 for never) gone past [ttl]? */
export const stale = (at, now, ttl) => !at || now - at > ttl

/** Alder's `synopsisAtSentence`: the description cut at the last sentence end before [limit], else at a word with an ellipsis. */
export function synopsisAtSentence(t, limit) {
  if (limit >= t.length) return t
  // A sentence ends at . ! or ? before a space, but not after "Sgt.", "Dr.", "U.S." and the like.
  let end = -1
  for (let i = limit - 1; i >= 0; i--) {
    if (!'.!?'.includes(t[i]) || t[i + 1] !== ' ') continue
    if (t[i] === '.') {
      const word = t.substring(t.lastIndexOf(' ', i) + 1, i)
      if (word.includes('.') || (word.length <= 3 && word.length > 0 && word[0] !== word[0].toLowerCase() && word[0] === word[0].toUpperCase())) continue
    }
    end = i
    break
  }
  if (end >= 0) return t.substring(0, end + 1)
  const clipped = t.slice(0, limit).replace(/\s+$/, '')
  const isLetterOrDigit = c => c !== undefined && /[\p{L}\p{N}]/u.test(c)
  let whole = clipped
  if (isLetterOrDigit(t[limit - 1]) && isLetterOrDigit(t[limit])) {
    const at = clipped.lastIndexOf(' ')
    whole = at >= 0 ? clipped.substring(0, at) : clipped
  }
  return whole.replace(/[\s,;:\-.!?]+$/, '') + '…'
}

/** "Because you watched Crayon Shin-chan: Pursuit" → "More like Crayon Shin-chan". */
export function homeRowName(name) {
  const prefix = 'Because you watched '
  if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return name.trim().slice(0, 36).replace(/\s+$/, '')
  let title = name.substring(prefix.length)
  title = title.split(':')[0].split(' (')[0].split(' - ')[0].trim()
  return 'More like ' + title.slice(0, 26).replace(/\s+$/, '')
}

export const seasons = count => (count === 1 ? '1 season' : count + ' seasons')

/** The genres a page's chips may offer: no "All", no duplicates, the common ones first. */
export function catalogGenres(names) {
  const preferred = ['Drama', 'Comedy', 'Crime', 'Sci-Fi', 'Anime', 'Documentary']
  const seen = new Set()
  const unique = names.filter(n => n.toLowerCase() !== 'all' && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
  const rank = n => { const i = preferred.findIndex(p => p.toLowerCase() === n.toLowerCase()); return i < 0 ? preferred.length : i }
  return sortBy(unique, [[rank, 'asc'], [n => n, 'asc']])
}

/** The chips to show once every genre row has answered: null while any is pending, else the ones that had titles. */
export function settledGenres(names, results) {
  if (names.some(n => !(n in results))) return null
  return names.filter(n => results[n] === true)
}

/**
 * A row's short name: personal picks are "For you", charts "Popular", and a long themed name ("Short & Sweet Adventure")
 * keeps only the [genres] it names, so it can merge with that genre's row.
 */
export function shortRowName(name, genres = []) {
  const n = name.replace(/science fiction/gi, 'Sci-Fi').trim()
  const has = s => n.toLowerCase().includes(s)
  if (has(' in india') && has('recommend')) return n // a region's picks, not the viewer's
  if (has('pick') || has('recommend')) return 'For you'
  if (has('popular') || has('trending')) return 'Popular'
  if (n.length <= 18) return n
  const named = genres.filter(g => has(g.toLowerCase())).slice(0, 2).join(' & ')
  return named || n.slice(0, 28).replace(/\s+$/, '')
}

export const isAddonMessage = name => name.toLowerCase().includes('authentication required')

export const listRowCount = (titles, columns) => Math.floor((titles + columns - 1) / columns)

export const nextCatalogSection = (total, loaded) => Math.min(total, loaded + 4)

export const catalogAnswerKey = (page, title, genre, sources) => [page, title, genre || ''].concat(sources).join('\u0000')

/** Add-on names as a person would write them: no "TV Shows:" label, no run-together keyword tags. */
export function tidy(name) {
  let n = name
  if (n.startsWith('TV Shows: ')) n = n.slice('TV Shows: '.length)
  if (n.startsWith('MyTrakt - ')) n = n.slice('MyTrakt - '.length)
  // Watchly glues TMDB keyword tags onto theme names ("Comedy Aftercreditsstinger"); a word this long is one.
  return n.split(' ').filter(w => w.length < 16).join(' ')
}

const INDIA = {
  trendingmovies: 'Trending in India', trendingtv: 'Trending in India',
  popmov: 'Popular in India',
  nfxprm: 'Popular on Netflix & Prime', nfxprmtv: 'Popular on Netflix & Prime',
  hstzee: 'Popular on Hotstar, SonyLIV & Zee5', hstzeetv: 'Popular on Hotstar, SonyLIV & Zee5',
  recmov: 'Recommended in India', atpmub: 'Recommended in India',
}

/**
 * Where a catalog's row goes and what it's called, like Netflix: Home is what you're watching and what it led to ("Because you
 * watched…"); everything else sits on Movies or Shows by type, without the add-on's name or a type suffix. Personal picks come
 * first (rank 0-1), then what's popular (2), then themed lists (3). Anything that isn't a film or a series (sport, TV channels,
 * events) goes to Live, under its own name. -> { page, title, rank }
 */
export function shelf(c) {
  const typePage = c.type === 'movie' ? 'Movies' : c.type === 'series' ? 'Shows' : null
  if (typePage === null) return { page: 'Live', title: tidy(c.name), rank: 3 }
  const addon = c.addon.id
  if (addon.includes('watchly') && c.id.startsWith('watchly.item')) return { page: 'Home', title: homeRowName(c.name), rank: 0 }
  if (addon.includes('watchly') && c.id === 'watchly.rec') return { page: typePage, title: 'Top Picks for You', rank: 0 }
  if (addon.startsWith('trakt.addon') && c.id.startsWith('recommendations')) return { page: typePage, title: 'Recommended for You', rank: 1 }
  if (addon.startsWith('trakt.addon') && c.id.startsWith('trending')) return { page: typePage, title: 'Trending Now', rank: 2 }
  if (addon === 'in.rdata.indiastreams') return { page: typePage, title: INDIA[c.id] || c.name, rank: 2 }
  return { page: typePage, title: tidy(c.name), rank: 3 }
}

/**
 * The shelves of [page] from every add-on's catalogs, in the add-ons' order within a rank: [{ catalog, shelf }].
 * (Kotlin's sortedBy is stable; so is this.)
 */
export function shelvesFor(page, addons) {
  const all = []
  addons.forEach(a => a.catalogs.forEach(c => { const s = shelf(c); if (s && s.page === page) all.push({ catalog: c, shelf: s }) }))
  return sortBy(all, [[e => e.shelf.rank, 'asc']])
}

/**
 * A page's rows: catalogs with the same purpose share a row, and Shows and Movies end with a row per main genre (the first
 * catalog that filters by it) unless a row of that name is already there; the chips jump to these rows.
 * -> [{ title, sources: [{ catalog, shelf }], picked: genre | null }]
 */
export function sectionsFor(page, shelves) {
  const genres = catalogGenres([].concat(...shelves.map(s => s.catalog.genres)))
  if (!isCatalogPage(page)) return shelves.map(s => ({ title: s.shelf.title, sources: [s], picked: null }))
  const groups = new Map()
  shelves.forEach(s => {
    const name = shortRowName(s.shelf.title, genres)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(s)
  })
  const merged = Array.from(groups, ([title, sources]) => ({ title, sources, picked: null }))
  const genreRows = genres.slice(0, GENRE_ROWS).filter(g => !merged.some(m => m.title.toLowerCase() === g.toLowerCase()))
    .map(g => { const first = shelves.find(s => s.catalog.genres.includes(g)); return first ? { title: g, sources: [first], picked: g } : null })
    .filter(Boolean)
  return merged.concat(genreRows)
}

// ---- Items ----

/** "S1 E3" for an episode id such as tt123:1:3, else null. */
export function episodeCode(videoId) {
  const parts = typeof videoId === 'string' ? videoId.split(':') : []
  return parts.length === 3 ? 'S' + parts[1] + ' E' + parts[2] : null
}

/** "31 min left" / "2h 3m left" from the stored duration and offset in ms, or null when there is nothing to say. */
export function timeLeft(durationMs, offsetMs) {
  if (!(durationMs > 0 && offsetMs > 1)) return null
  const mins = Math.trunc((durationMs - offsetMs) / 60000)
  return mins >= 60 ? Math.trunc(mins / 60) + 'h ' + (mins % 60) + 'm left' : mins + ' min left'
}

/** "31:34", or "1:06:12" past an hour (DateUtils.formatElapsedTime). */
export function elapsed(ms) {
  const total = Math.trunc(ms / 1000)
  const h = Math.trunc(total / 3600), m = Math.trunc((total % 3600) / 60), s = total % 60
  const two = n => (n < 10 ? '0' + n : String(n))
  return h > 0 ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s)
}

/** A finished title: watched at least once and nothing left to resume. */
export function libraryFinished(item) {
  const s = obj(item, 'state')
  if (!s) return false
  return optInt(s, 'timesWatched') > 0 && optInt(s, 'timeOffset') === 0
}

/** The facts the catalog did not send, from the meta add-on: "Drama, Comedy", year, "IMDb 8.0". */
export function factsOf(m) {
  return [m.genres.slice(0, 2).join(', ') || null, m.year, m.rating ? 'IMDb ' + m.rating : null].filter(x => x !== null && x !== undefined)
}

/**
 * A title in a row. Details the catalog didn't send are filled in later from the meta add-on (fill/apply in the screen).
 * Fields: id, type, name, poster (the card's picture, already sized), art (full-screen), logo, about, facts[], videoId, progress,
 * resume (has watch progress), left ("S1 E3  ·  31 min left"), stoppedAt (ms), addedAt, finished.
 */
export function metaItem(m) {
  return {
    id: m.id, type: m.type, name: m.name, poster: posterUrl(m.poster), art: m.background, logo: m.logo || logoFor(m.id),
    about: m.description || '', facts: factsOf(m), videoId: null, progress: 0, resume: false, left: null,
    stoppedAt: null, addedAt: null, finished: false, filled: false, settled: false,
  }
}

export function libraryItem(item) {
  const s = obj(item, 'state') || {}
  const videoId = text(s, 'video_id')
  const duration = optInt(s, 'duration')
  const offset = optInt(s, 'timeOffset')
  const code = episodeCode(videoId)
  const left = timeLeft(duration, offset)
  const progress = duration > 0 ? Math.max(0, Math.min(1, offset / duration)) : 0
  const id = optString(item, '_id')
  return {
    id, type: optString(item, 'type'), name: optString(item, 'name'), poster: posterUrl(text(item, 'poster')), art: null, logo: logoFor(id),
    about: '', facts: [], videoId, progress, resume: progress > 0, left: [code, left].filter(Boolean).join(DOT) || null,
    stoppedAt: offset, addedAt: text(item, '_ctime'), finished: libraryFinished(item), filled: false, settled: false,
  }
}

/** A card's picture at the size the card shows (MetaHub serves small, medium and large). */
export function posterUrl(url, width = 190) {
  return url ? sharp(url, width) : null
}

/** The year, first genre and length of a title for the hero line, from what the item and its details hold. */
export function heroFacts(item, meta, videoMeta) {
  const year = (meta && meta.year) || item.facts.find(f => /^\d/.test(f)) || null
  const genre = (meta && meta.genres[0]) || (() => { const f = item.facts.find(x => !/^\d/.test(x) && !x.startsWith('IMDb')); return f ? f.split(',')[0] : null })()
  const length = item.type === 'series'
    ? (() => { const n = new Set(((meta && meta.videos) || []).map(v => v.season).filter(s => s > 0)).size; return n > 0 ? seasons(n) : null })()
    : (meta && meta.runtime) || null
  // A show in progress describes its next episode, so the line names that episode rather than the show.
  const code = item.left ? item.left.split(DOT).find(p => p.startsWith('S') && p.includes(' E')) : null
  if (code) return [code, videoMeta && videoMeta.title ? videoMeta.title : null].filter(Boolean).join(DOT)
  return [year, genre, length].filter(Boolean).join(DOT)
}

/** Library filter and sort of My List (Alder's ListFilter and ListSort). */
export function listItems(library, filter, sort) {
  const kept = library.filter(it => !optBoolean(it, 'removed') && ['movie', 'series'].includes(optString(it, 'type')))
    .filter(it => filter === 'all' || optString(it, 'type') === (filter === 'movies' ? 'movie' : 'series'))
  if (sort === 'name') return sortBy(kept, [[it => optString(it, 'name').toLowerCase(), 'asc']])
  // finished titles last, then newest first
  if (sort === 'unwatched') return sortBy(kept, [[libraryFinished, 'asc'], [it => optString(it, '_ctime'), 'desc']])
  return sortBy(kept, [[it => optString(it, '_ctime'), 'desc']])
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Today", "Yesterday", "3 days ago", else "Jun 19, 2026" (DateUtils.getRelativeTimeSpanString at day resolution). */
export function addedAgo(value, now = Date.now()) {
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return 'recently'
  const day = t => { const d = new Date(t); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) }
  const days = Math.round((day(now) - day(at)) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days > 1 && days < 7) return days + ' days ago'
  const d = new Date(at)
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
}

/** The "Row 2 of 20  ·  115 titles" line of My List. */
export const listCountText = (row, rows, titles) => 'Row ' + row + ' of ' + rows + DOT + titles + ' titles'

/** Items of a library list for Home's Continue row (Library.continueWatching decides which). */
export const continueSignature = items => items.map(it => optString(it, '_id') + optString(it, '_mtime') + optBoolean(it, 'removed') + optInt(obj(it, 'state') || {}, 'timeOffset')).join(',')

/**
 * A pool that runs at most [n] jobs at once, newest first (Images.newestFirst): after racing along a row, the titles the remote
 * stopped on get their details before the ones it passed. jobs: (done) => void, which must call done() when finished.
 */
export function newestFirst(n, schedule = f => f()) {
  const queue = []
  let running = 0
  function pump() {
    while (running < n && queue.length) {
      const job = queue.pop()
      if (job.cancelled && job.cancelled()) continue
      running++
      let finished = false
      const done = () => { if (finished) return; finished = true; running--; schedule(pump) }
      try { job.run(done) } catch (e) { done() }
    }
  }
  return {
    run(run, cancelled = null) { queue.push({ run, cancelled }); pump() },
    pending: () => queue.length,
    active: () => running,
  }
}
