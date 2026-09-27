import type { IPrimitivePaneRenderer, SeriesAttachedParameter, Time } from 'lightweight-charts'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS, makeLwcTheme, tagPolygon } from './theme'
import { daySeparatorPrimitive, fencePrimitive, inkRuns, lastValueTag, rollPrimitive } from './CandleChart.primitives'

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0]

interface Call {
  readonly op: string
  readonly args: readonly unknown[]
  readonly style: { strokeStyle: unknown; fillStyle: unknown; lineWidth: unknown; textAlign: unknown; font: unknown; dash: readonly number[] }
}

/** A 2D context that records what was drawn and the style at each draw call; `inkRows` are canvas rows holding label text. */
function recorder(width = 57, inkRows: ReadonlySet<number> | null = null) {
  const calls: Call[] = []
  let dash: number[] = []
  const ctx = {
    strokeStyle: '', fillStyle: '', lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic', font: '',
    setLineDash(d: number[]) { dash = [...d] },
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as Record<string, unknown>
  if (inkRows !== null) {
    ctx.getImageData = (_x: number, y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4)
      for (let r = 0; r < h; r += 1) if (inkRows.has(y + r)) data.fill(255, r * w * 4, r * w * 4 + 4)
      return { data, width: w, height: h }
    }
  }
  for (const op of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'fillText', 'fillRect']) {
    ctx[op] = (...args: unknown[]) => {
      calls.push({ op, args, style: { strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle, lineWidth: ctx.lineWidth, textAlign: ctx.textAlign, font: ctx.font, dash } })
    }
  }
  const scope = {
    context: ctx, mediaSize: { width, height: 300 }, bitmapSize: { width, height: 300 },
    horizontalPixelRatio: 1, verticalPixelRatio: 1,
  }
  const target = {
    useBitmapCoordinateSpace: (f: (s: typeof scope) => void) => f(scope),
    useMediaCoordinateSpace: (f: (s: typeof scope) => void) => f(scope),
  } as unknown as Target
  return { calls, target }
}

function attach(coord: (logical: number) => number | null, price: (p: number) => number | null = () => null) {
  return {
    chart: { timeScale: () => ({ logicalToCoordinate: coord }) },
    series: { priceToCoordinate: price },
    requestUpdate: () => undefined,
  } as unknown as SeriesAttachedParameter<Time>
}

const theme = makeLwcTheme(DEFAULT_CHART_TOKENS)
const C = DEFAULT_CHART_TOKENS.color

describe('fence primitive', () => {
  it('draws the amber dashed line the full pane height at the fence, with IS | 2022+ SPENT either side', () => {
    const p = fencePrimitive({ logical: 4.5, style: theme.fence, label: { before: 'IS', after: '2022+ SPENT', font: '13px sans-serif' } })
    // Like lightweight-charts 5.2.1: a whole bar index maps to x, any other index to 0.
    p.attached?.(attach((l) => (Number.isInteger(l) ? 10 + l * 20 : 0)))
    const { calls, target } = recorder(400)
    p.paneViews?.()[0]?.renderer()?.draw(target)
    const stroke = calls.find((c) => c.op === 'stroke')
    expect(stroke?.style.strokeStyle).toBe(C.fence)
    expect(stroke?.style.dash).toEqual([4, 3])
    expect(calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args)).toEqual([[100.5, 0], [100.5, 300]])
    const texts = calls.filter((c) => c.op === 'fillText')
    expect(texts.map((c) => [c.args[0], c.args[1], c.style.textAlign, c.style.fillStyle])).toEqual([
      ['IS', 96, 'right', C.fence],
      ['2022+ SPENT', 104, 'left', C.fence],
    ])
  })

  it('puts the whole label left of the line when the right word would run into the value axis', () => {
    const p = fencePrimitive({ logical: 4.5, style: theme.fence, label: { before: 'IS', after: '2022+ SPENT', font: '13px sans-serif' } })
    p.attached?.(attach((l) => (Number.isInteger(l) ? 10 + l * 20 : 0)))
    const { calls, target } = recorder(150)
    p.paneViews?.()[0]?.renderer()?.draw(target)
    const texts = calls.filter((c) => c.op === 'fillText')
    expect(texts.map((c) => [c.args[0], c.args[1], c.style.textAlign])).toEqual([['IS | 2022+ SPENT', 96, 'right']])
  })

  it('draws nothing when the fence is off the plot or unknown', () => {
    for (const logical of [4.5, null]) {
      const p = fencePrimitive({ logical, style: theme.fence })
      p.attached?.(attach(() => null))
      const { calls, target } = recorder()
      p.paneViews?.()[0]?.renderer()?.draw(target)
      expect(calls).toEqual([])
    }
  })

  it('has no label in the lower panes', () => {
    const p = fencePrimitive({ logical: 2.5, style: theme.fence })
    p.attached?.(attach((l) => (Number.isInteger(l) ? 10 + l * 12 : 0)))
    const { calls, target } = recorder()
    p.paneViews?.()[0]?.renderer()?.draw(target)
    expect(calls.some((c) => c.op === 'fillText')).toBe(false)
    expect(calls.some((c) => c.op === 'stroke')).toBe(true)
  })
})

describe('roll primitive', () => {
  const rolls = [{ index: 3, label: '2021-03-19' }, { index: 60, label: '2021-06-18' }]

  it('draws a solid 1px yellow line the full pane height at each roll', () => {
    const p = rollPrimitive({ rolls, style: theme.rollMarker })
    p.attached?.(attach((l) => (l === 3 ? 30 : null)))
    const { calls, target } = recorder()
    p.paneViews?.()[0]?.renderer()?.draw(target)
    const stroke = calls.find((c) => c.op === 'stroke')
    expect(stroke?.style.strokeStyle).toBe(C.marker)
    expect(stroke?.style.dash).toEqual([])
    expect(calls.filter((c) => c.op === 'moveTo').map((c) => c.args)).toEqual([[30.5, 0]])
  })

  it('leaves the date tags to the second axis row: no library time-axis tags, which have rounded corners', () => {
    const p = rollPrimitive({ rolls, style: theme.rollMarker })
    expect(p.timeAxisViews?.() ?? []).toEqual([])
  })
})

describe('day separator primitive (look spec 7.6 GIP)', () => {
  it('draws a grey 1px dashed line the full pane height between each pair of sessions, behind the candles', () => {
    const p = daySeparatorPrimitive({ positions: [11.5, 23.5], style: theme.daySeparator })
    p.attached?.(attach((l) => (Number.isInteger(l) ? 10 + l * 4 : 0)))
    const { calls, target } = recorder(400)
    const view = p.paneViews?.()[0]
    expect(view?.zOrder?.()).toBe('bottom')
    view?.renderer()?.draw(target)
    const strokes = calls.filter((c) => c.op === 'stroke')
    expect(strokes).toHaveLength(2)
    expect(strokes[0]?.style.strokeStyle).toBe(C.chartYearDiv)
    expect(strokes[0]?.style.dash).toEqual([3, 3])
    expect(strokes[0]?.style.lineWidth).toBe(1)
    expect(calls.filter((c) => c.op === 'moveTo').map((c) => c.args)).toEqual([[56.5, 0], [104.5, 0]])
  })

  it('draws nothing where a position is off the plot', () => {
    const p = daySeparatorPrimitive({ positions: [11.5], style: theme.daySeparator })
    p.attached?.(attach(() => null))
    const { calls, target } = recorder()
    p.paneViews?.()[0]?.renderer()?.draw(target)
    expect(calls).toEqual([])
  })
})

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

describe('label ink runs', () => {
  it('groups consecutive inked rows into [first, last] runs', () => {
    expect(inkRuns([false, true, true, false, false, true, false, true])).toEqual([[1, 2], [5, 5], [7, 7]])
    expect(inkRuns([])).toEqual([])
  })
})

describe('last-value tag', () => {
  it('draws a pentagon on the value axis in the fill colour with contrasting text', () => {
    const p = lastValueTag({ value: () => ({ value: 103.75, fill: C.candleUp, text: '103.75' }), font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS })
    p.attached?.(attach(() => null, (v) => (v === 103.75 ? 50 : null)))
    const { calls, target } = recorder()
    p.priceAxisPaneViews?.()[0]?.renderer()?.draw(target)
    const points = calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args)
    expect(points).toEqual(tagPolygon(0, 50, 57 - 5).map(([x, y]) => [x, y]))
    expect(calls.find((c) => c.op === 'fill')?.style.fillStyle).toBe(C.candleUp)
    const text = calls.find((c) => c.op === 'fillText')
    expect(text?.args.slice(0, 2)).toEqual(['103.75', 7])
    expect(text?.style.fillStyle).toBe(C.bg)
  })

  it('clears every tick label the tag touches, whole, before drawing (the tag replaces it)', () => {
    const p = lastValueTag({ value: () => ({ value: 103.75, fill: C.candleUp, text: '103.75' }), font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS })
    p.attached?.(attach(() => null, () => 50))
    // Labels drawn at rows 30-39 (touches the tag, 41.5 to 58.5, only through its 2px margin),
    // 55-64 (under it) and 70-79 (clear of it).
    const rows = new Set([...range(30, 40), ...range(55, 65), ...range(70, 80)])
    const { calls, target } = recorder(57, rows)
    p.priceAxisPaneViews?.()[0]?.renderer()?.draw(target)
    const clears = calls.filter((c) => c.op === 'fillRect')
    expect(clears.every((c) => c.style.fillStyle === C.bg)).toBe(true)
    // From the label column (right of the 6px tick) to the edge, one row either side of the ink.
    expect(clears.map((c) => c.args)).toEqual([[7, 29, 50, 12], [7, 54, 50, 12]])
    expect(calls.findIndex((c) => c.op === 'fillRect')).toBeLessThan(calls.findIndex((c) => c.op === 'fill'))
  })

  it('is drawn with the axis labels (normal order), under the crosshair label', () => {
    const p = lastValueTag({ value: () => null, font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS })
    expect(p.priceAxisPaneViews?.()[0]?.zOrder?.()).toBe('normal')
  })

  it('draws the last-price line from the last bar to the axis only when asked (candles)', () => {
    const value = () => ({ value: 103.75, fill: C.candleUp, text: '103.75', index: 3 })
    const p = lastValueTag({ value, font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS, line: C.lastLine })
    p.attached?.(attach((l) => (l === 3 ? 30 : null), () => 50))
    const { calls, target } = recorder(400)
    p.paneViews?.()[0]?.renderer()?.draw(target)
    expect(calls.find((c) => c.op === 'stroke')?.style.strokeStyle).toBe(C.lastLine)
    expect(calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args)).toEqual([[30, 50.5], [400, 50.5]])
    const plain = lastValueTag({ value, font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS })
    expect(plain.paneViews?.() ?? []).toEqual([])
  })

  it('puts black text on the blue down fill too, the better contrast (5.5 against 3.8)', () => {
    const p = lastValueTag({ value: () => ({ value: 1, fill: C.candleDn, text: '1.00' }), font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS })
    p.attached?.(attach(() => null, () => 10))
    const { calls, target } = recorder()
    p.priceAxisPaneViews?.()[0]?.renderer()?.draw(target)
    expect(calls.find((c) => c.op === 'fillText')?.style.fillStyle).toBe(C.bg)
  })

  it('draws nothing without a value or off the scale', () => {
    for (const value of [() => null, () => ({ value: 5, fill: C.chartVol, text: '5' })]) {
      const p = lastValueTag({ value, font: '13px sans-serif', tokens: DEFAULT_CHART_TOKENS })
      p.attached?.(attach(() => null, () => null))
      const { calls, target } = recorder()
      p.priceAxisPaneViews?.()[0]?.renderer()?.draw(target)
      expect(calls).toEqual([])
    }
  })
})
