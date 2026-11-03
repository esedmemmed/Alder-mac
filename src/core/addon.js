// Port of Alder's Addon.kt: one installed add-on spoken to with the Stremio add-on protocol (plain GETs for catalogs,
// metadata, streams and subtitles), plus Meta, Video, Subtitle and Stream (which reads a release's quality from its names).
//
// Dependencies are injected so this runs in Node and in the browser alike:
//   deps.http  { get(url, { keep, timeoutMs }) -> Promise<string>,  saved(url, json?) -> string | null }
//              `keep`: store the answer for `saved` (Alder's Http.keep). Both return the body text; a failed request rejects.
//   Fields marked "ms" are milliseconds.

import { languageName, toIso1, toIso3 } from './lang.js'
import { audioCodecsIn, classifyAudio } from './audio.js'
import { sortBy, arr, items, objects, strings, obj, optString, text, getString, optInt, optBoolean, uriEncode, lines, formatOneDecimal } from './util.js'

const MIB = 1024 * 1024

/**
 * One installed add-on. [descriptor] is the account's entry for it as Stremio stores it, kept whole so it can be copied
 * to another profile. Unlike Kotlin's constructor this one never throws on an odd manifest (a missing field reads as
 * empty): the descriptor must survive a reorder or a copy even when we can't use the add-on.
 */
export class Addon {
  constructor(descriptor, deps = {}) {
    this.descriptor = descriptor
    this.deps = deps
    const manifest = obj(descriptor, 'manifest') || {}
    this.manifest = manifest
    this.id = optString(manifest, 'id')
    this.name = optString(manifest, 'name')
    this.transportUrl = optString(descriptor, 'transportUrl')
    const flags = obj(descriptor, 'flags')
    /** Stremio's built-ins (Cinemeta, Local Files), which every account already has. */
    this.official = optBoolean(flags, 'official')
    /** Stremio's own that can't be removed (Cinemeta, Local Files); they can still be moved. */
    this.locked = optBoolean(flags, 'protected')
    this.providesStreams = items(arr(manifest, 'resources')).some(r => resourceName(r) === 'stream')
    /** Reads one person's history or lists (MyTrakt also declares `stream`): never shared or copied by default. */
    this.personal = ['watchly', 'trakt', 'simkl', 'syncribullet', 'aiolists'].some(p => this.name.toLowerCase().includes(p))
    this.base = this.transportUrl.replace(/\/manifest\.json$/, '')

    /** Catalogs Home can show: the ones that need no required input such as a search query. */
    this.catalogs = objects(arr(manifest, 'catalogs'))
      .filter(c => text(c, 'type') && text(c, 'id'))
      .filter(c => items(arr(c, 'extraRequired')).length === 0 && !objects(arr(c, 'extra')).some(e => optBoolean(e, 'isRequired')))
      .map(c => {
        const extras = strings(arr(c, 'extraSupported')).concat(objects(arr(c, 'extra')).map(e => optString(e, 'name')))
        // The genres it can filter by: the protocol's `genre` extra options, or the older `genres` list.
        const genreExtra = objects(arr(c, 'extra')).find(e => optString(e, 'name') === 'genre')
        const options = strings(arr(genreExtra, 'options'))
        const genres = options.length ? options : strings(arr(c, 'genres'))
        return new Catalog(this, getString(c, 'type'), getString(c, 'id'), optString(c, 'name') || getString(c, 'id'), extras.includes('skip'), genres)
      })
  }

  /** Stremio's `official` built-ins and personal add-ons are never lent; a profile lends its own stream add-ons. */
  get shareable() { return !this.official && this.providesStreams && !this.personal }

  /** Whether this add-on answers [resource] ("meta", "stream", …) for this type and id. */
  serves(resource, type, id) {
    const entry = items(arr(this.manifest, 'resources')).find(r => resourceName(r) === resource)
    if (entry === undefined) return false
    const own = entry !== null && typeof entry === 'object' ? entry : null
    const types = strings(arr(own, 'types') || arr(this.manifest, 'types'))
    const rawPrefixes = arr(own, 'idPrefixes') || arr(this.manifest, 'idPrefixes')
    const prefixes = rawPrefixes ? strings(rawPrefixes) : null // null: any id; an empty list: none
    return types.includes(type) && (prefixes === null || prefixes.some(p => id.startsWith(p)))
  }

  // Catalogs (one [genre] of them with Stremio's `genre` extra) and details are kept as they arrive; the saved*
  // versions read last time's answer, no network.
  async catalog(c, genre = null, timeoutMs = 20000) {
    const answer = JSON.parse(await this.deps.http.get(this.url(catalogPath(c, genre)), { keep: true, timeoutMs }))
    return metasOf(answer)
  }

  /** The titles after the first [skip] (Stremio's paging extra); not kept. */
  async catalogPage(c, skip) {
    return metasOf(await this.get(false, 'catalog', c.type, c.id, 'skip=' + skip))
  }

  savedCatalog(c, genre = null) {
    const saved = this.saved(...catalogPath(c, genre))
    return saved ? metasOf(saved) : null
  }

  /**
   * Every search catalog the add-on advertises, as Stremio's catalog protocol specifies. [deadlineMs]: after this long the
   * catalogs that have not answered are left out (Alder: 5 s); each request also has its own 5 s timeout.
   */
  async search(query, deadlineMs = 5000) {
    if (!String(query).trim()) throw new Error('Empty search')
    const catalogs = []
    const seen = new Set()
    for (const c of objects(arr(this.manifest, 'catalogs'))) {
      const required = strings(arr(c, 'extraRequired'))
      const supported = strings(arr(c, 'extraSupported'))
      const extras = objects(arr(c, 'extra'))
      const okType = ['movie', 'series'].includes(optString(c, 'type'))
      const hasSearch = required.concat(supported).concat(extras.map(e => optString(e, 'name'))).includes('search')
      const onlySearchRequired = required.every(r => r === 'search') &&
        !extras.some(e => optBoolean(e, 'isRequired') && optString(e, 'name') !== 'search')
      const key = optString(c, 'type') + '|' + optString(c, 'id')
      if (okType && hasSearch && onlySearchRequired && !seen.has(key)) { seen.add(key); catalogs.push(c) }
    }
    const fetchOne = async c => {
      const path = this.url(['catalog', getString(c, 'type'), getString(c, 'id')]).replace(/\.json$/, '')
      const searchUrl = path + '/search=' + uriEncode(query) + '.json'
      const answer = JSON.parse(await this.deps.http.get(searchUrl, { timeoutMs: 5000 }))
      if (!Array.isArray(answer.metas)) throw new Error('Search catalog failed')
      return metasOf(answer)
    }
    const answers = []
    let succeeded = false
    await new Promise(resolve => {
      let left = catalogs.length
      let done = false
      if (!left) return resolve()
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve() } }
      const timer = setTimeout(finish, deadlineMs)
      catalogs.forEach((c, index) => {
        fetchOne(c).then(
          metas => { if (!done) { succeeded = true; answers.push([index, metas]) } },
          () => {},
        ).then(() => { if (--left === 0) finish() })
      })
    })
    if (catalogs.length && !succeeded) throw new Error('Search catalog unavailable')
    return sortBy(answers, [[a => a[0], 'asc']]).reduce((all, a) => all.concat(a[1]), [])
  }

  async meta(type, id) {
    const m = obj(await this.get(true, 'meta', type, id), 'meta')
    return m ? new Meta(m) : null
  }

  savedMeta(type, id) {
    const m = obj(this.saved('meta', type, id), 'meta')
    return m ? new Meta(m) : null
  }

  /** A title-specific catalog, when an installed add-on advertises the protocol's required `similar` extra. */
  async similar(type, id) {
    const catalog = objects(arr(this.manifest, 'catalogs')).find(c =>
      optString(c, 'type') === type &&
      objects(arr(c, 'extra')).some(e => optString(e, 'name') === 'similar' && optBoolean(e, 'isRequired')) &&
      (p => p.length === 0 || p.some(x => id.startsWith(x)))(strings(arr(c, 'idPrefixes'))))
    if (!catalog) return null
    const path = this.url(['catalog', type, getString(catalog, 'id')]).replace(/\.json$/, '')
    return metasOf(JSON.parse(await this.deps.http.get(path + '/similar=' + uriEncode(id, ':') + '.json', { keep: true })))
  }

  /** Playable streams only: torrent-only results (no url) need a streaming server, which this app doesn't have. */
  async streams(type, videoId) {
    const answer = await this.get(false, 'stream', type, videoId)
    return objects(arr(answer, 'streams')).map(s => Stream.from(s)).filter(s => s !== null)
  }

  /** Subtitle files for one video (OpenSubtitles and co. through Stremio's `subtitles` resource). */
  async subtitles(type, videoId) {
    const answer = await this.get(false, 'subtitles', type, videoId)
    const out = []
    for (const s of objects(arr(answer, 'subtitles'))) {
      const url = text(s, 'url')
      if (url) out.push(new Subtitle(url, text(s, 'lang') || 'und', this.name))
    }
    return out
  }

  // Ids such as "tt0903747:1:2" keep their colons, like Stremio's own requests.
  url(path) { return this.base + '/' + path.map(p => uriEncode(p, ':=')).join('/') + '.json' }

  async get(keep, ...path) { return JSON.parse(await this.deps.http.get(this.url(path), { keep })) }

  saved(...path) {
    const body = this.deps.http.saved ? this.deps.http.saved(this.url(path)) : null
    if (!body) return null
    try { return JSON.parse(body) } catch (e) { return null }
  }
}

/** [pages]: the catalog takes Stremio's `skip` extra, so a row can ask for the titles after the first page. */
export class Catalog {
  constructor(addon, type, id, name, pages, genres) {
    this.addon = addon
    this.type = type
    this.id = id
    this.name = name
    this.pages = pages
    this.genres = genres
  }
}

function catalogPath(c, genre) {
  return ['catalog', c.type, c.id].concat(genre ? ['genre=' + genre] : [])
}

function resourceName(r) {
  return typeof r === 'string' ? r : (r && typeof r === 'object' ? optString(r, 'name') : null)
}

/** Metas of a catalog answer. One entry without an id is skipped instead of failing the whole row (Kotlin threw). */
function metasOf(answer) {
  return objects(arr(answer, 'metas')).filter(m => text(m, 'id')).map(m => new Meta(m))
}

export class Meta {
  constructor(json) {
    this.json = json
    this.id = getString(json, 'id')
    this.type = optString(json, 'type')
    this.name = optString(json, 'name')
    this.poster = text(json, 'poster')
    this.background = text(json, 'background')
    /** The title as artwork (AIOMetadata and Cinemeta provide it), shown instead of plain text when present. */
    this.logo = text(json, 'logo')
    this.description = text(json, 'description')
    const release = text(json, 'releaseInfo')
    this.year = release === null ? null : release.replace(/[–\- ]+$/, '') // "2026–" (still running) reads as 2026 everywhere
    const rt = text(json, 'runtime')
    this.runtime = rt === null ? null : runtime(rt)
    this.rating = text(json, 'imdbRating')
    this.genres = strings(arr(json, 'genres')).slice(0, 3)
    this.cast = strings(arr(json, 'cast'))
    this.info = [this.year, this.runtime, this.genres.join(' · ') || null].filter(x => x !== null && x !== undefined).join('   ')

    /** Episodes in play order: by season then episode, specials (season 0) last. */
    this.videos = sortBy(
      objects(arr(json, 'videos')).map(v => new Video(
        getString(v, 'id'), text(v, 'title') || text(v, 'name') || '', optInt(v, 'season'), optInt(v, 'episode'),
        text(v, 'thumbnail'), text(v, 'overview') || text(v, 'description'), text(v, 'released') || text(v, 'available'))),
      [[v => (v.season === 0 ? Number.MAX_SAFE_INTEGER : v.season), 'asc'], [v => v.episode, 'asc']])
  }
}

export class Video {
  constructor(id, title, season, episode, thumbnail, overview, released) {
    this.id = id
    this.title = title
    this.season = season
    this.episode = episode
    this.thumbnail = thumbnail
    this.overview = overview
    this.released = released
  }
}

/** [lang] is what the add-on sends: ISO 639-2 ("eng") from OpenSubtitles, sometimes a two-letter code. */
export class Subtitle {
  constructor(url, lang, addon) {
    this.url = url
    this.lang = lang
    this.addon = addon
  }

  get language() { return languageName(this.lang).trim() || this.lang }

  /** "srt" | "vtt" | "ass" by the file's extension (query string ignored); anything else is read as SubRip like Alder. */
  /** Whether the subtitle is English (Alder: Locale(lang).language == "en"). */
  isEnglish() { return toIso1(this.lang) === 'en' }

  get format() {
    const u = this.url.split('?')[0].toLowerCase()
    return u.endsWith('.vtt') ? 'vtt' : (u.endsWith('.ass') || u.endsWith('.ssa')) ? 'ass' : 'srt'
  }

  get mimeType() {
    return { vtt: 'text/vtt', ass: 'text/x-ssa', srt: 'application/x-subrip' }[this.format]
  }

  /**
   * Whether it's in the TV's language (either code style). [tvLanguage] is a locale or code such as "en" / "de-DE".
   * Alder compares the code with Locale.language and isO3Language; this also takes the ISO 639-2/B spelling
   * ("ger", "fre") that OpenSubtitles sends, which Java's T-codes ("deu", "fra") would miss.
   */
  isLocal(tvLanguage) {
    const tv = toIso1(String(tvLanguage || '').split(/[-_]/)[0])
    return this.lang === tv || this.lang === toIso3(tv) || toIso1(this.lang) === tv
  }
}

export class Stream {
  constructor(title, description, url, headers, size, filename, bingeGroup) {
    this.title = title
    this.description = description
    this.url = url
    this.headers = headers || {}
    this.size = size
    this.filename = filename === undefined ? null : filename
    this.bingeGroup = bingeGroup === undefined ? null : bingeGroup

    // What the release is, read from its file name and the add-ons' labels (AIOStreams writes "2160p", "DV", "HEVC"
    // into them; the file name says it for every add-on). ponytail (Alder): name matching, not the file's real tracks.
    const words = (this.filename || '') + ' ' + title + ' ' + description
    const w = words.toLowerCase()
    this.words = w
    this.height = /2160|\b4k\b|\buhd\b/.test(w) ? 2160 : w.includes('1080') ? 1080 : w.includes('720') ? 720
      : w.includes('576') ? 576 : w.includes('480') ? 480 : 0
    this.dolbyVision = /\b(dv|dovi|dolby.?vision)\b/.test(w)
    this.hdr = /\bhdr|\bp8\b|hybrid/.test(w) // P8 and hybrid DV carry an HDR10 base
    this.isHdr = this.hdr || this.dolbyVision
    this.hevc = /hevc|[xh].?265/.test(w)
    this.av1 = /\bav1\b/.test(w)

    // The release type and extras, for Settings' stream preferences.
    this.remux = /\bremux\b/.test(w)
    this.bluray = !this.remux && /blu.?ray|\bbd.?rip|\bbr.?rip/.test(w)
    this.web = /web.?(dl|rip)|\bweb\b/.test(w)
    /** Filmed in a cinema or a screener: never picked. */
    this.cam = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine|scr|screener|dvdscr)\b/.test(w)
    this.threeD = /\b3d\b/.test(w)
    this.hardSubs = /\bhc\b|hardcoded|hardsub/.test(w)
    /** 3D or subtitles burnt into the picture: picked last. */
    this.awkward = this.threeD || this.hardSubs
    this.bigAudio = /atmos|truehd|dts.?hd|dts.?x\b/.test(w) // what a receiver gains from (Settings' receiver option is dropped on Tizen)
    this.multiAudio = /\b(multi|dual)\b/.test(w)
    this.dubbed = /\bdub(bed)?\b/.test(w)
    this._codecs = null
    this._kind = undefined
    this._kindFor = undefined
  }

  /**
   * False for add-on "actions" dressed up as streams, such as MyTrakt's "Mark Watched" (a 27 KB placeholder file).
   * They stay listed but are never picked or focused first. Unknown size counts as a video.
   */
  get isVideo() { return this.size === 0 || this.size >= 50 * MIB }

  /** The add-on's name for it on one line: "Torrentio (2160p)" becomes "Torrentio  ·  2160p". */
  get label() { return lines(this.title).map(l => l.trim()).join(' ').replace(/\s*\((.+?)\)\s*$/, '  ·  $1') }

  /** Whether the names mention this language ("hindi" for "hi"). [name] maps a code to its English name. */
  mentions(language, name = languageName) {
    const n = name(language).toLowerCase()
    return n.length > 2 && this.words.includes(n)
  }

  /** Short tags for the source list: "REMUX · DV · Atmos". */
  get tags() {
    const w = this.words
    return [
      this.remux ? 'REMUX' : null, this.bluray ? 'BluRay' : null, this.web && !this.remux && !this.bluray ? 'WEB' : null,
      this.dolbyVision ? 'DV' : null, this.hdr ? 'HDR' : null, w.includes('atmos') ? 'Atmos' : null,
      w.includes('truehd') ? 'TrueHD' : null, /dts.?hd/.test(w) ? 'DTS-HD' : null,
      this.multiAudio ? 'Multi audio' : null, this.dubbed ? 'Dub' : null, this.threeD ? '3D' : null, this.hardSubs ? 'Hard subs' : null,
    ].filter(t => t !== null)
  }

  /**
   * Whether this TV can decode it at all. Dolby Vision without an HDR10 base named (profile 5, common on web
   * releases) shows purple and green without a Dolby Vision decoder, so it's left out; DV with HDR10 plays as HDR10.
   */
  playableOn(tv) {
    return (!this.hevc || tv.hevc) && (!this.av1 || tv.av1) && (!this.dolbyVision || this.hdr || tv.dolbyVision)
  }

  /** How well it suits this TV, higher first: nothing above the screen's resolution, HDR only on an HDR screen. */
  fit(tv) {
    return (this.height > tv.height ? 0 : 2) + (this.hdr || this.dolbyVision ? (tv.hdr ? 0 : -1) : 0)
  }

  // ---- added for Tizen (PLAN.md section 5) ----

  /** Audio codecs the names mention, e.g. ["EAC3", "AAC"]; see core/audio.js. */
  get audioCodecs() {
    if (this._codecs === null) this._codecs = audioCodecsIn(this.words)
    return this._codecs
  }

  /** Stage A verdict for this TV: "good" | "bad" | "mixed" | "unknown". [tv] is the device profile (its `audio` Set). */
  audioKind(tv) {
    const set = tv && tv.audio ? tv.audio : undefined
    if (this._kind === undefined || this._kindFor !== set) { // cached: ranking asks several times per stream
      this._kind = classifyAudio(this.words, set).kind
      this._kindFor = set
    }
    return this._kind
  }

  /**
   * Headers the add-on asks the player to send (behaviorHints.proxyHeaders.request) that AVPlay can't. AVPlay can set
   * User-Agent and Cookie through setStreamingProperty; any other header makes the stream "may not play".
   */
  get unsupportedHeaders() {
    return Object.keys(this.headers).filter(h => !['user-agent', 'cookie'].includes(h.toLowerCase()))
  }

  get mayNotPlay() { return this.unsupportedHeaders.length > 0 }

  toJson() {
    return { name: this.title, description: this.description, url: this.url, headers: this.headers, size: this.size, filename: this.filename, binge: this.bingeGroup }
  }

  static from(json) {
    const url = text(json, 'url')
    if (url === null) return null
    const hints = obj(json, 'behaviorHints')
    const headerObject = obj(obj(hints, 'proxyHeaders'), 'request')
    const headers = {}
    if (headerObject) for (const k of Object.keys(headerObject)) headers[k] = String(headerObject[k])
    return new Stream(
      text(json, 'name') || '',
      text(json, 'description') || text(json, 'title') || '',
      url,
      headers,
      optInt(hints, 'videoSize'),
      text(hints, 'filename'),
      text(hints, 'bingeGroup'),
    )
  }

  /** Back from [toJson], for the player's list of sources to try. */
  static read(json) {
    const headers = {}
    const h = obj(json, 'headers') || {}
    for (const k of Object.keys(h)) headers[k] = String(h[k])
    return new Stream(optString(json, 'name'), optString(json, 'description'), getString(json, 'url'), headers,
      optInt(json, 'size'), text(json, 'filename'), text(json, 'binge'))
  }
}

/** "147 min" reads "2h 27m" as on the mock; under an hour, and anything not in minutes, stays as the add-on wrote it. */
export function runtime(textValue) {
  // "147 min", or "2h35min" / "2h 35m" as some add-ons write it.
  const t = String(textValue).trim()
  const hm = /^(\d+)\s*h\s*(\d+)\s*m(in)?$/.exec(t)
  let minutes
  if (hm) minutes = parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10)
  else {
    const m = /^(\d+)\s*min/.exec(t)
    if (!m) return textValue
    minutes = parseInt(m[1], 10)
  }
  if (minutes < 60) return minutes + ' min'
  const rest = minutes % 60
  return Math.floor(minutes / 60) + 'h ' + (rest < 10 ? '0' : '') + rest + 'm'
}

// ---- for the Sources list (StreamsActivity.kt) ----

/** "5.4 GB" / "850 MB" / "—" (decimal units, as Alder prints them). */
export function sourceSize(size) {
  if (size <= 0) return '—'
  if (size >= 1000000000) return formatOneDecimal(size / 1000000000) + ' GB'
  return Math.trunc(size / 1000000) + ' MB'
}

/** "WEB · HEVC · DD 5.1": what the release is, in a few words. */
export function sourceSummary(s) {
  const w = ((s.filename || '') + ' ' + s.title + ' ' + s.description).toLowerCase()
  const release = s.remux || s.bluray ? 'BluRay' : s.web ? 'WEB' : w.includes('hdtv') ? 'HDTV' : w.includes('sdtv') ? 'SDTV' : 'Source'
  const codec = /\bav1\b/.test(w) ? 'AV1' : /hevc|[xh].?265/.test(w) ? 'HEVC' : /avc|[xh].?264/.test(w) ? 'AVC' : null
  const audio = w.includes('atmos') ? 'Atmos'
    : /\b(dd|ac3|eac3|e-ac3)[ ._-]?5[ ._-]?1\b/.test(w) ? 'DD 5.1'
    : /\b5[ ._-]?1\b/.test(w) ? '5.1'
    : /\b2[ ._-]?0\b|stereo/.test(w) ? '2.0' : null
  return [release, codec, audio].filter(x => x !== null).join(' · ')
}

/** The provider shown under a source: the add-on's own first line of its title, else the add-on's name. */
export function providerLabel(s, addonName) {
  const first = lines(s.title)[0] || ''
  const cleaned = first.split('(')[0].replace(/^\[[^\]]+\]\s*/, '').trim()
  return cleaned !== '' && !/^\d+p$/.test(cleaned) ? cleaned : addonName
}
