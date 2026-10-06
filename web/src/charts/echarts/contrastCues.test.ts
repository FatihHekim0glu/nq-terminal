// Second cues under forced colours (theme/chartContrast.ts) in the ECharts set: the lines that differ
// only by colour gain a dash, and the default options stay exactly as they were.
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS, SYSTEM_COLOUR_FALLBACK, forcedChartTokens } from '../theme'
import { coneOption, type ConeInput } from './coneModel'
import { compositionStackOption, type CompositionInput } from './compositionModel'
import { forcedLineType } from './shared'

const FORCED = forcedChartTokens(SYSTEM_COLOUR_FALLBACK, DEFAULT_CHART_TOKENS)

const CONE: ConeInput = {
  name: 'cone',
  label: 'resampled history, not a forecast',
  unit: '%',
  decimals: 2,
  steps: [1, 2, 3],
  bands: [
    { p: 5, values: [-1.7, -2.5, -3.2] },
    { p: 25, values: [-0.7, -1.2, -1.6] },
    { p: 50, values: [-0.1, -0.3, -0.5] },
    { p: 75, values: [0.4, 0.5, 0.5] },
    { p: 95, values: [1.3, 1.4, 1.7] },
  ],
  realised: [0.2, 0.8, 1.5],
  realisedDates: ['2011-04-25', '2011-04-26', '2011-04-27'],
}

const COMPOSITION: CompositionInput = {
  name: 'book',
  unit: 'x',
  decimals: 2,
  columns: ['2021-01-04', '2021-01-05'],
  rows: [
    { kind: 'band', label: 'Equity', tone: 'secEquity' },
    { kind: 'instrument', label: 'NQ', sector: 'Equity', tone: 'secEquity', values: [0.5, 0.6] },
  ],
  gross: [0.5, 0.6],
  net: [0.4, 0.5],
  note: 'Every session.',
}

type Line = { id?: string; lineStyle?: { color?: string; type?: unknown } }
const seriesOf = (o: unknown) => (o as { series: Line[] }).series
const typeOf = (o: unknown, id: string) => seriesOf(o).find((s) => s.id === id)?.lineStyle?.type

describe('forcedLineType', () => {
  it('is empty in the default look and for the solid lead position', () => {
    expect(forcedLineType(DEFAULT_CHART_TOKENS, 1)).toEqual({})
    expect(forcedLineType(FORCED, 0)).toEqual({})
  })

  it('gives the forced dash for any other position', () => {
    expect(forcedLineType(FORCED, 1)).toEqual({ type: [10, 4] })
  })
})

describe('Cone under forced colours', () => {
  it('born failing: by default the realised path and the median differ by colour only', () => {
    const o = coneOption(CONE, DEFAULT_CHART_TOKENS)
    expect(typeOf(o, 'realised')).toBeUndefined()
    expect(typeOf(o, 'p50')).toBeUndefined()
  })

  it('dashes the realised path and dots the inner band, keeping the median solid and the outer band dashed', () => {
    const o = coneOption(CONE, FORCED)
    expect(typeOf(o, 'realised')).toEqual([10, 4])
    expect(typeOf(o, 'p25')).toEqual([2, 5])
    expect(typeOf(o, 'p75')).toEqual([2, 5])
    expect(typeOf(o, 'p50')).toBeUndefined()
    expect(typeOf(o, 'p5')).toEqual([4, 3])
  })

  it('leaves the default cone lines as they were', () => {
    const o = coneOption(CONE, DEFAULT_CHART_TOKENS)
    expect(typeOf(o, 'p25')).toBeUndefined()
    expect(typeOf(o, 'p5')).toEqual([4, 3])
  })
})

describe('Composition under forced colours', () => {
  it('dashes Net against a solid Gross only under forced colours', () => {
    expect(typeOf(compositionStackOption(COMPOSITION, DEFAULT_CHART_TOKENS), 'net')).toBeUndefined()
    const forced = compositionStackOption(COMPOSITION, FORCED)
    expect(typeOf(forced, 'net')).toEqual([10, 4])
    expect(typeOf(forced, 'gross')).toBeUndefined()
  })
})
