import { describe, expect, it } from 'vitest'
import { renderCustom, seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'
import { barLadderOption, barLadderTable, describeBarLadder, type BarLadderInput } from './barLadderModel'

const T = uniqueTokens()

const blocks: BarLadderInput = {
  name: 'Net R by block',
  unit: 'R',
  ci: '95% confidence interval',
  bars: [
    { label: '2010-13', value: -0.12, lo: -0.3, hi: 0.06, n: 801 },
    { label: '2014-17', value: 0, lo: -0.15, hi: 0.15, n: 760 },
    { label: '2018-21', value: 0.16, lo: 0.01, hi: 0.31, n: 744 },
  ],
}

const byId = (option: unknown, id: string) => seriesOf(option).find((s) => s.id === id) as Record<string, any>

describe('barLadderOption (look spec 6.3 BarLadder)', () => {
  it('draws signed bars: bar-pos at or above zero, bar-neg below', () => {
    const bars = byId(barLadderOption(blocks, T), 'bars')
    expect(bars.type).toBe('bar')
    expect(bars.data.map((d: { value: number; itemStyle: { color: string } }) => [d.value, d.itemStyle.color])).toEqual([
      [-0.12, T.color.barNeg],
      [0, T.color.barPos],
      [0.16, T.color.barPos],
    ])
  })

  it('prints each value under its category label, with its sign', () => {
    const option = barLadderOption(blocks, T) as Record<string, any>
    const x = [option.xAxis].flat()[0]
    expect(x).toMatchObject({ type: 'category', data: ['2010-13', '2014-17', '2018-21'] })
    const format = x.axisLabel.formatter as (value: string, index: number) => string
    expect(format('2010-13', 0)).toBe('2010-13\n-0.12')
    expect(format('2018-21', 2)).toBe('2018-21\n+0.16')
  })

  it('draws white CI whiskers with caps from lo to hi, and includes them in the y range', () => {
    const option = barLadderOption(blocks, T)
    const whiskers = byId(option, 'whiskers')
    expect(whiskers.type).toBe('custom')
    expect(whiskers.data).toEqual([[0, -0.3, 0.06], [1, -0.15, 0.15], [2, 0.01, 0.31]])
    expect(whiskers.encode).toEqual({ x: 0, y: [1, 2] })
    const drawn = renderCustom(whiskers, 3) as { type: string; children: { type: string; style: { stroke: string } }[] }[]
    expect(drawn[0]!.type).toBe('group')
    expect(drawn[0]!.children).toHaveLength(3)
    expect(drawn[0]!.children.every((c) => c.type === 'line' && c.style.stroke === T.color.white)).toBe(true)
  })

  it('puts the 1px whiskers and caps on pixel centres, so they draw crisp white, not two grey columns', () => {
    const drawn = renderCustom(byId(barLadderOption(blocks, T), 'whiskers'), 3) as { children: { shape: Record<string, number> }[] }[]
    const centred = (v: number) => Math.abs(Math.abs(v % 1) - 0.5) < 1e-9
    for (const group of drawn) {
      const [stem, capTop, capBottom] = group.children.map((c) => c.shape)
      expect(centred(stem!.x1!) && stem!.x1 === stem!.x2, JSON.stringify(stem)).toBe(true)
      for (const cap of [capTop!, capBottom!]) expect(centred(cap.y1!) && cap.y1 === cap.y2, JSON.stringify(cap)).toBe(true)
    }
  })

  it('draws no whisker for a bar without an interval', () => {
    const option = barLadderOption({ ...blocks, bars: [{ label: 'a', value: 1 }] }, T)
    expect(byId(option, 'whiskers')).toBeUndefined()
  })

  it('keeps a solid zero line and an optional dashed reference line with a label', () => {
    const option = barLadderOption({ ...blocks, reference: { value: 0.1, label: 'Break-even' } }, T)
    const data = byId(option, 'bars').markLine.data as { yAxis: number; name?: string; lineStyle: { color: string; type: unknown } }[]
    expect(data[0]).toMatchObject({ yAxis: 0, lineStyle: { color: T.color.zeroLine, type: 'solid' } })
    expect(data[1]).toMatchObject({ yAxis: 0.1, name: 'Break-even', lineStyle: { color: T.color.data } })
  })

  it('draws a dashed amber marker between categories at a fractional position (break-even cost)', () => {
    const option = barLadderOption({ ...blocks, marker: { at: 1.6, label: 'Break-even' } }, T)
    const marker = byId(option, 'marker')
    expect(marker.type).toBe('custom')
    const [drawn] = renderCustom(marker, 1) as { children: { type: string; shape?: Record<string, number>; style: Record<string, unknown> }[] }[]
    const [line, text] = drawn!.children
    // Categories 1 and 2 sit at 10px and 20px in the fake API, so 1.6 is at 16px, drawn on the pixel
    // centre (16.5) so the 1px line stays crisp, full plot height.
    expect(line).toMatchObject({ type: 'line', shape: { x1: 16.5, x2: 16.5, y1: 0, y2: 300 }, style: { stroke: T.color.data, lineDash: [4, 3] } })
    expect(text).toMatchObject({ type: 'text', style: { text: 'Break-even', fill: T.color.data } })
    expect(strayColours(drawn, tokenValues(T))).toEqual([])
  })

  it('leaves the value axis to find its own nice range unless a reference line needs room', () => {
    const plain = barLadderOption(blocks, T) as Record<string, any>
    expect([plain.yAxis].flat()[0].min).toBeUndefined()
    const withRef = barLadderOption({ ...blocks, reference: { value: 0.5, label: 'x' } }, T) as Record<string, any>
    expect(([withRef.yAxis].flat()[0].max as (e: { max: number }) => number)({ max: 0.31 })).toBe(0.5)
  })

  it('puts the value axis on the right', () => {
    const option = barLadderOption(blocks, T) as Record<string, any>
    expect([option.yAxis].flat()[0]).toMatchObject({ type: 'value', position: 'right' })
  })

  // U18: a long unit (the cost ladder's phrase) repeated on every tick took about 200px, 18% of the
  // card, and squeezed the bars at 1366. '%' still attaches to the tick (short and self-evident, spec
  // 6.3); any other unit, long or short, is left to the axis name or the card's existing 'Unit:' line
  // (barLadderModel.u18.test.ts covers the axis name; the caller's card owns the 'Unit:' line).
  it("attaches '%' to the value axis labels; leaves any other unit off them", () => {
    const pct = barLadderOption({ ...blocks, unit: '%' }, T) as Record<string, any>
    expect([pct.yAxis].flat()[0].axisLabel.formatter(0.05)).toBe('0.05%')
    const r = barLadderOption(blocks, T) as Record<string, any>
    expect([r.yAxis].flat()[0].axisLabel.formatter(-0.2)).toBe('-0.2')
  })

  it('takes every colour from the tokens', () => {
    const option = barLadderOption({ ...blocks, reference: { value: 0.1, label: 'x' } }, T)
    const allowed = tokenValues(T)
    expect(strayColours(option, allowed)).toEqual([])
    expect(strayColours(renderCustom(byId(option, 'whiskers'), 3), allowed)).toEqual([])
  })
})

describe('emphasis (an outlined bar, the spec curve headline or the placebo actual)', () => {
  it('outlines an emphasised bar with the chartS1 token, leaving its fill colour unchanged', () => {
    const emphasised: BarLadderInput = { ...blocks, bars: [{ ...blocks.bars[0]!, emphasis: true }, blocks.bars[1]!, blocks.bars[2]!] }
    const bars = byId(barLadderOption(emphasised, T), 'bars')
    expect(bars.data[0].itemStyle).toEqual({ color: T.color.barNeg, borderColor: T.color.chartS1, borderWidth: 2 })
    expect(bars.data[1].itemStyle).toEqual({ color: T.color.barPos })
    expect(bars.data[2].itemStyle).toEqual({ color: T.color.barPos })
  })

  it('adds no key to itemStyle for a bar without emphasis, so the option stays deep-equal to today\'s', () => {
    const bars = byId(barLadderOption(blocks, T), 'bars')
    for (const d of bars.data as { itemStyle: Record<string, unknown> }[]) expect(Object.keys(d.itemStyle)).toEqual(['color'])
    const explicitlyFalse = byId(barLadderOption({ ...blocks, bars: blocks.bars.map((b) => ({ ...b, emphasis: false })) }, T), 'bars')
    for (const d of explicitlyFalse.data as { itemStyle: Record<string, unknown> }[]) expect(Object.keys(d.itemStyle)).toEqual(['color'])
  })
})

describe('describeBarLadder and barLadderTable', () => {
  it('summarises signs, extremes and the interval', () => {
    expect(describeBarLadder(blocks)).toBe(
      'Net R by block: 3 bars, 2 positive and 1 negative; high +0.16 R (2018-21), low -0.12 R (2010-13). Whiskers show the 95% confidence interval.',
    )
  })

  it('handles an empty ladder', () => {
    expect(describeBarLadder({ ...blocks, bars: [] })).toBe('Net R by block: no values.')
  })

  it('lists every bar with its interval and count', () => {
    const table = barLadderTable(blocks)
    expect(table.columns.map((c) => c.label)).toEqual(['Bar', 'Value', 'CI low', 'CI high', 'n'])
    expect(table.rows[0]).toEqual({ label: '2010-13', value: '-0.12', lo: '-0.30', hi: '+0.06', n: 801 })
  })
})
