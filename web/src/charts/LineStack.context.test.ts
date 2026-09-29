import { describe, expect, it } from 'vitest'
import { LINE_STACK, LINE_STACK_GALLERY } from '../copy/lineStack'
import {
  contextReadout,
  contextSummary,
  contextTables,
  drawLanes,
  drawRibbon,
  drawSpans,
  laneAt,
  ribbonRuns,
  spansInView,
  type LaneColours,
  type RibbonColours,
  type SpanStyle,
} from './LineStack.context'
import { fakePlot, type CtxCall } from './LineStack.testUtil'
import type { LanesSpec, RibbonSpec, RibbonState, StackSpan } from './LineStack.types'
import { CHART_GEOMETRY as G, DEFAULT_CHART_TOKENS } from './theme'

const c = DEFAULT_CHART_TOKENS.color
const font = DEFAULT_CHART_TOKENS.font
const DAY = 86_400
const days = (n: number) => n * DAY
/** Eleven daily sessions, day 0 to day 10. */
const T = Array.from({ length: 11 }, (_, i) => days(i))

const named = (calls: CtxCall[], name: string) => calls.filter((x) => x[0] === name)
const indexOfCall = (calls: CtxCall[], name: string, ...args: unknown[]) =>
  calls.findIndex((x) => x[0] === name && args.every((a, i) => x[i + 1] === a))

/** The fillStyle in force at each fillRect, in call order. */
function fillsOf(calls: CtxCall[]): string[] {
  let current = ''
  const out: string[] = []
  for (const call of calls) {
    if (call[0] === 'set:fillStyle') current = String(call[1])
    if (call[0] === 'fillRect') out.push(current)
  }
  return out
}

const spanStyle: SpanStyle = { fill: c.data, chipBg: c.legendBg, chipText: c.text, font }
const ribbonColours: RibbonColours = { low: c.regimeLow, mid: c.regimeMid, high: c.regimeHigh }
const laneColours: LaneColours = { fall: c.barNeg, recover: c.barMag, hatch: c.chartVol, text: c.text, outline: c.white }

describe('geometry additions (roadmap 12)', () => {
  it('pins the context layer sizes', () => {
    expect(G.ribbonHeight).toBe(6)
    expect(G.ribbonGap).toBe(2)
    expect(G.spanAlpha).toBe(0.12)
    expect(G.laneBarShare).toBe(0.6)
    expect(G.hatchStep).toBe(4)
  })
})

describe('drawSpans: marked windows', () => {
  const span = (from: number, to: number, label = 'Window'): StackSpan => ({ from, to, label })

  it('fills the full plot height between the span ends at alpha 0.12, inside a save and restore', () => {
    const u = fakePlot({ xMin: 0, xMax: days(10) })
    drawSpans(u, [span(days(2), days(5))], spanStyle, false)
    const x0 = u.valToPos(days(2), 'x', true)
    const x1 = u.valToPos(days(5), 'x', true)
    const calls = u.ctx.calls
    expect(named(calls, 'fillRect')).toEqual([['fillRect', x0, u.bbox.top, x1 - x0, u.bbox.height]])
    expect(calls).toContainEqual(['set:fillStyle', c.data])
    expect(calls).toContainEqual(['set:globalAlpha', G.spanAlpha])
    const save = indexOfCall(calls, 'save')
    const alpha = indexOfCall(calls, 'set:globalAlpha', G.spanAlpha)
    const fill = indexOfCall(calls, 'fillRect')
    const restore = indexOfCall(calls, 'restore')
    expect(save).toBeGreaterThanOrEqual(0)
    expect(save).toBeLessThan(alpha)
    expect(alpha).toBeLessThan(fill)
    expect(fill).toBeLessThan(restore)
    expect(named(calls, 'save')).toHaveLength(named(calls, 'restore').length)
  })

  it('draws every span in one translucent pass, so the alpha never leaks into the chips', () => {
    const u = fakePlot({ xMin: 0, xMax: days(10) })
    drawSpans(u, [span(days(1), days(2), 'A'), span(days(6), days(8), 'B')], spanStyle, true)
    const calls = u.ctx.calls
    expect(named(calls, 'set:globalAlpha')).toHaveLength(1)
    const alphaAt = indexOfCall(calls, 'set:globalAlpha')
    const restoreAt = calls.findIndex((x, i) => x[0] === 'restore' && i > alphaAt)
    const rects = calls.flatMap((x, i) => (x[0] === 'fillRect' ? [i] : []))
    // Two span fills under the alpha, then the two chip boxes after it is restored.
    expect(rects).toHaveLength(4)
    expect(rects.slice(0, 2).every((i) => i > alphaAt && i < restoreAt)).toBe(true)
    expect(rects.slice(2).every((i) => i > restoreAt)).toBe(true)
  })

  it('clips a span to the visible x range on both sides', () => {
    const u = fakePlot({ xMin: days(3), xMax: days(8) })
    drawSpans(u, [span(days(1), days(5)), span(days(6), days(12))], spanStyle, false)
    const [first, second] = named(u.ctx.calls, 'fillRect')
    const right = u.bbox.left + u.bbox.width
    expect(first).toEqual(['fillRect', u.bbox.left, u.bbox.top, u.valToPos(days(5), 'x', true) - u.bbox.left, u.bbox.height])
    expect(second![1]).toBe(u.valToPos(days(6), 'x', true))
    expect((second![1] as number) + (second![3] as number)).toBeCloseTo(right, 9)
  })

  it('draws nothing for a span wholly outside the view, and no chip for it', () => {
    const u = fakePlot({ xMin: days(3), xMax: days(8) })
    drawSpans(u, [span(days(0), days(2), 'Before'), span(days(9), days(10), 'After')], spanStyle, true)
    expect(u.ctx.calls.filter((x) => x[0] === 'fillRect' || x[0] === 'fillText')).toEqual([])
  })

  it('draws nothing and touches no state for an empty list', () => {
    const u = fakePlot({ xMin: 0, xMax: days(10) })
    drawSpans(u, [], spanStyle, true)
    expect(u.ctx.calls).toEqual([])
  })

  it('draws nothing while the x scale is unset, and skips reversed or non-finite spans', () => {
    const blank = fakePlot({ xMin: 0, xMax: days(10) })
    const unset = { ...blank, scales: { ...blank.scales, x: { min: null, max: null } } }
    drawSpans(unset, [span(days(1), days(2))], spanStyle, true)
    expect(blank.ctx.calls).toEqual([])
    const u = fakePlot({ xMin: 0, xMax: days(10) })
    drawSpans(u, [span(days(5), days(2), 'Reversed'), span(Number.NaN, days(2), 'NaN')], spanStyle, true)
    expect(named(u.ctx.calls, 'fillRect')).toEqual([])
  })

  it('keeps a one-instant span visible as a hairline of one device pixel', () => {
    const u = fakePlot({ xMin: 0, xMax: days(10), pxRatio: 2 })
    drawSpans(u, [span(days(4), days(4))], spanStyle, false)
    const [rect] = named(u.ctx.calls, 'fillRect')
    expect(rect![3]).toBe(2)
  })

  describe('chips', () => {
    it('go on the top pane only', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10) })
      drawSpans(u, [span(days(1), days(3), 'Alpha')], spanStyle, false)
      expect(named(u.ctx.calls, 'fillText')).toEqual([])
      const top = fakePlot({ xMin: 0, xMax: days(10) })
      drawSpans(top, [span(days(1), days(3), 'Alpha')], spanStyle, true)
      expect(named(top.ctx.calls, 'fillText').map((x) => x[1])).toEqual(['Alpha'])
    })

    it('sit 4px right of the span start and 2px under the plot top, on the chip background', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10), pxRatio: 2 })
      drawSpans(u, [span(days(1), days(3), 'Alpha')], spanStyle, true)
      const calls = u.ctx.calls
      const x0 = u.valToPos(days(1), 'x', true)
      const boxes = named(calls, 'fillRect').slice(1)
      expect(boxes).toHaveLength(1)
      expect(boxes[0]![1]).toBe(x0 + 4 * 2)
      expect(boxes[0]![2]).toBe(u.bbox.top + 2 * 2)
      const bg = indexOfCall(calls, 'set:fillStyle', c.legendBg)
      const box = calls.indexOf(boxes[0]!)
      const ink = indexOfCall(calls, 'set:fillStyle', c.text)
      const text = indexOfCall(calls, 'fillText', 'Alpha')
      expect(bg).toBeLessThan(box)
      expect(box).toBeLessThan(ink)
      expect(ink).toBeLessThan(text)
      // The text sits inside its box, left aligned.
      expect(calls[text]![2] as number).toBeGreaterThan(boxes[0]![1] as number)
      expect(calls).toContainEqual(['set:textAlign', 'left'])
    })

    it('start at the left edge of the view (plus 4px) for a span that began before it', () => {
      const u = fakePlot({ xMin: days(3), xMax: days(8) })
      drawSpans(u, [span(days(1), days(5), 'Alpha')], spanStyle, true)
      const box = named(u.ctx.calls, 'fillRect')[1]!
      expect(box[1]).toBe(u.bbox.left + 4)
    })

    it('skip a chip that would overlap the previous one, and keep a clear one', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10) })
      drawSpans(u, [
        span(days(1), days(3), 'Alpha'),
        span(days(1.2), days(4), 'Overlapping'),
        span(days(5), days(6), 'Clear'),
      ], spanStyle, true)
      expect(named(u.ctx.calls, 'fillText').map((x) => x[1])).toEqual(['Alpha', 'Clear'])
      // All three windows are still filled: only the chip is dropped.
      expect(named(u.ctx.calls, 'fillRect').filter((x) => x[2] === u.bbox.top && x[4] === u.bbox.height)).toHaveLength(3)
    })

    it('compare against the last chip drawn, not the last one skipped', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10) })
      // B is skipped (inside A's chip); C starts clear of A's chip, though it is under B's would-be chip.
      drawSpans(u, [
        span(days(1), days(2), 'Alpha'),
        span(days(1.1), days(9), 'Blocked but wide'),
        span(days(3), days(4), 'Third'),
      ], spanStyle, true)
      expect(named(u.ctx.calls, 'fillText').map((x) => x[1])).toEqual(['Alpha', 'Third'])
    })

    it('are drawn in time order whatever order the spans arrive in', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10) })
      drawSpans(u, [span(days(6), days(7), 'Late'), span(days(1), days(2), 'Early')], spanStyle, true)
      expect(named(u.ctx.calls, 'fillText').map((x) => x[1])).toEqual(['Early', 'Late'])
    })

    it('are skipped when they would pass the right edge of the plot', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10) })
      drawSpans(u, [span(days(9.8), days(10), 'Too wide to fit'), span(days(2), days(3), 'Fits')], spanStyle, true)
      expect(named(u.ctx.calls, 'fillText').map((x) => x[1])).toEqual(['Fits'])
      // Every chip box ends inside the plot.
      const right = u.bbox.left + u.bbox.width
      for (const box of named(u.ctx.calls, 'fillRect').filter((x) => x[2] !== u.bbox.top || x[4] !== u.bbox.height)) {
        expect((box[1] as number) + (box[3] as number)).toBeLessThanOrEqual(right)
      }
    })

    it('scale with the pixel ratio: the chip font and its box are in canvas pixels', () => {
      const u = fakePlot({ xMin: 0, xMax: days(10), pxRatio: 2 })
      drawSpans(u, [span(days(1), days(3), 'Alpha')], spanStyle, true)
      const fontSet = u.ctx.calls.find((x) => x[0] === 'set:font')
      expect(fontSet![1]).toBe(`${font.size * 2}px ${font.family}`)
      const box = named(u.ctx.calls, 'fillRect')[1]!
      expect(box[4]).toBe((font.size + 3) * 2)
    })
  })
})

describe('ribbonRuns', () => {
  it('lists each run of one state with the times of its first and last session and its length', () => {
    const values: (RibbonState | null)[] = ['low', 'low', 'mid', 'high', 'high', 'high', 'low']
    expect(ribbonRuns(T.slice(0, 7), values)).toEqual([
      { state: 'low', from: days(0), to: days(1), sessions: 2 },
      { state: 'mid', from: days(2), to: days(2), sessions: 1 },
      { state: 'high', from: days(3), to: days(5), sessions: 3 },
      { state: 'low', from: days(6), to: days(6), sessions: 1 },
    ])
  })

  it('splits a run at a gap: null is not a state and joins nothing', () => {
    const values: (RibbonState | null)[] = ['low', null, 'low', 'low', null, null, 'mid']
    expect(ribbonRuns(T.slice(0, 7), values)).toEqual([
      { state: 'low', from: days(0), to: days(0), sessions: 1 },
      { state: 'low', from: days(2), to: days(3), sessions: 2 },
      { state: 'mid', from: days(6), to: days(6), sessions: 1 },
    ])
  })

  it('returns no runs for no data, all gaps, or no times', () => {
    expect(ribbonRuns([], [])).toEqual([])
    expect(ribbonRuns(T.slice(0, 3), [null, null, null])).toEqual([])
    expect(ribbonRuns([], ['low'])).toEqual([])
  })

  it('reads a short values list as gaps after its end and ignores values past the last time', () => {
    expect(ribbonRuns(T.slice(0, 4), ['mid', 'mid'])).toEqual([{ state: 'mid', from: days(0), to: days(1), sessions: 2 }])
    expect(ribbonRuns(T.slice(0, 2), ['mid', 'mid', 'mid', 'mid'])).toEqual([{ state: 'mid', from: days(0), to: days(1), sessions: 2 }])
  })

  it('counts a long series in one pass', () => {
    const n = 20_000
    const t = Array.from({ length: n }, (_, i) => i * DAY)
    const values = Array.from({ length: n }, (_, i): RibbonState => (Math.floor(i / 100) % 2 === 0 ? 'low' : 'high'))
    const runs = ribbonRuns(t, values)
    expect(runs).toHaveLength(200)
    expect(runs.every((r) => r.sessions === 100)).toBe(true)
  })
})

describe('drawRibbon: the regime strip under the time axis', () => {
  // 100px per session: the cell of session i is exactly [8 + 100 i, 8 + 100 (i + 1)) on a 1100px plot.
  const plot = (over: Partial<Parameters<typeof fakePlot>[0]> = {}) =>
    fakePlot({ xMin: -days(0.5), xMax: days(10.5), width: 1191, height: 400, ...over })
  const spec = (values: (RibbonState | null)[]): RibbonSpec => ({
    name: LINE_STACK_GALLERY.regimeName,
    values,
    states: {
      low: { label: LINE_STACK_GALLERY.states.low, glyph: LINE_STACK_GALLERY.glyphs.low },
      mid: { label: LINE_STACK_GALLERY.states.mid, glyph: LINE_STACK_GALLERY.glyphs.mid },
      high: { label: LINE_STACK_GALLERY.states.high, glyph: LINE_STACK_GALLERY.glyphs.high },
    },
    missing: LINE_STACK.missing,
  })
  const VALUES: (RibbonState | null)[] = ['low', 'low', 'mid', null, 'high', 'high', 'high', 'low', null, null, 'mid']

  it('fills one rect per run of equal non-null states, cell edges at the midpoints between sessions', () => {
    const u = plot()
    drawRibbon(u, T, spec(VALUES), ribbonColours)
    const y = u.bbox.top + u.bbox.height + (G.xAxisHeight + G.ribbonGap)
    const rects = named(u.ctx.calls, 'fillRect')
    expect(rects).toEqual([
      ['fillRect', 8, y, 200, G.ribbonHeight],
      ['fillRect', 208, y, 100, G.ribbonHeight],
      ['fillRect', 408, y, 300, G.ribbonHeight],
      ['fillRect', 708, y, 100, G.ribbonHeight],
      ['fillRect', 1008, y, 100, G.ribbonHeight],
    ])
  })

  it('colours each run by its state', () => {
    const u = plot()
    drawRibbon(u, T, spec(VALUES), ribbonColours)
    expect(fillsOf(u.ctx.calls)).toEqual([c.regimeLow, c.regimeMid, c.regimeHigh, c.regimeLow, c.regimeMid])
  })

  it('sits under the time axis: bbox bottom plus (45 + 2) css pixels, 6px tall, in canvas pixels', () => {
    const u = plot({ pxRatio: 2 })
    drawRibbon(u, T, spec(VALUES), ribbonColours)
    const rects = named(u.ctx.calls, 'fillRect')
    expect(rects.length).toBeGreaterThan(0)
    for (const r of rects) {
      expect(r[2]).toBe(u.bbox.top + u.bbox.height + (45 + 2) * 2)
      expect(r[4]).toBe(6 * 2)
    }
  })

  it('shares each boundary exactly between neighbouring runs, so no seam shows', () => {
    const t = [days(0), days(1), days(2), days(5), days(6)]
    const u = fakePlot({ xMin: -days(0.5), xMax: days(6.5), width: 1000, height: 300 })
    drawRibbon(u, t, spec(['low', 'low', 'low', 'mid', 'mid']), ribbonColours)
    const [a, b] = named(u.ctx.calls, 'fillRect')
    expect((a![1] as number) + (a![3] as number)).toBe(b![1])
    // The boundary is the midpoint between day 2 and day 5, not the day 2 tick.
    expect(b![1]).toBe(Math.round(u.valToPos(days(3.5), 'x', true)))
  })

  it('mirrors the end cells: the first starts half a step before the first session, the last ends half a step after', () => {
    const u = fakePlot({ xMin: -days(2), xMax: days(12), width: 1191, height: 400 })
    drawRibbon(u, T, spec(['low', ...Array<RibbonState>(9).fill('mid'), 'high']), ribbonColours)
    const rects = named(u.ctx.calls, 'fillRect')
    const first = rects[0]!
    const last = rects[rects.length - 1]!
    expect(first[1]).toBe(Math.round(u.valToPos(-days(0.5), 'x', true)))
    expect((last[1] as number) + (last[3] as number)).toBe(Math.round(u.valToPos(days(10.5), 'x', true)))
  })

  it('clips a run to the visible x range and drops runs outside it', () => {
    const u = plot({ xMin: days(3.75), xMax: days(6.9) })
    drawRibbon(u, T, spec(VALUES), ribbonColours)
    const right = u.bbox.left + u.bbox.width
    const rects = named(u.ctx.calls, 'fillRect')
    // Only the high run (edges 3.5 to 6.5 days) and the low session at day 7 (6.5 to 7.5) reach the view.
    expect(rects).toHaveLength(2)
    expect(rects[0]![1]).toBe(u.bbox.left)
    expect((rects[1]![1] as number) + (rects[1]![3] as number)).toBe(right)
    for (const r of rects) {
      expect(r[1] as number).toBeGreaterThanOrEqual(u.bbox.left)
      expect((r[1] as number) + (r[3] as number)).toBeLessThanOrEqual(right)
    }
  })

  it('draws nothing for gaps: an all-null strip leaves the canvas alone', () => {
    const u = plot()
    drawRibbon(u, T, spec(Array<RibbonState | null>(11).fill(null)), ribbonColours)
    expect(named(u.ctx.calls, 'fillRect')).toEqual([])
  })

  it('draws nothing with no times or an unset x scale', () => {
    const u = plot()
    drawRibbon(u, [], spec([]), ribbonColours)
    expect(u.ctx.calls).toEqual([])
    const blank = plot()
    drawRibbon({ ...blank, scales: { ...blank.scales, x: { min: null, max: null } } }, T, spec(VALUES), ribbonColours)
    expect(blank.ctx.calls).toEqual([])
  })

  it('draws a single session as a one device pixel rect rather than nothing', () => {
    const u = fakePlot({ xMin: -days(1), xMax: days(1), width: 500, height: 300 })
    drawRibbon(u, [0], spec(['mid']), ribbonColours)
    const rects = named(u.ctx.calls, 'fillRect')
    expect(rects).toHaveLength(1)
    expect(rects[0]![3]).toBeGreaterThanOrEqual(1)
  })

  it('keeps every run at least one device pixel wide when sessions are narrower than a pixel', () => {
    const n = 4000
    const t = Array.from({ length: n }, (_, i) => i * DAY)
    const values = Array.from({ length: n }, (_, i): RibbonState => (i % 2 === 0 ? 'low' : 'high'))
    const u = fakePlot({ xMin: 0, xMax: (n - 1) * DAY, width: 800, height: 300 })
    drawRibbon(u, t, spec(values), ribbonColours)
    const rects = named(u.ctx.calls, 'fillRect')
    expect(rects).toHaveLength(n)
    expect(rects.every((r) => (r[3] as number) >= 1)).toBe(true)
  })

  it('saves and restores the context around its own state', () => {
    const u = plot()
    drawRibbon(u, T, spec(VALUES), ribbonColours)
    expect(named(u.ctx.calls, 'save')).toHaveLength(named(u.ctx.calls, 'restore').length)
    expect(named(u.ctx.calls, 'save').length).toBeGreaterThan(0)
  })
})

describe('drawLanes and laneAt: episode lanes', () => {
  const lanes: LanesSpec = {
    name: LINE_STACK_GALLERY.lanesName,
    episodes: [
      { rank: 1, peak: days(1), trough: days(3), end: days(6), open: false, depth: '-28.8%' },
      { rank: 2, peak: days(4), trough: days(5), end: days(10), open: true, depth: '-12.0%' },
      { rank: 3, peak: days(7), trough: days(8), end: days(9), open: false, depth: '-5.0%' },
    ],
  }
  // 100px per day from x = 8; three rows of 100px from y = 8; the bar is 60px, centred (20px above and below).
  const plot = (over: Partial<Parameters<typeof fakePlot>[0]> = {}) =>
    fakePlot({ xMin: 0, xMax: days(10), width: 1091, height: 353, ...over })
  const draw = (u = plot(), highlight: number | null = null, spec: LanesSpec = lanes) => {
    drawLanes(u, spec, laneColours, highlight, font)
    return u
  }

  it('draws the fall from peak to trough and the recovery from trough to end, one row per episode', () => {
    const u = draw()
    expect(named(u.ctx.calls, 'fillRect')).toEqual([
      ['fillRect', 108, 28, 200, 60],
      ['fillRect', 308, 28, 300, 60],
      ['fillRect', 408, 128, 100, 60],
      ['fillRect', 708, 228, 100, 60],
      ['fillRect', 808, 228, 100, 60],
    ])
  })

  it('fills the fall and the recovery in their own colours', () => {
    const u = draw()
    expect(fillsOf(u.ctx.calls)).toEqual([c.barNeg, c.barMag, c.barNeg, c.barNeg, c.barMag])
  })

  it('hatches an open episode recovery every 4 css pixels instead of filling it', () => {
    const u = draw()
    const calls = u.ctx.calls
    // The open recovery (day 5 to day 10) is a clipped hatch, not a fillRect.
    expect(named(calls, 'fillRect').some((x) => x[1] === 508)).toBe(false)
    expect(calls).toContainEqual(['rect', 508, 128, 500, 60])
    expect(indexOfCall(calls, 'clip')).toBeGreaterThan(indexOfCall(calls, 'rect', 508, 128, 500, 60))
    expect(calls).toContainEqual(['set:strokeStyle', c.chartVol])
    const starts = named(calls, 'moveTo').map((x) => x[1] as number)
    expect(starts.length).toBeGreaterThan(20)
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBe(G.hatchStep)
    expect(named(calls, 'stroke')).toHaveLength(1)
  })

  it('steps the hatch by the pixel ratio and keeps every stroke inside a clip on the recovery box', () => {
    const u = draw(plot({ pxRatio: 2 }))
    const starts = named(u.ctx.calls, 'moveTo').map((x) => x[1] as number)
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBe(G.hatchStep * 2)
    const clip = indexOfCall(u.ctx.calls, 'clip')
    const stroke = indexOfCall(u.ctx.calls, 'stroke')
    const restore = u.ctx.calls.findIndex((x, i) => x[0] === 'restore' && i > stroke)
    expect(clip).toBeLessThan(stroke)
    expect(stroke).toBeLessThan(restore)
  })

  it('does not hatch a closed episode', () => {
    const closed: LanesSpec = { name: 'x', episodes: [lanes.episodes[0]!] }
    const u = draw(plot(), null, closed)
    expect(named(u.ctx.calls, 'stroke')).toEqual([])
    expect(named(u.ctx.calls, 'clip')).toEqual([])
  })

  it('makes the bar 60% of its row, but never under 2 css pixels', () => {
    const many: LanesSpec = {
      name: 'x',
      episodes: Array.from({ length: 200 }, (_, i) => ({ rank: i + 1, peak: days(1), trough: days(2), end: days(3), open: false, depth: '-1%' })),
    }
    const u = draw(plot({ pxRatio: 2 }), null, many)
    const rects = named(u.ctx.calls, 'fillRect')
    expect(rects.length).toBeGreaterThan(0)
    expect(rects.every((r) => (r[4] as number) >= 4)).toBe(true)
    expect(rects[0]![4]).toBe(4)
  })

  it('centres a bar in its row', () => {
    const u = draw()
    const rowTop = u.bbox.top + 100
    const rowBottom = rowTop + 100
    const [, , y, , h] = named(u.ctx.calls, 'fillRect')[2] as [string, number, number, number, number]
    expect(y - rowTop).toBe(20)
    expect(rowBottom - (y + h)).toBe(20)
  })

  it('clips episodes to the visible range and skips one wholly outside it', () => {
    const u = draw(plot({ xMin: days(2), xMax: days(4.5) }))
    const rects = named(u.ctx.calls, 'fillRect')
    const right = u.bbox.left + u.bbox.width
    // Episode 1's fall starts before the view (clipped to the left edge); episode 3 is outside.
    expect(rects[0]![1]).toBe(u.bbox.left)
    for (const r of rects) expect((r[1] as number) + (r[3] as number)).toBeLessThanOrEqual(right + 1e-9)
    expect(rects.every((r) => (r[2] as number) < 200)).toBe(true)
  })

  it('writes the rank at the left edge of each row, and the depth right of the fall when there is room', () => {
    const u = draw()
    const texts = named(u.ctx.calls, 'fillText')
    expect(texts).toContainEqual(['fillText', '1', 12, 58])
    expect(texts).toContainEqual(['fillText', '2', 12, 158])
    expect(texts).toContainEqual(['fillText', '3', 12, 258])
    expect(texts).toContainEqual(['fillText', '-28.8%', 312, 58])
    expect(texts).toContainEqual(['fillText', '-5.0%', 812, 258])
    expect(u.ctx.calls).toContainEqual(['set:textBaseline', 'middle'])
    expect(u.ctx.calls).toContainEqual(['set:fillStyle', c.text])
  })

  it('writes the word open on an open episode, after its depth, when there is room', () => {
    const u = draw()
    const texts = named(u.ctx.calls, 'fillText')
    const depth = texts.find((x) => x[1] === '-12.0%')!
    const open = texts.find((x) => x[1] === LINE_STACK.laneOpen)!
    expect(depth).toBeDefined()
    expect(open).toBeDefined()
    expect(open[2] as number).toBeGreaterThan(depth[2] as number)
    expect(texts.filter((x) => x[1] === LINE_STACK.laneOpen)).toHaveLength(1)
  })

  it('leaves out the depth and the word open where the recovery is too short to hold them', () => {
    const short: LanesSpec = {
      name: 'x',
      episodes: [{ rank: 1, peak: days(1), trough: days(5), end: days(5.2), open: true, depth: '-28.8%' }],
    }
    const u = draw(plot(), null, short)
    const words = named(u.ctx.calls, 'fillText').map((x) => x[1])
    expect(words).toEqual(['1'])
  })

  it('leaves out every label when rows are shorter than the text, but still draws the bars', () => {
    const many: LanesSpec = {
      name: 'x',
      episodes: Array.from({ length: 40 }, (_, i) => ({ rank: i + 1, peak: days(1), trough: days(2), end: days(9), open: false, depth: '-1%' })),
    }
    const u = draw(plot(), null, many)
    expect(named(u.ctx.calls, 'fillText')).toEqual([])
    expect(named(u.ctx.calls, 'fillRect').length).toBe(80)
  })

  it('outlines only the highlighted rank, 1 css pixel wide, inside its bar and after the fills', () => {
    const u = draw(plot(), 2)
    const calls = u.ctx.calls
    const strokes = named(calls, 'strokeRect')
    expect(strokes).toEqual([['strokeRect', 408.5, 128.5, 599, 59]])
    const outline = indexOfCall(calls, 'set:strokeStyle', c.white)
    expect(outline).toBeGreaterThanOrEqual(0)
    expect(calls).toContainEqual(['set:lineWidth', 1])
    expect(outline).toBeGreaterThan(calls.map((x) => x[0]).lastIndexOf('fillRect'))
  })

  it('draws the outline at the pixel ratio and never a second one', () => {
    const u = draw(plot({ pxRatio: 2 }), 1)
    expect(named(u.ctx.calls, 'strokeRect')).toHaveLength(1)
    expect(u.ctx.calls).toContainEqual(['set:lineWidth', 2])
  })

  it('draws no outline for null, or for a rank that is not in the lanes', () => {
    expect(named(draw(plot(), null).ctx.calls, 'strokeRect')).toEqual([])
    expect(named(draw(plot(), 99).ctx.calls, 'strokeRect')).toEqual([])
  })

  it('draws no outline for a highlighted episode that is wholly outside the view', () => {
    const u = draw(plot({ xMin: days(0), xMax: days(2) }), 3)
    expect(named(u.ctx.calls, 'strokeRect')).toEqual([])
  })

  it('skips an episode whose trough is not after its peak, or that ends before its trough', () => {
    const odd: LanesSpec = {
      name: 'x',
      episodes: [
        { rank: 1, peak: days(3), trough: days(3), end: days(6), open: false, depth: '0%' },
        { rank: 2, peak: days(4), trough: days(6), end: days(5), open: false, depth: '0%' },
      ],
    }
    // Two rows of 150px, bars of 90px centred 30px in. Row 1 has a recovery and no fall; row 2 a fall and no recovery.
    const u = draw(plot(), null, odd)
    expect(named(u.ctx.calls, 'fillRect')).toEqual([
      ['fillRect', 308, 38, 300, 90],
      ['fillRect', 408, 188, 200, 90],
    ])
  })

  it('draws nothing for no episodes or an unset x scale, and balances save and restore', () => {
    const empty = plot()
    drawLanes(empty, { name: 'x', episodes: [] }, laneColours, null, font)
    expect(empty.ctx.calls).toEqual([])
    const blank = plot()
    drawLanes({ ...blank, scales: { ...blank.scales, x: { min: null, max: null } } }, lanes, laneColours, null, font)
    expect(blank.ctx.calls).toEqual([])
    const u = draw(plot(), 1)
    expect(named(u.ctx.calls, 'save')).toHaveLength(named(u.ctx.calls, 'restore').length)
  })

  describe('laneAt', () => {
    const ranked: LanesSpec = {
      name: 'x',
      episodes: [
        { rank: 5, peak: 0, trough: 1, end: 2, open: false, depth: '' },
        { rank: 2, peak: 0, trough: 1, end: 2, open: false, depth: '' },
        { rank: 9, peak: 0, trough: 1, end: 2, open: true, depth: '' },
      ],
    }

    it('returns the rank of the row under a css y measured from the plot top', () => {
      expect(laneAt(ranked, 0, 300)).toBe(5)
      expect(laneAt(ranked, 99.9, 300)).toBe(5)
      expect(laneAt(ranked, 100, 300)).toBe(2)
      expect(laneAt(ranked, 199, 300)).toBe(2)
      expect(laneAt(ranked, 200, 300)).toBe(9)
      expect(laneAt(ranked, 299.9, 300)).toBe(9)
    })

    it('returns null above the plot, below it, and for a plot with no height', () => {
      expect(laneAt(ranked, -1, 300)).toBeNull()
      expect(laneAt(ranked, 300, 300)).toBeNull()
      expect(laneAt(ranked, 450, 300)).toBeNull()
      expect(laneAt(ranked, 10, 0)).toBeNull()
      expect(laneAt(ranked, 10, -5)).toBeNull()
    })

    it('returns null for non-finite input and for no episodes', () => {
      expect(laneAt(ranked, Number.NaN, 300)).toBeNull()
      expect(laneAt(ranked, 10, Number.NaN)).toBeNull()
      expect(laneAt(ranked, Number.POSITIVE_INFINITY, 300)).toBeNull()
      expect(laneAt({ name: 'x', episodes: [] }, 10, 300)).toBeNull()
    })

    it('agrees with the rows drawLanes uses', () => {
      const u = plot()
      const cssHeight = u.bbox.height
      for (const [i, e] of lanes.episodes.entries()) {
        expect(laneAt(lanes, (i + 0.5) * (cssHeight / 3), cssHeight)).toBe(e.rank)
      }
    })
  })
})

describe('contextReadout: what the polite live region says at the crosshair', () => {
  const spans: StackSpan[] = [
    { from: days(2), to: days(4), label: LINE_STACK_GALLERY.windowLabels[0] },
    { from: days(3), to: days(6), label: LINE_STACK_GALLERY.windowLabels[1] },
  ]
  const ribbon: RibbonSpec = {
    name: 'Regime',
    values: ['low', 'low', 'mid', 'mid', 'high', 'high', null, 'low', 'low', 'low', 'low'],
    states: {
      low: { label: LINE_STACK_GALLERY.states.low, glyph: 'L' },
      mid: { label: LINE_STACK_GALLERY.states.mid, glyph: 'M' },
      high: { label: LINE_STACK_GALLERY.states.high, glyph: 'H' },
    },
    missing: '--',
  }
  const lanes: LanesSpec = {
    name: 'Episodes',
    episodes: [
      { rank: 1, peak: days(1), trough: days(3), end: days(5), open: false, depth: '-20%' },
      { rank: 2, peak: days(6), trough: days(8), end: days(10), open: true, depth: '-9%' },
    ],
  }

  it('names each marked window the crosshair is inside, the regime state with its glyph, and the lane phase', () => {
    expect(contextReadout(T, 3, spans, ribbon, [lanes])).toBe(
      'inside 2020 COVID crash | inside 2018 Q4 sell-off | Regime: mid volatility (M) | episode 1 falling',
    )
  })

  it('says nothing for the parts that do not apply', () => {
    expect(contextReadout(T, 0, spans, undefined, [])).toBe('')
    expect(contextReadout(T, 9, [], undefined, [lanes])).toBe('episode 2 open')
    expect(contextReadout(T, 5, undefined, ribbon, [])).toBe('Regime: high volatility (H)')
  })

  it('counts the window ends as inside', () => {
    expect(contextReadout(T, 2, spans, undefined, [])).toBe('inside 2020 COVID crash')
    expect(contextReadout(T, 6, spans, undefined, [])).toBe('inside 2018 Q4 sell-off')
    expect(contextReadout(T, 7, spans, undefined, [])).toBe('')
  })

  it('says the regime is missing at a gap, using the strip\'s own missing text', () => {
    expect(contextReadout(T, 6, undefined, ribbon, [])).toBe('Regime --')
  })

  it('follows an episode through falling, recovering and (when unrecovered) open', () => {
    const at = (idx: number) => contextReadout(T, idx, undefined, undefined, [lanes])
    expect(at(0)).toBe('')
    expect(at(1)).toBe('episode 1 falling')
    expect(at(3)).toBe('episode 1 falling')
    expect(at(4)).toBe('episode 1 recovering')
    expect(at(5)).toBe('episode 1 recovering')
    expect(at(6)).toBe('episode 2 falling')
    expect(at(8)).toBe('episode 2 falling')
    expect(at(9)).toBe('episode 2 open')
    expect(at(10)).toBe('episode 2 open')
  })

  it('reads every lanes pane', () => {
    const second: LanesSpec = { name: 'Benchmark', episodes: [{ rank: 4, peak: days(2), trough: days(4), end: days(9), open: false, depth: '-3%' }] }
    expect(contextReadout(T, 3, undefined, undefined, [lanes, second])).toBe('episode 1 falling | episode 4 falling')
  })

  it('returns an empty string for an index outside the times', () => {
    expect(contextReadout(T, -1, spans, ribbon, [lanes])).toBe('')
    expect(contextReadout(T, 99, spans, ribbon, [lanes])).toBe('')
    expect(contextReadout([], 0, spans, ribbon, [lanes])).toBe('')
  })

  it('reads a ribbon shorter than the times as a gap', () => {
    const short: RibbonSpec = { ...ribbon, values: ['low'] }
    expect(contextReadout(T, 5, undefined, short, [])).toBe('Regime --')
  })
})

describe('contextTables: the T table view of the context layer', () => {
  const spans: StackSpan[] = [
    { from: days(1), to: days(3), label: 'Window one' },
    { from: days(20), to: days(30), label: 'Window two [SPENT]' },
    { from: days(9), to: days(15), label: 'Window three' },
  ]
  const ribbon: RibbonSpec = {
    name: 'Regime',
    values: ['low', 'low', 'high', 'high', 'high', null, 'mid', 'mid', 'mid', 'mid', 'mid'],
    states: {
      low: { label: 'low volatility', glyph: 'L' },
      mid: { label: 'mid volatility', glyph: 'M' },
      high: { label: 'high volatility', glyph: 'H' },
    },
    missing: '--',
  }
  const lanes: LanesSpec = {
    name: 'Episodes',
    episodes: [
      { rank: 1, peak: days(1), trough: days(3), end: days(5), open: false, depth: '-20.0%' },
      { rank: 2, peak: days(6), trough: days(8), end: days(10), open: true, depth: '-9.0%' },
    ],
  }
  const iso = (n: number) => new Date(days(n) * 1000).toISOString().slice(0, 10)

  it('returns no tables without a context layer', () => {
    expect(contextTables('Equity', T, undefined, undefined, [])).toEqual([])
    expect(contextTables('Equity', T, [], undefined, [])).toEqual([])
    expect(contextTables('Equity', T, undefined, { ...ribbon, values: [null, null] }, [])).toEqual([])
    expect(contextTables('Equity', T, undefined, undefined, [{ name: 'x', episodes: [] }])).toEqual([])
  })

  it('lists the marked windows with their dates and whether the data reaches them', () => {
    const [table] = contextTables('Equity', T, spans, undefined, [])
    expect(table!.caption).toBe('Equity, marked windows')
    expect(table!.columns.map((col) => col.label)).toEqual(['Window', 'From', 'To', 'In view'])
    expect(table!.rows).toEqual([
      { window: 'Window one', from: iso(1), to: iso(3), inView: 'yes' },
      { window: 'Window two [SPENT]', from: iso(20), to: iso(30), inView: 'no' },
      { window: 'Window three', from: iso(9), to: iso(15), inView: 'yes' },
    ])
  })

  it('counts a window that only partly overlaps the data as in view', () => {
    const [table] = contextTables('Equity', T, [{ from: days(-5), to: days(0), label: 'Edge' }], undefined, [])
    expect(table!.rows[0]).toMatchObject({ inView: 'yes' })
  })

  it('lists the regime runs with the state in words, dates and the number of sessions', () => {
    const [table] = contextTables('Equity', T, undefined, ribbon, [])
    expect(table!.caption).toBe('Equity, Regime runs')
    expect(table!.columns.map((col) => col.label)).toEqual(['State', 'From', 'To', 'Sessions'])
    expect(table!.columns[3]!.numeric).toBe(true)
    // The date window is unique per run and names it; the state repeats, so it stays a plain cell (ChartA11y D38).
    expect(table!.columns.filter((c) => c.rowHeader).map((c) => c.key)).toEqual(['from'])
    expect(table!.rows).toEqual([
      { state: 'low volatility', from: iso(0), to: iso(1), sessions: 2 },
      { state: 'high volatility', from: iso(2), to: iso(4), sessions: 3 },
      { state: 'mid volatility', from: iso(6), to: iso(10), sessions: 5 },
    ])
  })

  it('leaves the first-column row header on the windows and episodes tables, whose first column is unique', () => {
    const tables = contextTables('Equity', T, spans, undefined, [lanes])
    expect(tables.map((tbl) => tbl.columns.filter((c) => c.rowHeader).length)).toEqual([0, 0])
    expect(tables.map((tbl) => tbl.columns[0]!.key)).toEqual(['window', 'rank'])
  })

  it('lists the episodes with dates, whether each has recovered, and its depth', () => {
    const [table] = contextTables('Equity', T, undefined, undefined, [lanes])
    expect(table!.caption).toBe('Equity, episodes')
    expect(table!.columns.map((col) => col.label)).toEqual(['#', 'Peak', 'Trough', 'End', 'State', 'Depth'])
    expect(table!.rows).toEqual([
      { rank: 1, peak: iso(1), trough: iso(3), end: iso(5), state: 'recovered', depth: '-20.0%' },
      { rank: 2, peak: iso(6), trough: iso(8), end: iso(10), state: 'open', depth: '-9.0%' },
    ])
  })

  it('returns the tables in reading order: windows, regime, episodes', () => {
    const tables = contextTables('Equity', T, spans, ribbon, [lanes])
    expect(tables.map((tbl) => tbl.caption)).toEqual(['Equity, marked windows', 'Equity, Regime runs', 'Equity, episodes'])
  })

  it('gives a second lanes pane its own caption', () => {
    const second: LanesSpec = { name: 'Benchmark episodes', episodes: lanes.episodes }
    const tables = contextTables('Equity', T, undefined, undefined, [lanes, second])
    expect(tables.map((tbl) => tbl.caption)).toEqual(['Equity, Episodes', 'Equity, Benchmark episodes'])
    expect(new Set(tables.map((tbl) => tbl.caption)).size).toBe(2)
  })

  it('keeps one caption for a single lanes pane', () => {
    expect(contextTables('Equity', T, undefined, undefined, [lanes])[0]!.caption).toBe('Equity, episodes')
  })

  it('shows the time of day on an intraday stack', () => {
    const minute = Array.from({ length: 5 }, (_, i) => 1_700_000_000 + i * 60)
    const [table] = contextTables('Equity', minute, [{ from: minute[1]!, to: minute[3]!, label: 'Session' }], undefined, [])
    expect(table!.rows[0]!.from).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('has a row for every column key, so the table renders whole', () => {
    for (const table of contextTables('Equity', T, spans, ribbon, [lanes])) {
      for (const row of table.rows) expect(Object.keys(row).sort()).toEqual(table.columns.map((col) => col.key).sort())
    }
  })
})

describe('contextSummary and spansInView', () => {
  it('states the marked windows in view and the episode lanes', () => {
    expect(contextSummary(2, 6)).toBe('Marked windows in view: 2. Episode lanes: 6.')
    expect(contextSummary(1, 1)).toBe('Marked windows in view: 1. Episode lanes: 1.')
    expect(contextSummary(0, 0)).toBe('Marked windows in view: 0. Episode lanes: 0.')
  })

  it('counts the spans that touch a time range, ends included', () => {
    const spans: StackSpan[] = [
      { from: days(1), to: days(3), label: 'a' },
      { from: days(3), to: days(5), label: 'b' },
      { from: days(6), to: days(7), label: 'c' },
      { from: days(20), to: days(21), label: 'd' },
    ]
    expect(spansInView(spans, days(0), days(10))).toBe(3)
    expect(spansInView(spans, days(3), days(3))).toBe(2)
    expect(spansInView(spans, days(8), days(10))).toBe(0)
    expect(spansInView(undefined, days(0), days(10))).toBe(0)
    expect(spansInView([], days(0), days(10))).toBe(0)
  })
})
