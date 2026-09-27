import { describe, expect, it } from 'vitest'
import { corrHeat, DEFAULT_CHART_TOKENS, monHeat, seagHeat } from '../theme'
import { renderCustom, seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'
import { describeHeatmap, heatmapCells, heatmapOption, heatmapTable, heatScale, mretRows, type HeatmapInput } from './heatmapModel'

const T = uniqueTokens()

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Cell {
  readonly children: { readonly shape?: Record<string, number>; readonly style: Record<string, string> }[]
}

const mret: HeatmapInput = {
  kind: 'mret',
  name: 'Monthly returns',
  unit: '%',
  columns: ['Jan', 'Feb', 'Mar'],
  rows: ['2 yr avg', '2021', '2020'],
  values: [
    [1.5, -2, null],
    [3, -4, null],
    [0, 0, null],
  ],
}

const corr: HeatmapInput = {
  kind: 'corr',
  name: 'Correlation',
  columns: ['NQ', 'ES', 'ZN'],
  rows: ['NQ', 'ES', 'ZN'],
  values: [
    [1, 0.95, -0.31],
    [0.95, 1, -0.05],
    [-0.31, -0.05, 1],
  ],
}

const mon: HeatmapInput = {
  kind: 'mon',
  name: '27F returns',
  unit: '%',
  columns: ['1D', '12M'],
  rows: ['NQ', 'ZN'],
  values: [
    [0.5, 30],
    [-1.2, -4],
  ],
  strongAt: [1, 10],
}

describe('mretRows (look spec 7.5 MRET)', () => {
  it('puts the N-year average first, then the years descending, and skips blanks in the mean', () => {
    const out = mretRows({ years: [2019, 2020, 2021], grid: [[1, null], [3, null], [null, null]] })
    expect(out.rows).toEqual(['3 yr avg', '2021', '2020', '2019'])
    expect(out.values[0]).toEqual([2, null])
    expect(out.values.slice(1)).toEqual([[null, null], [3, null], [1, null]])
  })
})

describe('heatmapCells', () => {
  it('fills MRET cells from the SEAG ramp, symmetric by the largest absolute value', () => {
    const cells = heatmapCells(mret, T)
    expect(cells).toHaveLength(9)
    const c = cells.find((x) => x.row === 1 && x.col === 1)!
    expect(c.value).toBe(-4)
    expect(c.fill).toBe(seagHeat(-4, 4, T).fill)
    expect(c.text).toBe(seagHeat(-4, 4, T).text)
    expect(c.label).toBe('-4.00')
    expect(cells.find((x) => x.row === 0 && x.col === 0)!.label).toBe('+1.50')
  })

  it('leaves a missing month black with no label', () => {
    const c = heatmapCells(mret, T).find((x) => x.row === 0 && x.col === 2)!
    expect(c).toMatchObject({ value: null, fill: T.color.bg, label: '' })
  })

  it('uses the CORR scale, grey on the diagonal', () => {
    const cells = heatmapCells(corr, T)
    expect(cells.find((x) => x.row === 0 && x.col === 0)!.fill).toBe(T.color.corrDiag)
    expect(cells.find((x) => x.row === 0 && x.col === 2)!.fill).toBe(corrHeat(-0.31, {}, T).fill)
    expect(cells.find((x) => x.row === 1 && x.col === 2)!.fill).toBe(T.color.corr0)
  })

  it('uses the MON scale with a threshold per column', () => {
    const cells = heatmapCells(mon, T)
    expect(cells.find((x) => x.row === 0 && x.col === 0)!.fill).toBe(monHeat(0.5, 1, T).fill)
    expect(cells.find((x) => x.row === 0 && x.col === 1)!.fill).toBe(T.color.heatUp2)
    expect(cells.find((x) => x.row === 1 && x.col === 1)!.fill).toBe(T.color.heatDn1)
  })
})

describe('heatmapOption', () => {
  it('draws one custom item per cell on category axes, months across the top', () => {
    const option = heatmapOption(mret, T) as Record<string, any>
    const [series] = seriesOf(option)
    expect(series!.type).toBe('custom')
    expect(series!.data).toHaveLength(9)
    expect((series!.data as unknown[])[0]).toEqual([0, 0])
    expect((series!.data as unknown[])[2]).toEqual([2, 0])
    expect(option.xAxis).toMatchObject({ type: 'category', position: 'top', data: ['Jan', 'Feb', 'Mar'] })
    expect(option.yAxis).toMatchObject({ type: 'category', inverse: true, data: mret.rows })
    expect(option.animation).toBe(false)
    expect(option.backgroundColor).toBe(T.color.bg)
  })

  it('snaps every cell to whole pixels with a clean 2px black gutter between neighbours', () => {
    // FAKE_PLOT is 400 by 300: three columns of 133.33px and three rows of 100px.
    const drawn = renderCustom(seriesOf(heatmapOption(mret, T))[0], 9) as Cell[]
    const rect = (i: number) => drawn[i]!.children[0]!.shape as unknown as Rect
    for (let i = 0; i < 9; i++) {
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(Number.isInteger(rect(i)[k]), `${i} ${k}`).toBe(true)
    }
    expect(rect(1).x - (rect(0).x + rect(0).width)).toBe(2)
    expect(rect(2).x - (rect(1).x + rect(1).width)).toBe(2)
    expect(rect(3).y - (rect(0).y + rect(0).height)).toBe(2)
    expect(rect(0)).toEqual({ x: 1, y: 1, width: 131, height: 98 })
    expect(rect(2).x + rect(2).width).toBe(399)
  })

  it('fills each cell from its scale and prints its value in the text colour the scale chose', () => {
    const drawn = renderCustom(seriesOf(heatmapOption(mret, T))[0], 9) as Cell[]
    expect(drawn[1]!.children[0]!.style.fill).toBe(seagHeat(-2, 4, T).fill)
    const text = drawn[1]!.children[1]!
    expect(text.style).toMatchObject({ text: '-2.00', fill: seagHeat(-2, 4, T).text, align: 'center', verticalAlign: 'middle' })
    expect(text.style.font).toBe(`${T.font.size}px ${T.font.family}`)
    // A blank cell stays black with no text.
    expect(drawn[2]!.children).toHaveLength(1)
    expect(drawn[2]!.children[0]!.style.fill).toBe(T.color.bg)
  })

  it('sets every label at the chart font size', () => {
    const option = heatmapOption(mret, T) as Record<string, any>
    expect(option.xAxis.axisLabel.fontSize).toBe(T.font.size)
    expect(option.yAxis.axisLabel.fontSize).toBe(T.font.size)
  })

  it('labels CORR rows amber-filled with black text (FXC convention)', () => {
    const option = heatmapOption(corr, T) as Record<string, any>
    expect(option.yAxis.axisLabel).toMatchObject({ backgroundColor: T.color.data, color: T.color.bg })
  })

  it.each([mret, corr, mon])('takes every colour from the tokens or the heat scales ($kind)', (input) => {
    const allowed = new Set([...tokenValues(T), ...heatmapCells(input, T).flatMap((c) => [c.fill, c.text])])
    const option = heatmapOption(input, T)
    expect(strayColours(option, allowed)).toEqual([])
    expect(strayColours(renderCustom(seriesOf(option)[0], input.rows.length * input.columns.length), allowed)).toEqual([])
  })

  it('born failing: a literal colour in an option is caught', () => {
    const allowed = tokenValues(T)
    expect(strayColours({ itemStyle: { color: '#FFFFFF' } }, allowed)).toHaveLength(1)
  })
})

describe('heatScale (the legend under the grid)', () => {
  it('gives the five CORR steps from the tokens', () => {
    const s = heatScale(corr, T)
    expect(s.kind).toBe('steps')
    expect(s.kind === 'steps' && s.steps.map((x) => x.fill)).toEqual([
      T.color.corrDn2, T.color.corrDn1, T.color.corr0, T.color.corrUp1, T.color.corrUp2,
    ])
  })

  it('gives the MRET ramp from min to max, labelled at both ends', () => {
    const s = heatScale(mret, T)
    expect(s.kind).toBe('ramp')
    if (s.kind !== 'ramp') return
    // The scale ends carry the unit: cells print bare numbers, so the legend says what they are.
    expect(s.low).toBe('-4.00%')
    expect(s.high).toBe('+3.00%')
    expect(s.stops[0]).toMatchObject({ at: 0, fill: seagHeat(-4, 4, T).fill })
    expect(s.stops[s.stops.length - 1]).toMatchObject({ at: 1, fill: seagHeat(3, 4, T).fill })
  })

  it('gives the four MON steps', () => {
    const s = heatScale(mon, T)
    expect(s.kind === 'steps' && s.steps.map((x) => x.fill)).toEqual([
      T.color.heatDn2, T.color.heatDn1, T.color.heatUp1, T.color.heatUp2,
    ])
  })
})

describe('describeHeatmap and heatmapTable', () => {
  it('summarises size, extremes with their cells, and blanks', () => {
    expect(describeHeatmap(mret)).toBe(
      'Monthly returns: 3 rows by 3 columns; low -4.00% at 2021 Feb, high +3.00% at 2021 Jan; 3 blank cells.',
    )
  })

  it('born failing: leaves terminal-computed rows (the MRET average) out of the extremes', () => {
    const avg = { ...mret, rows: ['1 yr avg', ...mret.rows.slice(1)], derivedRows: 1, values: [[-9, 9, null], ...mret.values.slice(1)] }
    const text = describeHeatmap(avg)
    expect(text).not.toContain('avg')
    expect(text).not.toContain('9.00')
  })

  it('leaves the CORR diagonal out of the extremes', () => {
    expect(describeHeatmap(corr)).toContain('low -0.31 at NQ ZN, high +0.95 at NQ ES')
  })

  it('says so when every cell is blank', () => {
    expect(describeHeatmap({ ...mret, values: [[null], [null]], rows: ['a', 'b'], columns: ['x'] })).toBe(
      'Monthly returns: 2 rows by 1 columns, all blank.',
    )
  })

  it('gives the same numbers as a table, blanks empty', () => {
    const table = heatmapTable(mret)
    expect(table.caption).toBe('Monthly returns')
    expect(table.columns.map((c) => c.label)).toEqual(['Year', 'Jan', 'Feb', 'Mar'])
    expect(table.rows[1]).toEqual({ row: '2021', c0: '+3.00', c1: '-4.00', c2: '' })
  })

  it('uses the defaults when no tokens are passed', () => {
    expect(heatmapCells(corr)[0]!.fill).toBe(DEFAULT_CHART_TOKENS.color.corrDiag)
  })
})

describe('column groups (look spec 7.8, the CORR sector header row)', () => {
  const corr: HeatmapInput = {
    kind: 'corr', name: 'c', columns: ['ES', 'NQ', 'ZN'], rows: ['ES', 'NQ', 'ZN'],
    values: [[1, 0.9, -0.3], [0.9, 1, -0.3], [-0.3, -0.3, 1]],
    columnGroups: [{ label: 'Equity', from: 0, to: 1 }, { label: 'Rates', from: 2, to: 2 }],
  }

  it('makes room above the column labels and draws one white heading centred over each span', () => {
    const option = heatmapOption(corr, T) as Record<string, any>
    expect(option.grid.top).toBeGreaterThan((heatmapOption({ ...corr, columnGroups: undefined }, T) as Record<string, any>).grid.top)
    const groups = seriesOf(option).find((s) => s.id === 'groups')!
    const drawn = renderCustom(groups, 1)[0] as { children: Array<{ type: string; x?: number; style: Record<string, unknown> }> }
    const texts = drawn.children.filter((c) => c.type === 'text')
    expect(texts.map((t) => t.style.text)).toEqual(['Equity', 'Rates'])
    // FAKE_PLOT is 400 wide: three columns of 133.33px; Equity spans the first two.
    expect(texts[0]!.x).toBeCloseTo(133.33, 1)
    expect(texts[1]!.x).toBeCloseTo(333.33, 1)
    expect(texts[0]!.style.fill).toBe(T.color.white)
  })

  it('draws no group row without groups', () => {
    expect(seriesOf(heatmapOption({ ...corr, columnGroups: undefined }, T)).some((s) => s.id === 'groups')).toBe(false)
  })
})
