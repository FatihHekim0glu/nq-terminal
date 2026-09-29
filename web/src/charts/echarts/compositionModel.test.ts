// @vitest-environment jsdom
// The pure models run in the same file as the component check, so the file is jsdom; the ECharts library
// is mocked (jsdom has no canvas), as in components.test.tsx.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { DEFAULT_CHART_TOKENS, interpolateHex } from '../theme'
import { Composition } from './Composition'
import {
  compositionCells,
  compositionHeatOption,
  compositionKey,
  compositionMax,
  compositionScaleNote,
  compositionStackOption,
  compositionTable,
  describeComposition,
  toneOfSector,
  yearLabels,
  type CompositionInput,
} from './compositionModel'
import { renderCustom, seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'

afterEach(cleanup)

const T = uniqueTokens()
const C = T.color

const INPUT: CompositionInput = {
  name: 'run_a gross exposure by instrument',
  unit: 'notional over equity',
  decimals: 3,
  columns: ['2011-06-03', '2011-06-06', '2012-01-02', '2012-01-03'],
  rows: [
    { kind: 'band', label: 'Equity', tone: 'secEquity' },
    { kind: 'instrument', label: 'ES', sector: 'Equity', tone: 'secEquity', values: [0.1, 0, null, 0.2] },
    { kind: 'instrument', label: 'NQ', sector: 'Equity', tone: 'secEquity', values: [0.05, 0.1, 0.15, 0.4] },
    { kind: 'band', label: 'Rates', tone: 'secRates' },
    { kind: 'instrument', label: 'ZN', sector: 'Rates', tone: 'secRates', values: [0, 0, 0.3, 0.1] },
  ],
  gross: [0.15, 0.1, 0.45, 0.7],
  net: [0.15, -0.1, 0.45, -0.2],
  note: 'Every session is shown.',
}

/** One band and one instrument over `cols` columns, for the pixel checks. */
function wide(cols: number): CompositionInput {
  const columns = Array.from({ length: cols }, (_, i) => `2011-01-${String((i % 28) + 1).padStart(2, '0')}`)
  return {
    ...INPUT,
    columns,
    rows: [
      { kind: 'band', label: 'Equity', tone: 'secEquity' },
      { kind: 'instrument', label: 'ES', sector: 'Equity', tone: 'secEquity', values: columns.map(() => 0.1) },
    ],
    gross: columns.map(() => 0.1),
    net: columns.map(() => 0.1),
  }
}

interface Rect {
  readonly type: string
  readonly shape: { x: number; y: number; width: number; height: number }
  readonly style: { fill: string }
}

type Series = Record<string, unknown> & {
  id: string
  name?: string
  stack?: string
  data: unknown[]
  areaStyle?: { color: string }
  lineStyle?: { color?: string; width: number }
  silent?: boolean
  markLine?: unknown
}

describe('toneOfSector', () => {
  it('gives each house sector its own token and everything else the slate', () => {
    expect(toneOfSector('equity')).toBe('secEquity')
    expect(toneOfSector('rates')).toBe('secRates')
    expect(toneOfSector('fx')).toBe('secFx')
    expect(toneOfSector('energy')).toBe('secEnergy')
    expect(toneOfSector('metals')).toBe('secMetals')
    expect(toneOfSector('grains')).toBe('secGrains')
    expect(toneOfSector('livestock')).toBe('secLivestock')
    expect(toneOfSector('other')).toBe('chartVol')
    expect(toneOfSector('crypto')).toBe('chartVol')
    expect(toneOfSector('constructor')).toBe('chartVol')
  })
})

describe('yearLabels', () => {
  it('prints YYYY at the first shown column of each year and nothing elsewhere', () => {
    expect(yearLabels(INPUT.columns)).toEqual(['2011', '', '2012', ''])
    expect(yearLabels(['2011-12-30', '2012-01-31'])).toEqual(['2011', '2012'])
    expect(yearLabels([])).toEqual([])
  })

  it('leaves a column that is not a date without a year label', () => {
    expect(yearLabels(['', 'abc', '2011-01-03'])).toEqual(['', '', '2011'])
  })
})

describe('compositionMax and compositionCells', () => {
  it('takes the largest served instrument value, never gross or net', () => {
    expect(compositionMax(INPUT)).toBe(0.4)
    expect(compositionMax({ ...INPUT, rows: [{ kind: 'band', label: 'Equity', tone: 'secEquity' }] })).toBe(0)
  })

  it('brightens by value from a quarter to full and fills zero and null with the page colour', () => {
    const cells = compositionCells(INPUT, T)
    expect(cells).toHaveLength(12)
    const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col)!
    expect(at(1, 0).fill).toBe(interpolateHex(C.bg, C.secEquity, 0.25 + (0.75 * 0.1) / 0.4))
    expect(at(2, 3).fill).toBe(interpolateHex(C.bg, C.secEquity, 1))
    expect(at(1, 1).fill).toBe(C.bg)
    expect(at(1, 2).fill).toBe(C.bg)
    expect(at(4, 0).fill).toBe(C.bg)
    expect(at(4, 2).fill).toBe(interpolateHex(C.bg, C.secRates, 0.25 + (0.75 * 0.3) / 0.4))
    expect(at(2, 0).value).toBe(0.05)
    expect(at(1, 2).value).toBeNull()
  })

  it('draws a brighter cell for a larger value in the same sector', () => {
    const cells = compositionCells(INPUT, T)
    const lum = (hex: string) => Number.parseInt(hex.slice(1, 3), 16) + Number.parseInt(hex.slice(3, 5), 16) + Number.parseInt(hex.slice(5, 7), 16)
    const small = cells.find((c) => c.row === 2 && c.col === 0)!
    const large = cells.find((c) => c.row === 2 && c.col === 3)!
    expect(lum(large.fill)).toBeGreaterThan(lum(small.fill))
  })

  it('keeps every cell on the page colour when nothing is held', () => {
    const none: CompositionInput = { ...INPUT, rows: INPUT.rows.map((r) => (r.kind === 'band' ? r : { ...r, values: r.values.map(() => 0) })) }
    expect(compositionCells(none, T).every((c) => c.fill === C.bg)).toBe(true)
  })

  it('rejects a row whose length differs from the columns', () => {
    const bad: CompositionInput = { ...INPUT, rows: [{ kind: 'instrument', label: 'ES', sector: 'Equity', tone: 'secEquity', values: [1] }] }
    expect(() => compositionCells(bad, T)).toThrow(/values must be/)
    expect(() => compositionHeatOption({ ...INPUT, gross: [1] }, T)).toThrow(/gross/)
    expect(() => compositionStackOption({ ...INPUT, net: [1] }, T)).toThrow(/net/)
  })
})

describe('compositionHeatOption', () => {
  const option = compositionHeatOption(INPUT, T)
  const cells = seriesOf(option)[0]! as Series

  it('is one custom series of cells: instruments times columns, nothing on the band rows', () => {
    expect(seriesOf(option)).toHaveLength(1)
    expect(cells.id).toBe('cells')
    expect(cells.type).toBe('custom')
    expect(cells.silent).toBe(true)
    expect(cells.data).toHaveLength(12)
    const rows = new Set((cells.data as number[][]).map(([, row]) => row))
    expect([...rows].sort()).toEqual([1, 2, 4])
    expect(rows.has(0)).toBe(false)
    expect(rows.has(3)).toBe(false)
  })

  it('draws every cell as a rectangle without text, 0 and null in the page colour', () => {
    const drawn = renderCustom(cells, 12) as Rect[]
    expect(drawn.every((d) => d.type === 'rect')).toBe(true)
    expect(JSON.stringify(drawn)).not.toMatch(/"text"/)
    expect(drawn.map((d) => d.style.fill)).toEqual(compositionCells(INPUT, T).map((c) => c.fill))
    const data = cells.data as number[][]
    const blank = drawn.filter((_, i) => data[i]![1] === 1 && (data[i]![0] === 1 || data[i]![0] === 2))
    expect(blank.map((d) => d.style.fill)).toEqual([C.bg, C.bg])
  })

  it('puts every cell edge on a whole pixel, with a 1px row gutter and a 1px column gutter up to 60 columns', () => {
    const many = wide(60)
    const series = seriesOf(compositionHeatOption(many, T))[0]! as Series
    const drawn = renderCustom(series, 60) as Rect[]
    for (const d of drawn) for (const v of Object.values(d.shape)) expect(Number.isInteger(v)).toBe(true)
    // the next cell starts one pixel after this one ends
    for (let i = 0; i < 59; i++) expect(drawn[i]!.shape.x + drawn[i]!.shape.width + 1).toBe(drawn[i + 1]!.shape.x)
    // two rows in the plot (a band and an instrument): the instrument row is the second, 150px of 300
    expect(drawn[0]!.shape.y).toBe(150)
    expect(drawn[0]!.shape.height).toBe(149)
  })

  it('has no column gutter above 60 columns, so the cells touch', () => {
    const series = seriesOf(compositionHeatOption(wide(61), T))[0]! as Series
    const drawn = renderCustom(series, 61) as Rect[]
    for (const d of drawn) for (const v of Object.values(d.shape)) expect(Number.isInteger(v)).toBe(true)
    for (let i = 0; i < 60; i++) expect(drawn[i]!.shape.x + drawn[i]!.shape.width).toBe(drawn[i + 1]!.shape.x)
    expect(drawn[0]!.shape.height).toBe(149)
  })

  it('labels the columns by year and the rows by instrument, the band titles in their sector colour', () => {
    const o = option as unknown as {
      xAxis: { type: string; data: string[]; axisLabel: { formatter: (v: string, i: number) => string; interval: number } }
      yAxis: { type: string; inverse: boolean; data: string[]; axisLabel: { color: (v: string, i: number) => string } }
    }
    expect(o.xAxis.type).toBe('category')
    expect(o.xAxis.data).toEqual(INPUT.columns)
    expect(o.xAxis.axisLabel.interval).toBe(0)
    expect(INPUT.columns.map((c, i) => o.xAxis.axisLabel.formatter(c, i))).toEqual(['2011', '', '2012', ''])
    expect(o.yAxis.type).toBe('category')
    expect(o.yAxis.inverse).toBe(true)
    expect(o.yAxis.data).toEqual(['Equity', 'ES', 'NQ', 'Rates', 'ZN'])
    expect(o.yAxis.axisLabel.color('Equity', 0)).toBe(C.secEquity)
    expect(o.yAxis.axisLabel.color('Rates', 3)).toBe(C.secRates)
    expect(o.yAxis.axisLabel.color('ES', 1)).toBe(C.white)
  })

  it('takes every colour from the tokens', () => {
    const allowed = tokenValues(T)
    expect(strayColours(option, allowed)).toEqual([])
    // a cell fill is a mix of two tokens (the page colour and its sector's), so it follows the tokens:
    // the same input under the default tokens draws different fills, and the empty cells take each set's own page colour
    const under = (tokens: typeof T) => renderCustom(seriesOf(compositionHeatOption(INPUT, tokens))[0], 12) as Rect[]
    const mine = under(T).map((d) => d.style.fill)
    const theirs = under(DEFAULT_CHART_TOKENS).map((d) => d.style.fill)
    expect(mine).not.toEqual(theirs)
    expect(mine.filter((f) => f === C.bg)).toHaveLength(theirs.filter((f) => f === DEFAULT_CHART_TOKENS.color.bg).length)
  })

  it('draws an empty book without failing', () => {
    const empty = compositionHeatOption({ ...INPUT, columns: [], rows: [], gross: [], net: [] }, T)
    expect((seriesOf(empty)[0] as Series).data).toEqual([])
  })
})

describe('compositionStackOption', () => {
  const option = compositionStackOption(INPUT, T)
  const series = seriesOf(option) as Series[]
  const stacked = series.filter((s) => s.stack !== undefined)

  it('stacks one silent area per instrument in its sector colour, drawn with no outline', () => {
    expect(stacked.map((s) => s.name)).toEqual(['ES', 'NQ', 'ZN'])
    expect(new Set(stacked.map((s) => s.stack)).size).toBe(1)
    expect(stacked.map((s) => s.areaStyle?.color)).toEqual([C.secEquity, C.secEquity, C.secRates])
    expect(stacked.every((s) => s.lineStyle?.width === 0 && s.silent === true && s.type === 'line')).toBe(true)
    // A null in a lower instrument must not blank the areas above it: with 'all' ECharts carries the NaN
    // stack result up, so NQ and ZN would vanish at the column where ES is null. 'samesign' skips it.
    expect(stacked.every((s) => s.stackStrategy === 'samesign')).toBe(true)
    expect(stacked.map((s) => s.data)).toEqual([[0.1, 0, null, 0.2], [0.05, 0.1, 0.15, 0.4], [0, 0, 0.3, 0.1]])
  })

  it('draws the served Gross and Net as their own lines, not stacked, equal to the input', () => {
    const gross = series.find((s) => s.id === 'gross')!
    const net = series.find((s) => s.id === 'net')!
    expect(gross.name).toBe('Gross (API)')
    expect(net.name).toBe('Net (API)')
    expect(gross.stack).toBeUndefined()
    expect(net.stack).toBeUndefined()
    expect(gross.data).toEqual(INPUT.gross)
    expect(net.data).toEqual(INPUT.net)
    expect(gross.lineStyle?.color).toBe(C.chartS1)
    expect(net.lineStyle?.color).toBe(C.accent2)
    expect(gross.areaStyle).toBeUndefined()
  })

  it('draws a zero line and prints no stacked total', () => {
    expect(series.map((s) => s.id).filter((id) => id === 'zero')).toEqual(['zero'])
    expect(series.find((s) => s.id === 'zero')!.markLine).toBeTruthy()
    expect(series).toHaveLength(3 + 2 + 1)
    for (const s of series) {
      expect(s.label).toBeUndefined()
      expect(s.endLabel).toBeUndefined()
    }
    // the value axis is left to ECharts, which stacks the areas itself: no total is added here
    const y = (option as unknown as { yAxis: { min?: unknown; max?: unknown } }).yAxis
    expect(y.min).toBeUndefined()
    expect(y.max).toBeUndefined()
    expect(JSON.stringify(option)).not.toMatch(/total/i)
  })

  it('shares the column axis with the heat view: dates as categories, a year label at each first column', () => {
    const o = option as unknown as {
      xAxis: { type: string; data: string[]; boundaryGap: boolean; axisLabel: { formatter: (v: string, i: number) => string } }
      yAxis: { axisLabel: { formatter: (v: number) => string } }
    }
    expect(o.xAxis.type).toBe('category')
    expect(o.xAxis.data).toEqual(INPUT.columns)
    expect(o.xAxis.boundaryGap).toBe(false)
    expect(INPUT.columns.map((c, i) => o.xAxis.axisLabel.formatter(c, i))).toEqual(['2011', '', '2012', ''])
    expect(o.yAxis.axisLabel.formatter(0.25)).toBe('0.250')
  })

  it('takes every colour from the tokens', () => {
    expect(strayColours(option, tokenValues(T))).toEqual([])
  })
})

describe('describeComposition', () => {
  it('names the instruments, sectors and columns, then the sampling sentence', () => {
    expect(describeComposition(INPUT, 'heat')).toBe(
      'run_a gross exposure by instrument: 3 instruments in 2 sectors over 4 columns. Every session is shown.',
    )
    expect(describeComposition(INPUT, 'stack')).toBe(describeComposition(INPUT, 'heat'))
  })

  it('uses the singular for one instrument, one sector and one column', () => {
    const one: CompositionInput = {
      ...INPUT,
      columns: ['2024-01-02'],
      rows: [
        { kind: 'band', label: 'Equity', tone: 'secEquity' },
        { kind: 'instrument', label: 'ES', sector: 'Equity', tone: 'secEquity', values: [0.1] },
      ],
      gross: [0.1],
      net: [0.1],
    }
    expect(describeComposition(one, 'heat')).toBe(
      'run_a gross exposure by instrument: 1 instrument in 1 sector over 1 column. Every session is shown.',
    )
  })

  it('prints no number that the API did not send', () => {
    expect(describeComposition(INPUT, 'stack')).not.toMatch(/\d\.\d/)
  })
})

describe('compositionTable', () => {
  const table = compositionTable(INPUT)

  it('has an Instrument column that names the row, a Sector column and one column per shown session', () => {
    expect(table.caption).toBe('run_a gross exposure by instrument, each instrument at each shown session')
    expect(table.columns.map((c) => c.label)).toEqual(['Instrument', 'Sector', ...INPUT.columns])
    expect(table.columns[0]).toMatchObject({ key: 'instrument', rowHeader: true })
    expect(table.columns.slice(2).every((c) => c.numeric === true)).toBe(true)
  })

  it('lists each instrument with its sector, then Gross (API) and Net (API), as the API sent them', () => {
    expect(table.rows).toHaveLength(5)
    expect(table.rows[0]).toEqual({ instrument: 'ES', sector: 'Equity', c0: '0.100', c1: '0.000', c2: '', c3: '0.200' })
    expect(table.rows[2]).toEqual({ instrument: 'ZN', sector: 'Rates', c0: '0.000', c1: '0.000', c2: '0.300', c3: '0.100' })
    expect(table.rows[3]).toEqual({ instrument: 'Gross (API)', sector: '', c0: '0.150', c1: '0.100', c2: '0.450', c3: '0.700' })
    expect(table.rows[4]).toEqual({ instrument: 'Net (API)', sector: '', c0: '+0.150', c1: '-0.100', c2: '+0.450', c3: '-0.200' })
  })

  it('has no row for a band', () => {
    expect(table.rows.map((r) => r.instrument)).not.toContain('Equity')
  })
})

describe('compositionKey and compositionScaleNote', () => {
  it('names each sector present in its colour, and Gross and Net only in the stack view', () => {
    expect(compositionKey(INPUT, 'heat', T)).toEqual([
      { label: 'Equity', fill: C.secEquity },
      { label: 'Rates', fill: C.secRates },
    ])
    expect(compositionKey(INPUT, 'stack', T)).toEqual([
      { label: 'Equity', fill: C.secEquity },
      { label: 'Rates', fill: C.secRates },
      { label: 'Gross (API)', fill: C.chartS1 },
      { label: 'Net (API)', fill: C.accent2 },
    ])
  })

  it('explains the brightness scale up to the served maximum, and has none when nothing is held', () => {
    expect(compositionScaleNote(INPUT)).toBe('Brightness from black (0, not held) to 0.400 notional over equity; hue is the sector.')
    expect(compositionScaleNote({ ...INPUT, rows: [] })).toBeNull()
  })
})

describe('Composition', () => {
  async function draw(mode: 'heat' | 'stack') {
    fake.chart.setOption.mockClear()
    const view = render(createElement(Composition, { data: INPUT, mode, chartId: `test-${mode}` }))
    await act(async () => {
      await Promise.resolve()
    })
    return view
  }

  it('is an image named by the summary, drawn through the ECharts host, with a sector key and the brightness scale in the heat view', async () => {
    await draw('heat')
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(describeComposition(INPUT, 'heat'))
    expect(fake.chart.setOption).toHaveBeenCalledTimes(1)
    const drawn = fake.chart.setOption.mock.calls[0]![0] as { series: Series[] }
    expect(drawn.series[0]!.id).toBe('cells')
    const [key, scale, ...rest] = document.querySelectorAll('.echarts-scale')
    expect(rest).toHaveLength(0)
    expect(key!.textContent).toContain('Equity')
    expect(key!.textContent).toContain('Rates')
    expect(key!.textContent).not.toContain('Gross (API)')
    expect(key!.querySelectorAll('.echarts-scale-step')).toHaveLength(2)
    expect(scale!.textContent).toBe('Brightness from black (0, not held) to 0.400 notional over equity; hue is the sector.')
    // The key can hold up to ten entries, so both footer rows wrap instead of clipping in a narrow panel.
    for (const row of [key, scale] as HTMLElement[]) {
      expect(row.style.flexWrap).toBe('wrap')
      expect(row.style.height).toBe('auto')
    }
  })

  it('names Gross and Net in the key of the stack view and leaves the brightness scale out', async () => {
    await draw('stack')
    const drawn = fake.chart.setOption.mock.calls[0]![0] as { series: Series[] }
    expect(drawn.series.map((s) => s.id)).toContain('gross')
    const keys = document.querySelectorAll('.echarts-scale')
    expect(keys).toHaveLength(1)
    expect(keys[0]!.textContent).toContain('Gross (API)')
    expect(keys[0]!.textContent).toContain('Net (API)')
    expect(keys[0]!.textContent).not.toContain('Brightness')
    expect(keys[0]!.querySelectorAll('.echarts-scale-step')).toHaveLength(4)
  })

  it('has a table view with a Sector column', async () => {
    await draw('heat')
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByRole('table').textContent).toContain('Sector')
  })
})
