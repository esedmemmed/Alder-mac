/*
 * Subtitle name match (T3): how well an add-on subtitle's own words (its Stremio `id` and `label`) describe the release that is playing.
 * Pure: strings in, numbers out. Imported only by the Mac build (platform/mac/subtitle-memory.js, subtitle-fetch.js); the Tizen bundle never
 * pulls it in. A subtitle whose id and label are numbers only (an OpenSubtitles id "1954712345") says nothing about a release: score 0.
 *
 * ctx = { filename, sig }: the playing file's name (or null) and the 1.4 release signature ("1080p|web|avc|grp", release-memory.js signature()).
 * Score: group +6, resolution +2, source +2, codec +1, HDR +1, same SxxEyy +1, one more shared name token +1. A different SxxEyy on both: 0.
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
const textOf = (s) => norm([s && s.id, s && s.label].filter((x) => typeof x === 'string').join(' '));
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
  parts.forEach((p) => {
    if (RES.test(p)) { if (new RegExp('\\b' + p).test(text)) score += 2; }
    else if (SOURCE[p]) { if (SOURCE[p].test(text)) score += 2; }
    else if (CODEC[p]) { if (CODEC[p].test(text)) score += 1; }
    else if (HDR[p]) { if (HDR[p].test(text)) score += 1; }
    else if (have.indexOf(p) >= 0) score += 6; // the release group
  });
  const shared = tokensOf(file).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.test(w) && !/^s\d+e\d+$/.test(w) && parts.indexOf(w) < 0 && have.indexOf(w) >= 0);
  return score + (shared.length ? 1 : 0);
}

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
