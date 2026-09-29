// REG 95) Compare series names: the cost is written with its label, so a legend reads
// "volmanaged_v0 (0 ticks)", never "(0 tick)".
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { regCompareModel } from './regCompareModel'

type Body = Schemas['HypothesisSeries']

function body(name: string): Body {
  return { basis: 'A', bench_label: null, cost: 1, equity: [1], kind: 'trades', name, r: [0], r_bench: null, source: 'fixture', t: [1], unit: 'USD' }
}

const nameAt = (cost: number): string =>
  regCompareModel([{ name: 'a_v0', body: body('a_v0'), error: null }], cost).panes[0]!.series[0]!.name

describe('regCompareModel: series names at each cost', () => {
  it('reads 0 ticks, 1 tick and 2 ticks', () => {
    expect(nameAt(0)).toBe('a_v0 (0 ticks)')
    expect(nameAt(1)).toBe('a_v0 (1 tick)')
    expect(nameAt(2)).toBe('a_v0 (2 ticks)')
  })
})
