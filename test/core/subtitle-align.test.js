import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RATIOS, DEFAULTS, prepareCues, overlapScore, align, applyTransform, mapTime, PIECEWISE, alignPiecewise, applySegments, segmentMapTime, CHECKED, alignChecked, pickBest } from '../../src/core/subtitle-align.js'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRef(seed, n) {
  const rnd = mulberry32(seed)
  const cues = []
  let t = 30000
  for (let i = 0; i < n; i++) {
    const dur = 1000 + Math.floor(rnd() * 3000)
    cues.push({ start: t, end: t + dur })
    t += dur + 300 + Math.floor(rnd() * 5700)
  }
  return cues
}

function derive(ref, seed, o) {
  const rnd = mulberry32(seed)
  const jitter = o.jitter === undefined ? 150 : o.jitter
  const drop = o.drop === undefined ? 0.1 : o.drop
  const split = o.split === undefined ? 0.1 : o.split
  const pieces = []
  for (const c of ref) {
    if (rnd() < drop) continue
    if (rnd() < split) {
      const mid = (c.start + c.end) / 2
      pieces.push({ start: c.start, end: mid - 50 }, { start: mid + 50, end: c.end })
    } else {
      pieces.push({ start: c.start, end: c.end })
    }
  }
  return pieces.map(p => {
    const start = p.start + (rnd() * 2 - 1) * jitter
    let end = p.end + (rnd() * 2 - 1) * jitter
    if (end <= start) end = start + 300
    return { start: Math.round(start * o.ratio + o.offset), end: Math.round(end * o.ratio + o.offset) }
  })
}

const win = { from: -1e9, to: 1e9 }

test('1: offset +2500, ratio 1 -> offset -2500', (t) => {
  const ref = makeRef(1, 700)
  const r = align(ref, derive(ref, 11, { ratio: 1, offset: 2500 }))
  t.diagnostic('result ' + JSON.stringify(r) + ' error ' + Math.abs(r.offset + 2500))
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.offset + 2500) <= 80)
  assert.equal(r.ratio, 1)
  assert.equal(r.confidence, 'high')
})

test('2: offset -45000 -> offset +45000', (t) => {
  const ref = makeRef(2, 700)
  const r = align(ref, derive(ref, 12, { ratio: 1, offset: -45000 }))
  t.diagnostic('result ' + JSON.stringify(r) + ' error ' + Math.abs(r.offset - 45000))
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.offset - 45000) <= 80)
  assert.equal(r.ratio, 1)
  assert.equal(r.confidence, 'high')
})

function checkRatio(t, seed, ratio, offset, expected) {
  const ref = makeRef(seed, 700)
  const r = align(ref, derive(ref, seed + 10, { ratio, offset }))
  t.diagnostic('result ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.ratio, expected)
  assert.ok(RATIOS.indexOf(r.ratio) >= 0)
  for (const min of [10, 60, 110]) {
    const target = min * 60000
    const truth = (target - offset) / ratio
    const err = Math.abs(mapTime(target, r) - truth)
    t.diagnostic('t=' + min + ' min error ' + err.toFixed(1) + ' ms')
    assert.ok(err <= 150)
  }
}

test('3: ratio 25/23.976, offset +1200 -> inverse ratio recovered', (t) => {
  checkRatio(t, 3, 25 / 23.976, 1200, 23.976 / 25)
})

test('4: ratio 23.976/25, offset -800 -> inverse ratio recovered', (t) => {
  checkRatio(t, 4, 23.976 / 25, -800, 25 / 23.976)
})

test('5: identity with jitter', (t) => {
  const ref = makeRef(5, 700)
  const r = align(ref, derive(ref, 15, { ratio: 1, offset: 0 }))
  t.diagnostic('result ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.identity, true)
})

test('6: unrelated target is not accepted', (t) => {
  const r = align(makeRef(6, 700), makeRef(66, 700))
  t.diagnostic('result ' + JSON.stringify(r))
  assert.ok(r.ok === false || r.confidence === 'none')
})

test('7: partial reference (first 5 minutes), target offset +3000 -> offset -3000', (t) => {
  const full = makeRef(7, 700)
  const limit = full[0].start + 5 * 60000
  const ref = full.filter(c => c.start < limit)
  t.diagnostic('reference cues ' + ref.length)
  assert.ok(ref.length >= 50 && ref.length <= 90)
  const r = align(ref, derive(full, 17, { ratio: 1, offset: 3000 }))
  t.diagnostic('result ' + JSON.stringify(r) + ' error ' + Math.abs(r.offset + 3000))
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.offset + 3000) <= 100)
  assert.equal(r.ratio, 1) // Occam: ratio 1 is preferred when it fits as well
})

test('7b: partial reference, target at 25/23.976 -> right inside the reference window', (t) => {
  const full = makeRef(7, 700)
  const limit = full[0].start + 5 * 60000
  const ref = full.filter(c => c.start < limit)
  const ratio = 25 / 23.976
  const r = align(ref, derive(full, 27, { ratio, offset: 0 }))
  t.diagnostic('result ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  for (let ms = 30000 * ratio; ms < limit * ratio; ms += 30000) {
    const err = Math.abs(mapTime(ms, r) - ms / ratio)
    assert.ok(err <= 200, 'error ' + err + ' at ' + ms)
  }
})

test('8: too few cues', () => {
  const ref = makeRef(8, 10)
  const r = align(ref, derive(ref, 18, { ratio: 1, offset: 1000 }))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'too few cues')
  assert.equal(r.confidence, 'none')
})

test('9: prepareCues drops, merges and sorts', () => {
  const input = [
    { start: 20000, end: 22000 },
    { start: 0, end: 2000 },
    { start: 1500, end: 3000 }, // overlaps the previous: merged
    { start: 3040, end: 4000 }, // gap 40 < 50: merged
    { start: 4050, end: 5000 }, // gap 50: kept apart
    { start: 6000, end: 6299 }, // too short
    { start: 7000, end: 19001 }, // too long
    { start: 8000, end: 8000 }, // empty
    { start: 9000, end: 8000 }, // negative
    { start: NaN, end: 9000 },
    { start: 9000, end: Infinity },
    { start: '1000', end: 3000 },
    { start: 10000, end: 10300 }, // exactly 300: kept
    { start: 30000, end: 42000 }, // exactly 12000: kept
  ]
  const out = prepareCues(input)
  assert.deepEqual(out, [
    { start: 0, end: 4000 },
    { start: 4050, end: 5000 },
    { start: 10000, end: 10300 },
    { start: 20000, end: 22000 },
    { start: 30000, end: 42000 },
  ])
  assert.equal(input[0].start, 20000) // input untouched
})

test('10: overlapScore known answer and the window rule', () => {
  const ref = [{ start: 1000, end: 2000 }, { start: 3000, end: 4000 }]
  const target = [{ start: 0, end: 1000 }, { start: 1500, end: 2500 }, { start: 5000, end: 6000 }]
  // offset +1000: [1000,2000] -> 1000 covered, [2500,3500] -> 500 covered, [6000,7000] -> 0
  const all = overlapScore(ref, target, 1, 1000, { from: 0, to: 10000 })
  assert.equal(all.count, 3)
  assert.equal(all.score, 1500 / 3000)
  // window [1000, 3500]: the third is outside, the first two count fully inside
  const w = overlapScore(ref, target, 1, 1000, { from: 1000, to: 3500 })
  assert.equal(w.count, 2)
  assert.equal(w.score, 1500 / 2000)
  // window [1500, 10000]: the first starts before from and is not counted
  const w2 = overlapScore(ref, target, 1, 1000, { from: 1500, to: 10000 })
  assert.equal(w2.count, 2)
  assert.equal(w2.score, 500 / 2000)
  // ratio 2: [0,1000] -> [0,2000]; covered 1000 of 2000
  const r2 = overlapScore(ref, [{ start: 0, end: 1000 }], 2, 0, win)
  assert.equal(r2.count, 1)
  assert.equal(r2.score, 0.5)
  const none = overlapScore(ref, target, 1, 0, { from: 100000, to: 200000 })
  assert.deepEqual(none, { score: 0, count: 0 })
})

test('11: applyTransform carries fields, clamps, drops, does not mutate', () => {
  const input = [
    { start: 1000, end: 2000, lines: ['a'] },
    { start: 100, end: 400, lines: ['b'] },
    { start: 5000, end: 6000, lines: ['c'] },
  ]
  const copy = JSON.parse(JSON.stringify(input))
  const out = applyTransform(input, { ratio: 1, offset: -500 })
  assert.deepEqual(input, copy)
  assert.deepEqual(out, [
    { start: 500, end: 1500, lines: ['a'] },
    { start: 4500, end: 5500, lines: ['c'] },
  ])
  const clamped = applyTransform(input, { ratio: 1, offset: -300 })
  assert.deepEqual(clamped[1], { start: 0, end: 100, lines: ['b'] }) // 100-300 clamped at 0
  assert.equal(clamped.length, 3)
  assert.notEqual(out[0], input[0])
  assert.equal(applyTransform([{ start: 1, end: 2 }], { ratio: 1.5, offset: 0.4 })[0].end, 3)
  assert.equal(mapTime(1000, { ratio: 2, offset: -5 }), 1995)
})

test('constants', () => {
  assert.equal(RATIOS.length, 7)
  assert.equal(DEFAULTS.binMs, 100)
})

test('12: performance, 1500 cues', (t) => {
  const ref = makeRef(12, 1500)
  const target = derive(ref, 22, { ratio: 25 / 23.976, offset: 4000 })
  const t0 = process.hrtime.bigint()
  const r = align(ref, target)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  t.diagnostic('align took ' + ms.toFixed(0) + ' ms; ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.ok(ms < 3000)
})

// ---- piecewise ----

// add [shift] to every cue starting after [after]; with a negative shift the cues that would collide are dropped first
function cutAt(cues, after, shift) {
  const kept = shift < 0 ? cues.filter(c => !(c.start > after + shift && c.start <= after)) : cues
  return kept.map(c => c.start > after ? { start: c.start + shift, end: c.end + shift } : c)
}

test('P1: linear target -> one segment', (t) => {
  const ref = makeRef(31, 700)
  const r = alignPiecewise(ref, derive(ref, 41, { ratio: 1, offset: 2500 }))
  t.diagnostic('P1 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.segments.length, 1)
  assert.ok(Math.abs(r.segments[0].offset + 2500) <= 80)
  assert.equal(r.confidence, 'high')
})

test('P2: one cut (inserted scene of 45 s after 50 min)', (t) => {
  const ref = makeRef(32, 700)
  const base = derive(ref, 42, { ratio: 1, offset: 2000 })
  const cut = 50 * 60000
  const target = cutAt(base, cut, 45000)
  const r = alignPiecewise(ref, target)
  t.diagnostic('P2 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.segments.length, 2)
  assert.ok(Math.abs(r.segments[0].offset + 2000) <= 100)
  assert.ok(Math.abs(r.segments[1].offset + 47000) <= 100)
  const idx = target.findIndex(c => c.start > cut)
  assert.ok(r.segments[1].from >= target[idx - 1].start && r.segments[1].from <= target[idx + 1].start)
})

test('P3: two cuts', (t) => {
  const ref = makeRef(33, 1100)
  let target = derive(ref, 43, { ratio: 1, offset: 1000 })
  target = cutAt(target, 40 * 60000, -20000)
  target = cutAt(target, 80 * 60000, 15000)
  const r = alignPiecewise(ref, target)
  t.diagnostic('P3 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.segments.length, 3)
  const truth = [-1000, 19000, 4000]
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(r.segments[i].offset - truth[i]) <= 100, 'segment ' + i)
})

test('P4: ratio with a cut', (t) => {
  const ref = makeRef(34, 700)
  const ratio = 25 / 23.976
  const target = cutAt(derive(ref, 44, { ratio, offset: 1200 }), 60 * 60000, 30000)
  const r = alignPiecewise(ref, target)
  t.diagnostic('P4 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.ratio, 23.976 / 25)
  assert.equal(r.segments.length, 2)
  for (const min of [10, 50, 100]) {
    const x = min * 60000
    const truth = (x - 1200 - (x > 60 * 60000 ? 30000 : 0)) / ratio
    const err = Math.abs(segmentMapTime(x, r) - truth)
    t.diagnostic('P4 t=' + min + ' min error ' + err.toFixed(1) + ' ms')
    assert.ok(err <= 150)
  }
})

test('P5: unrelated target', (t) => {
  const r = alignPiecewise(makeRef(35, 700), makeRef(77, 700))
  t.diagnostic('P5 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, false)
  assert.equal(r.confidence, 'none')
})

test('P6: partial reference', (t) => {
  const full = makeRef(36, 700)
  const limit = full[0].start + 5 * 60000
  const ref = full.filter(c => c.start < limit)
  const r = alignPiecewise(ref, derive(full, 46, { ratio: 1, offset: 3000 }))
  t.diagnostic('P6 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.segments.length, 1)
  assert.ok(Math.abs(r.segments[0].offset + 3000) <= 100)
})

test('P7: applySegments and segmentMapTime', () => {
  const result = { ratio: 1, segments: [{ from: 0, offset: -500 }, { from: 10000, offset: 1000 }] }
  const input = [
    { start: 100, end: 400, lines: ['a'] }, // ends at -100: dropped
    { start: 300, end: 900, lines: ['b'] }, // start clamped at 0
    { start: 9999, end: 10500, lines: ['c'] }, // first segment
    { start: 10000, end: 11000, lines: ['d'] }, // second segment
  ]
  const copy = JSON.parse(JSON.stringify(input))
  const out = applySegments(input, result)
  assert.deepEqual(input, copy)
  assert.deepEqual(out, [
    { start: 0, end: 400, lines: ['b'] },
    { start: 9499, end: 10000, lines: ['c'] },
    { start: 11000, end: 12000, lines: ['d'] },
  ])
  assert.equal(segmentMapTime(5000, result), 4500)
  assert.equal(segmentMapTime(10000, result), 11000)
  assert.equal(segmentMapTime(-50, result), -550)
  assert.equal(segmentMapTime(1000, { ratio: 2, segments: [{ from: 0, offset: 3 }] }), 2003)
  assert.equal(PIECEWISE.states, 10)
})

test('P8: piecewise performance, 1500 cues', (t) => {
  const ref = makeRef(38, 1500)
  const target = derive(ref, 48, { ratio: 25 / 23.976, offset: 4000 })
  const t0 = process.hrtime.bigint()
  const r = alignPiecewise(ref, target)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  t.diagnostic('P8 alignPiecewise took ' + ms.toFixed(0) + ' ms; ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.ok(ms < 3000)
})

test('P9: inserted scene with dialogue', (t) => {
  const ref = makeRef(39, 700)
  const base = derive(ref, 49, { ratio: 1, offset: 2000 })
  const cut = 50 * 60000
  const before = base.filter(c => c.start <= cut)
  const after = base.filter(c => c.start > cut).map(c => ({ start: c.start + 60000, end: c.end + 60000 }))
  const holeStart = before[before.length - 1].end + 200, holeEnd = after[0].start - 200
  const raw = makeRef(99, 20)
  const t0 = raw[0].start, t1 = raw[raw.length - 1].end
  const inserted = raw.map(c => ({
    start: Math.round(holeStart + (c.start - t0) / (t1 - t0) * (holeEnd - holeStart)),
    end: Math.round(holeStart + (c.end - t0) / (t1 - t0) * (holeEnd - holeStart)),
  }))
  const target = before.concat(inserted, after)
  const r = alignPiecewise(ref, target)
  t.diagnostic('P9 skipped ' + r.skipped + ' drops ' + (r.drops ? r.drops.length : 0) + ' ' + JSON.stringify(r))
  assert.equal(r.ok, true)
  assert.equal(r.segments.length, 2)
  assert.ok(Math.abs(r.segments[0].offset + 2000) <= 100)
  assert.ok(Math.abs(r.segments[1].offset + 62000) <= 100)
  const tagged = target.map((c, i) => ({ start: c.start, end: c.end, ins: i >= before.length && i < before.length + 20 }))
  const kept = applySegments(tagged, r)
  const keptIns = kept.filter(c => c.ins).length
  const keptOther = kept.length - keptIns
  const droppedIns = 20 - keptIns, droppedOther = (target.length - 20) - keptOther
  t.diagnostic('P9 dropped inserted ' + droppedIns + ', dropped others ' + droppedOther)
  assert.ok(droppedIns >= 16)
  assert.ok(droppedOther <= 1)
})

// ---- checked ----

test('C1: alignChecked on a linear target', (t) => {
  const ref = makeRef(1, 700)
  const r = alignChecked(ref, derive(ref, 11, { ratio: 1, offset: 2500 }))
  t.diagnostic('C1 ' + JSON.stringify(r))
  assert.equal(r.checked, 'high')
  assert.ok(r.gain > 0.40)
  assert.ok(Math.abs(r.offset + 2500) <= 80)
})

test('C2: alignChecked on an unrelated target', (t) => {
  const r = alignChecked(makeRef(6, 700), makeRef(66, 700))
  t.diagnostic('C2 ' + JSON.stringify(r))
  assert.equal(r.checked, 'none')
})

test('C3: alignChecked on a partial reference', (t) => {
  const full = makeRef(7, 700)
  const limit = full[0].start + 5 * 60000
  const ref = full.filter(c => c.start < limit)
  const r = alignChecked(ref, derive(full, 17, { ratio: 1, offset: 3000 }))
  t.diagnostic('C3 ' + JSON.stringify(r))
  assert.notEqual(r.checked, 'none')
  assert.ok(Math.abs(r.offset + 3000) <= 100)
})

test('C4: pickBest ranks the right candidate first and the unrelated one last', (t) => {
  const ref = makeRef(1, 700)
  const cands = [
    { id: 'rough', cues: derive(ref, 12, { ratio: 1, offset: 2500, jitter: 600 }) },
    { id: 'good', cues: derive(ref, 11, { ratio: 1, offset: 2500 }) },
    { id: 'other', cues: makeRef(66, 700) },
  ]
  const before = JSON.stringify(cands)
  const ranked = pickBest(ref, cands)
  t.diagnostic('C4 ' + ranked.map(x => x.id + ' gain ' + x.result.gain.toFixed(3) + ' ' + x.result.checked).join(' | '))
  assert.equal(JSON.stringify(cands), before)
  assert.equal(ranked.length, 3)
  assert.equal(ranked[0].id, 'good')
  assert.equal(ranked[2].id, 'other')
  assert.equal(CHECKED.highGain, 0.40)
})
