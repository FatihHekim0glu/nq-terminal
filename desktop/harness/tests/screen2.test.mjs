// The screen-2 guard (born failing): a primary-monitor rectangle is refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { guardFrame, screen2Of, screen2Allow, frameOf } from '../lib/screen2.mjs'

const PRIMARY = { primary: true, rect: [0, 0, 2560, 1440], work: [0, 0, 2560, 1400] }
const SECOND = { primary: false, rect: [-1080, 0, 0, 1920], work: [-1080, 0, 0, 1872] }
const TABLE = [PRIMARY, SECOND]

test('a rectangle on the primary monitor is refused', () => {
  const g = guardFrame([100, 100, 1100, 900], TABLE)
  assert.equal(g.ok, false)
  assert.match(g.reason, /primary/)
})

test('a rectangle that straddles the two monitors is refused', () => {
  assert.equal(guardFrame([-500, 100, 500, 900], TABLE).ok, false)
})

test('a rectangle inside the second monitor work area is accepted', () => {
  const g = guardFrame([-1060, 228, -20, 1000], TABLE)
  assert.equal(g.ok, true)
  assert.deepEqual(g.work, SECOND.work)
})

test('a rectangle on the second monitor but below its work area (over the taskbar) is refused', () => {
  assert.equal(guardFrame([-1060, 1800, -20, 1900], TABLE).ok, false)
})

test('without exactly one second monitor everything is refused', () => {
  assert.equal(guardFrame([-1060, 228, -20, 1000], [PRIMARY]).ok, false)
  assert.equal(guardFrame([-1060, 228, -20, 1000], [PRIMARY, SECOND, { ...SECOND, rect: [2560, 0, 3560, 900], work: [2560, 0, 3560, 900] }]).ok, false)
  assert.equal(guardFrame([-1060, 228, -20, 1000], []).ok, false)
  assert.equal(screen2Of([PRIMARY]), null)
})

test('a malformed rectangle is refused', () => {
  assert.equal(guardFrame([0, 0, 0, 0], TABLE).ok, false)
  assert.equal(guardFrame(null, TABLE).ok, false)
  assert.equal(guardFrame([1, 2, 3], TABLE).ok, false)
})

test('the watch allows only the owned process own window inside the guard', () => {
  const allow = screen2Allow([77], TABLE)
  assert.equal(allow({ pid: 77, rect: [-1060, 228, -20, 1000] }), true)
  assert.equal(allow({ pid: 78, rect: [-1060, 228, -20, 1000] }), false, 'another process on screen 2')
  assert.equal(allow({ pid: 77, rect: [100, 100, 900, 700] }), false, 'the owned process on the primary monitor')
})

test('the frame of a window is its DWM bounds when present', () => {
  assert.deepEqual(frameOf({ rect: [1, 2, 3, 4], frame: [5, 6, 7, 8] }), [5, 6, 7, 8])
  assert.deepEqual(frameOf({ rect: [1, 2, 3, 4], frame: null }), [1, 2, 3, 4])
})
