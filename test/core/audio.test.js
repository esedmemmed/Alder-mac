import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAudio, audioCodecsIn, classifyCodecId, parseAudioTracks, bestAudio, decideAudio, afterAudioError, parseExtraInfo,
  describeTracks, TU8000_AUDIO, NO_SOUND_TAG,
} from '../../src/core/audio.js'
import { toIso1 } from '../../src/core/lang.js'
import { stream, tv } from './helpers.js'

// ---------------------------------------------------------------------------------------------------------------------
// Stage A: 50 realistic release names
// ---------------------------------------------------------------------------------------------------------------------

const CASES = [
  // good: a playable codec named, nothing unplayable
  ['Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv', 'good'],
  ['The.Batman.2022.1080p.BluRay.DD5.1.x264-SPARKS.mkv', 'good'],
  ['Oppenheimer.2023.1080p.WEB-DL.DD+5.1.Atmos.H.264-FLUX.mkv', 'good'],
  ['Barbie.2023.1080p.AMZN.WEB-DL.DDP2.0.H.264-CMRG.mkv', 'good'],
  ['Severance.S01E04.The.You.You.Are.1080p.ATVP.WEB-DL.DDP5.1.Atmos.H.264-NTb.mkv', 'good'],
  ['Top.Gun.Maverick.2022.720p.WEB.h264.AAC-KOGi.mkv', 'good'],
  ['Arrival.2016.1080p.WEBRip.x265.10bit.AAC5.1-[YTS.MX].mp4', 'good'],
  ['Mad.Max.Fury.Road.2015.1080p.NF.WEB-DL.EAC3.5.1.x264-GRP.mkv', 'good'],
  ['Heat.1995.1080p.WEB-DL.E-AC-3.5.1.H.264-GRP.mkv', 'good'],
  ['Spirited.Away.2001.2160p.WEB-DL.Opus.5.1.AV1-NTb.mkv', 'good'],
  ['Pulp.Fiction.1994.1080p.BluRay.Remux.FLAC.2.0.AVC-GRP.mkv', 'good'],
  ['The.Room.2003.DVDRip.XviD.MP3-FGT.avi', 'good'],
  ['Inception.2010.1080p.WEB-DL.Dolby.Digital.5.1.H264.mkv', 'good'],
  ['Gladiator.2000.1080p.WEB-DL.Dolby.Digital.Plus.7.1.H264.mkv', 'good'],
  ['Koyaanisqatsi.1982.1080p.BluRay.LPCM.2.0.AVC-GRP.mkv', 'good'],
  ['Alien.1979.480p.DVDRip.XviD.AC3.5.1-GRP.avi', 'good'],
  ['Parasite.2019.1080p.WEB-DL.DD.5.1.H.264-GRP.mkv', 'good'],
  ['Blade.Runner.2049.2017.1080p.WEB-DL.DDP.Atmos.x264-GRP.mkv', 'good'],
  ['Her.2013.1080p.BluRay.AC-3.x264-GRP.mkv', 'good'],
  ['Jaws.1975.720p.BluRay.x264.AC3.mkv', 'good'],
  // unknown: audio not named (or only things that are not an audio codec)
  ['Movie 2022 [1080p] [WEBRip] [5.1] [YTS.MX]', 'unknown'],
  ['Dune.Part.Two.2024.1080p.WEB-DL.x264-GRP.mkv', 'unknown'],
  ['Dune.Part.Two.2024.2160p.WEB-DL.Atmos.HDR10.H.265-GRP.mkv', 'unknown'],
  ['Sicario.2015.BluRay.1080p.5.1.x264-GRP', 'unknown'],
  ['Hacks.S02E03.720p.HDTV.x264-SYNCOPY', 'unknown'],
  ['Avatar.The.Way.of.Water.2022.4K.UHD.HDR', 'unknown'],
  ['Movie.2020.1080p.WEB-DL.DV.HDR10.H.265-GRP.mkv', 'unknown'], // "DV" is Dolby Vision, not audio
  ['Movie.2020.2160p.Dolby.Vision.WEB-DL.H.265-GRP.mkv', 'unknown'], // "Dolby" alone is not Dolby Digital
  ['Isaac.Asimov.Documentary.2019.1080p.BluRay.x264-GRP', 'unknown'], // "isaac" is not AAC
  ['Eddie.Murphy.Raw.1987.1080p.BluRay.x264-GRP', 'unknown'], // "eddie" contains dd
  ['Daddy.Day.Care.2003.1080p.BluRay.x264-GRP', 'unknown'], // "daddy" contains dd
  ['Magnum.Opuscule.2020.1080p.WEB-DL.x264', 'unknown'], // "opuscule" is not Opus
  // bad: only DTS / TrueHD, which a TU8000 cannot decode
  ['Dune.Part.Two.2024.UHD.BluRay.2160p.REMUX.HDR10.HEVC.TrueHD.Atmos.7.1-WiLDCAT.mkv', 'bad'],
  ['Dune.Part.Two.2024.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-RARBG.mkv', 'bad'],
  ['Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.7.1-SPARKS.mkv', 'bad'],
  ['Heat.1995.1080p.BluRay.DTS.x264-FGT.mkv', 'bad'],
  ['Ready.Player.One.2018.2160p.UHD.BluRay.x265.DTS-X.7.1-GRP.mkv', 'bad'],
  ['Ready.Player.One.2018.2160p.UHD.BluRay.DTS:X.7.1.HEVC', 'bad'],
  ['Dunkirk.2017.2160p.BluRay.DTSX.7.1.x265-GRP', 'bad'],
  ['Zodiac.2007.1080p.BluRay.DTS-HDMA.5.1.x264-GRP', 'bad'],
  ['Zodiac.2007.1080p.BluRay.DTSHD.MA.5.1.x264-GRP', 'bad'],
  ['Sicario.2015.1080p.BluRay.True-HD.7.1.x264-GRP', 'bad'],
  ['Joker.2019.2160p.Dolby.TrueHD.Atmos.HEVC', 'bad'],
  ['Ronin.1998.720p.BluRay.DTS.5.1.x264-GRP', 'bad'],
  ['Predator.1987.1080p.BluRay.DTS-ES.x264-GRP', 'bad'],
  // mixed: playable and unplayable named together (multi-audio releases)
  ['Dune.Part.Two.2024.MULTi.1080p.BluRay.DTS.AC3.x264-LOST.mkv', 'mixed'],
  ['Collateral.2004.1080p.BluRay.DTS-HD.MA.5.1.AC3.x264-GRP.mkv', 'mixed'],
  ['Gravity.2013.2160p.BluRay.TrueHD.7.1.Atmos.DD+5.1.HEVC-GRP', 'mixed'],
  ['Amelie.2001.Dual.Audio.DTS.AAC.1080p.BluRay.x264', 'mixed'],
  ['Movie 2021 🔊 DTS-HD MA 5.1 | DD+ 5.1', 'mixed'], // AIOStreams-style description
  ['Tenet.2020.2160p.WEB-DL.DDP5.1.TrueHD.HEVC-GRP', 'mixed'],
]

test('audio classifier: ' + CASES.length + ' realistic names', () => {
  assert.ok(CASES.length >= 40)
  const wrong = []
  for (const [name, expected] of CASES) {
    const got = classifyAudio(name).kind
    if (got !== expected) wrong.push(name + ' -> ' + got + ' (wanted ' + expected + ')')
  }
  assert.deepEqual(wrong, [])
})

test('audio classifier: kinds are balanced in the table (so no kind is untested)', () => {
  const count = k => CASES.filter(c => c[1] === k).length
  for (const k of ['good', 'bad', 'mixed', 'unknown']) assert.ok(count(k) >= 6, k)
})

test('audio classifier: codecs are named, longest family first', () => {
  assert.deepEqual(audioCodecsIn('DTS-HD.MA.5.1 AC3'), ['DTS-HD', 'AC3'])
  assert.deepEqual(audioCodecsIn('E-AC-3'), ['EAC3']) // not also AC3
  assert.deepEqual(audioCodecsIn('DDP5.1'), ['EAC3'])
  assert.deepEqual(audioCodecsIn('DD5.1'), ['AC3'])
  assert.deepEqual(audioCodecsIn('DTS-X'), ['DTS:X'])
  assert.deepEqual(audioCodecsIn('DTS.x264'), ['DTS']) // "x264" is the video codec, not DTS:X
  assert.deepEqual(audioCodecsIn('TrueHD Atmos'), ['TRUEHD'])
  assert.deepEqual(audioCodecsIn('nothing here'), [])
  assert.deepEqual(audioCodecsIn(null), [])
})

test('audio classifier: a device that plays DTS (a future transcoder) flips the verdict', () => {
  const withDts = new Set([...TU8000_AUDIO, 'DTS'])
  assert.equal(classifyAudio('Movie.DTS.1080p', withDts).kind, 'good')
  assert.equal(classifyAudio('Movie.DTS-HD.MA.1080p', withDts).kind, 'bad') // DTS-HD is a different codec id
})

test('Stream.audioKind reads filename, title and description together', () => {
  const dev = tv()
  assert.equal(stream('Movie.2020.1080p.WEB-DL.x264-GRP.mkv', { description: '🔊 DTS-HD MA 5.1' }).audioKind(dev), 'bad')
  assert.equal(stream('Movie.2020.1080p.WEB-DL.x264-GRP.mkv', { title: 'AIOStreams\n1080p DD+ 5.1' }).audioKind(dev), 'good')
  assert.equal(stream('Movie.2020.1080p.WEB-DL.x264-GRP.mkv').audioKind(dev), 'unknown')
  assert.equal(NO_SOUND_TAG, 'No sound on this TV')
})

// ---------------------------------------------------------------------------------------------------------------------
// Stage B: AVPlay tracks
// ---------------------------------------------------------------------------------------------------------------------

const track = (index, fourCC, language, channels, extra = {}) => ({
  index, type: 'AUDIO', extra_info: JSON.stringify(Object.assign({ fourCC, language, channels: String(channels) }, extra)),
})
const video = { index: 0, type: 'VIDEO', extra_info: '{"fourCC":"HEVC","width":"3840","height":"2160"}' }
const parse = (list, current = null) => parseAudioTracks([video].concat(list), { currentIndex: current, toLanguage: toIso1 })

test('classifyCodecId: fourCCs, Matroska ids, WAVE tags and names', () => {
  const kind = id => classifyCodecId(id).codec + '/' + classifyCodecId(id).playable
  assert.equal(kind('ec-3'), 'EAC3/yes')
  assert.equal(kind('EAC3'), 'EAC3/yes')
  assert.equal(kind('A_EAC3'), 'EAC3/yes')
  assert.equal(kind('AC-3'), 'AC3/yes')
  assert.equal(kind('ac3'), 'AC3/yes')
  assert.equal(kind('A_AC3'), 'AC3/yes')
  assert.equal(kind('0x2000'), 'AC3/yes')
  assert.equal(kind('mp4a'), 'AAC/yes')
  assert.equal(kind('mp4a.40.2'), 'AAC/yes')
  assert.equal(kind('AAC'), 'AAC/yes')
  assert.equal(kind('mp4a.6b'), 'MP3/yes')
  assert.equal(kind('MP3'), 'MP3/yes')
  assert.equal(kind('fLaC'), 'FLAC/yes')
  assert.equal(kind('Opus'), 'OPUS/yes')
  assert.equal(kind('vorbis'), 'VORBIS/yes')
  assert.equal(kind('PCM_S16LE'), 'PCM/yes')
  assert.equal(kind('twos'), 'PCM/yes')
  assert.equal(kind('DTS '), 'DTS/no')
  assert.equal(kind('dtsc'), 'DTS/no')
  assert.equal(kind('A_DTS'), 'DTS/no')
  assert.equal(kind('0x2001'), 'DTS/no')
  assert.equal(kind('dtsh'), 'DTS-HD/no')
  assert.equal(kind('DTS-HD MA'), 'DTS-HD/no')
  assert.equal(kind('dtsx'), 'DTS:X/no')
  assert.equal(kind('mlpa'), 'TRUEHD/no')
  assert.equal(kind('A_TRUEHD'), 'TRUEHD/no')
  assert.equal(kind('Dolby Digital Plus'), 'EAC3/yes')
  assert.equal(kind('weirdcodec'), 'WEIRDCODEC/maybe')
  assert.equal(kind(''), '/maybe')
})

test('parseExtraInfo: JSON, objects, and text that is not quite JSON', () => {
  assert.deepEqual(parseExtraInfo('{"fourCC":"AC-3","channels":"6"}'), { fourCC: 'AC-3', channels: '6' })
  assert.deepEqual(parseExtraInfo({ fourCC: 'AAC' }), { fourCC: 'AAC' })
  const loose = parseExtraInfo('{fourCC:"AC-3",language:"eng",channels:6}')
  assert.equal(loose.fourCC, 'AC-3')
  assert.equal(loose.language, 'eng')
  assert.deepEqual(parseExtraInfo(undefined), {})
})

test('parseAudioTracks keeps only AUDIO tracks and normalises them', () => {
  const tracks = parse([track(1, 'ec-3', 'eng', 6), track(2, 'DTS ', 'fre', 6), { index: 3, type: 'TEXT', extra_info: '{"track_lang":"eng"}' }], 1)
  assert.equal(tracks.length, 2)
  assert.deepEqual(tracks.map(t => [t.index, t.codec, t.playable, t.language, t.channels, t.isDefault]), [
    [1, 'EAC3', 'yes', 'en', 6, true],
    [2, 'DTS', 'no', 'fr', 6, false],
  ])
  assert.deepEqual(parseAudioTracks(undefined), [])
})

test('parseAudioTracks: no codec field, the whole extra_info is read like a release name', () => {
  const t = parseAudioTracks([{ index: 0, type: 'AUDIO', extra_info: '{"track_title":"DTS-HD MA 5.1","language":"eng"}' }])
  assert.equal(t[0].codec, 'DTS-HD')
  assert.equal(t[0].playable, 'no')
})

test('Stage B: DTS-only file has no playable audio -> source failure', () => {
  const d = decideAudio(parse([track(1, 'DTS ', 'eng', 6)], 1), { language: 'en', currentIndex: 1 })
  assert.equal(d.ok, false)
  assert.match(d.reason, /^no playable audio/)
  assert.match(d.reason, /DTS/)
})

test('Stage B: TrueHD plus DTS-HD only is still no playable audio', () => {
  const d = decideAudio(parse([track(1, 'mlpa', 'eng', 8), track(2, 'dtsh', 'eng', 8)], 1), { language: 'en', currentIndex: 1 })
  assert.equal(d.ok, false)
})

test('Stage B: DTS default + AC3 second -> switch to the AC3 track before play', () => {
  const d = decideAudio(parse([track(1, 'DTS ', 'eng', 6), track(2, 'AC-3', 'eng', 6)], 1), { language: 'en', currentIndex: 1 })
  assert.equal(d.ok, true)
  assert.equal(d.index, 2)
  assert.equal(d.change, true)
  assert.match(d.reason, /default #1 DTS cannot play here; chose #2 AC3/)
})

test('Stage B: default track already playable and best -> kept, no switch', () => {
  const d = decideAudio(parse([track(1, 'ec-3', 'eng', 6), track(2, 'AC-3', 'eng', 6)], 1), { language: 'en', currentIndex: 1 })
  assert.equal(d.index, 1)
  assert.equal(d.change, false)
})

test('bestAudio order: audio language, then default flag, then channels', () => {
  const tracks = parse([track(1, 'AC-3', 'eng', 2), track(2, 'AC-3', 'hin', 6), track(3, 'AC-3', 'hin', 2)], 3)
  assert.equal(bestAudio(tracks, { language: 'hi' }).index, 3) // language first, then the default flag beats channels
  assert.equal(bestAudio(tracks, { language: 'en' }).index, 1)
  assert.equal(bestAudio(tracks, { language: '' }).index, 3) // no language wish: the default flag
  const noDefault = parse([track(1, 'AC-3', 'eng', 2), track(2, 'AC-3', 'eng', 6)], null)
  assert.equal(bestAudio(noDefault, { language: 'en' }).index, 2) // then the most channels
  const ties = parse([track(1, 'AC-3', 'eng', 6), track(2, 'AC-3', 'eng', 6)], null)
  assert.equal(bestAudio(ties, { language: 'en' }).index, 1) // ties keep the earlier track
})

test('bestAudio: a commentary is never chosen over a real track, nor a failed track', () => {
  const tracks = parse([track(1, 'AC-3', 'eng', 2, { name: 'Director Commentary' }), track(2, 'AC-3', 'eng', 2)], 1)
  assert.equal(bestAudio(tracks, { language: 'en' }).index, 2)
  assert.equal(bestAudio(tracks, { language: 'en', failed: new Set([2]) }).index, 1) // sound beats silence
  assert.equal(bestAudio(tracks, { language: 'en', failed: new Set([1, 2]) }), null)
})

test('bestAudio: a codec we have no verdict on is only used when nothing known plays', () => {
  const unknown = parse([track(1, 'xyz1', 'eng', 8), track(2, 'AAC', 'eng', 2)], 1)
  assert.equal(bestAudio(unknown, { language: 'en' }).index, 2)
  const only = parse([track(1, 'xyz1', 'eng', 8)], 1)
  assert.equal(bestAudio(only, { language: 'en' }).index, 1)
})

test('Stage B: multi-language file prefers the Settings audio language among playable tracks', () => {
  const tracks = parse([track(1, 'DTS ', 'hin', 6), track(2, 'AC-3', 'eng', 6), track(3, 'AC-3', 'hin', 2)], 1)
  const d = decideAudio(tracks, { language: 'hi', currentIndex: 1 })
  assert.equal(d.index, 3) // Hindi, playable, even though stereo
})

test('Stage B: no audio tracks reported -> play as is, do not fail the source', () => {
  const d = decideAudio([], { language: 'en' })
  assert.equal(d.ok, true)
  assert.equal(d.index, null)
  assert.equal(d.change, false)
})

test('afterAudioError drops the failed track and carries on with the next best', () => {
  const tracks = parse([track(1, 'ec-3', 'eng', 6), track(2, 'AC-3', 'eng', 6), track(3, 'AAC', 'eng', 2)], 1)
  const first = afterAudioError(tracks, 1, { language: 'en' })
  assert.equal(first.ok, true)
  assert.equal(first.index, 2)
  assert.equal(first.change, true)
  const second = afterAudioError(tracks, 2, { language: 'en', failed: first.failed })
  assert.equal(second.index, 3)
  const third = afterAudioError(tracks, 3, { language: 'en', failed: second.failed })
  assert.equal(third.ok, false)
})

test('describeTracks is a one-line-per-track summary for Diagnostics', () => {
  const text = describeTracks(parse([track(1, 'ec-3', 'eng', 6), track(2, 'DTS ', 'fre', 6)], 1))
  assert.match(text, /#1 EAC3 en 6ch default/)
  assert.match(text, /#2 DTS \(not playable\) fr 6ch/)
})
