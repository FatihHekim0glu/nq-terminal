import { describe, expect, it, vi } from 'vitest'
import { canvasFont, DEFAULT_CHART_TOKENS, readChartTokens } from '../../charts/theme/chartTokens'
import {
  composeFigure,
  composeGrab,
  readGrabPalette,
  type CanvasContextLike,
  type CanvasLike,
  type GrabPalette,
} from './compose'
import type { GrabFigure, GrabLayer } from './collect'

const PALETTE: GrabPalette = { background: 'bg-1', text: 'text-1', label: 'label-1', rule: 'rule-1', font: '13px test-sans' }

interface Op {
  readonly op: string
  readonly args: readonly unknown[]
  readonly fillStyle: unknown
  readonly font: string
}

interface FakeCanvas extends CanvasLike {
  readonly ops: Op[]
}

/** A canvas that records what is drawn on it; text is 7 px a character. */
function fakeCanvas(width: number, height: number, hasContext = true): FakeCanvas {
  const ops: Op[] = []
  const state = { fillStyle: '' as unknown, font: '' }
  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      ops.push({ op, args, fillStyle: state.fillStyle, font: state.font })
    }
  const ctx = {
    get fillStyle(): unknown {
      return state.fillStyle
    },
    set fillStyle(value: unknown) {
      state.fillStyle = value
    },
    get font(): string {
      return state.font
    },
    set font(value: string) {
      state.font = value
    },
    textBaseline: 'alphabetic',
    measureText: (text: string) => ({ width: text.length * 7 }),
    scale: record('scale'),
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
  }
  return {
    width,
    height,
    ops,
    getContext: () => (hasContext ? (ctx as unknown as CanvasContextLike) : null),
    toBlob: () => {},
  }
}

function makeFactory(hasContext = true) {
  const made: FakeCanvas[] = []
  const make = vi.fn((width: number, height: number) => {
    const canvas = fakeCanvas(width, height, hasContext)
    made.push(canvas)
    return canvas
  })
  return { make, made }
}

/** Each layer gets a source of its own, so a test can tell which one was drawn. */
function layer(x: number, y: number, width: number, height: number): GrabLayer {
  return { source: {} as CanvasImageSource, x, y, width, height }
}

function figure(summary: string, width: number, height: number, layers: readonly GrabLayer[]): GrabFigure {
  return { summary, width, height, layers }
}

const paints = (canvas: FakeCanvas): Op[] => canvas.ops.filter((o) => o.op !== 'scale')

describe('composeGrab', () => {
  const CAPTION = ['1-EQ [A] | volmanaged_v0 EQ', 'IS | 2022+ SPENT | grabbed 14:02:11 ET | nq-lab terminal']

  it('makes a canvas as wide as the widest figure plus padding, scaled by the device pixel ratio', () => {
    const { make, made } = makeFactory()
    const result = composeGrab([figure('summary', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 2, make)
    expect(result).not.toBeNull()
    // width 700 + 2 * 8 = 716; height 8 + 16 (summary) + 300 + 8 + (1 + 8 + 2 * 16 + 8) = 381
    expect(result?.canvas).toBe(made.at(-1))
    expect(result?.canvas.width).toBe(1432)
    expect(result?.canvas.height).toBe(762)
    expect(result?.kept).toBe(1)
  })

  it('is at least 640 px wide however small the figure is', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 100, 50, [layer(0, 0, 100, 50)])], CAPTION, PALETTE, 1, make)
    expect(result?.canvas.width).toBe(640)
  })

  it('never lets the canvas pass 16000 px on a side', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 9000, 100, [layer(0, 0, 9000, 100)])], CAPTION, PALETTE, 4, make)
    expect(result?.canvas.width).toBeLessThanOrEqual(16000)
    expect(result?.canvas.width).toBeGreaterThan(15990)
  })

  it('paints the background first, over the whole image, in the background colour', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 2, make)
    const first = paints(result?.canvas as FakeCanvas)[0]
    expect(first).toMatchObject({ op: 'fillRect', args: [0, 0, 716, 381], fillStyle: PALETTE.background })
  })

  it('covers every device pixel with the background when the layout is fractional (display scaling 150%)', () => {
    // A chart box from getBoundingClientRect is fractional in a flex layout; at 1.5 the canvas size rounds. The
    // background must reach the last pixel column and row, or the PNG has a see-through edge on a white page.
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 700.4, 300.3, [layer(0, 0, 700.4, 300.3)])], CAPTION, PALETTE, 1.5, make)
    const canvas = result?.canvas as FakeCanvas
    const [x, y, w, h] = paints(canvas)[0]?.args as [number, number, number, number]
    expect([x, y]).toEqual([0, 0])
    expect(w * 1.5).toBeGreaterThanOrEqual(canvas.width)
    expect(h * 1.5).toBeGreaterThanOrEqual(canvas.height)
    // Nothing is cut either: the canvas holds the whole layout.
    expect(canvas.width).toBeGreaterThanOrEqual(716.4 * 1.5)
  })

  it('does the same for one figure alone (dossier figures)', () => {
    const { make } = makeFactory()
    const canvas = composeFigure(figure('s', 400.4, 200.3, [layer(0, 0, 400.4, 200.3)]), 1.25, make, PALETTE) as FakeCanvas
    const [, , w, h] = paints(canvas)[0]?.args as [number, number, number, number]
    expect(w * 1.25).toBeGreaterThanOrEqual(canvas.width)
    expect(h * 1.25).toBeGreaterThanOrEqual(canvas.height)
    expect(canvas.width).toBeGreaterThanOrEqual(400.4 * 1.25)
    expect(canvas.height).toBeGreaterThanOrEqual(200.3 * 1.25)
  })

  it('scales the drawing by the ratio so every later coordinate is in CSS px', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 2, make)
    expect((result?.canvas as FakeCanvas).ops[0]).toMatchObject({ op: 'scale', args: [2, 2] })
  })

  it('draws every layer of every figure whole, at its offset under that figure summary', () => {
    const { make } = makeFactory()
    const base = layer(0, 0, 400, 200)
    const over = layer(10, 20, 300, 100)
    const second = layer(0, 0, 400, 100)
    const figures = [figure('one', 400, 200, [base, over]), figure('two', 400, 100, [second])]
    const result = composeGrab(figures, CAPTION, PALETTE, 1, make)
    const draws = paints(result?.canvas as FakeCanvas).filter((o) => o.op === 'drawImage')
    // figure one: summaryY 8, top 24; figure two: 24 + 200 + 8 = 232 summary, top 248
    expect(draws.map((d) => d.args)).toEqual([
      [base.source, 8, 24, 400, 200],
      [over.source, 18, 44, 300, 100],
      [second.source, 8, 248, 400, 100],
    ])
  })

  it('writes each summary in the text colour above its figure', () => {
    const { make } = makeFactory()
    const figures = [figure('one', 400, 200, [layer(0, 0, 400, 200)]), figure('two', 400, 100, [layer(0, 0, 400, 100)])]
    const result = composeGrab(figures, CAPTION, PALETTE, 1, make)
    const texts = paints(result?.canvas as FakeCanvas).filter((o) => o.op === 'fillText')
    const summaries = texts.filter((t) => t.args[0] === 'one' || t.args[0] === 'two')
    // text is centred on its 16 px line: the first summary starts at 8, the second at 232
    expect(summaries.map((t) => [t.args[0], t.args[1], t.args[2], t.fillStyle])).toEqual([
      ['one', 8, 16, PALETTE.text],
      ['two', 8, 240, PALETTE.text],
    ])
    expect(summaries.every((t) => t.font === PALETTE.font)).toBe(true)
  })

  it('draws a one pixel rule in the rule colour, then the caption with its first line in the label colour', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 1, make)
    const ops = paints(result?.canvas as FakeCanvas)
    const rule = ops.filter((o) => o.op === 'fillRect')[1]
    // rule at 8 + 16 + 300 + 8 = 332, across the image inside the padding
    expect(rule).toMatchObject({ args: [8, 332, 700, 1], fillStyle: PALETTE.rule })
    const lines = ops.filter((o) => o.op === 'fillText' && CAPTION.includes(o.args[0] as string))
    expect(lines.map((t) => [t.args[0], t.fillStyle])).toEqual([
      [CAPTION[0], PALETTE.label],
      [CAPTION[1], PALETTE.text],
    ])
    expect(lines[0]?.args[1]).toBe(8)
  })

  it('draws the caption after the figures, so it is never covered by a chart', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('s', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 1, make)
    const ops = paints(result?.canvas as FakeCanvas)
    const lastImage = ops.map((o) => o.op).lastIndexOf('drawImage')
    const captionAt = ops.findIndex((o) => o.op === 'fillText' && o.args[0] === CAPTION[0])
    expect(captionAt).toBeGreaterThan(lastImage)
  })

  it('wraps a caption line wider than the image and keeps its label colour on every row', () => {
    const { make } = makeFactory()
    const long = 'alpha '.repeat(40).trim() // 239 characters, 7 px each, into 700 px
    const result = composeGrab([figure('s', 700, 100, [layer(0, 0, 700, 100)])], [long, 'tail'], PALETTE, 1, make)
    const rows = paints(result?.canvas as FakeCanvas).filter(
      (o) => o.op === 'fillText' && o.args[0] !== 's' && o.args[0] !== 'tail',
    )
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect((row.args[0] as string).length * 7).toBeLessThanOrEqual(700)
      expect(row.fillStyle).toBe(PALETTE.label)
    }
    expect(rows.map((r) => r.args[0]).join(' ')).toBe(long)
  })

  it('omits the summary text of a figure whose summary is blank', () => {
    const { make } = makeFactory()
    const result = composeGrab([figure('', 700, 100, [layer(0, 0, 700, 100)])], ['line'], PALETTE, 1, make)
    const texts = paints(result?.canvas as FakeCanvas).filter((o) => o.op === 'fillText')
    expect(texts.map((t) => t.args[0])).toEqual(['line'])
  })

  it('leaves out the figures that do not fit under the height cap and reports how many it kept', () => {
    const { make } = makeFactory()
    const figures = [
      figure('a', 700, 3000, [layer(0, 0, 700, 3000)]),
      figure('b', 700, 3000, [layer(0, 0, 700, 3000)]),
      figure('c', 700, 3000, [layer(0, 0, 700, 3000)]),
    ]
    const result = composeGrab(figures, CAPTION, PALETTE, 1, make)
    expect(result?.kept).toBe(2)
    const draws = paints(result?.canvas as FakeCanvas).filter((o) => o.op === 'drawImage')
    expect(draws).toHaveLength(2)
  })

  it('returns null when the browser gives no drawing context', () => {
    const { make } = makeFactory(false)
    expect(composeGrab([figure('s', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 1, make)).toBeNull()
  })

  it('returns null when the final canvas gives no context, though the scratch one did', () => {
    let calls = 0
    const make = (width: number, height: number): FakeCanvas => fakeCanvas(width, height, (calls += 1) === 1)
    expect(composeGrab([figure('s', 700, 300, [layer(0, 0, 700, 300)])], CAPTION, PALETTE, 1, make)).toBeNull()
  })

  it('returns null, and makes no canvas, when there is no figure to draw', () => {
    const { make } = makeFactory()
    expect(composeGrab([], CAPTION, PALETTE, 1, make)).toBeNull()
    expect(make).not.toHaveBeenCalled()
  })
})

describe('composeFigure', () => {
  it('makes a canvas of the figure size times the ratio: background, then each layer whole', () => {
    const { make } = makeFactory()
    const a = layer(0, 0, 400, 200)
    const b = layer(5, 6, 100, 50)
    const canvas = composeFigure(figure('s', 400, 200, [a, b]), 2, make, PALETTE) as FakeCanvas
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(400)
    expect(paints(canvas).map((o) => [o.op, ...o.args])).toEqual([
      ['fillRect', 0, 0, 400, 200],
      ['drawImage', a.source, 0, 0, 400, 200],
      ['drawImage', b.source, 5, 6, 100, 50],
    ])
    expect(paints(canvas)[0]?.fillStyle).toBe(PALETTE.background)
  })

  it('returns null when the browser gives no drawing context', () => {
    const { make } = makeFactory(false)
    expect(composeFigure(figure('s', 400, 200, [layer(0, 0, 400, 200)]), 1, make, PALETTE)).toBeNull()
  })

  it('reads the live palette when none is given', () => {
    const { make } = makeFactory()
    const canvas = composeFigure(figure('s', 400, 200, [layer(0, 0, 400, 200)]), 1, make) as FakeCanvas
    expect(paints(canvas)[0]?.fillStyle).toBe(DEFAULT_CHART_TOKENS.color.bg)
  })
})

describe('readGrabPalette', () => {
  it('takes its colours and font from the chart tokens, so the image follows the theme', () => {
    const tokens = readChartTokens(null)
    expect(readGrabPalette(tokens)).toEqual({
      background: tokens.color.bg,
      text: tokens.color.text,
      label: tokens.color.data,
      rule: tokens.color.chartGrid,
      font: canvasFont(tokens),
    })
  })

  it('reads the page tokens when none are given', () => {
    expect(readGrabPalette()).toEqual(readGrabPalette(readChartTokens(null)))
  })
})
