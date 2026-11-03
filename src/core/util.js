// Small helpers shared by the core modules. Pure: no DOM, no network, no storage.
//
// Two of them exist because of the target engine (Tizen 5.5 = Chromium 69):
//  - stableSort: Array.prototype.sort is NOT stable before Chromium 70 (V8 7.0) for arrays longer than 10 items.
//    Alder's ranking relies on Kotlin's stable sortedWith ("ties keep the add-on's order"), so every ranking goes through here.
//  - base64: written by hand so the watched bitfield does not depend on window.atob/btoa quirks (whitespace, padding).

/** Stable sort by a list of [selector, "asc" | "desc"] keys, like Kotlin's compareBy(...).thenBy(...). null sorts lowest. */
export function sortBy(list, keys) {
  const compare = (a, b) => {
    for (const [select, dir] of keys) {
      const x = select(a), y = select(b)
      const c = compareValues(x, y)
      if (c !== 0) return dir === 'desc' ? -c : c
    }
    return 0
  }
  return stableSort(list, compare)
}

function compareValues(x, y) {
  if (x === y) return 0
  if (x === null || x === undefined) return -1
  if (y === null || y === undefined) return 1
  if (typeof x === 'boolean') x = x ? 1 : 0
  if (typeof y === 'boolean') y = y ? 1 : 0
  return x < y ? -1 : x > y ? 1 : 0
}

/** A new array sorted with [compare], equal items keeping their order (decorate, sort, undecorate). */
export function stableSort(list, compare) {
  return list
    .map((value, index) => ({ value, index }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map(e => e.value)
}

/** Kotlin's maxWithOrNull: the first of the maximal elements (ties keep the earlier one). */
export function maxWith(list, compare) {
  let best
  let has = false
  for (const e of list) {
    if (!has || compare(best, e) < 0) { best = e; has = true }
  }
  return has ? best : null
}

// ---- org.json-style readers: Alder reads add-on and Stremio JSON leniently (optString/optInt/...), so does the port ----

const isNull = v => v === undefined || v === null
export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** optJSONArray: the array at [key], or null. */
export function arr(o, key) {
  const v = o ? o[key] : undefined
  return Array.isArray(v) ? v : null
}
export const items = a => (Array.isArray(a) ? a : [])
export const objects = a => items(a).filter(isObject)
export const strings = a => items(a).filter(v => typeof v === 'string')
export function obj(o, key) {
  const v = o ? o[key] : undefined
  return isObject(v) ? v : null
}

/** optString: "" when missing or null. Numbers and booleans read as their text. */
export function optString(o, key) {
  const v = o ? o[key] : undefined
  if (isNull(v)) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** The string at [key], or null when it's missing, JSON null or blank. */
export function text(o, key) {
  const s = optString(o, key)
  return s.trim() === '' ? null : s
}

/** getString: throws when missing, like org.json. */
export function getString(o, key) {
  const v = o ? o[key] : undefined
  if (isNull(v) || typeof v === 'object') throw new Error('Missing "' + key + '"')
  return String(v)
}

function numberOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}
export function optInt(o, key, fallback = 0) {
  const n = numberOf(o ? o[key] : undefined)
  return n === null ? fallback : n
}
export const optLong = optInt // JS numbers hold every size and millisecond count Stremio sends exactly

export function optBoolean(o, key) {
  const v = o ? o[key] : undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return false
}

// ---- URLs ----

/** Android's Uri.encode(s, allow): percent-encodes everything but A-Z a-z 0-9 _ - ! . ~ ' ( ) * and the [allow] characters. */
export function uriEncode(s, allow = '') {
  let out = encodeURIComponent(s)
  for (const ch of allow) out = out.split(encodeURIComponent(ch)).join(ch)
  return out
}

// ---- base64 (standard alphabet, padding optional on input, none on output = Android's NO_WRAP) ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = (() => { const m = {}; for (let i = 0; i < 64; i++) m[B64[i]] = i; return m })()

export function base64Encode(bytes, pad = true) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : (pad ? '=' : '')
    out += i + 2 < bytes.length ? B64[n & 63] : (pad ? '=' : '')
  }
  return out
}

/** Android's Base64.DEFAULT decoding: whitespace is skipped, a bad character throws. */
export function base64Decode(str) {
  const clean = str.replace(/[\s=]+/g, '')
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4))
  let acc = 0, bits = 0, n = 0
  for (let i = 0; i < clean.length; i++) {
    const v = B64_INDEX[clean[i]]
    if (v === undefined) throw new Error('Bad base64')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 255 }
  }
  return out.subarray(0, n)
}

// ---- number formatting ----

/** Java's String.format("%.1f", x): the shortest decimal form of x, rounded half up (toFixed rounds the binary value, which differs on ties). */
export function formatOneDecimal(x) {
  const negative = x < 0
  const s = Math.abs(x).toString()
  if (/e/i.test(s)) return (negative ? '-' : '') + Math.abs(x).toFixed(1)
  const [whole, frac = ''] = s.split('.')
  const digits = (whole + (frac + '0').slice(0, 1)).split('').map(Number)
  const roundUp = (frac.charCodeAt(1) || 48) >= 53
  if (roundUp) {
    let i = digits.length - 1
    while (i >= 0) {
      if (digits[i] === 9) { digits[i] = 0; i-- } else { digits[i]++; break }
    }
    if (i < 0) digits.unshift(1)
  }
  const str = digits.join('')
  return (negative ? '-' : '') + str.slice(0, -1) + '.' + str.slice(-1)
}

/** Kotlin's String.lines(): splits on \r\n, \n and \r. */
export const lines = s => s.split(/\r\n|\n|\r/)
