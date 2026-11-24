// Subtitle alignment: finds the linear time transform (target * ratio + offset) that puts an out-of-sync TARGET subtitle
// (e.g. Turkish) onto a REFERENCE subtitle (e.g. English) that is in sync with the video. Only cue TIMINGS are compared,
// never text (the languages differ). All times are milliseconds. A cue is any object with numeric start and end.
//
// Algorithm:
//  1. prepareCues keeps plausible cues (300 ms - 12 s), sorts them and merges overlaps / gaps < 50 ms into disjoint intervals.
//  2. Voting: for every ratio in RATIOS, each target start (and end) votes for the offsets that would land it on every
//     reference start (end) within +-maxOffsetMs; votes go into binMs bins, are smoothed over 3 bins, and the best
//     peaksPerRatio peaks (at least peakSeparationMs apart) become coarse offsets.
//  3. Refinement: each coarse offset is scanned +-refineSpanMs in refineStepMs steps with overlapScore (the share of the
//     target's mapped time that lies inside reference cues, a two-pointer O(n + m) sweep); candidates must cover enough cues.
//  4. The best score wins (a ratio-1 candidate equivalent to it and within 0.02 replaces a non-1 best); the runner-up is the
//     best score among candidates NOT equivalent to it (they disagree by >= peakSeparationMs at either end of the reference
//     window), and the margin gives the confidence: 'high', 'low' or 'none'.
// Piecewise (alignPiecewise): candidate offsets per ratio come from the vote peaks (states); a Viterbi pass with a switch penalty
// picks one state per target cue (state gains are the overlap fraction minus the reference density, so chance placements earn
// nothing); when two consecutive segments claim the same stretch of the reference (beyond monotoneTolMs), the group that matches
// it better keeps it and the other group's cues are dropped (on apply too); a segment whose own normalised match is below minSegmentNormalized is treated as unmatched. Short
// segments are merged into a neighbour and each segment is refined on its own. Its confidence is the normalised score minus the
// same score against a mirrored reference (a decoy with equal density).
// align returns the transform that maps TARGET times onto REFERENCE times (target 3 s late => offset -3000).
//
// Syntax limits (enforced by `npm run compat`, Tizen 5.5 = Chromium 69 / Safari 14): plain ES module, no optional chaining,
// no nullish coalescing, no class fields, no regex lookbehind, no BigInt, no Array.prototype.flat/flatMap, no
// Object.fromEntries. Pure: no window, document, fetch, localStorage, Date.now or Math.random.
import { stableSort } from './util.js'

/** Frame-rate ratios that are tried: none, then 25 / 23.976 / 24 fps conversions in both directions. */
export const RATIOS = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25]

/** Tunables of align (all milliseconds except the counts and the 0..1 scores). */
export const DEFAULTS = {
  maxOffsetMs: 600000,
  binMs: 100,
  minCues: 15,
  refineSpanMs: 600,
  refineStepMs: 10,
  peaksPerRatio: 3,
  peakSeparationMs: 2000,
  highScore: 0.6,
  highMargin: 0.15,
  lowScore: 0.45,
  lowMargin: 0.08,
  identityMs: 100,
  padMs: 5000,
}

/** A new sorted array of disjoint {start, end} intervals: bad / very short / very long cues dropped, near-touching ones merged. */
export function prepareCues(cues) {
  const good = []
  for (const cue of cues) {
    const s = cue.start, e = cue.end
    if (typeof s !== 'number' || typeof e !== 'number' || !isFinite(s) || !isFinite(e)) continue
    const d = e - s
    if (e <= s || d < 300 || d > 12000) continue
    good.push({ start: s, end: e })
  }
  const sorted = stableSort(good, (a, b) => a.start - b.start)
  const out = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last && c.start - last.end < 50) {
      if (c.end > last.end) last.end = c.end
    } else {
      out.push({ start: c.start, end: c.end })
    }
  }
  return out
}

/**
 * How much of the target's mapped time falls inside the reference. [ref] and [target] are prepared intervals; a target
 * interval maps to [start * ratio + offset, end * ratio + offset] and counts only when fully inside [win.from, win.to].
 * Returns { score, count }: overlap with the reference union / mapped duration of the counted intervals.
 */
export function overlapScore(ref, target, ratio, offset, win) {
  let covered = 0, total = 0, count = 0, j = 0
  for (let i = 0; i < target.length; i++) {
    const a = target[i].start * ratio + offset
    const b = target[i].end * ratio + offset
    if (a < win.from || b > win.to) continue
    count++
    total += b - a
    while (j < ref.length && ref[j].end <= a) j++
    for (let k = j; k < ref.length && ref[k].start < b; k++) {
      const lo = ref[k].start > a ? ref[k].start : a
      const hi = ref[k].end < b ? ref[k].end : b
      if (hi > lo) covered += hi - lo
    }
  }
  return { score: count > 0 && total > 0 ? covered / total : 0, count }
}

/** First index in [ref] (sorted by start) whose start is >= x. */
function lowerBoundStart(ref, x) {
  let lo = 0, hi = ref.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ref[mid].start < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index in [ref] (sorted by end, as they are disjoint) whose end is >= x. */
function lowerBoundEnd(ref, x) {
  let lo = 0, hi = ref.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ref[mid].end < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Coarse offsets for one ratio: the strongest smoothed vote bins, [peaksPerRatio] of them at least peakSeparationMs apart. */
function coarseOffsets(R, T, ratio, o) {
  const max = o.maxOffsetMs, bin = o.binMs
  const size = Math.round((2 * max) / bin) + 1
  const votes = new Float64Array(size)
  for (let i = 0; i < T.length; i++) {
    const s = T[i].start * ratio
    for (let j = lowerBoundStart(R, s - max); j < R.length && R[j].start <= s + max; j++) {
      const k = Math.round((R[j].start - s + max) / bin)
      if (k >= 0 && k < size) votes[k] += 1
    }
    const e = T[i].end * ratio
    for (let j = lowerBoundEnd(R, e - max); j < R.length && R[j].end <= e + max; j++) {
      const k = Math.round((R[j].end - e + max) / bin)
      if (k >= 0 && k < size) votes[k] += 1
    }
  }
  const smooth = new Float64Array(size)
  for (let k = 0; k < size; k++) {
    smooth[k] = (k > 0 ? votes[k - 1] : 0) + votes[k] + (k < size - 1 ? votes[k + 1] : 0)
  }
  const exclude = Math.floor(o.peakSeparationMs / bin)
  const peaks = []
  for (let n = 0; n < o.peaksPerRatio; n++) {
    let bestK = -1, bestV = 0
    for (let k = 0; k < size; k++) {
      if (smooth[k] > bestV) { bestV = smooth[k]; bestK = k }
    }
    if (bestK < 0) break
    peaks.push(bestK * bin - max)
    const from = Math.max(0, bestK - exclude), to = Math.min(size - 1, bestK + exclude)
    for (let k = from; k <= to; k++) smooth[k] = 0
  }
  return peaks
}

/** Is candidate [a] ranked above [b]: higher score, then ratio closer to 1, then smaller |offset|. */
function better(a, b) {
  if (a.score !== b.score) return a.score > b.score
  const ra = Math.abs(a.ratio - 1), rb = Math.abs(b.ratio - 1)
  if (ra !== rb) return ra < rb
  return Math.abs(a.offset) < Math.abs(b.offset)
}

/**
 * Align [targetCues] to [refCues]. opts merges over DEFAULTS (opts.ratios replaces RATIOS). Returns
 * { ok, ratio, offset, score, baseline, runnerUp, confidence, identity, refCount, targetCount, reason }, or
 * { ok: false, reason, confidence: 'none' } when there is nothing to go on.
 */
export function align(refCues, targetCues, opts) {
  const o = Object.assign({}, DEFAULTS)
  let ratios = RATIOS
  if (opts) {
    for (const key of Object.keys(opts)) {
      if (key === 'ratios') ratios = opts.ratios
      else o[key] = opts[key]
    }
  }
  const R = prepareCues(refCues)
  const T = prepareCues(targetCues)
  if (R.length < o.minCues || T.length < o.minCues) return { ok: false, reason: 'too few cues', confidence: 'none' }

  const win = { from: R[0].start - o.padMs, to: R[R.length - 1].end + o.padMs }
  const needed = Math.max(o.minCues, Math.floor(0.5 * R.length))
  const base = overlapScore(R, T, 1, 0, win)
  const baseline = base.count >= needed ? base.score : 0

  const refined = []
  for (const ratio of ratios) {
    const peaks = coarseOffsets(R, T, ratio, o)
    for (const coarse of peaks) {
      let best = null
      for (let off = coarse - o.refineSpanMs; off <= coarse + o.refineSpanMs; off += o.refineStepMs) {
        const r = overlapScore(R, T, ratio, off, win)
        if (r.count < needed) continue
        if (!best || r.score > best.score ||
            (r.score === best.score && Math.abs(off - coarse) < Math.abs(best.offset - coarse))) {
          best = { ratio, offset: off, score: r.score }
        }
      }
      if (best) refined.push(best)
    }
  }
  if (!refined.length) return { ok: false, reason: 'no valid candidate', confidence: 'none' }

  let best = refined[0]
  for (const c of refined) if (better(c, best)) best = c
  // equivalent = within peakSeparationMs of [best] at both ends of the reference window (the mappings are linear)
  const equivalent = (c, b) => {
    const tFrom = (win.from - b.offset) / b.ratio, tTo = (win.to - b.offset) / b.ratio
    return Math.abs((c.ratio * tFrom + c.offset) - (b.ratio * tFrom + b.offset)) < o.peakSeparationMs &&
      Math.abs((c.ratio * tTo + c.offset) - (b.ratio * tTo + b.offset)) < o.peakSeparationMs
  }
  if (best.ratio !== 1) {
    let simple = null
    for (const c of refined) {
      if (c.ratio === 1 && equivalent(c, best) && c.score >= best.score - 0.02 && (!simple || c.score > simple.score)) simple = c
    }
    if (simple) best = simple
  }
  let runnerUp = 0
  for (const c of refined) {
    if (!equivalent(c, best) && c.score > runnerUp) runnerUp = c.score
  }
  const margin = best.score - runnerUp
  let confidence = 'none'
  if (best.score >= o.highScore && margin >= o.highMargin) confidence = 'high'
  else if (best.score >= o.lowScore && margin >= o.lowMargin) confidence = 'low'

  const offset = Math.round(best.offset)
  return {
    ok: confidence !== 'none',
    ratio: best.ratio,
    offset,
    score: best.score,
    baseline,
    runnerUp,
    confidence,
    identity: best.ratio === 1 && Math.abs(offset) < o.identityMs,
    span: R[R.length - 1].end - R[0].start,
    refCount: R.length,
    targetCount: T.length,
    reason: '',
  }
}

/** A new cue list moved by [transform] = { ratio, offset }: other fields carried, start clamped at 0, cues ending at or before 0 dropped. */
export function applyTransform(cues, transform) {
  const out = []
  for (const cue of cues) {
    const c = Object.assign({}, cue)
    c.start = Math.round(cue.start * transform.ratio + transform.offset)
    c.end = Math.round(cue.end * transform.ratio + transform.offset)
    c.start = Math.max(0, c.start)
    if (c.end <= 0) continue
    out.push(c)
  }
  return out
}

/** One time moved by [transform] = { ratio, offset }. */
export function mapTime(ms, transform) {
  return Math.round(ms * transform.ratio + transform.offset)
}

// ---------------------------------------------------------------------------------------------------------------------
// Piecewise alignment: the same idea, but the offset may change between segments (a cut or an inserted scene).

/** Tunables of alignPiecewise (milliseconds except the counts, the penalty and the 0..1 gains). */
export const PIECEWISE = {
  maxOffsetMs: 600000,
  binMs: 100,
  minCues: 15,
  padMs: 5000,
  states: 10,
  stateSeparationMs: 1000,
  switchPenalty: 2.0,
  minSegmentCues: 8,
  refineSpanMs: 600,
  refineStepMs: 10,
  highGain: 0.30,
  lowGain: 0.18,
  minNormalized: 0.5,
  identityMs: 100,
  minSegmentNormalized: 0.5,
  skipPenalty: 1.0,
  monotoneTolMs: 2000,
}

/** How much of [a, b] lies inside the reference union. */
function overlapOne(R, a, b) {
  let covered = 0
  for (let k = lowerBoundEnd(R, a); k < R.length && R[k].start < b; k++) {
    const lo = R[k].start > a ? R[k].start : a
    const hi = R[k].end < b ? R[k].end : b
    if (hi > lo) covered += hi - lo
  }
  return covered
}

/** One ratio: candidate offsets from the votes, a Viterbi path over them (with SKIP), merged, overlap-resolved and refined segments. */
function solve(R, T, r, win, o) {
  const offsets = coarseOffsets(R, T, r, { maxOffsetMs: o.maxOffsetMs, binMs: o.binMs, peaksPerRatio: o.states, peakSeparationMs: o.stateSeparationMs })
  if (!offsets.length) return { ratio: r, valid: false, normalized: 0, segments: [], score: 0, count: 0, skipped: 0, drops: [] }
  const K = offsets.length, n = T.length, S = K + 1 // state K is SKIP
  let sum = 0
  for (let i = 0; i < R.length; i++) sum += R[i].end - R[i].start
  const d = sum / (win.to - win.from)
  const gain = new Float64Array(n * K)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < K; k++) {
      const a = T[i].start * r + offsets[k], b = T[i].end * r + offsets[k]
      gain[i * K + k] = (a < win.from || b > win.to) ? 0 : overlapOne(R, a, b) / (b - a) - d
    }
  }
  // Viterbi over the offset states and SKIP
  const dp = new Float64Array(n * S)
  const back = new Int32Array(n * S)
  for (let k = 0; k < K; k++) { dp[k] = gain[k]; back[k] = -1 }
  dp[K] = 0; back[K] = -1
  for (let i = 1; i < n; i++) {
    const p = (i - 1) * S, c = i * S
    for (let k = 0; k < S; k++) {
      let bestJ = -1, bestV = -Infinity
      for (let j = 0; j < S; j++) {
        let v = dp[p + j]
        if (j !== k) v -= (k === K || j === K) ? o.skipPenalty : o.switchPenalty
        if (v > bestV) { bestV = v; bestJ = j }
      }
      dp[c + k] = bestV + (k < K ? gain[i * K + k] : 0)
      back[c + k] = bestJ
    }
  }
  const path = new Int32Array(n)
  let last = 0
  for (let k = 1; k < S; k++) if (dp[(n - 1) * S + k] > dp[(n - 1) * S + last]) last = k
  for (let i = n - 1; i >= 0; i--) {
    path[i] = last
    last = back[i * S + last]
  }
  // segments = runs of one offset state, SKIP intervals belonging to none
  const dropped = new Uint8Array(n)
  let skipped = 0
  let segs = []
  for (let i = 0; i < n; i++) {
    if (path[i] === K) { skipped++; continue }
    if (segs.length && segs[segs.length - 1].state === path[i]) segs[segs.length - 1].items.push(i)
    else segs.push({ state: path[i], items: [i] })
  }
  const mergeShort = () => {
    for (;;) {
      if (segs.length < 2) break
      let pick = -1
      for (let s = 0; s < segs.length; s++) {
        if (segs[s].items.length < o.minSegmentCues && (pick < 0 || segs[s].items.length < segs[pick].items.length)) pick = s
      }
      if (pick < 0) break
      const seg = segs[pick]
      const sumFor = (state) => { let t = 0; for (const i of seg.items) t += gain[i * K + state]; return t }
      if (pick === 0) seg.state = segs[1].state
      else if (pick === segs.length - 1) seg.state = segs[pick - 1].state
      else seg.state = sumFor(segs[pick + 1].state) > sumFor(segs[pick - 1].state) ? segs[pick + 1].state : segs[pick - 1].state
      joinSame()
    }
  }
  const joinSame = () => {
    const joined = []
    for (const seg of segs) {
      const prev = joined[joined.length - 1]
      if (prev && prev.state === seg.state) prev.items = prev.items.concat(seg.items)
      else joined.push(seg)
    }
    segs = joined
  }
  mergeShort()
  // overlap resolution: of two consecutive segments claiming the same stretch of the reference, the better match keeps it
  const rate = (items, off) => {
    let covered = 0, total = 0
    for (const i of items) {
      const a = T[i].start * r + off, b = T[i].end * r + off
      total += b - a
      covered += overlapOne(R, a, b)
    }
    return items.length ? covered / total : -1
  }
  const segNormalized = (seg) => {
    let covered = 0, total = 0
    const off = offsets[seg.state]
    for (const i of seg.items) {
      const x = T[i].start * r + off, y = T[i].end * r + off
      if (x < win.from || y > win.to) continue
      total += y - x
      covered += overlapOne(R, x, y)
    }
    return total > 0 && d < 1 ? (covered / total - d) / (1 - d) : -1
  }
  for (let round = 0; round < 20; round++) {
    let changed = false
    for (let s = 0; s + 1 < segs.length; s++) {
      const A = segs[s], B = segs[s + 1]
      if (!A.items.length || !B.items.length) continue
      const oa = offsets[A.state], ob = offsets[B.state]
      const E = T[A.items[A.items.length - 1]].end * r + oa
      const Sx = T[B.items[0]].start * r + ob
      if (Sx >= E - o.monotoneTolMs) continue
      const tailA = A.items.filter(i => T[i].start * r + oa >= Sx)
      const headB = B.items.filter(i => T[i].end * r + ob <= E)
      const loser = rate(tailA, oa) < rate(headB, ob) ? A : B
      const lose = loser === A ? tailA : headB
      if (!lose.length) continue
      for (const i of lose) dropped[i] = 1
      loser.items = loser.items.filter(i => !dropped[i])
      changed = true
    }
    if (changed) {
      segs = segs.filter(seg => seg.items.length > 0)
      joinSame()
      mergeShort()
    }
    // a segment whose own normalised match is too low is treated as unmatched
    const q = segs.map(segNormalized)
    const weak = q.map(v => v < o.minSegmentNormalized)
    if (weak.some(Boolean)) {
      let keep = -1
      if (weak.every(Boolean)) { keep = 0; for (let s = 1; s < q.length; s++) if (q[s] > q[keep]) keep = s }
      let any = false
      for (let s = 0; s < segs.length; s++) {
        if (weak[s] && s !== keep) { segs[s].items = []; any = true }
      }
      if (any) {
        changed = true
        segs = segs.filter(seg => seg.items.length > 0)
        joinSame()
        mergeShort()
      }
    }
    if (!changed) break
  }
  if (!segs.length) return { ratio: r, valid: false, normalized: 0, segments: [], score: 0, count: 0, skipped, drops: [] }
  // refine each segment on its matched intervals
  const out = []
  for (let s = 0; s < segs.length; s++) {
    const base = offsets[segs[s].state]
    let bestOff = base, bestScore = -1
    for (let off = base - o.refineSpanMs; off <= base + o.refineSpanMs; off += o.refineStepMs) {
      let covered = 0, total = 0
      for (const i of segs[s].items) {
        const a = T[i].start * r + off, b = T[i].end * r + off
        if (a < win.from || b > win.to) continue
        total += b - a
        covered += overlapOne(R, a, b)
      }
      if (total <= 0) continue
      const sc = covered / total
      if (sc > bestScore || (sc === bestScore && Math.abs(off - base) < Math.abs(bestOff - base))) { bestScore = sc; bestOff = off }
    }
    out.push({ from: s === 0 ? 0 : T[segs[s].items[0]].start, offset: Math.round(bestOff), items: segs[s].items })
  }
  let covered = 0, total = 0, count = 0
  for (const seg of out) {
    for (const i of seg.items) {
      const a = T[i].start * r + seg.offset, b = T[i].end * r + seg.offset
      if (a < win.from || b > win.to) continue
      count++
      total += b - a
      covered += overlapOne(R, a, b)
    }
  }
  const score = total > 0 ? covered / total : 0
  const normalized = d < 1 ? (score - d) / (1 - d) : 0
  const valid = count >= Math.max(o.minCues, Math.floor(0.5 * R.length))
  const drops = []
  for (let i = 0; i < n; i++) {
    if (!dropped[i]) continue
    if (i > 0 && dropped[i - 1]) drops[drops.length - 1].to = T[i].end
    else drops.push({ from: T[i].start, to: T[i].end })
  }
  let matched = 0
  for (const seg of out) matched += seg.items.length
  return { ratio: r, valid, normalized, score, count, skipped: n - matched, drops, segments: out.map(x => ({ from: x.from, offset: x.offset })) }
}

/**
 * Piecewise alignment of [targetCues] to [refCues]: { ok, ratio, segments: [{ from, offset }], score, normalized, decoy,
 * gain, density, confidence, identity, refCount, targetCount, span, reason }. opts merges over PIECEWISE; opts.ratios replaces
 * RATIOS; opts.hintRatio (a number) is added to the ratio list when it is not already in it.
 */
export function alignPiecewise(refCues, targetCues, opts) {
  const o = Object.assign({}, PIECEWISE)
  let ratios = RATIOS.slice()
  let hint = null
  if (opts) {
    for (const key of Object.keys(opts)) {
      if (key === 'ratios') ratios = opts.ratios.slice()
      else if (key === 'hintRatio') hint = opts.hintRatio
      else o[key] = opts[key]
    }
  }
  if (typeof hint === 'number' && isFinite(hint) && !ratios.some(x => Math.abs(x - hint) <= 0.0005)) ratios.push(hint)
  const R = prepareCues(refCues)
  const T = prepareCues(targetCues)
  if (R.length < o.minCues || T.length < o.minCues) return { ok: false, reason: 'too few cues', confidence: 'none' }
  const win = { from: R[0].start - o.padMs, to: R[R.length - 1].end + o.padMs }
  let sum = 0
  for (let i = 0; i < R.length; i++) sum += R[i].end - R[i].start
  const density = sum / (win.to - win.from)

  let best = null
  for (const r of ratios) {
    const s = solve(R, T, r, win, o)
    if (!s.valid) continue
    if (!best || s.normalized > best.normalized ||
        (s.normalized === best.normalized && (Math.abs(s.ratio - 1) < Math.abs(best.ratio - 1) ||
          (Math.abs(s.ratio - 1) === Math.abs(best.ratio - 1) && s.segments.length < best.segments.length)))) best = s
  }
  if (!best) return { ok: false, reason: 'no valid candidate', confidence: 'none' }

  const Rd = stableSort(R.map(c => ({ start: win.from + win.to - c.end, end: win.from + win.to - c.start })), (a, b) => a.start - b.start)
  let decoy = 0
  for (const r of ratios) {
    const s = solve(Rd, T, r, win, o)
    if (s.valid && s.normalized > decoy) decoy = s.normalized
  }
  const gain = best.normalized - decoy
  let confidence = 'none'
  if (gain >= o.highGain && best.normalized >= o.minNormalized) confidence = 'high'
  else if (gain >= o.lowGain) confidence = 'low'
  return {
    ok: confidence !== 'none',
    ratio: best.ratio,
    segments: best.segments,
    score: best.score,
    normalized: best.normalized,
    decoy,
    gain,
    density,
    confidence,
    identity: best.ratio === 1 && best.segments.length === 1 && Math.abs(best.segments[0].offset) < o.identityMs,
    refCount: R.length,
    targetCount: T.length,
    span: R[R.length - 1].end - R[0].start,
    skipped: best.skipped,
    drops: best.drops,
    reason: '',
  }
}

/** The offset of the last segment whose from <= [ms] (the first segment for earlier times). */
function segmentIndex(ms, result) {
  let at = 0
  for (let i = 0; i < result.segments.length; i++) {
    if (result.segments[i].from <= ms) at = i
    else break
  }
  return at
}

function segmentOffset(ms, result) {
  return result.segments[segmentIndex(ms, result)].offset
}

/** A new cue list moved by a piecewise [result]: each cue by its segment, other fields carried, start clamped at 0, cues ending at or before 0 dropped. */
export function applySegments(cues, result) {
  const out = []
  for (const cue of cues) {
    if (result.drops && result.drops.some(x => cue.start >= x.from && cue.start <= x.to)) continue
    const si = segmentIndex(cue.start, result)
    const offset = result.segments[si].offset
    if (si + 1 < result.segments.length && Math.round(cue.start * result.ratio + offset) >= segmentMapTime(result.segments[si + 1].from, result)) continue
    const c = Object.assign({}, cue)
    c.start = Math.max(0, Math.round(cue.start * result.ratio + offset))
    c.end = Math.round(cue.end * result.ratio + offset)
    if (c.end <= 0) continue
    out.push(c)
  }
  return out
}

/** One time moved by a piecewise [result]. */
export function segmentMapTime(ms, result) {
  return Math.round(ms * result.ratio + segmentOffset(ms, result))
}

// ---------------------------------------------------------------------------------------------------------------------
// Linear alignment with a decoy check: the score is compared with the same alignment against a mirrored reference.

/** Gain thresholds of alignChecked. highGain 0.40 sits above every cross-title pair measured on the 2026-11-24 corpus (max 0.300); only 'high' is ever applied automatically. */
export const CHECKED = { highGain: 0.40, lowGain: 0.30 }

/** The window and the density of the prepared reference [R], as alignPiecewise defines them. */
function windowAndDensity(R) {
  const win = { from: R[0].start - PIECEWISE.padMs, to: R[R.length - 1].end + PIECEWISE.padMs }
  let sum = 0
  for (let i = 0; i < R.length; i++) sum += R[i].end - R[i].start
  return { win, density: sum / (win.to - win.from) }
}

/**
 * align plus a decoy check: the result of align with { density, normalized, decoy, gain, checked } added. normalized is the
 * score above chance (score - density) / (1 - density); decoy is the same for the reference mirrored inside the window;
 * gain = normalized - decoy; checked is 'high', 'low' or 'none' by CHECKED.
 */
export function alignChecked(refCues, targetCues, opts) {
  const r = align(refCues, targetCues, opts)
  const R = prepareCues(refCues)
  const minCues = (opts && opts.minCues) || DEFAULTS.minCues
  if (R.length < minCues) return Object.assign({}, r, { density: 0, normalized: 0, decoy: 0, gain: 0, checked: 'none' })
  const wd = windowAndDensity(R)
  const d = wd.density
  const mirrored = stableSort(R.map(c => ({ start: wd.win.from + wd.win.to - c.end, end: wd.win.from + wd.win.to - c.start })), (a, b) => a.start - b.start)
  const rd = align(mirrored, targetCues, opts)
  const norm = (x) => (x && typeof x.score === 'number' && d < 1) ? Math.max(0, (x.score - d) / (1 - d)) : 0
  const normalized = norm(r)
  const decoy = norm(rd)
  const gain = normalized - decoy
  const has = typeof r.ratio === 'number' && typeof r.offset === 'number'
  const checked = has && gain >= CHECKED.highGain ? 'high' : has && gain >= CHECKED.lowGain ? 'low' : 'none'
  return Object.assign({}, r, { density: d, normalized, decoy, gain, checked })
}

/** [candidates] = [{ id, cues }]: a new list [{ id, result }] of their alignChecked results, best gain first (ties keep the input order). */
export function pickBest(refCues, candidates, opts) {
  const list = candidates.map(c => ({ id: c.id, result: alignChecked(refCues, c.cues, opts) }))
  return stableSort(list, (a, b) => b.result.gain - a.result.gain)
}
