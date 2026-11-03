/*
 * Pure helpers for the 4B screens (details, streams, search, settings, add-ons): the small functions Alder keeps beside its
 * activities (episodeDate, rankSearchTitles, addonShortName, addonRole, install links, ...), ported so they run in Node tests.
 * No DOM, no window.
 */

import { stableSort } from '../../core/util.js';

export const DOT = '  ·  ';

// ---------- details (DetailsActivity.kt) ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-03-21T00:00:00.000Z" reads "21 Mar 2025"; anything else (or an impossible date) reads nothing. */
export function episodeDate(value) {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null; // not lenient
  return d + ' ' + MONTHS[mo - 1] + ' ' + y;
}

/** "S1 E4": the short episode label (Alder's openSources). */
export const episodeLabel = (v) => 'S' + v.season + ' E' + v.episode;

/** "Specials" for season 0, else "Season N" (the chip's words when selected) or just "N". */
export function seasonLabel(season, selected) {
  if (season === 0) return 'Specials';
  return selected ? 'Season ' + season : String(season);
}

/** "3 min left" for a position inside a known duration, else null. Both in ms. */
export function minutesLeft(resumeAt, duration) {
  return resumeAt > 0 && duration > resumeAt ? Math.floor((duration - resumeAt) / 60000) + ' min left' : null;
}

/** "2 seasons" / "1 season" (Alder's `seasons()`). */
export const seasonsText = (n) => n + (n === 1 ? ' season' : ' seasons');

/**
 * What Play opens: the episode Continue Watching points at, or the first real episode, or the movie itself.
 * Returns { videoId, video } (video null for a movie).
 */
export function playTarget(meta, item, metaId) {
  const videos = (meta && meta.videos) || [];
  if (videos.length === 0) return { videoId: metaId, video: null };
  const state = item && item.state && typeof item.state === 'object' ? item.state : null;
  const current = state && typeof state.video_id === 'string' ? state.video_id : null;
  const video = videos.find((v) => v.id === current) || videos.find((v) => v.season > 0) || videos[0];
  return { videoId: video.id, video };
}

/**
 * MainActivity.synopsisAtSentence: [text] cut at a whole sentence before [limit] characters when it can be, else at a
 * word with an ellipsis. A sentence ends at . ! or ? before a space, but not after "Sgt.", "Dr.", "U.S." and the like.
 */
export function synopsisAtSentence(text, limit) {
  if (limit >= text.length) return text;
  let end = -1;
  for (let i = limit - 1; i >= 0; i--) {
    const c = text.charAt(i);
    if ((c === '.' || c === '!' || c === '?') && text.charAt(i + 1) === ' ') {
      if (c === '.') {
        const word = text.substring(text.lastIndexOf(' ', i) + 1, i);
        const abbreviation = word.indexOf('.') >= 0 || (word.length <= 3 && word.length > 0 && word.charAt(0) !== word.charAt(0).toLowerCase());
        if (abbreviation) continue;
      }
      end = i;
      break;
    }
  }
  if (end >= 0) return text.substring(0, end + 1);
  const clipped = text.slice(0, limit).replace(/\s+$/, '');
  const alnum = (ch) => /[0-9A-Za-zÀ-￿]/.test(ch || '');
  let whole = clipped;
  if (alnum(text.charAt(limit - 1)) && alnum(text.charAt(limit))) {
    const cut = clipped.lastIndexOf(' ');
    if (cut >= 0) whole = clipped.substring(0, cut);
  }
  return whole.replace(/[ ,;:\-.!?]+$/, '') + '…';
}

// ---------- sources (StreamsActivity.kt) ----------

/**
 * The sources page's header from its params: `episode` ("S1 E4  ·  The You You Are") or, as Alder falls back, `label`
 * ("Severance  ·  S1 E4") without the name. Returns { where: [parts], eyebrow, title }.
 */
export function sourcesHeader(params) {
  const name = params.name || '';
  let episode = params.episode;
  if (!episode && params.label) {
    let s = String(params.label);
    if (name && s.indexOf(name) === 0) s = s.slice(name.length);
    episode = s.replace(/^[\s·]+|[\s·]+$/g, '');
  }
  const where = (episode ? String(episode).split('·') : []).map((p) => p.trim()).filter((p) => p.length > 0);
  const eyebrow = [where[0], params.runtime].filter((x) => x).join(' · ');
  const title = where.slice(1).join(' · ') || name;
  return { where, eyebrow, title };
}

/** "52 sources" / "1 source". */
export const sourceCount = (n) => n + (n === 1 ? ' source' : ' sources');

/** The params the player takes (src/player/engine.js), from the sources page's own and the streams chosen. */
export function playerParams(params, sources, { picked = false } = {}) {
  const out = {
    type: params.type || 'movie',
    metaId: params.id,
    videoId: params.videoId,
    name: params.name || '',
    poster: params.poster || null,
    background: params.background || null,
    logo: params.logo || null,
    episode: params.episode || null,
    runtime: params.runtime || null,
    sources,
    startOver: !!params.startOver,
    nextVideoId: params.nextVideoId || params.afterVideoId || null,
  };
  if (typeof params.resumeAt === 'number') out.resumeAt = params.resumeAt;
  if (picked) out.picked = true;
  if (params.onNavigate) out.onNavigate = params.onNavigate;
  return out;
}

// ---------- search (SearchActivity.kt, MainActivity.isAddonMessage) ----------

/** Add-ons that need a login answer with a "title" saying so: not a result. */
export const isAddonMessage = (name) => /authentication required/i.test(name || '');

const words = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]+/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 0);

/** More complete title matches lead; ties retain the installed add-ons' order. [title]: item -> its name. */
export function rankSearchTitles(items, query, title = (x) => x.name) {
  const wanted = words(query);
  if (wanted.length === 0) return items.slice();
  const score = (item) => {
    const actual = words(title(item));
    const same = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);
    if (same(actual, wanted)) return 0;
    if (same(actual.slice(0, wanted.length), wanted)) return 1;
    if (wanted.every((w) => actual.indexOf(w) >= 0)) return 2;
    if (actual.join(' ').indexOf(wanted.join(' ')) >= 0) return 3;
    return 4;
  };
  const scored = items.map((item) => ({ item, s: score(item) }));
  return stableSort(scored, (a, b) => a.s - b.s).map((x) => x.item);
}

/** The answers that arrived, in the add-ons' order (a slot is null until its add-on answers). */
export const searchAnswersInAddonOrder = (answers) => answers.filter((a) => a !== null && a !== undefined).reduce((all, a) => all.concat(a), []);

/** Recent searches, newest first, no duplicates (case-insensitive), at most [max] (Alder: 6). Storage is newline separated. */
export const RECENT = 6;
export function parseRecent(raw) {
  return String(raw || '').split('\n').filter((s) => s.trim().length > 0);
}
export function rememberRecent(list, query, max = RECENT) {
  const q = query.trim();
  if (!q) return list.slice(0, max);
  return [q].concat(list.filter((s) => s.toLowerCase() !== q.toLowerCase())).slice(0, max);
}

/** Facts line under a result's name: "2021  ·  Science Fiction  ·  2h 35m". */
export function searchFacts(meta, runtimeOf) {
  return [meta.year, meta.genres && meta.genres[0], meta.runtime ? runtimeOf(meta.runtime) : null].filter((x) => x).join('  ·  ');
}

// ---------- add-ons (AddonsActivity.kt) ----------

/** "Torrentio | ElfHosted" -> "Torrentio"; "OpenSubtitles v3" -> "OpenSubtitles". */
export function addonShortName(name) {
  let s = String(name || '').split('|')[0].split('(')[0].trim().replace(/^OpenSubtitles v3$/i, 'OpenSubtitles');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** What an add-on does, in a few words. [names]: its resource names. */
export function addonRoleOf(name, id, names) {
  if (/^local files/i.test(name)) return 'Files on this network';
  if (/watchly/i.test(id)) return 'Recommendations · Top Picks on Home';
  if (/trakt/i.test(id)) return 'Watch history to Trakt';
  if (/^cinemeta$/i.test(name)) return 'Titles and details';
  const out = [];
  if (names.has('stream')) out.push('Streams');
  if (names.has('subtitles')) out.push('Subtitles');
  if (names.has('catalog')) out.push('Catalogs');
  if (names.has('meta')) out.push('Titles and details');
  return out.slice(0, 2).join(' · ') || 'Add-on';
}

export function addonRole(addon) {
  const resources = Array.isArray(addon.manifest && addon.manifest.resources) ? addon.manifest.resources : [];
  const names = new Set();
  resources.forEach((r) => { if (typeof r === 'string') names.add(r); else if (r && typeof r === 'object' && typeof r.name === 'string') names.add(r.name); });
  return addonRoleOf(addonShortName(addon.name), addon.id, names);
}

/** The small tag beside an add-on: "Built-in", the part after "|", "v3", "ElfHosted", or nothing. */
export function addonHost(addon) {
  if (addon.locked) return 'Built-in';
  const named = String(addon.name || '').indexOf('|') >= 0 ? addon.name.slice(addon.name.indexOf('|') + 1).trim() : '';
  if (named) return named;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]*)/i.exec(addon.transportUrl || '');
  const host = m ? m[1] : '';
  if (/opensubtitles/i.test(addon.id) && (/v3/i.test(addon.name) || /v3/i.test(host))) return 'v3';
  if (/elfhosted/i.test(host)) return 'ElfHosted';
  return ''; // a bare server address says nothing useful
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
export function ordinal(n) {
  if (ORDINALS[n - 1]) return ORDINALS[n - 1];
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  const o = n % 10;
  return n + (o === 1 ? 'st' : o === 2 ? 'nd' : o === 3 ? 'rd' : 'th');
}

export function addonHelp(addon, index) {
  if (/watchly/i.test(addon.id)) return 'Makes your own Top Picks from what you watch. It answers ' + ordinal(index + 1) + '.';
  return addonRole(addon) + '. It answers ' + ordinal(index + 1) + '.';
}

/**
 * Stremio's install links are stremio://host/…/manifest.json; a bare add-on address gets /manifest.json added.
 * Returns the https address to fetch, or '' for nothing typed.
 */
export function installUrl(typed) {
  const t = String(typed || '').trim();
  if (!t) return '';
  let url = t.replace(/^stremio:\/\//i, 'https://');
  if (url.indexOf('://') < 0) url = 'https://' + url;
  if (!/\/manifest\.json$/.test(url)) url = url.replace(/\/+$/, '') + '/manifest.json';
  return url;
}

/** An add-on manifest has an id and resources (Alder's "That address isn't a Stremio addon."). */
export const isManifest = (m) => !!m && typeof m === 'object' && !Array.isArray(m) && 'id' in m && 'resources' in m;

/** Moves item [from] to [to] in a copy of [list]. */
export function moved(list, from, to) {
  const out = list.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}
