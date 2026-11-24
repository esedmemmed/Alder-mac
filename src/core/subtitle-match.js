/*
 * Subtitle name match (T3): how well an add-on subtitle's own words (its Stremio `id` and `label`) describe the release that is playing.
 * Pure: strings in, numbers out. Shared by every build (core/subtitle-memory.js, player/subtitle-fetch.js); the Tizen bundle carries it too.
 * A subtitle whose id and label are numbers only (an OpenSubtitles id "1954712345") says nothing about a release: score 0.
 *
 * ctx = { filename, sig }: the playing file's name (or null) and the 1.4 release signature ("1080p|web|avc|grp", release-memory.js signature()).
 * Score: group +6, resolution +2, source +4 (another source -4; +2 only when one side does not say), codec +1, HDR +1, same SxxEyy +1, one more shared name token +1. A different SxxEyy on both: 0.
 * THRESHOLD is the least that counts as a match: the group with the resolution, or the group with the episode and one more thing.
 * Ties keep the add-on order (stableSort, core/util.js). Safari 14: no lookbehind, no class fields.
 */
import { stableSort } from './util.js';

export const THRESHOLD = 8;

const RES = /^\d+p$/;
const SOURCE = { remux: /\bremux\b/, bluray: /blu ?ray|\bbd ?rip|\bbr ?rip/, web: /web ?-?(dl|rip)|\bweb\b/, hdtv: /\bhdtv\b/ };
const CODEC = { hevc: /hevc|\b[xh] ?265\b/, avc: /\b[xh] ?264\b|\bavc\b/, av1: /\bav1\b/ };
const HDR = { dv: /\b(dv|dovi|dolby ?vision)\b/, hdr: /\bhdr/ };
const NOISE = /^(\d+p|x26[45]|h26[45]|hevc|avc|av1|web|dl|webdl|webrip|rip|bluray|bdrip|brrip|remux|hdtv|mkv|mp4|avi|m4v|ts|dv|dovi|hdr\d*|aac|ac3|eac3|ddp\d*|atmos|srt|sub|subs|eng|english|the|and)$/;

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\.(mkv|mp4|avi|m4v|ts|srt)\b/g, ' ').replace(/[\s_.]+/g, ' ');
const textOf = (s) => norm([s && s.id, s && s.label, s && s.releaseName].filter((x) => typeof x === 'string').join(' '));
const tokensOf = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w);
const episodeOf = (s) => { const m = /\bs(\d{1,2}) ?e(\d{1,3})\b/.exec(norm(s)); return m ? Number(m[1]) + 'x' + Number(m[2]) : null; };

/** Whether the text reads as a name (a word of three letters or more), not just numbers or a code. "1954712345" is not. */
export function nameLike(text) {
  return tokensOf(text).some((w) => /[a-z]{3}/.test(w));
}

/** 0 when the subtitle says nothing nameable or is for another episode; else the sum described at the top. */
export function scoreSubtitle(sub, ctx) {
  const text = textOf(sub);
  if (!nameLike(text)) return 0;
  const file = ctx && ctx.filename ? String(ctx.filename) : '';
  const have = tokensOf(text);
  const epS = episodeOf(text);
  const epF = episodeOf(file);
  if (epS && epF && epS !== epF) return 0;
  let score = epS && epF ? 1 : 0;
  const parts = ctx && ctx.sig ? String(ctx.sig).split('|') : [];
  // the source by releaseInfo: the same source +4, another source -4 (a BluRay subtitle is timed differently from a WEB one); this replaces the older +2 where both are known
  const mine = FILE_SOURCE[parts.filter((p) => FILE_SOURCE[p])[0]] || (ctx && ctx.release && ctx.release.source) || releaseInfo(file).source;
  const theirs = releaseInfo(text).source;
  if (mine && theirs) score += mine === theirs ? 4 : -4;
  parts.forEach((p) => {
    if (RES.test(p)) { if (new RegExp('\\b' + p).test(text)) score += 2; }
    else if (SOURCE[p]) { if (!theirs && SOURCE[p].test(text)) score += 2; }
    else if (CODEC[p]) { if (CODEC[p].test(text)) score += 1; }
    else if (HDR[p]) { if (HDR[p].test(text)) score += 1; }
    else if (have.indexOf(p) >= 0) score += 6; // the release group
  });
  const shared = tokensOf(file).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.test(w) && !/^s\d+e\d+$/.test(w) && parts.indexOf(w) < 0 && have.indexOf(w) >= 0);
  return Math.max(0, score + (shared.length ? 1 : 0));
}

const FILE_SOURCE = { remux: 'bluray', bluray: 'bluray', web: 'web', hdtv: 'tv' }; // the 1.4 signature's source words as releaseInfo names them

const effective = (score) => (score >= THRESHOLD ? score : 0);

/** The subtitles (each with id, label), a match first, best first; those below THRESHOLD and ties keep their order. A new array. */
export function rankByMatch(subs, ctx) {
  const scores = new Map();
  subs.forEach((s) => scores.set(s, effective(scoreSubtitle(s, ctx))));
  return stableSort(subs, (a, b) => scores.get(b) - scores.get(a));
}

/** The menu's list (runs of one language, as core chooseAddonSubtitles gives it): each run ranked by match, the runs kept in order. */
export function rankRuns(list, ctx) {
  const out = [];
  let run = [];
  list.forEach((s, i) => {
    run.push(s);
    if (i === list.length - 1 || list[i + 1].language !== s.language) { rankByMatch(run, ctx).forEach((x) => out.push(x)); run = []; }
  });
  return out;
}

/** For the log line: the best score, how many are name-like, how many there are. */
export function matchStats(subs, ctx) {
  let best = 0;
  let named = 0;
  subs.forEach((s) => { if (nameLike(textOf(s))) named++; best = Math.max(best, scoreSubtitle(s, ctx)); });
  return { best, named, n: subs.length };
}

// ---- the release a name speaks of (0.7.1): source, group, frame rate ----

const REL_SOURCE = [
  ['bluray', /blu ?-?ray|\bbd ?rip|\bbr ?rip|\bbd\b|\bremux\b/],
  ['web', /web ?-?(dl|rip)|\bweb\b|\bamzn\b|\bnf\b|\bdsnp\b|\bhmax\b|\batvp\b/],
  ['tv', /\bhdtv\b|\bpdtv\b|\bdsr\b|\btv ?rip\b/],
  ['dvd', /dvd ?rip|\bdvd\b/],
];
const NOT_GROUP = /^(dl|rip|webrip|web|eng|english|tur|turkish|tr|en|srt|sub|subs|hi|sdh|forced|full|hd|\d+p?|x26[45]|h26[45]|aac|ac3|dd\d*|ddp\d*|mkv|mp4|avi)$/i;
const LANG_TAIL = /[\s_.\-]*\[(?:en|eng|english|tr|tur|turkish|de|ger|fr|fre|es|spa|ru|rus|it|ita|pt|por|nl|dut|ar|ara|hi|hin|sdh|forced)\]\s*$/i;

/** The names the source shows as: BluRay, WEB, TV, DVD. */
export const SOURCE_NAMES = { bluray: 'BluRay', web: 'WEB', tv: 'TV', dvd: 'DVD' };

/**
 * What one release name says: { source: 'bluray' | 'web' | 'tv' | 'dvd' | null, group: UPPERCASE | null, fps: 23.976 | 24 | 25 | 29.97 | null }.
 * The group is the trailing -GROUP before the extension (a language tag like _[eng] after it is ignored) or a trailing [GROUP]; a name cut off with
 * an ellipsis has no group (the end is missing); an empty or non-string input says nothing.
 */
export function releaseInfo(text) {
  const raw = String(text == null ? '' : text).trim();
  const low = raw.toLowerCase().replace(/\.(mkv|mp4|avi|m4v|ts|srt|ass|vtt)\b/g, ' ').replace(/[\s_.]+/g, ' ');
  let source = null;
  for (let i = 0; i < REL_SOURCE.length && !source; i++) if (REL_SOURCE[i][1].test(low)) source = REL_SOURCE[i][0];
  let fps = null;
  const rawLow = raw.toLowerCase();
  const f = /(?:^|[^\d])(23[.,]976|29[.,]97|24|25)[\s._]?fps\b/.exec(rawLow) || /(?:^|[^\d])(23\.976|29\.97)(?:[^\d]|$)/.exec(rawLow);
  if (f) fps = Number(f[1].replace(',', '.'));
  let group = null;
  const cut = /[…]\s*$|\.\.\.\s*$/.test(raw);
  if (!cut) {
    const body = raw.replace(/\.(mkv|mp4|avi|m4v|ts|srt|ass|vtt)\s*$/i, '').replace(LANG_TAIL, '').trim();
    const dash = /-([A-Za-z0-9]{2,16})$/.exec(body);
    const bracket = /\[([A-Za-z0-9]{2,16})\]$/.exec(body);
    const pick = dash && !NOT_GROUP.test(dash[1]) ? dash[1] : bracket && !NOT_GROUP.test(bracket[1]) ? bracket[1] : null;
    group = pick ? pick.toUpperCase() : null;
  }
  return { source, group, fps };
}

/** The release a subtitle was made for: its releaseName, else the release in its label (Subtitle Sync writes it after the second ' · '), else its id; the first that says something. */
export function subtitleRelease(sub) {
  const empty = { source: null, group: null, fps: null };
  if (!sub) return empty;
  const label = typeof sub.label === 'string' ? sub.label : '';
  const parts = label.split(' · ');
  const tail = parts.length >= 3 ? parts.slice(2).join(' · ') : label;
  const tries = [sub.releaseName, tail, typeof sub.id === 'string' && nameLike(sub.id) ? sub.id : ''];
  const merged = { source: null, group: null, fps: Number(sub.fps) > 0 ? Number(sub.fps) : null };
  tries.forEach((t) => {
    if (!t) return;
    const r = releaseInfo(t);
    if (!merged.source) merged.source = r.source;
    if (!merged.group) merged.group = r.group;
    if (!merged.fps) merged.fps = r.fps;
  });
  return merged.source || merged.group || merged.fps ? merged : empty;
}
