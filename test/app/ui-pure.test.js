import test from 'node:test'
import assert from 'node:assert/strict'
import { qrModules, qrSvg } from '../../src/ui/qr.js'
import { createPinState } from '../../src/ui/pin.js'
import { initialOf } from '../../src/ui/onboarding.js'

test('qr: a sign-in link fits a small version, finder patterns sit in three corners, the svg is one path', () => {
  const m = qrModules('https://link.stremio.com/?code=ABCD&x=1')
  assert.ok(m.length >= 21 && m.length <= 41 && (m.length - 17) % 4 === 0, 'size ' + m.length)
  const n = m.length
  // finder pattern: a 7x7 ring with a dark 3x3 centre
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    assert.equal(m[r][c], true); assert.equal(m[r + 3][c + 3], true); assert.equal(m[r + 1][c + 1], false); assert.equal(m[r][c + 6], true)
  }
  assert.equal(m[n - 7][n - 7] === undefined, false)
  const svg = qrSvg('https://link.stremio.com/?code=ABCD&x=1')
  assert.equal((svg.match(/<path/g) || []).length, 1)
  assert.match(svg, /viewBox="0 0 (\d+) \1"/)
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)[1])
  assert.equal(size, n + 8, 'a 4-module quiet zone each side')
})

test('pin state: Up and Down turn the digit, Right moves on once there is one, typing fills and moves on', () => {
  const s = createPinState()
  assert.equal(s.shown(0), '')
  s.right()
  assert.equal(s.at, 0, 'Right waits for a digit')
  s.down()
  assert.equal(s.value, '9', 'Down from an empty box starts at 9')
  s.up()
  assert.equal(s.value, '0', 'Up wraps 9 to 0')
  s.up()
  assert.equal(s.shown(0), '1')
  s.right()
  assert.equal(s.at, 1)
  assert.equal(s.shown(0), '\u2022', 'a box the remote left shows a dot')
  s.up()
  assert.equal(s.value, '10', 'a new box starts at 0 on Up')
  s.left()
  s.left()
  assert.equal(s.at, 0, 'Left stops at the first box')
  s.clear()
  assert.equal(s.value, '')
  assert.equal(s.type('2'), false)
  assert.equal(s.type(5), false)
  assert.equal(s.type('8'), false)
  assert.equal(s.complete, false)
  assert.equal(s.type('0'), true, 'the fourth digit completes it')
  assert.equal(s.complete, true)
  assert.equal(s.value, '2580')
  s.down()
  assert.equal(s.value, '2589', 'the last box can still be turned')
})

test('initialOf', () => {
  assert.equal(initialOf('enough'), 'E')
  assert.equal(initialOf('  jane'), 'J')
  assert.equal(initialOf(''), '')
  assert.equal(initialOf('émile'), 'É')
})
