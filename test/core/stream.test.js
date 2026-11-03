import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Stream, sourceSize, sourceSummary, providerLabel, runtime } from '../../src/core/addon.js'
import { stream, tv } from './helpers.js'
import { languageName } from '../../src/core/lang.js'

const s = name => stream(name)

// ---- height ----
test('Stream.height: 2160 from "2160", "4K" and "UHD"; then 1080, 720, 576, 480; else 0', () => {
  const h = name => s(name).height
  assert.equal(h('Dune.2024.2160p.WEB-DL.mkv'), 2160)
  assert.equal(h('Dune.2024.4K.HDR.mkv'), 2160)
  assert.equal(h('Dune.2024.4k.mkv'), 2160)
  assert.equal(h('Dune.2024.UHD.BluRay.mkv'), 2160)
  assert.equal(h('Dune.2024.1080p.mkv'), 1080)
  assert.equal(h('Dune.2024.720p.mkv'), 720)
  assert.equal(h('Dune.2024.576p.mkv'), 576)
  assert.equal(h('Dune.2024.480p.mkv'), 480)
  assert.equal(h('Dune.2024.mkv'), 0)
  assert.equal(h('Dune.2024.2160p.upscaled.from.1080p.mkv'), 2160) // the tallest named wins
  assert.equal(h('4Kids.Show.720p.mkv'), 720) // "4kids" is not "4k"
  assert.equal(h('Humvee.mkv'), 0) // "uhd" must be a word
})

test('Stream.height reads the add-on title and description too', () => {
  assert.equal(stream('movie.mkv', { title: 'Torrentio\n4k HDR' }).height, 2160)
  assert.equal(stream(null, { description: '1080p WEB-DL' }).height, 1080)
})

// ---- Dolby Vision / HDR ----
test('Stream.dolbyVision: DV, DoVi, Dolby Vision (any separator), not DVD', () => {
  for (const n of ['Movie.2160p.DV.mkv', 'Movie.DoVi.HDR10', 'Movie.Dolby.Vision.2160p', 'Movie Dolby Vision', 'Movie.DolbyVision.2160p', 'Movie.DOVI.mkv'])
    assert.equal(s(n).dolbyVision, true, n)
  for (const n of ['Movie.DVDRip.XviD', 'Movie.DVD5', 'Movie.2160p.HDR10', 'Advent.2160p']) assert.equal(s(n).dolbyVision, false, n)
})

test('Stream.hdr: HDR, HDR10, HDR10+, P8 and hybrid carry an HDR10 base', () => {
  for (const n of ['Movie.2160p.HDR.mkv', 'Movie.HDR10.mkv', 'Movie.HDR10+.mkv', 'Movie.DV.P8.mkv', 'Movie.Hybrid.2160p', 'Movie.DV.HYBRID'])
    assert.equal(s(n).hdr, true, n)
  for (const n of ['Movie.2160p.DV.mkv', 'Movie.P5.DV.mkv', 'Movie.P80.mkv', 'Movie.1080p.mkv']) assert.equal(s(n).hdr, false, n)
  assert.equal(s('Movie.DV.mkv').isHdr, true) // DV alone still counts as HDR for Settings' HDR switch
  assert.equal(s('Movie.1080p.mkv').isHdr, false)
})

// ---- codecs (private in Kotlin, used by playableOn) ----
test('Stream codecs: HEVC (x265, H.265, h265, x.265, HEVC), AV1; x264 is neither', () => {
  for (const n of ['Movie.x265.mkv', 'Movie.H.265.mkv', 'Movie.h265', 'Movie.x.265', 'Movie.HEVC', 'Movie.H 265'])
    assert.equal(s(n).hevc, true, n)
  for (const n of ['Movie.x264.mkv', 'Movie.H.264', 'Movie.AVC']) assert.equal(s(n).hevc, false, n)
  assert.equal(s('Movie.AV1.Opus').av1, true)
  assert.equal(s('Movie.AV1').av1, true)
  assert.equal(s('Movie.av10').av1, false)
})

// ---- release type ----
test('Stream remux / bluray / web', () => {
  const r = n => ({ remux: s(n).remux, bluray: s(n).bluray, web: s(n).web })
  assert.deepEqual(r('Movie.2160p.UHD.BluRay.REMUX.HEVC'), { remux: true, bluray: false, web: false }) // a remux is not "bluray"
  for (const n of ['Movie.1080p.BluRay.x264', 'Movie.1080p.Blu-Ray.x264', 'Movie.BDRip.x264', 'Movie.BD.Rip', 'Movie.BRRip', 'Movie.1080p.Blu.ray'])
    assert.deepEqual(r(n), { remux: false, bluray: true, web: false }, n)
  for (const n of ['Movie.1080p.WEB-DL.x264', 'Movie.1080p.WEBRip', 'Movie.1080p.WEB.DL', 'Movie.1080p.WEB.h264', 'Movie.WEBDL'])
    assert.deepEqual(r(n), { remux: false, bluray: false, web: true }, n)
  assert.equal(s('Webster.1080p').web, false)
  assert.equal(s('Movie.REMUXED').remux, false) // whole word
})

test('Stream.cam: cinema and screener releases, whole words only', () => {
  for (const n of ['Movie.2024.CAM.x264', 'Movie.HDCAM.x264', 'Movie.CAMRip', 'Movie.TS.x264', 'Movie.HDTS.x264', 'Movie.TELESYNC.720p',
    'Movie.TC.x264', 'Movie.TELECINE', 'Movie.SCR.XviD', 'Movie.SCREENER', 'Movie.DVDSCR'])
    assert.equal(s(n).cam, true, n)
  for (const n of ['Movie.2024.1080p.WEB-DL', 'Cameron.Diaz.Movie.1080p', 'Tsunami.2024.1080p', 'Movie.TV.1080p', 'Scream.1996.1080p', 'Movie.Campaign']) assert.equal(s(n).cam, false, n)
})

test('Stream.awkward: 3D and hard subtitles', () => {
  assert.equal(s('Movie.3D.1080p.BluRay.Half-SBS').awkward, true)
  assert.equal(s('Movie.3d.1080p').awkward, true)
  assert.equal(s('Movie.1080p.WEBRip.HC.KORSUB').awkward, true)
  assert.equal(s('Movie.1080p.Hardcoded.Subs').awkward, true)
  assert.equal(s('Movie.1080p.HARDSUB').awkward, true)
  assert.equal(s('Movie.1080p.HDR.mkv').awkward, false)
  assert.equal(s('Movie.3DHD.1080p').awkward, false) // "3dhd" is not a word boundary after 3d
})

test('Stream.bigAudio / multiAudio / dubbed', () => {
  for (const n of ['Movie.Atmos', 'Movie.TrueHD', 'Movie.DTS-HD.MA', 'Movie.DTSHD', 'Movie.DTS-X', 'Movie.DTSX', 'Movie.DTS.X.7.1']) assert.equal(s(n).bigAudio, true, n)
  for (const n of ['Movie.DD5.1', 'Movie.DTS.x264', 'Movie.AAC']) assert.equal(s(n).bigAudio, false, n)
  for (const n of ['Movie.MULTi.1080p', 'Movie.Dual.Audio', 'Movie DUAL 1080p']) assert.equal(s(n).multiAudio, true, n)
  assert.equal(s('Movie.Multiple.Endings').multiAudio, false)
  for (const n of ['Movie.Hindi.Dubbed', 'Movie.DUB.1080p', 'Movie.dub']) assert.equal(s(n).dubbed, true, n)
  assert.equal(s('Dublin.Murders.S01E01.1080p').dubbed, false)
})

test('Stream.mentions: the language written out in English', () => {
  const x = s('Movie.1080p.Hindi.WEB-DL')
  assert.equal(x.mentions('hi'), true)
  assert.equal(x.mentions('en'), false)
  assert.equal(x.mentions('hin'), true)
  assert.equal(stream('Movie.French.1080p').mentions('fr'), true)
  assert.equal(stream('Movie.1080p').mentions('xx'), false) // unknown: the code itself is 2 letters, too short to count
  assert.equal(stream('Movie.1080p').mentions('', languageName), false)
})

// ---- tags / label / isVideo ----
test('Stream.tags: order and the BluRay/WEB exclusivity', () => {
  assert.deepEqual(s('Movie.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1-GRP').tags, ['REMUX', 'DV', 'HDR', 'Atmos', 'TrueHD'])
  assert.deepEqual(s('Movie.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP').tags, ['BluRay', 'DTS-HD'])
  assert.deepEqual(s('Movie.1080p.WEB-DL.MULTi.DDP5.1').tags, ['WEB', 'Multi audio'])
  assert.deepEqual(s('Movie.3D.1080p.BluRay.Hindi.DUB.HC').tags, ['BluRay', 'Dub', '3D', 'Hard subs'])
  assert.deepEqual(s('Movie').tags, [])
})

test('Stream.label: one line, trailing (quality) set apart', () => {
  assert.equal(stream('f', { title: 'Torrentio (2160p)' }).label, 'Torrentio  ·  2160p')
  assert.equal(stream('f', { title: 'Torrentio\n4k HDR' }).label, 'Torrentio 4k HDR')
  assert.equal(stream('f', { title: '  AIO  \r\n  1080p (WEB)  ' }).label, 'AIO 1080p  ·  WEB')
})

test('Stream.isVideo: add-on actions (small files) are never picked; unknown size counts', () => {
  const sz = n => stream('x', { size: n }).isVideo
  assert.equal(sz(0), true)
  assert.equal(sz(27 * 1024), false)
  assert.equal(sz(50 * 1024 * 1024 - 1), false)
  assert.equal(sz(50 * 1024 * 1024), true)
})

// ---- playableOn / fit ----
test('playableOn: HEVC, AV1 and Dolby Vision against the device', () => {
  const dev = tv() // TU8000: hevc, no av1, no dv, hdr, 2160
  assert.equal(s('Movie.2160p.x265.HDR').playableOn(dev), true)
  assert.equal(s('Movie.1080p.x264').playableOn(dev), true)
  assert.equal(s('Movie.2160p.AV1').playableOn(dev), false)
  assert.equal(s('Movie.2160p.AV1').playableOn(tv({ av1: true })), true)
  assert.equal(s('Movie.2160p.DV.H.265').playableOn(dev), false) // profile 5: purple and green without a DV decoder
  assert.equal(s('Movie.2160p.DV.H.265').playableOn(tv({ dolbyVision: true })), true)
  assert.equal(s('Movie.2160p.DV.HDR.H.265').playableOn(dev), true) // DV with an HDR10 base plays as HDR10
  assert.equal(s('Movie.2160p.DV.P8.H.265').playableOn(dev), true)
  assert.equal(s('Movie.2160p.x265').playableOn(tv({ hevc: false })), false)
})

test('fit: nothing above the screen resolution, HDR only on an HDR screen', () => {
  const uhd = tv()
  const hd = tv({ height: 1080, hdr: false })
  assert.equal(s('Movie.2160p.HDR').fit(uhd), 2)
  assert.equal(s('Movie.1080p').fit(uhd), 2)
  assert.equal(s('Movie.2160p.HDR').fit(hd), -1) // too tall (0) and HDR without a screen for it (-1)
  assert.equal(s('Movie.2160p').fit(hd), 0)
  assert.equal(s('Movie.1080p.HDR').fit(hd), 1)
  assert.equal(s('Movie.1080p').fit(hd), 2)
  assert.equal(s('Movie').fit(hd), 2) // unknown height fits
  assert.equal(s('Movie.1080p.DV.HDR').fit(uhd), 2)
})

// ---- Stream.from / toJson / read ----
test('Stream.from: add-on JSON -> Stream, with Alder\'s fallbacks', () => {
  const a = Stream.from({
    name: 'Torrentio\n4k', title: 'Dune.mkv\n👤 12', url: 'https://x/y.mkv',
    behaviorHints: { videoSize: 123456, filename: 'Dune.mkv', bingeGroup: 'tio|4k', proxyHeaders: { request: { 'User-Agent': 'UA', Referer: 'https://r/' } } },
  })
  assert.equal(a.title, 'Torrentio\n4k')
  assert.equal(a.description, 'Dune.mkv\n👤 12') // `title` is the description when there is none
  assert.equal(a.size, 123456)
  assert.equal(a.filename, 'Dune.mkv')
  assert.equal(a.bingeGroup, 'tio|4k')
  assert.deepEqual(a.headers, { 'User-Agent': 'UA', Referer: 'https://r/' })
  const b = Stream.from({ url: 'https://x/z.mp4', description: 'desc', title: 'ignored' })
  assert.equal(b.description, 'desc')
  assert.equal(b.title, '')
  assert.equal(b.size, 0)
  assert.equal(b.filename, null)
  assert.equal(Stream.from({ infoHash: 'abc' }), null) // torrent-only: needs a streaming server
  assert.equal(Stream.from({ url: '  ' }), null)
  assert.equal(Stream.from({ url: null, name: 'x' }), null)
})

test('Stream.toJson / Stream.read round trip', () => {
  const a = Stream.from({ name: 'N', description: 'D', url: 'https://x/y', behaviorHints: { videoSize: 99, filename: 'f.mkv', bingeGroup: 'g', proxyHeaders: { request: { Cookie: 'a=b' } } } })
  const json = JSON.parse(JSON.stringify(a.toJson()))
  assert.deepEqual(json, { name: 'N', description: 'D', url: 'https://x/y', headers: { Cookie: 'a=b' }, size: 99, filename: 'f.mkv', binge: 'g' })
  const b = Stream.read(json)
  assert.deepEqual(b.toJson(), a.toJson())
  assert.equal(Stream.read({ name: 'n', url: 'u' }).filename, null)
})

test('Tizen: request headers AVPlay cannot send mark a stream "may not play"', () => {
  const x = (headers) => stream('Movie.1080p.mkv', { headers })
  assert.equal(x({}).mayNotPlay, false)
  assert.equal(x({ 'User-Agent': 'UA' }).mayNotPlay, false)
  assert.equal(x({ cookie: 'a=b', 'user-agent': 'UA' }).mayNotPlay, false)
  assert.equal(x({ Referer: 'https://r' }).mayNotPlay, true)
  assert.deepEqual(x({ 'User-Agent': 'UA', Referer: 'r', Authorization: 'a' }).unsupportedHeaders, ['Referer', 'Authorization'])
})

// ---- StreamsActivity helpers ----
test('sourceSummary: release · codec · audio', () => {
  assert.equal(sourceSummary(s('Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv')), 'WEB · HEVC · Atmos')
  assert.equal(sourceSummary(s('Movie.2021.1080p.BluRay.x264.DD5.1-SPARKS.mkv')), 'BluRay · AVC · DD 5.1')
  assert.equal(sourceSummary(s('Movie.2021.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1.mkv')), 'BluRay · AVC · 5.1')
  assert.equal(sourceSummary(s('Movie.2021.1080p.WEB-DL.AV1.AC3.5.1.mkv')), 'WEB · AV1 · DD 5.1')
  assert.equal(sourceSummary(s('Show.S01E01.720p.HDTV.x264.2.0-GRP.mkv')), 'HDTV · AVC · 2.0')
  assert.equal(sourceSummary(s('Show.S01E01.SDTV.XviD.stereo.avi')), 'SDTV · 2.0')
  assert.equal(sourceSummary(s('Movie.mkv')), 'Source')
  assert.equal(sourceSummary(stream(null, { title: 'x', description: 'x265 EAC3 5.1' })), 'Source · HEVC · DD 5.1')
})

test('sourceSize: decimal GB with one half-up decimal, MB truncated, dash for unknown', () => {
  assert.equal(sourceSize(0), '—')
  assert.equal(sourceSize(-5), '—')
  assert.equal(sourceSize(850 * 1e6), '850 MB')
  assert.equal(sourceSize(999999999), '999 MB')
  assert.equal(sourceSize(1e9), '1.0 GB')
  assert.equal(sourceSize(24.3e9), '24.3 GB')
  assert.equal(sourceSize(1.25e9), '1.3 GB') // Java's %.1f rounds half up
  assert.equal(sourceSize(5.35e9), '5.4 GB') // (toFixed would give 5.3: the binary value is just below)
  assert.equal(sourceSize(9.96e9), '10.0 GB') // the carry
  assert.equal(sourceSize(68.3 * 1024 ** 3), '73.3 GB')
})

test('providerLabel: first line of the add-on title, brackets and (quality) removed, else the add-on name', () => {
  assert.equal(providerLabel(stream('f', { title: '[TB+] Torrentio\n4k HDR' }), 'AddonName'), 'Torrentio') // \[[^\]]+] in Kotlin
  assert.equal(providerLabel(stream('f', { title: 'Torrentio (2160p)' }), 'AddonName'), 'Torrentio')
  assert.equal(providerLabel(stream('f', { title: '[RD+] Comet' }), 'AddonName'), 'Comet')
  assert.equal(providerLabel(stream('f', { title: '1080p' }), 'AddonName'), 'AddonName')
  assert.equal(providerLabel(stream('f', { title: '' }), 'AddonName'), 'AddonName')
  assert.equal(providerLabel(stream('f', { title: '[RD+]' }), 'AddonName'), 'AddonName')
})

// ---- runtime() ----
test('runtime(): "147 min" -> "2h 27m", also "2h35min" / "2h 35m"; under an hour or other text stays', () => {
  assert.equal(runtime('147 min'), '2h 27m')
  assert.equal(runtime('166 min'), '2h 46m')
  assert.equal(runtime('120 min'), '2h 00m')
  assert.equal(runtime('60 min'), '1h 00m')
  assert.equal(runtime('59 min'), '59 min')
  assert.equal(runtime('45min'), '45 min')
  assert.equal(runtime('2h35min'), '2h 35m')
  assert.equal(runtime('2h 35m'), '2h 35m')
  assert.equal(runtime('1h 5m'), '1h 05m')
  assert.equal(runtime('0h 45m'), '45 min')
  assert.equal(runtime('2h'), '2h')
  assert.equal(runtime('TBA'), 'TBA')
  assert.equal(runtime('  147 min  '), '2h 27m')
  assert.equal(runtime('147 min (director\'s cut)'), '2h 27m')
})
