/*
 * What the Diagnostics screen shows about the stream played last (PLAN.md "Added for Tizen"): which source (host and file
 * name only, never the whole URL: it can carry a debrid token), AVPlay's raw track list, and every audio decision with its
 * reason string. The owner has a phone and a remote, not logcat: a photo of this screen is the bug report.
 *
 * Kept in memory for the life of the app, so Settings can open Diagnostics after the player has closed.
 */

/** Host and file name of a URL, e.g. { host: "media.example.org", file: "Dune.2024.1080p.mkv" }. Never the query. */
export function urlParts(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(String(url || ''));
  if (!m) return { host: '', file: String(url || '').split(/[?#]/)[0].split('/').pop() };
  const host = m[1].replace(/^[^@]*@/, ''); // user:password@ is never shown
  let file = m[2].split('/').filter(Boolean).pop() || '';
  try { file = decodeURIComponent(file); } catch (e) { /* keep it as it is */ }
  return { host, file };
}

export function createDiag({ now = Date.now, limit = 60 } = {}) {
  let stream = null;
  let rawTracks = null;
  let picture = null;
  let decisions = [];
  let errors = [];

  return {
    /** A source was opened: { url, label, at, total, height }. Clears the previous stream's tracks and decisions. */
    setStream(info) {
      const { host, file } = urlParts(info.url);
      stream = { host, file, label: info.label || '', at: info.at, total: info.total, openedAt: now(), headers: info.headers || [] };
      rawTracks = null;
      picture = null;
    },
    /** The picture of this stream: the engine's pictureInfo() (the source's shape, Fit / Fill asked for and what was applied). */
    setPicture(info) { picture = info; },
    /** AVPlay's getTotalTrackInfo() as it came, so the first TV test tells us the real shape. */
    setTracks(raw) { rawTracks = raw; },
    /** One line per decision: "audio: chose #1 AC3 (...)". */
    decision(text) {
      decisions.push({ t: now(), text });
      if (decisions.length > limit) decisions = decisions.slice(decisions.length - limit);
    },
    error(text) {
      errors.push({ t: now(), text });
      if (errors.length > limit) errors = errors.slice(errors.length - limit);
    },
    snapshot() { return { stream, rawTracks, picture, decisions: decisions.slice(), errors: errors.slice() }; },
    clear() { stream = null; rawTracks = null; picture = null; decisions = []; errors = []; },
  };
}

/** The app's one recorder. */
export const diag = createDiag();
