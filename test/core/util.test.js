import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stableSort, sortBy, maxWith, base64Encode, base64Decode, uriEncode, formatOneDecimal, optInt, optString, text, getString, optBoolean, lines } from '../../src/core/util.js'
import { languageName, toIso1, toIso3, languageOfLocale } from '../../src/core/lang.js'

test('stableSort keeps the order of equal items even past 10 elements (Chromium 69 sort is not stable)', () => {
  const list = Array.from({ length: 200 }, (_, i) => ({ i, group: i % 3 }))
  const sorted = stableSort(list, (a, b) => a.group - b.group)
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k - 1].group === sorted[k].group) assert.ok(sorted[k - 1].i < sorted[k].i)
  }
  assert.equal(sorted.length, 200)
})

test('sortBy: several keys, desc, booleans (false < true) and null lowest', () => {
  const list = [{ n: 'a', v: 1, f: true }, { n: 'b', v: 2, f: false }, { n: 'c', v: 2, f: true }, { n: 'd', v: null, f: false }]
  assert.deepEqual(sortBy(list, [[x => x.v, 'desc'], [x => x.f, 'desc']]).map(x => x.n), ['c', 'b', 'a', 'd'])
  assert.deepEqual(sortBy(list, [[x => x.f, 'asc']]).map(x => x.n), ['b', 'd', 'a', 'c'])
  assert.deepEqual(sortBy([], [[x => x, 'asc']]), [])
})

test('maxWith: the first maximal element wins ties (Kotlin maxWithOrNull)', () => {
  assert.deepEqual(maxWith([{ k: 1, id: 'a' }, { k: 3, id: 'b' }, { k: 3, id: 'c' }], (x, y) => x.k - y.k), { k: 3, id: 'b' })
  assert.equal(maxWith([], () => 0), null)
})

test('base64: Android DEFAULT decoding (whitespace skipped) and NO_WRAP encoding (padded)', () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7])
  const enc = base64Encode(bytes)
  assert.equal(enc, Buffer.from(bytes).toString('base64'))
  assert.deepEqual(Array.from(base64Decode(enc)), Array.from(bytes))
  assert.deepEqual(Array.from(base64Decode(enc.slice(0, 8) + '\n' + enc.slice(8))), Array.from(bytes))
  assert.deepEqual(Array.from(base64Decode(enc.replace(/=+$/, ''))), Array.from(bytes)) // unpadded input is read too
  for (let n = 0; n < 12; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255)
    assert.equal(base64Encode(b), Buffer.from(b).toString('base64'))
    assert.deepEqual(Array.from(base64Decode(base64Encode(b))), Array.from(b))
  }
  assert.throws(() => base64Decode('ab$d'))
})

test('uriEncode = Android Uri.encode(s, allow)', () => {
  assert.equal(uriEncode('tt0903747:1:2', ':='), 'tt0903747:1:2')
  assert.equal(uriEncode('genre=Sci-Fi', ':='), 'genre=Sci-Fi')
  assert.equal(uriEncode('a b/c?d&e', ''), 'a%20b%2Fc%3Fd%26e')
  assert.equal(uriEncode('tt1:2', ''), 'tt1%3A2')
  assert.equal(uriEncode("it's (ok)*!~", ''), "it's%20(ok)*!~")
  assert.equal(uriEncode('dün', ''), 'd%C3%BCn')
  assert.equal(uriEncode('50%3A', ':'), '50%253A') // an existing % is escaped, then ':' only allowed from the real colon
})

test('formatOneDecimal = Java "%.1f"', () => {
  const cases = [[0, '0.0'], [1, '1.0'], [1.25, '1.3'], [5.35, '5.4'], [9.96, '10.0'], [24.3, '24.3'], [0.04, '0.0'], [0.05, '0.1'], [99.95, '100.0'], [12.34, '12.3'], [73.33, '73.3']]
  for (const [x, want] of cases) assert.equal(formatOneDecimal(x), want, String(x))
})

test('org.json-style readers', () => {
  const o = { a: 'x', b: 5, c: '7', d: null, e: '  ', f: true, g: 'TRUE', h: 3.9, i: { z: 1 } }
  assert.equal(optString(o, 'a'), 'x')
  assert.equal(optString(o, 'b'), '5')
  assert.equal(optString(o, 'd'), '')
  assert.equal(optString(o, 'missing'), '')
  assert.equal(text(o, 'a'), 'x')
  assert.equal(text(o, 'd'), null)
  assert.equal(text(o, 'e'), null)
  assert.equal(text(o, 'missing'), null)
  assert.equal(text(null, 'a'), null)
  assert.equal(optInt(o, 'b'), 5)
  assert.equal(optInt(o, 'c'), 7)
  assert.equal(optInt(o, 'h'), 3)
  assert.equal(optInt(o, 'a'), 0)
  assert.equal(optInt(o, 'missing', 9), 9)
  assert.equal(optBoolean(o, 'f'), true)
  assert.equal(optBoolean(o, 'g'), true)
  assert.equal(optBoolean(o, 'b'), false)
  assert.equal(getString(o, 'b'), '5')
  assert.throws(() => getString(o, 'missing'))
  assert.throws(() => getString(o, 'd'))
  assert.deepEqual(lines('a\r\nb\nc\rd'), ['a', 'b', 'c', 'd'])
})

test('lang: names and codes for the places Alder used java.util.Locale', () => {
  assert.equal(languageName('en'), 'English')
  assert.equal(languageName('eng'), 'English')
  assert.equal(languageName('ger'), 'German')
  assert.equal(languageName('deu'), 'German')
  assert.equal(languageName('hi'), 'Hindi')
  assert.equal(languageName('pt-BR'), 'Portuguese')
  assert.equal(languageName('xx'), 'xx') // unknown comes back unchanged, like Locale
  assert.equal(languageName(''), '')
  assert.equal(toIso1('eng'), 'en')
  assert.equal(toIso1('FRE'), 'fr')
  assert.equal(toIso1('English'), 'en')
  assert.equal(toIso1('zzz'), 'zzz')
  assert.equal(toIso3('de'), 'ger')
  assert.equal(toIso3('en'), 'eng')
  assert.equal(languageOfLocale('en_US'), 'en')
  assert.equal(languageOfLocale('de-DE'), 'de')
  assert.equal(languageOfLocale(''), 'en')
})
