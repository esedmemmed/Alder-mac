/*
 * Plain HTTP for Stremio's API, add-ons and images (port of Alder's Http.kt): fetch with a timeout, optional retries,
 * and "kept answers" so a screen can draw from last time at once and refresh behind it.
 *
 * Differences from Http.kt, all forced by the platform:
 *  - Kept answers live in a size-capped localStorage cache (lib/store.js createCache), not 60 MB of files.
 *  - Cache keys are a hash of url + body (urls carry add-on settings, bodies carry an auth key), as in Alder, but a
 *    synchronous 53-bit hash: crypto.subtle is async and not guaranteed on a TV's app origin.
 *  - Retries are new: Alder let HttpURLConnection fail and the caller retry. Off by default (retries: 0).
 *
 * Like Http.kt, a response with an error status still hands back its body (Stremio's API puts its JSON error in the
 * body of a failed response), and throws only when there is none.
 */
import { log as appLog } from './log.js';
import { createCache, browserStorage } from './store.js';

export class HttpError extends Error {
  /** kind: 'http' (an error status), 'timeout', or 'network' (the request never got an answer). */
  constructor(message, { kind = 'network', status = 0, url = '', cause } = {}) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic; it only names cache entries. */
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/**
 * Dev only: sends a request for any absolute http(s) URL to the fixture server instead, as
 * <origin>/<host>/<path>?<query> (":" in a host becomes "_"). dev/fixtures mirrors the real URLs this way.
 * Returns the URL unchanged when it is relative or already points at [origin].
 */
export function devRewrite(url, origin) {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(url);
  if (!m || url.indexOf(origin + '/') === 0) return url;
  return origin + '/' + m[1].replace(':', '_') + (m[2] || '/') + (m[3] || '');
}

/** Where the dev fixture server answers: window.ALDER_FIXTURE_ORIGIN, else this page's origin + /__fx. */
export function fixtureOrigin(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return '';
  return win.ALDER_FIXTURE_ORIGIN || (win.location.origin + '/__fx');
}

const RETRY_STATUSES = [502, 503, 504];

/**
 * createHttp({ fetch, cache, rewrite, defaultTimeoutMs, retries, retryDelayMs, timers })
 *  - fetch: window.fetch by default
 *  - cache: a lib/store.js createCache(), or null to keep nothing (Http.saved = null)
 *  - rewrite: (url) => url, applied just before the request (the dev fixture redirect); the kept-answer key still
 *    uses the original URL
 *  - retries: extra attempts after a network error, a timeout or a 502/503/504 (GET only unless retryPost)
 */
export function createHttp({
  fetch: fetchFn = typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : undefined) : null,
  cache = null, rewrite = null, defaultTimeoutMs = 20000, retries: defaultRetries = 0, retryDelayMs = 500,
  retryPost = false, timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) },
  log = appLog,
} = {}) {
  const sleep = (ms) => new Promise((resolve) => timers.setTimeout(resolve, ms));
  const keyOf = (url, json) => hashKey(url + '\n' + (json == null ? '' : json));

  /** One attempt: resolves to { status, ok, text, bytes } or rejects with an HttpError of kind 'timeout' / 'network'. */
  async function attempt(url, method, json, headers, timeoutMs, wantBytes) {
    const real = rewrite ? rewrite(url) : url;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let timer = null;
    // fetch cannot be told "connect within 10 s, read within 20 s" as HttpURLConnection can: one clock covers both.
    // The clock also rejects on its own, so a fetch that ignores its abort signal cannot hang the caller.
    const clock = new Promise((_, reject) => {
      timer = timers.setTimeout(() => {
        timedOut = true;
        if (controller) controller.abort();
        reject(new HttpError('timeout after ' + timeoutMs + ' ms', { kind: 'timeout', url }));
      }, timeoutMs);
    });
    try {
      const init = { method, headers: Object.assign({}, headers), signal: controller ? controller.signal : undefined };
      if (json != null) { init.body = json; init.headers['Content-Type'] = 'application/json'; }
      const work = (async () => {
        const res = await fetchFn(real, init);
        const body = wantBytes ? await res.arrayBuffer() : await res.text();
        return { status: res.status, ok: res.status < 400, text: wantBytes ? '' : body, bytes: wantBytes ? body : null };
      })();
      work.catch(() => {}); // when the clock wins, a later failure of the work is not an unhandled rejection
      return await Promise.race([work, clock]);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (timedOut) throw new HttpError('timeout after ' + timeoutMs + ' ms', { kind: 'timeout', url, cause: e });
      throw new HttpError(String((e && e.message) || e || 'network error'), { kind: 'network', url, cause: e });
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /**
   * The full result: { status, ok, text }. Rejects with an HttpError only when no answer came (timeout, network)
   * after the retries. `keep: true` saves the body of a successful answer for savedAnswer().
   */
  async function request(url, { method = 'GET', json = null, headers = null, timeoutMs = defaultTimeoutMs,
    retries = defaultRetries, keep = false, bytes = false } = {}) {
    const attempts = 1 + ((method === 'GET' || retryPost) ? retries : 0);
    let lastError = null;
    let lastAnswer = null;
    for (let n = 0; n < attempts; n++) {
      if (n > 0) await sleep(retryDelayMs);
      try {
        const res = await attempt(url, method, json, headers, timeoutMs, bytes);
        if (!res.ok && n < attempts - 1 && RETRY_STATUSES.indexOf(res.status) >= 0) {
          lastAnswer = res;
          log.debug('http', 'retry after HTTP ' + res.status + ' ' + shorten(url));
          continue;
        }
        if (keep && res.ok && cache && !bytes) cache.put(keyOf(url, json), res.text);
        return res;
      } catch (e) {
        lastError = e; lastAnswer = null;
        log.debug('http', e.kind + ' ' + shorten(url) + (n < attempts - 1 ? ' (retrying)' : ''));
      }
    }
    if (lastAnswer) return lastAnswer; // every try answered 5xx: the last answer is still an answer
    throw lastError;
  }

  function bodyOrThrow(res, url) {
    // Http.kt: `errorStream ?: throw IOException("HTTP $code")`
    if (!res.ok && res.text === '') throw new HttpError('HTTP ' + res.status, { kind: 'http', status: res.status, url });
    return res.text;
  }

  const api = {
    request,
    /** The body as text, even for an error status that has one (Http.get). */
    async get(url, opts = {}) { return bodyOrThrow(await request(url, opts), url); },
    /** POSTs [json] (a string, or any value, which is stringified) and returns the body as text (Http.post). */
    async post(url, json, opts = {}) {
      const body = typeof json === 'string' ? json : JSON.stringify(json);
      return bodyOrThrow(await request(url, Object.assign({}, opts, { method: 'POST', json: body })), url);
    },
    async getJson(url, opts = {}) { return JSON.parse(await api.get(url, opts)); },
    async postJson(url, json, opts = {}) { return JSON.parse(await api.post(url, json, opts)); },
    /** The raw bytes (pictures, small files). Throws on an error status. */
    async bytes(url, opts = {}) {
      const res = await request(url, Object.assign({}, opts, { bytes: true }));
      if (!res.ok) throw new HttpError('HTTP ' + res.status, { kind: 'http', status: res.status, url });
      return res.bytes;
    },
    /** The last answer kept for this request, or null. Never touches the network. */
    savedAnswer(url, json = null) { return cache ? cache.get(keyOf(url, typeof json === 'string' || json == null ? json : JSON.stringify(json))) : null; },
    /** Keeps [body] as the answer to this request, for savedAnswer() next time. */
    keep(url, json, body) { if (cache) cache.put(keyOf(url, typeof json === 'string' || json == null ? json : JSON.stringify(json)), body); },
    /**
     * Forgets every kept answer. Used when a profile is removed: its library, add-on list and personal add-ons'
     * answers (their URLs carry tokens) are not told apart by name, so all go and the others fetch theirs again once.
     */
    forget() { if (cache) cache.clear(); },
    cache,
  };
  return api;
}

function shorten(url) {
  return url.length > 90 ? url.slice(0, 90) + '…' : url;
}

let shared = null;
/**
 * The app's one Http, made on first use (so importing this module never touches window or storage).
 * In a dev build every request is redirected to the fixture server.
 */
export function appHttp() {
  if (shared) return shared;
  const opts = { cache: createCache({ storage: browserStorage() }) };
  if (typeof __ALDER_DEV__ !== 'undefined' && __ALDER_DEV__) { const origin = fixtureOrigin(); opts.rewrite = (u) => devRewrite(u, origin); }
  shared = createHttp(opts);
  return shared;
}
