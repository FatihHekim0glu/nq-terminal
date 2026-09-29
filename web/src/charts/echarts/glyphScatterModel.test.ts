import { describe, expect, it } from 'vitest'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS } from '../theme'
import { seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'
import {
  describeGlyphScatter,
  glyphDomain,
  glyphScatterOption,
  glyphScatterTable,
  offScaleLines,
  placedPoints,
  type GlyphAxis,
  type GlyphPoint,
  type GlyphScatterInput,
} from './glyphScatterModel'

const T = uniqueTokens()
const C = T.color
const D = DEFAULT_CHART_TOKENS.color

const KIND = { up: 'holds', down: 'lost', ring: 'undecided' } as const
const X: GlyphAxis = { label: 'p before', scale: 'log', format: 'p', inverse: true }
const Y: GlyphAxis = { label: 'p after', scale: 'log', format: 'p', inverse: true }
const pt = (tag: string, x: number, y: number, glyph: GlyphPoint['glyph'], more: Partial<GlyphPoint> = {}): GlyphPoint => ({
  label: `Strategy ${tag}`, tag, x, y, glyph, kind: KIND[glyph], ...more,
})

const INPUT: GlyphScatterInput = {
  name: 'Deflation',
  x: X,
  y: Y,
  points: [
    pt('A', 0.0004, 0.003, 'up'),
    pt('B', 0.002, 0.011, 'up', { hollow: true }),
    pt('C', 0.008, 0.06, 'down'),
    pt('D', 0.2, 0.31, 'ring'),
  ],
}

interface Item {
  value: number[]
  symbol: string
  symbolRotate: number
  itemStyle: { color: string; borderColor?: string; borderWidth?: number }
  label: { show: boolean; formatter: string; position: string; color: string; fontFamily: string; fontSize: number }
}
interface Axis {
  type: string
  logBase?: number
  min: number
  max: number
  interval?: number
  inverse?: boolean
  name: string
  axisLabel: { formatter: (v: number) => string }
}
type Series = Record<string, unknown> & { id: string; type: string; data: unknown[] }

const seriesById = (option: unknown, id: string) => seriesOf(option).find((s) => s.id === id) as Series | undefined
const itemsOf = (option: unknown) => seriesById(option, 'points')!.data as Item[]
const axisOf = (option: unknown, which: 'xAxis' | 'yAxis') => (option as Record<string, Axis>)[which]!

describe('glyphDomain', () => {
  it('floors a log p axis one decade below the lowest positive value and tops it at 1', () => {
    expect(glyphDomain(X, [0.00031, 0.2, 0.9])).toMatchObject({ min: 1e-4, max: 1 })
    expect(glyphDomain(X, [0.0000042, 0.5])).toMatchObject({ min: 1e-6, max: 1 })
  })

  it('gives a value that sits on a decade room below it', () => {
    expect(glyphDomain(X, [0.001, 0.5])).toMatchObject({ min: 1e-4, max: 1 })
    expect(glyphDomain(X, [1, 1])).toMatchObject({ min: 0.1, max: 1 })
  })

  it('floors and tops a log number axis by whole decades', () => {
    const axis: GlyphAxis = { label: 'Trades', scale: 'log', format: 'number' }
    expect(glyphDomain(axis, [3, 40, 700])).toMatchObject({ min: 1, max: 1000 })
    expect(glyphDomain(axis, [10, 100])).toMatchObject({ min: 1, max: 100 })
  })

  it('ignores values a log axis cannot show', () => {
    expect(glyphDomain(X, [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.02])).toMatchObject({ min: 1e-2, max: 1 })
  })

  it('lets a fixed min or max win over the values', () => {
    expect(glyphDomain({ ...X, min: 1e-5, max: 0.5 }, [0.02, 0.4])).toMatchObject({ min: 1e-5, max: 0.5 })
    expect(glyphDomain({ ...X, min: 1e-5 }, [0.02, 0.4])).toMatchObject({ min: 1e-5, max: 1 })
  })

  it('does not take a fixed bound a log axis cannot draw', () => {
    expect(glyphDomain({ ...X, min: 0 }, [0.02, 0.4])).toMatchObject({ min: 1e-2, max: 1 })
    expect(glyphDomain({ ...X, max: -2 }, [0.02, 0.4])).toMatchObject({ min: 1e-2, max: 1 })
  })

  it('has a usable log domain when there is nothing positive to place', () => {
    const empty = glyphDomain(X, [])
    expect(empty.min).toBeGreaterThan(0)
    expect(empty.max).toBeGreaterThan(empty.min)
    const number = glyphDomain({ label: 'n', scale: 'log', format: 'number' }, [])
    expect(number.max).toBeGreaterThan(number.min)
  })

  it('rounds a linear axis out over the values and zero, on an even interval', () => {
    const axis: GlyphAxis = { label: 'Sharpe', scale: 'linear', format: 'number' }
    expect(glyphDomain(axis, [1.2, 3.9])).toEqual({ min: 0, max: 4, interval: 0.5 })
    expect(glyphDomain(axis, [-6.91, 7.43])).toEqual({ min: -8, max: 8, interval: 2 })
    expect(glyphDomain(axis, [])).toEqual({ min: -1, max: 1, interval: 1 })
  })

  it('lets a fixed bound win on a linear axis and rounds the free side', () => {
    const axis: GlyphAxis = { label: 'Sharpe', scale: 'linear', format: 'number', max: 2 }
    expect(glyphDomain(axis, [-0.7, 3.4])).toMatchObject({ min: -1, max: 2 })
    expect(glyphDomain({ ...axis, min: -3, max: 3 }, [0.1])).toMatchObject({ min: -3, max: 3 })
  })
})

describe('placedPoints', () => {
  it('draws a point where it is, not off', () => {
    const { drawn, dropped } = placedPoints(INPUT)
    expect(dropped).toBe(0)
    expect(drawn).toHaveLength(4)
    expect(drawn[0]).toMatchObject({ tag: 'A', x: 0.0004, y: 0.003, px: 0.0004, py: 0.003, off: false })
  })

  it('drops a non-finite value and a non-positive one on a log axis, and counts them', () => {
    const { drawn, dropped } = placedPoints({
      ...INPUT,
      points: [
        pt('A', 0.01, 0.02, 'up'),
        pt('B', Number.NaN, 0.02, 'up'),
        pt('C', 0.01, Number.POSITIVE_INFINITY, 'down'),
        pt('D', 0, 0.02, 'ring'),
        pt('E', 0.01, -0.5, 'ring'),
      ],
    })
    expect(drawn.map((p) => p.tag)).toEqual(['A'])
    expect(dropped).toBe(4)
  })

  it('keeps zero and negative values on a linear axis', () => {
    const linear: GlyphAxis = { label: 'v', scale: 'linear', format: 'number' }
    const { drawn, dropped } = placedPoints({ name: 'n', x: linear, y: linear, points: [pt('A', 0, -2, 'up'), pt('B', -1, 1, 'down')] })
    expect(dropped).toBe(0)
    expect(drawn.map((p) => [p.px, p.py])).toEqual([[0, -2], [-1, 1]])
  })

  it('pins a point outside a fixed domain to the edge, off, with its true values kept', () => {
    const { drawn } = placedPoints({
      ...INPUT,
      x: { ...X, min: 1e-4 },
      points: [pt('A', 0.00002, 0.02, 'up'), pt('B', 0.02, 1.5, 'down'), pt('C', 0.02, 0.02, 'ring')],
    })
    expect(drawn[0]).toMatchObject({ x: 0.00002, y: 0.02, px: 1e-4, py: 0.02, off: true })
    expect(drawn[1]).toMatchObject({ x: 0.02, y: 1.5, px: 0.02, py: 1, off: true })
    expect(drawn[2]).toMatchObject({ off: false })
  })

  it('pins on a linear axis too', () => {
    const linear: GlyphAxis = { label: 'v', scale: 'linear', format: 'number', min: -2, max: 2 }
    const { drawn } = placedPoints({ name: 'n', x: linear, y: linear, points: [pt('A', 5, -9, 'up')] })
    expect(drawn[0]).toMatchObject({ x: 5, y: -9, px: 2, py: -2, off: true })
  })

  it('places nothing and drops nothing for no points', () => {
    expect(placedPoints({ ...INPUT, points: [] })).toEqual({ drawn: [], dropped: 0 })
  })
})

describe('offScaleLines', () => {
  const input: GlyphScatterInput = {
    ...INPUT,
    lines: [
      { axis: 'x', value: 0.05, label: 'alpha before', tone: 'data' },
      { axis: 'y', value: 0.05, label: 'alpha after', tone: 'accent' },
      { axis: 'y', value: 0.0000001, label: 'far below', tone: 'muted' },
      { axis: 'x', value: 4, label: 'above one', tone: 'muted' },
    ],
  }

  it('returns the lines outside their axis domain and only those', () => {
    expect(offScaleLines(input).map((l) => l.label)).toEqual(['far below', 'above one'])
  })

  it('checks an x line against the x domain and a y line against the y domain', () => {
    const wide: GlyphScatterInput = { ...input, x: { ...X, min: 1e-8 }, lines: [{ axis: 'x', value: 1e-7, label: 'x', tone: 'data' }, { axis: 'y', value: 1e-7, label: 'y', tone: 'data' }] }
    expect(offScaleLines(wide).map((l) => l.label)).toEqual(['y'])
  })

  it('treats a line that is not a finite number, or not positive on a log axis, as off scale', () => {
    const bad: GlyphScatterInput = {
      ...input,
      lines: [{ axis: 'x', value: Number.NaN, label: 'nan', tone: 'data' }, { axis: 'y', value: 0, label: 'zero', tone: 'data' }],
    }
    expect(offScaleLines(bad).map((l) => l.label)).toEqual(['nan', 'zero'])
  })

  it('has none to report without lines', () => {
    expect(offScaleLines(INPUT)).toEqual([])
  })
})

describe('glyphScatterOption points', () => {
  it('draws one silent scatter series named points, on top, at size 9', () => {
    const points = seriesById(glyphScatterOption(INPUT, T), 'points')!
    expect(points).toMatchObject({ type: 'scatter', silent: true, z: 4, symbolSize: 9 })
    expect(points.data).toHaveLength(4)
  })

  it('draws an up triangle in cUp', () => {
    const [a] = itemsOf(glyphScatterOption(INPUT, T))
    expect(a).toMatchObject({ value: [0.0004, 0.003], symbol: 'triangle', symbolRotate: 0, itemStyle: { color: C.cUp } })
  })

  it('draws a down triangle in cDown, the same triangle turned 180 degrees', () => {
    const items = itemsOf(glyphScatterOption(INPUT, T))
    expect(items[2]).toMatchObject({ symbol: 'triangle', symbolRotate: 180, itemStyle: { color: C.cDown } })
  })

  it('draws a ring as a black disc with a chartS1 border', () => {
    const items = itemsOf(glyphScatterOption(INPUT, T))
    expect(items[3]).toMatchObject({ symbol: 'circle', symbolRotate: 0, itemStyle: { color: C.bg, borderColor: C.chartS1, borderWidth: 1.5 } })
  })

  it('gives shape and colour both to the verdict, so neither carries it alone', () => {
    const items = itemsOf(glyphScatterOption({ ...INPUT, points: [pt('U', 0.1, 0.1, 'up'), pt('N', 0.1, 0.1, 'down'), pt('R', 0.1, 0.1, 'ring')] }, T))
    const pairs = items.map((i) => `${i.symbol}/${i.symbolRotate}/${i.itemStyle.color}/${i.itemStyle.borderColor ?? ''}`)
    expect(new Set(pairs).size).toBe(3)
    expect(new Set(items.map((i) => i.itemStyle.color)).size).toBe(3)
    expect(new Set(items.map((i) => `${i.symbol}/${i.symbolRotate}`)).size).toBe(3)
  })

  it('draws a hollow point with a black fill and a border in its glyph colour', () => {
    const items = itemsOf(glyphScatterOption(INPUT, T))
    expect(items[1]).toMatchObject({ symbol: 'triangle', symbolRotate: 0, itemStyle: { color: C.bg, borderColor: C.cUp, borderWidth: 1.5 } })
    const down = itemsOf(glyphScatterOption({ ...INPUT, points: [pt('C', 0.1, 0.1, 'down', { hollow: true })] }, T))
    expect(down[0]).toMatchObject({ symbolRotate: 180, itemStyle: { color: C.bg, borderColor: C.cDown, borderWidth: 1.5 } })
  })

  it('has no border on a solid triangle, so hollow is the only outlined kind besides the ring', () => {
    const [a] = itemsOf(glyphScatterOption(INPUT, T))
    expect(a!.itemStyle.borderWidth ?? 0).toBe(0)
  })

  it('labels every point with its tag to the right, in the text colour and chart font', () => {
    const items = itemsOf(glyphScatterOption(INPUT, T))
    expect(items[0]!.label).toEqual({
      show: true, formatter: 'A', position: 'right', color: C.text, fontFamily: T.font.family, fontSize: T.font.size,
    })
    expect(items.map((i) => i.label.formatter)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('puts the label of a point on the right-hand edge to its left, inside the plot', () => {
    const upright: GlyphScatterInput = { ...INPUT, x: { label: 'p', scale: 'log', format: 'p', min: 1e-3 } }
    const items = itemsOf(glyphScatterOption({ ...upright, points: [pt('A', 1, 0.02, 'up'), pt('B', 0.5, 0.02, 'down')] }, T))
    expect(items.map((i) => i.label.position)).toEqual(['left', 'right'])
    const reversed = itemsOf(glyphScatterOption({ ...INPUT, x: { ...X, min: 1e-4 }, points: [pt('A', 0.00002, 0.02, 'up'), pt('B', 0.5, 0.02, 'down')] }, T))
    expect(reversed.map((i) => i.label.position)).toEqual(['left', 'right'])
  })

  it('draws a point outside a fixed domain at the edge in its own glyph, labelled with its true value', () => {
    const option = glyphScatterOption({
      ...INPUT,
      x: { ...X, min: 1e-4 },
      points: [pt('A', 0.00002, 0.02, 'up'), pt('B', 0.02, 1.5, 'down', { hollow: true }), pt('R', 0.00003, 0.3, 'ring')],
    }, T)
    const [a, b, ring] = itemsOf(option)
    expect(a).toMatchObject({ value: [1e-4, 0.02], symbol: 'triangle', symbolRotate: 0, itemStyle: { color: C.cUp } })
    expect(a!.label.formatter).toBe('A (2.0e-5)')
    expect(b).toMatchObject({ value: [0.02, 1], symbol: 'triangle', symbolRotate: 180, itemStyle: { color: C.bg, borderColor: C.cDown } })
    expect(b!.label.formatter).toBe('B (1.5000)')
    expect(ring!.symbol).toBe('circle')
    // Colour alone must not carry the verdict, even at the edge: an up and a down point differ in shape.
    expect(a!.symbolRotate).not.toBe(b!.symbolRotate)
  })

  it('names both true values when a point is off scale on both axes', () => {
    const linear: GlyphAxis = { label: 'v', scale: 'linear', format: 'number', decimals: 1, unit: 'R', min: -2, max: 2 }
    const [a] = itemsOf(glyphScatterOption({ name: 'n', x: linear, y: linear, points: [pt('A', 5, -9, 'up')] }, T))
    expect(a!.value).toEqual([2, -2])
    expect(a!.label.formatter).toBe('A (+5.0 R, -9.0 R)')
  })

  it('leaves a dropped point out of the series', () => {
    const option = glyphScatterOption({ ...INPUT, points: [pt('A', 0.01, 0.02, 'up'), pt('B', 0, 0.02, 'down'), pt('C', Number.NaN, 0.5, 'ring')] }, T)
    expect(itemsOf(option).map((i) => i.label.formatter)).toEqual(['A'])
  })

  it('draws an input with no points as an empty series on a usable frame', () => {
    const option = glyphScatterOption({ ...INPUT, points: [] }, T)
    expect(itemsOf(option)).toEqual([])
    expect(axisOf(option, 'xAxis').min).toBeGreaterThan(0)
  })
})

describe('glyphScatterOption axes', () => {
  it('makes a log axis from the domain, base 10, reversed when asked', () => {
    const option = glyphScatterOption(INPUT, T)
    for (const which of ['xAxis', 'yAxis'] as const) {
      expect(axisOf(option, which)).toMatchObject({ type: 'log', logBase: 10, inverse: true })
    }
    expect(axisOf(option, 'xAxis')).toMatchObject({ min: 1e-4, max: 1, name: 'p before' })
    expect(axisOf(option, 'yAxis')).toMatchObject({ min: 1e-3, max: 1, name: 'p after' })
  })

  it('leaves an axis the right way up unless it is inverse', () => {
    const option = glyphScatterOption({ ...INPUT, x: { label: 'p', scale: 'log', format: 'p' } }, T)
    expect(axisOf(option, 'xAxis').inverse ?? false).toBe(false)
    expect(axisOf(option, 'yAxis').inverse).toBe(true)
  })

  it('names the y axis at its top: the high end, or the low end when reversed', () => {
    const upright = glyphScatterOption({ ...INPUT, y: { ...Y, inverse: false } }, T) as unknown as Record<string, { nameLocation: string }>
    expect(upright.yAxis!.nameLocation).toBe('end')
    expect((glyphScatterOption(INPUT, T) as unknown as Record<string, { nameLocation: string }>).yAxis!.nameLocation).toBe('start')
  })

  it('makes a value axis for a linear scale, on the nice interval', () => {
    const linear: GlyphAxis = { label: 'Sharpe', scale: 'linear', format: 'number' }
    const option = glyphScatterOption({ name: 'n', x: linear, y: linear, points: [pt('A', 1.2, -6.91, 'up'), pt('B', 3.9, 7.43, 'down')] }, T)
    expect(axisOf(option, 'xAxis')).toMatchObject({ type: 'value', min: 0, max: 4, interval: 0.5 })
    expect(axisOf(option, 'yAxis')).toMatchObject({ type: 'value', min: -8, max: 8, interval: 2 })
  })

  it('writes p ticks with formatP, and an exponent where formatP would repeat', () => {
    const format = axisOf(glyphScatterOption(INPUT, T), 'xAxis').axisLabel.formatter
    expect([1, 0.1, 0.01, 0.001, 0.0001].map(format)).toEqual(['1.0000', '0.1000', '0.0100', '0.0010', '0.0001'])
    expect([0.00001, 0.000001].map(format)).toEqual(['1e-5', '1e-6'])
  })

  it('writes number ticks with the axis decimals and unit', () => {
    const pct: GlyphAxis = { label: 'Return', scale: 'linear', format: 'number', decimals: 1, unit: '%' }
    const r: GlyphAxis = { label: 'Net', scale: 'linear', format: 'number', unit: 'R' }
    const option = glyphScatterOption({ name: 'n', x: pct, y: r, points: [pt('A', 1, 1, 'up')] }, T)
    expect(axisOf(option, 'xAxis').axisLabel.formatter(2.5)).toBe('2.5%')
    expect(axisOf(option, 'yAxis').axisLabel.formatter(-1.5)).toBe('-1.50 R')
    expect(axisOf(option, 'yAxis').axisLabel.formatter(-0.001)).toBe('0.00 R')
  })
})

describe('glyphScatterOption reference lines', () => {
  const lines = [
    { axis: 'x', value: 0.05, label: 'alpha before', tone: 'data' },
    { axis: 'y', value: 0.05, label: 'alpha after', tone: 'accent' },
    { axis: 'y', value: 0.5, label: 'half', tone: 'muted' },
  ] as const

  interface Mark {
    xAxis?: number
    yAxis?: number
    name: string
    lineStyle: { color: string; width: number; type: unknown }
    label: { show: boolean; formatter: string; color: string; position: string }
  }
  const marksOf = (option: unknown) => {
    const refs = seriesById(option, 'refs')!
    return (refs.markLine as { data: Mark[]; silent: boolean }).data
  }

  it('puts each line in a markLine on a data-less line series named refs', () => {
    const option = glyphScatterOption({ ...INPUT, lines: [...lines] }, T)
    const refs = seriesById(option, 'refs')!
    expect(refs).toMatchObject({ type: 'line', silent: true, data: [] })
    expect(marksOf(option)).toHaveLength(3)
    expect(marksOf(option)[0]).toMatchObject({ xAxis: 0.05 })
    expect(marksOf(option)[1]).toMatchObject({ yAxis: 0.05 })
  })

  it('colours a line by its tone: data, accent2 and zeroLine', () => {
    const marks = marksOf(glyphScatterOption({ ...INPUT, lines: [...lines] }, T))
    expect(marks.map((m) => m.lineStyle.color)).toEqual([C.data, C.accent2, C.zeroLine])
  })

  it('labels each line in its own colour, so a tone is never the only cue', () => {
    const marks = marksOf(glyphScatterOption({ ...INPUT, lines: [...lines] }, T))
    expect(marks.map((m) => m.label.formatter)).toEqual(['alpha before', 'alpha after', 'half'])
    expect(marks.every((m) => m.label.show)).toBe(true)
    expect(marks.map((m) => m.label.color)).toEqual([C.data, C.accent2, C.zeroLine])
  })

  it('keeps the label of a vertical line off the axis when the y axis is reversed', () => {
    const upright = marksOf(glyphScatterOption({ ...INPUT, y: { ...Y, inverse: false }, lines: [lines[0]] }, T))
    const reversed = marksOf(glyphScatterOption({ ...INPUT, lines: [lines[0]] }, T))
    expect(upright[0]!.label.position).toBe('end')
    expect(reversed[0]!.label.position).toBe('start')
  })

  it('leaves out a line that is outside its domain, and draws no refs series without one', () => {
    const off = { axis: 'y', value: 1e-9, label: 'gone', tone: 'data' } as const
    expect(marksOf(glyphScatterOption({ ...INPUT, lines: [...lines, off] }, T))).toHaveLength(3)
    expect(seriesById(glyphScatterOption({ ...INPUT, lines: [off] }, T), 'refs')).toBeUndefined()
    expect(seriesById(glyphScatterOption(INPUT, T), 'refs')).toBeUndefined()
  })
})

describe('glyphScatterOption diagonal', () => {
  const both = { ...INPUT, diagonal: 'y = x' }
  interface Diag extends Series {
    silent: boolean
    showSymbol: boolean
    symbolSize: number
    lineStyle: { color: string; type: number[]; width: number }
    label: { show: boolean; position: string; color: string; formatter: (p: { dataIndex: number }) => string }
  }

  it('draws a dashed y = x line in zeroLine from corner to corner of the domain', () => {
    const diag = seriesById(glyphScatterOption(both, T), 'diagonal') as Diag
    expect(diag).toMatchObject({ type: 'line', silent: true })
    expect(diag.data).toEqual([[1e-4, 1e-4], [1, 1]])
    expect(diag.lineStyle.type).toEqual([...CHART_GEOMETRY.fenceDash])
    expect(diag.lineStyle.color).toBe(C.zeroLine)
  })

  it('spans the union of the two domains', () => {
    const diag = seriesById(glyphScatterOption({ ...both, x: { ...X, min: 1e-6 }, y: { ...Y, max: 0.5 } }, T), 'diagonal') as Diag
    expect(diag.data).toEqual([[1e-6, 1e-6], [1, 1]])
  })

  it('spans the union on linear axes too', () => {
    const lin: GlyphAxis = { label: 'v', scale: 'linear', format: 'number' }
    const diag = seriesById(glyphScatterOption({ name: 'n', x: lin, y: lin, diagonal: 'y = x', points: [pt('A', -1.5, 3, 'up')] }, T), 'diagonal') as Diag
    expect(diag.data).toEqual([[-1.6, -1.6], [3, 3]])
  })

  it('labels one end with the diagonal text in the line colour, on an invisible symbol', () => {
    const diag = seriesById(glyphScatterOption(both, T), 'diagonal') as Diag
    expect(diag).toMatchObject({ showSymbol: true, symbolSize: 0 })
    expect(diag.label).toMatchObject({ show: true, color: C.zeroLine })
  })

  it('puts the label on the right-hand end: the high end, or the low end when x is reversed', () => {
    const at = (option: unknown) => {
      const diag = seriesById(option, 'diagonal') as Diag
      return [0, 1].map((dataIndex) => diag.label.formatter({ dataIndex }))
    }
    expect(at(glyphScatterOption({ ...both, x: { ...X, inverse: false } }, T))).toEqual(['', 'y = x'])
    expect(at(glyphScatterOption(both, T))).toEqual(['y = x', ''])
  })

  it('draws under the points', () => {
    const option = glyphScatterOption(both, T)
    expect((seriesById(option, 'diagonal') as Diag & { z: number }).z).toBeLessThan(4)
  })

  it('is left out without a diagonal', () => {
    expect(seriesById(glyphScatterOption(INPUT, T), 'diagonal')).toBeUndefined()
  })

  it('throws when the axes differ in scale', () => {
    expect(() => glyphScatterOption({ ...both, y: { ...Y, scale: 'linear' } }, T)).toThrow(/diagonal/)
  })

  it('throws when the axes differ in format', () => {
    expect(() => glyphScatterOption({ ...both, y: { ...Y, format: 'number' } }, T)).toThrow(/diagonal/)
  })

  it('does not throw for different axes when there is no diagonal', () => {
    expect(() => glyphScatterOption({ ...INPUT, y: { ...Y, scale: 'linear', format: 'number' } }, T)).not.toThrow()
  })
})

describe('glyphScatterOption colours', () => {
  const FULL: GlyphScatterInput = {
    ...INPUT,
    x: { ...X, min: 1e-4 },
    diagonal: 'y = x',
    points: [...INPUT.points, pt('E', 0.00002, 0.4, 'down', { hollow: true })],
    lines: [
      { axis: 'x', value: 0.05, label: 'a', tone: 'data' },
      { axis: 'y', value: 0.05, label: 'b', tone: 'accent' },
      { axis: 'y', value: 0.5, label: 'c', tone: 'muted' },
    ],
  }

  it('takes every colour from the tokens', () => {
    expect(strayColours(glyphScatterOption(FULL, T), tokenValues(T))).toEqual([])
  })

  it('finds the same shapes and the default colours with the default tokens', () => {
    expect(strayColours(glyphScatterOption(FULL), new Set(Object.values(D)))).toEqual([])
    expect(itemsOf(glyphScatterOption(FULL))[0]!.itemStyle.color).toBe(D.cUp)
  })

  it('writes no animation and sets the theme background', () => {
    const option = glyphScatterOption(FULL, T) as unknown as { animation: boolean; backgroundColor: string }
    expect(option.animation).toBe(false)
    expect(option.backgroundColor).toBe(C.bg)
  })
})

describe('describeGlyphScatter', () => {
  it('names the count, both ranges and each kind with its glyph', () => {
    expect(describeGlyphScatter(INPUT)).toBe(
      'Deflation: 4 points; p before from 0.0004 to 0.2000, p after from 0.0030 to 0.3100; '
      + '2 holds (triangle up), 1 lost (triangle down), 1 undecided (ring); 1 hollow.',
    )
  })

  it('leaves the hollow count out when nothing is hollow', () => {
    const text = describeGlyphScatter({ ...INPUT, points: INPUT.points.map((p) => ({ ...p, hollow: false })) })
    expect(text).not.toContain('hollow')
    expect(text.endsWith('1 undecided (ring).')).toBe(true)
  })

  it('counts a kind once per glyph', () => {
    const text = describeGlyphScatter({ ...INPUT, points: [pt('A', 0.1, 0.1, 'up'), pt('B', 0.1, 0.1, 'down', { kind: 'holds' })] })
    expect(text).toContain('1 holds (triangle up), 1 holds (triangle down)')
  })

  it('counts points outside the axis range and gives their true values in the range', () => {
    const text = describeGlyphScatter({ ...INPUT, x: { ...X, min: 1e-4 }, points: [pt('A', 0.00002, 0.02, 'up'), pt('B', 0.5, 0.3, 'down')] })
    expect(text).toContain('p before from 2.0e-5 to 0.5000')
    expect(text.endsWith(' 1 outside the axis range, drawn at its edge.')).toBe(true)
  })

  it('counts the points it could not draw', () => {
    const text = describeGlyphScatter({ ...INPUT, points: [pt('A', 0.1, 0.2, 'up'), pt('B', 0, 0.2, 'down'), pt('C', Number.NaN, 0.2, 'ring')] })
    expect(text).toContain('Deflation: 1 point;')
    expect(text.endsWith(' 2 not drawn (missing, or not positive on a log axis).')).toBe(true)
  })

  it('names the reference lines it could not draw', () => {
    const text = describeGlyphScatter({ ...INPUT, lines: [{ axis: 'y', value: 1e-9, label: 'far', tone: 'data' }, { axis: 'x', value: 0.05, label: 'alpha', tone: 'data' }] })
    expect(text.endsWith(' Not drawn, outside the axis range: far.')).toBe(true)
  })

  it('says so when there is nothing to draw', () => {
    expect(describeGlyphScatter({ ...INPUT, points: [] })).toBe('Deflation: no points.')
    expect(describeGlyphScatter({ ...INPUT, points: [pt('A', 0, 0.2, 'up')] })).toBe('Deflation: no points. 1 not drawn (missing, or not positive on a log axis).')
  })

  it('writes signed values on a linear axis, with the unit', () => {
    const lin: GlyphAxis = { label: 'Net', scale: 'linear', format: 'number', unit: 'R' }
    const text = describeGlyphScatter({ name: 'n', x: lin, y: lin, points: [pt('A', -1.5, 0.25, 'up'), pt('B', 2, 1, 'down')] })
    expect(text).toContain('Net from -1.50 R to +2.00 R, Net from +0.25 R to +1.00 R')
  })
})

describe('glyphScatterTable', () => {
  const table = glyphScatterTable(INPUT)

  it('has Mark, Point, both axis labels and Kind, with the point as the row header', () => {
    expect(table.columns.map((c) => c.label)).toEqual(['Mark', 'Point', 'p before', 'p after', 'Kind'])
    expect(table.columns.filter((c) => c.rowHeader).map((c) => c.label)).toEqual(['Point'])
    expect(table.columns.filter((c) => c.numeric).map((c) => c.label)).toEqual(['p before', 'p after'])
  })

  it('gives one row per drawn point with formatted values', () => {
    expect(table.caption).toBe('Deflation, one row per point')
    expect(table.rows).toHaveLength(4)
    expect(table.rows[0]).toEqual({ tag: 'A', point: 'Strategy A', x: '0.0004', y: '0.0030', kind: 'holds' })
  })

  it('shows the true value of a point drawn at the edge', () => {
    const rows = glyphScatterTable({ ...INPUT, x: { ...X, min: 1e-4 }, points: [pt('A', 0.00002, 0.02, 'up')] }).rows
    expect(rows[0]).toMatchObject({ x: '2.0e-5', y: '0.0200' })
  })

  it('keeps a point that was not drawn, with its values as served and its Kind marked not drawn', () => {
    const rows = glyphScatterTable({
      ...INPUT,
      points: [pt('A', 0.1, 0.2, 'up'), pt('B', 0, 0.2, 'down'), pt('C', Number.NaN, 0.5, 'ring')],
    }).rows
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.tag)).toEqual(['A', 'B', 'C'])
    expect(rows[0]).toEqual({ tag: 'A', point: 'Strategy A', x: '0.1000', y: '0.2000', kind: KIND.up })
    expect(rows[1]).toMatchObject({ tag: 'B', x: '0.0000', y: '0.2000', kind: `${KIND.down}, not drawn` })
    expect(rows[2]).toMatchObject({ tag: 'C', x: '--', y: '0.5000', kind: `${KIND.ring}, not drawn` })
  })

  it('writes a value a log axis cannot show as served, with the axis unit, and a non-finite one as missing', () => {
    const num: GlyphAxis = { label: 'Trades', scale: 'log', format: 'number', decimals: 1, unit: 'n' }
    const rows = glyphScatterTable({
      name: 'n',
      x: num,
      y: num,
      points: [pt('A', -3, 4, 'up'), pt('B', Number.POSITIVE_INFINITY, Number.NaN, 'down'), pt('C', 5, 6, 'ring')],
    }).rows
    expect(rows[0]).toMatchObject({ x: '-3.0 n', y: '4.0 n', kind: `${KIND.up}, not drawn` })
    expect(rows[1]).toMatchObject({ x: '--', y: '--', kind: `${KIND.down}, not drawn` })
    expect(rows[2]).toMatchObject({ x: '5.0 n', y: '6.0 n', kind: KIND.ring })
  })

  it('adds the extra columns after Kind, with the value each point carries', () => {
    const input: GlyphScatterInput = {
      ...INPUT,
      extraColumns: [{ key: 'n', label: 'Trades', numeric: true }, { key: 'note', label: 'Note' }],
      points: [pt('A', 0.1, 0.2, 'up', { extra: { n: '120' } }), pt('B', 0.3, 0.4, 'down', { extra: { n: '80', note: 'thin' } })],
    }
    const t = glyphScatterTable(input)
    expect(t.columns.map((c) => c.label)).toEqual(['Mark', 'Point', 'p before', 'p after', 'Kind', 'Trades', 'Note'])
    expect(t.columns[5]).toMatchObject({ key: 'n', numeric: true })
    expect(t.rows[0]).toMatchObject({ n: '120', note: '' })
    expect(t.rows[1]).toMatchObject({ n: '80', note: 'thin' })
  })

  it('throws when an extra column would overwrite a fixed one', () => {
    expect(() => glyphScatterTable({ ...INPUT, extraColumns: [{ key: 'x', label: 'Clash' }] })).toThrow(/x/)
  })

  it('writes signed values with units on linear axes', () => {
    const lin: GlyphAxis = { label: 'Net', scale: 'linear', format: 'number', unit: 'R', decimals: 1 }
    const t = glyphScatterTable({ name: 'n', x: lin, y: { ...lin, label: 'Gross' }, points: [pt('A', -1.5, 0.25, 'up')] })
    expect(t.rows[0]).toMatchObject({ x: '-1.5 R', y: '+0.3 R' })
  })

  it('holds one row for each of 10,000 points', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => pt(`P${i}`, 0.0001 + (i % 900) / 1000, 0.5 - (i % 400) / 1000, 'up'))
    const input = { ...INPUT, points: many }
    expect(glyphScatterTable(input).rows).toHaveLength(10_000)
    expect(itemsOf(glyphScatterOption(input, T))).toHaveLength(10_000)
  })
})
