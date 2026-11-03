import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceProfile, tu8000Profile, describeDevice } from '../../src/core/device.js'
import { TU8000_AUDIO } from '../../src/core/audio.js'

test('static TU8000 profile: HEVC yes, AV1 no, Dolby Vision no, HDR, 4K, the documented audio set', () => {
  const p = tu8000Profile()
  assert.deepEqual([p.hevc, p.av1, p.dolbyVision, p.hdr, p.height], [true, false, false, true, 2160])
  assert.deepEqual(Array.from(p.audio).sort(), ['AAC', 'AC3', 'EAC3', 'FLAC', 'MP3', 'OPUS', 'PCM', 'VORBIS'])
  for (const gone of ['DTS', 'DTS-HD', 'DTS:X', 'TRUEHD']) assert.ok(!p.audio.has(gone))
  assert.equal(tu8000Profile().audio.size, TU8000_AUDIO.length)
})

test('webapis missing (desktop dev): the TU8000 profile, logged', () => {
  const lines = []
  const p = deviceProfile({ log: m => lines.push(m) })
  assert.equal(p.height, 2160)
  assert.equal(p.hdr, true)
  assert.ok(lines.some(l => /webapis missing/.test(l)))
})

test('webapis answers: panel height and HDR come from the TV', () => {
  const webapis = { productinfo: { isUdPanelSupported: () => false }, avinfo: { isHdrTvSupport: () => false } }
  const p = deviceProfile({ webapis })
  assert.equal(p.height, 1080)
  assert.equal(p.hdr, false)
  assert.equal(p.source, 'webapis')
  assert.equal(p.hevc, true) // codecs stay a fact of the model
  const uhd = deviceProfile({ webapis: { productinfo: { isUdPanelSupported: () => true }, avinfo: { isHdrTvSupport: () => true } } })
  assert.equal(uhd.height, 2160)
  assert.equal(uhd.hdr, true)
})

test('webapis throws or lacks a function: that part falls back, the other still counts, all logged', () => {
  const lines = []
  const p = deviceProfile({
    webapis: { productinfo: { isUdPanelSupported() { throw new Error('boom') } }, avinfo: {} },
    log: m => lines.push(m),
  })
  assert.equal(p.height, 2160)
  assert.equal(p.hdr, true)
  assert.equal(p.notes.length, 2)
  assert.ok(lines.some(l => /productinfo failed \(boom\)/.test(l)))
  assert.ok(lines.some(l => /isHdrTvSupport unavailable/.test(l)))
})

test('the AV1 toggle (Settings -> Advanced) is the only way AV1 turns on', () => {
  assert.equal(deviceProfile({}).av1, false)
  assert.equal(deviceProfile({ av1: true }).av1, true)
  assert.equal(deviceProfile({ webapis: {}, av1: true }).av1, true)
})

test('describeDevice for the diagnostics screen', () => {
  assert.match(describeDevice(tu8000Profile()), /^2160p HDR HEVC audio\[AAC,AC3,EAC3,MP3,FLAC,OPUS,VORBIS,PCM\]/)
})
