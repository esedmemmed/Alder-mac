import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportText, scrubReport, playbackReport, reportLink, decodeReportHash, REPORT_BASE, LINK_MAX } from '../../src/core/report-text.js'
import { qrModules, qrSvg } from '../../src/ui/qr.js'
import { buildReport } from '../../src/screens/diagnostics.js'
import { createDiag } from '../../src/player/diag.js'

const KEY = 'SECRET-AUTH-KEY-1234'
function fixtureReport(decisions = 60) {
  const diag = createDiag({ now: () => 0 })
  diag.setFind({ start: 'early (good cached source)', addons: [{ name: 'AIOStreams Stable', ms: 1369, count: 6, error: null }, { name: 'Flix', ms: 311, count: 5, error: null }] })
  diag.setStream({ url: 'https://media.example.org/dl/The.Movie.2024.1080p.mkv?token=ABC', label: 'x', at: 1, total: 4, addon: 'AIOStreams Stable', service: 'TorBox', title: 'The Movie', videoId: 'tt1234567' })
  diag.subtitleExtraKeys(['videoHash', 'videoSize', 'filename'])
  diag.subtitleAddon('Subtitle Sync', 3)
  diag.subtitleAddon('OpenSubtitles', new Error('failed for https://x.example/a?k=1'))
  for (let i = 0; i < decisions; i++) diag.decision('audio: line ' + i + ' chose #1 EAC3 (reason ' + i + ') for user@example.com ' + KEY)
  const log = { lines: () => [{ t: 0, level: 'info', tag: 'x', msg: 'log line' }], capacity: 200 }
  return buildReport({ log, diag: diag.snapshot(), device: null, version: '0.5.0', env: 'prod', agent: 'UA https://leak.example/x' })
}

test('playbackReport: title first, the six sections in order, no ICONS / PICTURE / AVPLAY TRACKS / LOG', () => {
  const text = playbackReport(fixtureReport(), [KEY])
  assert.ok(text.startsWith('Title: The Movie (tt1234567)\n'))
  const heads = text.split('\n').filter((l) => /^[A-Z]/.test(l) && !l.startsWith('Title'))
  assert.deepEqual(heads, ['APP', 'DEVICE', 'SOURCES', 'STREAM', 'SUBTITLE ADD-ONS', 'AUDIO AND SOURCE DECISIONS'])
  assert.ok(!/ICONS|PICTURE|AVPLAY|LOG/.test(text))
})

test('scrub: links, the auth key, e-mails and the host line are gone', () => {
  const text = playbackReport(fixtureReport(), [KEY])
  assert.ok(!/https?:\/\//.test(text) && !text.includes(KEY) && !text.includes('user@example.com') && !text.includes('media.example.org'))
  assert.ok(/host\s+\[hidden\]/.test(text))
  assert.ok(scrubReport('authKey: ' + KEY + ' see www.example.com magnet:?xt=urn:btih:abc').indexOf(KEY) < 0)
})

test('round trip: report -> link -> decode gives the scrubbed short report', () => {
  const text = playbackReport(fixtureReport(5), [KEY])
  const link = reportLink(text)
  assert.ok(link.startsWith(REPORT_BASE))
  assert.ok(/^[A-Za-z0-9_-]+$/.test(link.slice(REPORT_BASE.length)), 'base64url, no padding')
  assert.equal(decodeReportHash('#r=' + link.slice(REPORT_BASE.length)), text)
})

test('the cap: over 1800 characters the oldest decisions go first, STREAM and SOURCES stay', () => {
  const noisy = playbackReport(fixtureReport(60), [KEY]).replace(/reason (\d+)/g, (m, n) => 'reason ' + n + ' ' + Math.random().toString(36).repeat(4))
  const full = reportLink(noisy, 1e9)
  assert.ok(full.length > LINK_MAX, 'the fixture must be over the cap: ' + full.length)
  const link = reportLink(noisy)
  assert.ok(link.length <= LINK_MAX, String(link.length))
  const text = decodeReportHash('#r=' + link.slice(REPORT_BASE.length))
  assert.ok(text.includes('SOURCES') && text.includes('STREAM') && text.includes('Title: The Movie'))
  assert.ok(text.includes('line 59 ') && !text.includes('line 0 '), 'newest kept, oldest dropped')
})

test('the cap: with no decisions left, subtitle add-on lines go from the end; STREAM and SOURCES are never cut', () => {
  const big = 'SOURCES\n  Start: x\nSTREAM\n  file  f\n\nSUBTITLE ADD-ONS\n' + Array.from({ length: 80 }, (_, i) => '  addon' + i + ': ' + Array.from({ length: 8 }, () => Math.random().toString(36).slice(2)).join('')).join('\n') + '\n'
  const text = decodeReportHash('#r=' + reportLink(big).slice(REPORT_BASE.length))
  assert.ok(text.includes('addon0:') && !text.includes('addon79:'))
  assert.ok(text.includes('Start: x') && text.includes('file  f'))
})

test('the QR for an 1800-character link builds at L (and sign-in keeps M by default)', () => {
  const link = REPORT_BASE + 'A'.repeat(1800 - REPORT_BASE.length)
  assert.equal(link.length, 1800)
  const l = qrModules(link, 'L')
  assert.ok(l.length > 100 && l.length === l[0].length)
  assert.ok(qrSvg(link, { ecc: 'L' }).startsWith('<svg'))
  assert.ok(qrModules('https://example.org/x').length === qrModules('https://example.org/x', 'M').length)
})

test('decodeReportHash: a good hash decodes, damaged ones give null', () => {
  const link = reportLink('hello\n')
  assert.equal(decodeReportHash('#r=' + link.slice(REPORT_BASE.length)), 'hello\n')
  assert.equal(decodeReportHash('#r='), null)
  assert.equal(decodeReportHash('#r=!!!not-base64'), null)
  assert.equal(decodeReportHash('#r=AAAA'), null)
  assert.equal(decodeReportHash('#other'), null)
  assert.equal(decodeReportHash(''), null)
})

test('reportText keeps its shape', () => {
  assert.equal(reportText([{ title: 'A', lines: [{ text: 'x' }] }]), 'A\n  x\n')
})

test('a real-shaped report: the link length', () => {
  const len = reportLink(playbackReport(fixtureReport(60), [KEY])).length
  console.log('typical link length: ' + len)
  assert.ok(len < LINK_MAX)
})
