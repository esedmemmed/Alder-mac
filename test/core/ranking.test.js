import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRanker, createSourceMemory, preferenceScore, readyStreams, sourceRow, TRY, presetName } from '../../src/core/ranking.js'
import { createSettings } from '../../src/core/settings.js'
import { KEYS } from '../../src/core/keys.js'
import { fakeHttp, fixtureAddons, memoryStore, settingsStub, stream, tv } from './helpers.js'

const GB = 1024 ** 3
const names = list => list.map(s => s.filename)
const ranker = (over = {}) => createRanker(Object.assign({ settings: settingsStub(), device: tv(), memory: null, videoId: 'tt1', metaId: 'tt1' }, over))

// ---- readyStreams ----
test('readyStreams: add-on order, stopping at the first add-on that has not answered unless gaps are allowed', () => {
  const a = stream('a.mkv'), b = stream('b.mkv'), c = stream('c.mkv')
  assert.deepEqual(readyStreams([[a], null, [c]], false), [a])
  assert.deepEqual(readyStreams([[a], null, [c]], true), [a, c])
  assert.deepEqual(readyStreams([null, [b], [c]], false), [])
  assert.deepEqual(readyStreams([null, [b], [c]], true), [b, c])
  assert.deepEqual(readyStreams([[a], [], [b, c]], false), [a, b, c]) // an empty answer is an answer
  assert.deepEqual(readyStreams([], false), [])
  assert.deepEqual(readyStreams([null], true), [])
})

// ---- rank ----
test('rank: ties keep the add-on\'s order (stable, also past 10 items)', () => {
  const list = Array.from({ length: 40 }, (_, i) => stream(`Movie.2024.1080p.WEB-DL.DDP5.1.H.264-GRP${i}.mkv`))
  assert.deepEqual(names(ranker().rank(list)), names(list))
  const mixed = list.map((s, i) => (i % 2 ? stream(`Movie.2024.1080p.WEB-DL.DDP5.1.H.264-ODD${i}.mkv`, { bingeGroup: 'b' }) : s))
  const ranked = ranker().rank(mixed)
  assert.equal(ranked.length, 40)
  assert.deepEqual(names(ranked.filter(s => s.bingeGroup === null)), names(mixed.filter(s => s.bingeGroup === null)))
})

test('rank: the file played last time, then the release the previous episode used, lead everything but a lower-quality request', () => {
  const store = memoryStore()
  const memory = createSourceMemory(store)
  const a = stream('A.1080p.WEB-DL.DDP5.1.mkv', { bingeGroup: 'g1' })
  const b = stream('B.720p.WEB-DL.DDP5.1.mkv', { bingeGroup: 'g2' })
  const c = stream('C.2160p.WEB-DL.DDP5.1.HDR.mkv', { bingeGroup: 'g3' })
  assert.deepEqual(names(ranker({ memory }).rank([a, b, c])), names([a, b, c]))
  store.set(KEYS.sourceBinge('tt1'), 'g3')
  assert.deepEqual(names(ranker({ memory }).rank([a, b, c])), names([c, a, b]))
  store.set(KEYS.sourceFile('tt1'), 'B.720p.WEB-DL.DDP5.1.mkv')
  assert.deepEqual(names(ranker({ memory }).rank([a, b, c])), names([b, c, a])) // the file beats the binge group
  // the player asked for less: the tallest first, even over the remembered file
  assert.deepEqual(names(ranker({ memory, maxHeight: 1080 }).rank([a, b, c])), names([c, a, b]))
})

test('rank: 3D and hard subtitles go last; then streams that need headers; then fit', () => {
  const plain = stream('P.1080p.WEB-DL.DDP5.1.mkv')
  const threeD = stream('T.3D.1080p.BluRay.DD5.1.mkv')
  const hard = stream('H.1080p.WEBRip.HC.AAC.mkv')
  const headers = stream('R.1080p.WEB-DL.DDP5.1.mkv', { headers: { Referer: 'x' } })
  const ua = stream('U.1080p.WEB-DL.DDP5.1.mkv', { headers: { 'User-Agent': 'x' } })
  assert.deepEqual(names(ranker().rank([threeD, hard, headers, ua, plain])), names([ua, plain, headers, threeD, hard]))
  // 3D and hard subs are the last resort even when they have no header trouble
  assert.deepEqual(names(ranker().rank([threeD, headers])), names([headers, threeD]))
})

test('rank: nothing above the screen, HDR only on an HDR screen (fit), before audio and preferences', () => {
  const uhdHdr = stream('Movie.2160p.WEB-DL.DDP5.1.HDR.x265.mkv')
  const hd = stream('Movie.1080p.WEB-DL.DDP5.1.mkv')
  const hdScreen = tv({ height: 1080, hdr: false })
  assert.deepEqual(names(ranker({ device: hdScreen }).rank([uhdHdr, hd])), names([hd, uhdHdr])) // 4K HDR first by order, but it does not fit
  assert.deepEqual(names(ranker().rank([uhdHdr, hd])), names([uhdHdr, hd])) // on the 4K HDR TU8000 add-on order stays (fit equal)
  // fit before audio: a stream that fits beats a better-sounding one that does not
  const quiet = stream('Movie.1080p.WEB-DL.x264.mkv')
  const loud = stream('Movie.2160p.WEB-DL.DDP5.1.x265.mkv')
  assert.deepEqual(names(ranker({ device: hdScreen }).rank([loud, quiet])), names([quiet, loud]))
})

test('rank (added for Tizen): the audio key sits after fit and before the Settings preference', () => {
  const bad = stream('Movie.1080p.BluRay.REMUX.DTS-HD.MA.5.1.mkv')
  const mixed = stream('Movie.1080p.BluRay.MULTi.DTS.AC3.mkv')
  const unknown = stream('Movie.1080p.WEB-DL.x264.mkv')
  const good = stream('Movie.1080p.WEB-DL.DD5.1.x264.mkv')
  assert.deepEqual(names(ranker().rank([bad, mixed, unknown, good])), names([good, mixed, unknown, bad]))
  // after fit: a worse-fitting good stream cannot jump a better-fitting bad one
  const hdScreen = tv({ height: 1080 })
  const tall = stream('Movie.2160p.WEB-DL.DDP5.1.mkv')
  assert.deepEqual(names(ranker({ device: hdScreen }).rank([tall, bad])), names([bad, tall]))
  // before the preference: the REMUX preference no longer lifts a no-sound release over a playable one
  const settings = settingsStub({ release: () => 'remux' })
  assert.deepEqual(names(ranker({ settings }).rank([good, bad])), names([good, bad]))
  // and among equal audio the preference still decides
  const remuxGood = stream('Movie.1080p.BluRay.REMUX.AC3.mkv')
  assert.deepEqual(names(ranker({ settings }).rank([good, remuxGood])), names([remuxGood, good]))
})

// ---- preference ----
test('preferenceScore: Alder\'s numbers for release, HDR and dub preferences', () => {
  const remux = stream('Movie.2160p.BluRay.REMUX.DV.HDR.mkv')
  const bluray = stream('Movie.1080p.BluRay.x264.mkv')
  const web = stream('Movie.1080p.WEB-DL.x264.mkv')
  const dv = stream('Movie.2160p.WEB-DL.DV.HDR.mkv')
  const hdr = stream('Movie.2160p.WEB-DL.HDR10.mkv')
  const plain = stream('Movie.1080p.x264.mkv')
  const score = (over, s) => preferenceScore(settingsStub(over))(s)
  assert.deepEqual([remux, bluray, web, plain].map(s => score({ release: () => 'remux' }, s)), [3, 1, 0, 0])
  assert.deepEqual([remux, bluray, web, plain].map(s => score({ release: () => 'encode' }, s)), [-2, 2, 2, 0])
  assert.deepEqual([remux, bluray, web, plain].map(s => score({ release: () => 'web' }, s)), [-2, 0, 2, 0])
  assert.deepEqual([dv, hdr, plain].map(s => score({ hdrPref: () => 'dv' }, s)), [2, 1, 0])
  assert.deepEqual([dv, hdr, plain].map(s => score({ hdrPref: () => 'hdr10' }, s)), [2, 2, 0])
  assert.deepEqual([dv, hdr, plain].map(s => score({ hdrPref: () => '' }, s)), [0, 0, 0])
  const hindi = stream('Movie.1080p.Hindi.DUB.mkv')
  const multi = stream('Movie.1080p.MULTi.mkv')
  assert.deepEqual([hindi, multi, plain].map(s => score({ dub: () => 'original' }, s)), [-2, 0, 0])
  assert.deepEqual([hindi, multi, plain].map(s => score({ dub: () => 'mine', audioLanguage: () => 'hi' }, s)), [2, 1, 0])
  assert.deepEqual([hindi, multi, plain].map(s => score({ dub: () => 'mine', audioLanguage: () => 'en' }, s)), [0, 1, 0])
  // sums
  assert.equal(score({ release: () => 'remux', hdrPref: () => 'dv' }, remux), 5)
})

test('preferenceScore: "No preference" scores 0 for everything (TV speakers, nothing set)', () => {
  const score = preferenceScore(settingsStub())
  for (const n of ['Movie.2160p.BluRay.REMUX.DV.Atmos', 'Movie.Hindi.DUB', 'Movie.WEB-DL']) assert.equal(score(stream(n)), 0)
})

// ---- wanted ----
test('wanted: within Settings\' limits, never a cam; unknown sizes and resolutions pass', () => {
  const w = (over, s) => ranker({ settings: settingsStub(over) }).wanted(s)
  assert.equal(w({}, stream('Movie.2160p.WEB-DL.mkv')), true)
  assert.equal(w({ maxHeight: () => 1080 }, stream('Movie.2160p.WEB-DL.mkv')), false)
  assert.equal(w({ maxHeight: () => 1080 }, stream('Movie.1080p.WEB-DL.mkv')), true)
  assert.equal(w({ maxHeight: () => 1080 }, stream('Movie.WEB-DL.mkv')), true) // unknown resolution passes
  assert.equal(w({ maxSizeGb: () => 10 }, stream('Movie.1080p.mkv', { size: 12 * GB })), false)
  assert.equal(w({ maxSizeGb: () => 10 }, stream('Movie.1080p.mkv', { size: 10 * GB })), true)
  assert.equal(w({ maxSizeGb: () => 10 }, stream('Movie.1080p.mkv', { size: 0 })), true) // unknown size passes
  assert.equal(w({ hdr: () => false }, stream('Movie.2160p.HDR.mkv')), false)
  assert.equal(w({ hdr: () => false }, stream('Movie.2160p.DV.mkv')), false)
  assert.equal(w({ hdr: () => false }, stream('Movie.1080p.mkv')), true)
  assert.equal(w({}, stream('Movie.2024.HDCAM.x264.mkv')), false)
  assert.equal(w({}, stream('Movie.2024.TELESYNC.mkv')), false)
})

test('wanted: the player asking for a lower quality overrides Settings\' highest quality', () => {
  const lower = ranker({ settings: settingsStub({ maxHeight: () => 2160 }), maxHeight: 720 })
  assert.equal(lower.wanted(stream('Movie.1080p.mkv')), false)
  assert.equal(lower.wanted(stream('Movie.720p.mkv')), true)
  const same = ranker({ settings: settingsStub({ maxHeight: () => 720 }), maxHeight: 0 })
  assert.equal(same.wanted(stream('Movie.1080p.mkv')), false)
})

// ---- auto-play and the Sources list ----
test('autoCandidates: real videos this TV decodes, within limits, never "No sound on this TV"', () => {
  const r = ranker()
  const list = [
    stream('Movie.1080p.BluRay.DTS-HD.MA.5.1.mkv'), // bad audio
    stream('Movie.2160p.AV1.Opus.mkv'), // not decodable
    stream('mark-watched.mp4', { size: 27 * 1024 }), // an add-on action
    stream('Movie.HDCAM.AAC.mkv'), // cam
    stream('Movie.2160p.DV.H.265.mkv'), // DV profile 5
    stream('Movie.1080p.WEB-DL.DDP5.1.mkv'),
    stream('Movie.1080p.MULTi.DTS.AC3.mkv'),
    stream('Movie.720p.WEB.x264.mkv'),
  ]
  assert.deepEqual(names(r.autoCandidates(list)), ['Movie.1080p.WEB-DL.DDP5.1.mkv', 'Movie.1080p.MULTi.DTS.AC3.mkv', 'Movie.720p.WEB.x264.mkv'])
  assert.deepEqual(r.autoCandidates([stream('Movie.1080p.DTS.mkv')]), [])
  assert.equal(TRY, 3)
})

test('listModel: BEST MATCH is the first wanted source with sound; no-sound ones come last but stay selectable', () => {
  const settings = settingsStub({ maxHeight: () => 1080 })
  const r = ranker({ settings })
  const entries = [
    { stream: stream('Movie.1080p.BluRay.REMUX.TrueHD.Atmos.mkv'), addon: 'A' }, // wanted but no sound
    { stream: stream('Movie.2160p.WEB-DL.DDP5.1.HDR.mkv'), addon: 'B' }, // above the limit: not wanted
    { stream: stream('Movie.1080p.WEB-DL.DDP5.1.x264.mkv'), addon: 'B' }, // best
    { stream: stream('Movie.HDCAM.AAC.mkv'), addon: 'C' }, // cam: not wanted
    { stream: stream('Movie.720p.DTS.mkv'), addon: 'C' }, // wanted but no sound
    { stream: stream('mark-watched.mp4', { size: 1000 }), addon: 'C' }, // not a video: not listed
  ]
  const model = r.listModel(entries)
  assert.equal(model.count, 5)
  assert.equal(model.best.filename, 'Movie.1080p.WEB-DL.DDP5.1.x264.mkv')
  assert.deepEqual(names(model.streams), [
    'Movie.1080p.WEB-DL.DDP5.1.x264.mkv', // eligible with sound
    'Movie.2160p.WEB-DL.DDP5.1.HDR.mkv', // not wanted
    'Movie.HDCAM.AAC.mkv',
    'Movie.1080p.BluRay.REMUX.TrueHD.Atmos.mkv', // no sound, last, still in rank order
    'Movie.720p.DTS.mkv',
  ])
  assert.deepEqual(model.rows.map(row => row.best), [true, false, false, false, false])
  assert.deepEqual(model.rows[3].warnings, ['No sound on this TV'])
  assert.deepEqual(model.rows[0].warnings, [])
  assert.deepEqual(model.rows.map(row => row.provider), ['B', 'B', 'C', 'A', 'C'])
})

test('listModel: nothing with sound -> no BEST MATCH, the list is still there', () => {
  const model = ranker().listModel([{ stream: stream('Movie.1080p.DTS.mkv'), addon: 'A' }, { stream: stream('Movie.2160p.TrueHD.mkv'), addon: 'A' }])
  assert.equal(model.best, null)
  assert.equal(model.count, 2)
  assert.deepEqual(model.rows.map(row => row.warnings), [['No sound on this TV'], ['No sound on this TV']])
  assert.deepEqual(ranker().listModel([]).rows, [])
})

test('sourceRow: quality, summary, tags (one on the best row, two otherwise), size, dimming', () => {
  const s = stream('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.Atmos.7.1-GRP.mkv', { size: 68300000000, title: '[TB+] Torrentio\n4k' })
  const best = sourceRow(s, 'Torrentio', true, tv())
  assert.equal(best.quality, '2160p')
  assert.equal(best.size, '68.3 GB')
  assert.deepEqual(best.tags, ['REMUX'])
  assert.equal(best.provider, 'Torrentio')
  const other = sourceRow(s, 'Torrentio', false, tv())
  assert.deepEqual(other.tags, ['REMUX', 'DV'])
  assert.equal(other.dim, false)
  const low = sourceRow(stream('Movie.480p.WEB.mkv', { size: 0 }), 'X', false, tv())
  assert.equal(low.dim, true)
  assert.equal(low.size, '—')
  assert.equal(sourceRow(stream('Movie.mkv'), 'X', false, tv()).quality, 'Auto')
  assert.equal(sourceRow(stream('Movie.mkv'), 'X', false, tv()).dim, false)
  const risky = sourceRow(stream('Movie.1080p.mkv', { headers: { Referer: 'r' } }), 'X', false, tv())
  assert.deepEqual(risky.warnings, ['May not play'])
})

// ---- the demo fixtures end to end ----
test('fixtures: the 20 streams of the demo movie rank sensibly on a TU8000', async () => {
  const http = fakeHttp()
  const addons = fixtureAddons(http)
  const entries = []
  for (const a of addons.filter(x => x.serves('stream', 'movie', 'tt15239678'))) {
    for (const s of await a.streams('movie', 'tt15239678')) entries.push({ stream: s, addon: a.name })
  }
  assert.equal(entries.length, 20)
  const store = memoryStore()
  const settings = createSettings({ store, activeProfileId: () => '1' })
  const r = createRanker({ settings, device: tv(), memory: createSourceMemory(store), videoId: 'tt15239678', metaId: 'tt15239678' })
  const model = r.listModel(entries)
  // not listed: DV profile 5 (no HDR10 base), AV1, the "Mark Watched" action and the 38 MB sample
  assert.equal(model.count, 16)
  assert.equal(model.best.filename, 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv')
  const tail = model.rows.slice(-3)
  assert.deepEqual(tail.map(row => row.warnings[0]), ['No sound on this TV', 'No sound on this TV', 'No sound on this TV'])
  const auto = r.autoCandidates(entries.map(e => e.stream)).slice(0, TRY)
  assert.deepEqual(names(auto), [
    'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
    'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.Atmos.H.264-FLUX.mkv',
    'Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.x265-NOGRP.mkv',
  ])
  // the multi-audio DTS+AC3 release is playable but not preferred over releases that name only playable sound
  const rows = model.rows.map(row => row.stream.filename)
  assert.ok(rows.indexOf('Dune.Part.Two.2024.MULTi.1080p.BluRay.DTS.AC3.x264-LOST.mkv') > rows.indexOf('Dune.Part.Two.2024.1080p.WEB-DL.DDP5.1.x265-NOGRP.mkv'))
  // "May not play" (Referer header) is behind the plain releases, 3D and hard subs are behind that
  assert.ok(rows.indexOf('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HDR10.H.265-FLUX.mkv') > rows.indexOf('Dune.Part.Two.2024.1080p.WEB-DL.x264-GRP.mkv'))
  assert.ok(rows.indexOf('Dune.Part.Two.2024.3D.1080p.BluRay.Half-SBS.x264.DD5.1-3DHD.mkv') > rows.indexOf('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HDR10.H.265-FLUX.mkv'))
})

test('fixtures: presets change the pick (Balanced and Fast start skip the 24 GB 4K release)', async () => {
  const http = fakeHttp()
  const tio = fixtureAddons(http).find(a => a.name === 'Torrentio')
  const entries = (await tio.streams('movie', 'tt15239678')).map(s => ({ stream: s, addon: 'Torrentio' }))
  const store = memoryStore()
  const settings = createSettings({ store, activeProfileId: () => '1' })
  const pick = () => createRanker({ settings, device: tv(), memory: createSourceMemory(store), videoId: 'v', metaId: 'm' }).listModel(entries).best.filename
  assert.equal(presetName(settings), "Add-on's order")
  assert.match(pick(), /2160p\.WEB-DL\.DDP5\.1\.Atmos\.DV\.HDR/)
  settings.shiftPreset(1) // Best picture
  assert.match(pick(), /2160p\.WEB-DL\.DDP5\.1\.Atmos\.DV\.HDR/)
  settings.shiftPreset(1) // Balanced: files up to 20 GB, encodes first
  assert.match(pick(), /1080p\.WEB-DL\.DDP5\.1\.Atmos\.H\.264/)
  settings.shiftPreset(1) // Fast start: web releases up to 1080p and 10 GB
  assert.match(pick(), /1080p\.WEB-DL\.DDP5\.1\.Atmos\.H\.264/)
  assert.equal(presetName(settings), 'Fast start')
})

// ---- source memory ----
test('createSourceMemory: file per video, binge group per title; a stream without them clears the keys', () => {
  const store = memoryStore()
  const memory = createSourceMemory(store)
  assert.equal(memory.file('v1'), null)
  assert.equal(memory.binge('m1'), null)
  memory.remember('v1', 'm1', stream('A.mkv', { bingeGroup: 'g' }))
  assert.equal(memory.file('v1'), 'A.mkv')
  assert.equal(memory.binge('m1'), 'g')
  assert.equal(store.get('sources/file:v1'), 'A.mkv')
  assert.equal(store.get('sources/binge:m1'), 'g')
  memory.remember('v1', 'm1', new (stream('x').constructor)('t', 'd', 'u', {}, 0, null, null))
  assert.equal(memory.file('v1'), null)
  assert.equal(memory.binge('m1'), null)
})
