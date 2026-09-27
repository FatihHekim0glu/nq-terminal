import { describe, expect, it } from 'vitest'
import { seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'
import { describePScatter, multipleTests, pScatterOption, pScatterTable, type PScatterInput } from './pScatterModel'

const T = uniqueTokens()

const input: PScatterInput = {
  name: 'Registry p-values',
  alpha: 0.05,
  points: [
    { label: 'dtsmom_v0', p: 0.3 },
    { label: 'overnight_v0', p: 0.001 },
    { label: 'rebal_v0', p: 0.02 },
    { label: 'za_v0', p: 0.01 },
    { label: 'mim_v0', p: 0.04 },
  ],
}

const byId = (option: unknown, id: string) => seriesOf(option).find((s) => s.id === id) as Record<string, any>

describe('multipleTests (Bonferroni, Holm step-down, BH step-up)', () => {
  it('sorts by p and gives each rank its three boundaries', () => {
    const rows = multipleTests(input.points, 0.05)
    expect(rows.map((r) => r.label)).toEqual(['overnight_v0', 'za_v0', 'rebal_v0', 'mim_v0', 'dtsmom_v0'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5])
    expect(rows.every((r) => r.bonferroni === 0.01)).toBe(true)
    expect(rows.map((r) => r.holm)).toEqual([0.01, 0.0125, 0.05 / 3, 0.025, 0.05])
    expect(rows.map((r) => r.bh)).toEqual([0.01, 0.02, 0.03, 0.04, 0.05].map((_, i) => ((i + 1) * 0.05) / 5))
    expect(rows[3]!.bh).toBeCloseTo(0.04)
  })

  it('passes Bonferroni at p <= alpha/m, stops Holm at the first failure, and lets BH step up', () => {
    const rows = multipleTests(input.points, 0.05)
    expect(rows.map((r) => r.passes)).toEqual([
      { bonferroni: true, holm: true, bh: true },
      { bonferroni: true, holm: true, bh: true },
      { bonferroni: false, holm: false, bh: true },
      { bonferroni: false, holm: false, bh: true },
      { bonferroni: false, holm: false, bh: false },
    ])
  })

  it('holds Holm at the first failure even when a later p would pass its own line', () => {
    const rows = multipleTests([{ label: 'a', p: 0.02 }, { label: 'b', p: 0.024 }], 0.05)
    expect(rows.map((r) => r.passes.holm)).toEqual([true, true])
    const stopped = multipleTests([{ label: 'a', p: 0.03 }, { label: 'b', p: 0.031 }], 0.05)
    expect(stopped.map((r) => r.passes.holm)).toEqual([false, false])
  })

  it('refuses a p-value outside [0, 1] or an alpha outside (0, 1)', () => {
    expect(() => multipleTests([{ label: 'x', p: 1.2 }], 0.05)).toThrow(/p-value/)
    expect(() => multipleTests([{ label: 'x', p: 0.2 }], 0)).toThrow(/alpha/)
  })
})

describe('pScatterOption (look spec 6.3 PScatter)', () => {
  it('plots sorted p against rank as white points, hollow where BH does not pass', () => {
    const points = byId(pScatterOption(input, T), 'points')
    expect(points.type).toBe('scatter')
    expect(points.data.map((d: { value: number[] }) => d.value)).toEqual([[1, 0.001], [2, 0.01], [3, 0.02], [4, 0.04], [5, 0.3]])
    expect(points.data[0].itemStyle).toEqual({ color: T.color.white, borderColor: T.color.white, borderWidth: 1.5 })
    expect(points.data[4].itemStyle).toEqual({ color: T.color.bg, borderColor: T.color.white, borderWidth: 1.5 })
  })

  it('draws the Bonferroni, Holm and BH boundaries in their house colours, each with a text label', () => {
    const option = pScatterOption(input, T)
    const bonf = byId(option, 'bonferroni')
    const holm = byId(option, 'holm')
    const bh = byId(option, 'bh')
    expect(holm.lineStyle.color).toBe(T.color.chartGreen)
    expect(bh.lineStyle.color).toBe(T.color.accent2)
    expect(holm.step).toBe('middle')
    expect(holm.data[0]).toEqual([0.5, 0.01])
    expect(bh.data[0]).toEqual([0.5, 0.005])
    expect(bh.data[1][0]).toBe(5.5)
    expect(bh.data[1][1]).toBeCloseTo(0.055, 12)
    for (const [s, label] of [[holm, 'Holm'], [bh, 'BH']] as const) {
      expect(s.endLabel).toMatchObject({ show: true, formatter: label, color: s.lineStyle.color })
    }
    const [from, to] = bonf.markLine.data[0]
    expect(from).toMatchObject({
      coord: [0.5, 0.01],
      lineStyle: { color: T.color.chartMagenta, width: 1, type: 'solid' },
      label: { show: true, formatter: 'Bonferroni', color: T.color.chartMagenta, position: 'end' },
    })
    expect(to).toEqual({ coord: [5.5, 0.01] })
  })

  it('draws the flat Bonferroni line as a markLine, which ECharts puts on a pixel centre (one crisp row)', () => {
    const bonf = byId(pScatterOption(input, T), 'bonferroni')
    expect(bonf.type).toBe('line')
    expect(bonf.data).toEqual([])
    expect(bonf.markLine).toMatchObject({ silent: true, symbol: ['none', 'none'], animation: false })
  })

  it('labels the ranks 1 to m on integer ticks', () => {
    const x = (pScatterOption(input, T) as Record<string, any>).xAxis
    expect(x).toMatchObject({ type: 'value', min: 0, interval: 1 })
    const format = x.axisLabel.formatter as (v: number) => string
    expect([0, 1, 5, 6].map(format)).toEqual(['', '1', '5', ''])
  })

  it('ticks only the ranks 1 to m and leaves just the room the boundary labels need', () => {
    const x = (pScatterOption(input, T) as Record<string, any>).xAxis
    const m = input.points.length
    const ranks = Array.from({ length: m }, (_, i) => i + 1)
    expect(x.axisTick.customValues).toEqual(ranks)
    expect(x.axisLabel.customValues).toEqual(ranks)
    expect(x.max - (m + 0.5)).toBeGreaterThan(0)
    expect(x.max - (m + 0.5)).toBeLessThanOrEqual(Math.max(1, m * 0.1))
  })

  it('keeps the p axis line and ticks at the right edge, not at x = 0', () => {
    for (const scale of ['log', 'linear'] as const) {
      const y = [(pScatterOption({ ...input, scale }, T) as Record<string, any>).yAxis].flat()[0]
      expect(y.position).toBe('right')
      expect(y.axisLine.onZero).toBe(false)
    }
  })

  it('uses a log p axis on the right by default, linear on request', () => {
    const log = pScatterOption(input, T) as Record<string, any>
    expect([log.yAxis].flat()[0]).toMatchObject({ type: 'log', position: 'right', max: 1 })
    expect([log.yAxis].flat()[0].min).toBe(0.0001)
    const lin = pScatterOption({ ...input, scale: 'linear' }, T) as Record<string, any>
    expect([lin.yAxis].flat()[0]).toMatchObject({ type: 'value', min: 0, max: 1 })
  })

  it('takes every colour from the tokens', () => {
    expect(strayColours(pScatterOption(input, T), tokenValues(T))).toEqual([])
  })
})

describe('describePScatter and pScatterTable', () => {
  it('summarises the count, the lowest p and what passes each rule', () => {
    expect(describePScatter(input)).toBe(
      'Registry p-values: 5 p-values at alpha 0.05; lowest 0.0010 (overnight_v0); passing: Bonferroni 2, Holm 2, BH 4.',
    )
  })

  it('lists each hypothesis with its rank, p, boundaries and the rules it passes', () => {
    const table = pScatterTable(input)
    expect(table.columns.map((c) => c.label)).toEqual(['Rank', 'Hypothesis', 'p', 'Bonferroni line', 'Holm line', 'BH line', 'Passes'])
    expect(table.rows[0]).toEqual({ rank: 1, label: 'overnight_v0', p: '0.0010', bonferroni: '0.0100', holm: '0.0100', bh: '0.0100', passes: 'Bonferroni, Holm, BH' })
    expect(table.rows[4]!.passes).toBe('none')
  })
})
