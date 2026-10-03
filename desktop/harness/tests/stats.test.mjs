import test from 'node:test'
import assert from 'node:assert/strict'
import { median, quantile, p95, range, withinNoise, agreeWithinNoise } from '../lib/stats.mjs'

test('median of odd and even sets, ignoring non numbers', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([1, null, undefined, NaN, 3]), 2)
  assert.equal(median([]), null)
})

test('the nearest-rank quantile matches trace.ts', () => {
  const xs = Array.from({ length: 20 }, (_, i) => i + 1)
  assert.equal(p95(xs), 19)
  assert.equal(quantile(xs, 0.5), 10)
  assert.equal(quantile([], 0.5), null)
})

test('range reports n, min, max and median', () => {
  assert.deepEqual(range([5, 1, 3]), { n: 3, min: 1, max: 5, median: 3 })
})

test('within noise: 10% of the median, or inside the min to max range', () => {
  const ref = { median: 834.5, min: 814, max: 892 }
  assert.equal(withinNoise(900, ref), true, 'inside 10% of the median (917.95)')
  assert.equal(withinNoise(810, ref), true, 'within 10% below')
  assert.equal(withinNoise(1000, ref), false)
  assert.equal(withinNoise(700, ref), false)
  assert.equal(withinNoise(164.9 * 1.09, { median: 164.9, min: 159.7, max: 168.4 }), true)
  assert.equal(withinNoise(null, ref), false)
  assert.equal(withinNoise(850, null), false)
})

test('a figure outside 10% but inside a wide range still counts', () => {
  assert.equal(withinNoise(120, { median: 100, min: 80, max: 130 }), true)
})

test('two builds agree within noise when medians are within 10% or ranges overlap', () => {
  assert.equal(agreeWithinNoise({ median: 1200, min: 1150, max: 1250 }, { median: 1300, min: 1280, max: 1350 }), true)
  assert.equal(agreeWithinNoise({ median: 1000, min: 990, max: 1010 }, { median: 1500, min: 1490, max: 1510 }), false)
  assert.equal(agreeWithinNoise({ median: 1000, min: 900, max: 1400 }, { median: 1500, min: 1300, max: 1600 }), true)
  assert.equal(agreeWithinNoise(null, { median: 1 }), false)
})
