// Born-failing checks for the dock-step wait (run: node --test dockwait.test.mjs).
// Finding (diag, 2 October 2026): with six docked panels the volmanaged_v0 DES charts sit in a 198 px wide panel, collapse to height 0 and never
// draw, in Tauri as well as in Electron. The strict wait of bench_browser.py (no aria-busy anywhere) passed in Tauri only because it ran before
// those charts mounted; in Electron the charts mount in the same commit as the panel title, so it never passed. The dock wait ignores a busy
// container whose box has no height (it can never draw) and still waits for any busy container that has a height.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dockReady, waitDockPanel } from '../lib/dockwait.mjs'

const BUSY = '[aria-busy="true"]:not(td):not([role="gridcell"])'
const el = (title, height) => ({ getAttribute: (n) => (n === 'data-nqt-title' ? title : null), getBoundingClientRect: () => ({ height }) })
function fakeDoc({ titles = [], busyHeights = [], empty = false } = {}) {
  return {
    querySelectorAll: (sel) => (sel === '[data-nqt-title]' ? titles.map((t) => el(t, 400)) : sel === BUSY ? busyHeights.map((h) => el(null, h)) : []),
    querySelector: (sel) => (sel === 'p.ws-empty' ? (empty ? {} : null) : null),
  }
}

test('ready when the panel is there and nothing is busy', () => {
  assert.equal(dockReady(fakeDoc({ titles: ['volmanaged_v0 DES'] }), 'volmanaged_v0 DES'), true)
})

test('not ready while the panel title is missing', () => {
  assert.equal(dockReady(fakeDoc({ titles: ['NQ DES'] }), 'volmanaged_v0 DES'), false)
})

test('not ready while the empty-state line is shown', () => {
  assert.equal(dockReady(fakeDoc({ titles: ['volmanaged_v0 DES'], empty: true }), 'volmanaged_v0 DES'), false)
})

test('not ready while a busy container has a height (it is still loading)', () => {
  assert.equal(dockReady(fakeDoc({ titles: ['volmanaged_v0 DES'], busyHeights: [220] }), 'volmanaged_v0 DES'), false)
})

test('ready when the only busy containers have no height (zero-height charts that can never draw)', () => {
  assert.equal(dockReady(fakeDoc({ titles: ['volmanaged_v0 DES'], busyHeights: [0, 0, 0] }), 'volmanaged_v0 DES'), true)
})

test('not ready when a zero-height container is busy next to one that has a height', () => {
  assert.equal(dockReady(fakeDoc({ titles: ['volmanaged_v0 DES'], busyHeights: [0, 12] }), 'volmanaged_v0 DES'), false)
})

test('the page expression carries the line and the 45 s timeout of the strict wait, and no strict busy test', () => {
  const x = waitDockPanel('volmanaged_v0 DES')
  assert.match(x, /volmanaged_v0 DES/)
  assert.match(x, /45000/)
  assert.doesNotMatch(x, /querySelector\('\[aria-busy="true"\]:not\(td\):not\(\[role="gridcell"\]\)'\) === null/)
  assert.match(x, /getBoundingClientRect\(\)\.height/)
  assert.doesNotThrow(() => new Function(`return (${x})`))
})
