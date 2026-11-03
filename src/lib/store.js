/*
 * localStorage as JSON, namespaced. Alder keeps its settings in SharedPreferences; here every preference is one
 * key under a prefix ("alder:"), and a profile or a feature can take a sub-store with scope(). The same names
 * Alder uses are chosen by src/core (which receives a store through its deps), not here.
 *
 * Storage can be missing or throw (private mode, a full disk, a TV that wipes it): reads then give the fallback and
 * writes return false. Nothing here ever throws.
 */

/** A Storage look-alike in memory: the fallback when localStorage is unusable, and what the tests use. */
export function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (i) => (i >= 0 && i < data.size ? Array.from(data.keys())[i] : null),
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(String(k), String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

/** window.localStorage when it works (probed with a write), else a memory storage. */
export function browserStorage(win = typeof window !== 'undefined' ? window : null) {
  try {
    const s = win && win.localStorage;
    if (s) {
      s.setItem('alder:probe', '1');
      s.removeItem('alder:probe');
      return s;
    }
  } catch (e) { /* fall through */ }
  return memoryStorage();
}

function keysOf(storage) {
  const out = [];
  for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k !== null) out.push(k); }
  return out;
}

export function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

export function createStore({ storage = browserStorage(), prefix = 'alder:' } = {}) {
  const store = {
    prefix,
    /** The value saved under [key], or [fallback] when there is none or it is unreadable. */
    get(key, fallback = null) {
      try {
        const raw = storage.getItem(prefix + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    /** Saves any JSON-able value. false when it could not be written (storage full). undefined removes the key. */
    set(key, value) {
      if (value === undefined) { store.remove(key); return true; }
      try { storage.setItem(prefix + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    has(key) { try { return storage.getItem(prefix + key) !== null; } catch (e) { return false; } },
    remove(key) { try { storage.removeItem(prefix + key); } catch (e) { /* nothing to do */ } },
    /** Keys under this prefix, without it. */
    keys() {
      try { return keysOf(storage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)); } catch (e) { return []; }
    },
    /** Removes everything under this prefix (a profile being deleted takes its sub-store with it). */
    clear() { store.keys().forEach((k) => store.remove(k)); },
    /** A store whose keys live under prefix + name + ':' (per-profile settings, for instance). */
    scope(name) { return createStore({ storage, prefix: prefix + name + ':' }); },
    storage,
  };
  return store;
}

/** Entries are kept as "<last used ms>|<body>". Returns [ts, body], or null for anything else. */
function unpack(raw) {
  if (typeof raw !== 'string') return null;
  const bar = raw.indexOf('|');
  if (bar < 1) return null;
  const ts = Number(raw.slice(0, bar));
  return Number.isFinite(ts) ? [ts, raw.slice(bar + 1)] : null;
}

/**
 * A size-capped least-recently-used cache of strings on top of a Storage (the add-on list, the library, catalogs,
 * metas: Alder's Http.saved on disk). The cap counts characters of keys plus bodies; when over it, or when the
 * storage reports it is full, the oldest entries go first.
 *
 * A read counts as a use but only rewrites the stored timestamp when the stored one is over [touchEveryMs] old,
 * so reading a catalog does not write to storage.
 */
export function createCache({ storage = browserStorage(), prefix = 'alder:cache:', maxChars = 2000000,
  now = Date.now, touchEveryMs = 10 * 60 * 1000 } = {}) {
  const index = new Map(); // key -> { size, ts }
  let total = 0;

  function track(key, size, ts) {
    const old = index.get(key);
    if (old) total -= old.size;
    index.set(key, { size, ts });
    total += size;
  }
  function untrack(key) {
    const old = index.get(key);
    if (old) { total -= old.size; index.delete(key); }
  }

  // Index what an earlier run left behind; anything unreadable under our prefix is dropped.
  try {
    for (const k of keysOf(storage)) {
      if (!k.startsWith(prefix)) continue;
      const parsed = unpack(storage.getItem(k));
      if (parsed) track(k.slice(prefix.length), k.length + parsed[1].length + 12, parsed[0]);
      else storage.removeItem(k);
    }
  } catch (e) { /* an unreadable storage just starts empty */ }

  function evictOldest(until) {
    // compat-ok: unstable sort (entries with equal timestamps may go in either order)
    const order = Array.from(index.entries()).sort((a, b) => a[1].ts - b[1].ts);
    for (const [key] of order) {
      if (total <= until) break;
      try { storage.removeItem(prefix + key); } catch (e) { /* keep going */ }
      untrack(key);
    }
  }

  const cache = {
    get(key) {
      let raw;
      try { raw = storage.getItem(prefix + key); } catch (e) { return null; }
      const parsed = unpack(raw);
      if (!parsed) { if (raw !== null) cache.remove(key); return null; }
      const t = now();
      if (t - parsed[0] > touchEveryMs) {
        try { storage.setItem(prefix + key, t + '|' + parsed[1]); track(key, key.length + parsed[1].length + 12, t); } catch (e) { /* stays as it was */ }
      }
      return parsed[1];
    },
    /** Stores [body] (a string). false when it cannot fit even after evicting everything older. */
    put(key, body) {
      const size = key.length + body.length + 12;
      if (size > maxChars) return false;
      const t = now();
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          storage.setItem(prefix + key, t + '|' + body);
          track(key, size, t);
          if (total > maxChars) evictOldest(Math.floor(maxChars * 0.9));
          return true;
        } catch (e) {
          if (!isQuotaError(e)) return false;
          // The storage is full (maybe of things that are not ours): free a quarter of what we hold and retry.
          if (index.size === 0) return false;
          evictOldest(Math.floor(total * 0.75));
        }
      }
      return false;
    },
    remove(key) {
      try { storage.removeItem(prefix + key); } catch (e) { /* nothing to do */ }
      untrack(key);
    },
    clear() { Array.from(index.keys()).forEach((k) => cache.remove(k)); },
    /** Characters held, for the size report on Diagnostics. */
    size: () => total,
    count: () => index.size,
    has: (key) => index.has(key),
  };
  return cache;
}
