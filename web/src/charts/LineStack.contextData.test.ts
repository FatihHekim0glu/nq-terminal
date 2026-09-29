import { describe, expect, it } from 'vitest'
import { LINE_STACK_GALLERY as G } from '../copy/lineStack'
// Cross-check only: the gallery data copies these dates, since a chart module must not import a screen.
import { HYP_EXTENDED } from '../screens/tear/tearP1.fixtures'
import { FENCE_TIME } from './fence'
import { contextStack, REGIME_WARMUP } from './LineStack.contextData'
import { contextReadout, contextTables, ribbonRuns } from './LineStack.context'
import { lanesOf } from './LineStack.model'

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
const number = (depth: string) => Number(depth.replace('%', ''))

describe('the context gallery data', () => {
  const stack = contextStack()
  const lanes = lanesOf(stack.panes)[0]!
  const equity = stack.panes[0]!.series[0]!.values as number[]

  it('is 2,500 seeded weekday sessions from 2011-01-03, all in sample', () => {
    expect(stack.t).toHaveLength(2500)
    expect(iso(stack.t[0]!)).toBe('2011-01-03')
    expect(stack.t.every((x, i) => i === 0 || x > stack.t[i - 1]!)).toBe(true)
    expect(stack.t.every((x) => ![0, 6].includes(new Date(x * 1000).getUTCDay()))).toBe(true)
    expect(stack.t.at(-1)!).toBeLessThan(FENCE_TIME)
    expect(stack.panes.map((p) => p.id)).toEqual(['eq', 'dd', 'lanes'])
    expect(equity).toHaveLength(2500)
  })

  it('is the same every time it is built', () => {
    expect(contextStack()).toEqual(stack)
  })

  it('has an underwater pane that is the equity below its running peak', () => {
    const dd = stack.panes[1]!.series[0]!.values as number[]
    expect(dd).toHaveLength(2500)
    expect(Math.max(...dd)).toBe(0)
    expect(Math.min(...dd)).toBeLessThan(-5)
  })

  it('marks the five frozen RK5 windows with the dates HYP_EXTENDED serves, deepest first', () => {
    expect(stack.spans).toHaveLength(5)
    const served = HYP_EXTENDED.stress.rows.map((r) => [r.label, r.peak, r.trough])
    expect(stack.spans.map((s) => [s.label, iso(s.from), iso(s.to)])).toEqual(served)
    expect(stack.spans.map((s) => s.label)).toEqual([...G.windowLabels])
    // Every window lies inside the data, so all five show.
    for (const s of stack.spans) {
      expect(s.from).toBeGreaterThanOrEqual(stack.t[0]!)
      expect(s.to).toBeLessThanOrEqual(stack.t.at(-1)!)
    }
  })

  it('has a seeded three-state strip that starts after the warm-up, with all three states and a gap', () => {
    const { ribbon } = stack
    expect(ribbon.values).toHaveLength(stack.t.length)
    expect(ribbon.name).toBe(G.regimeName)
    expect(ribbon.values.slice(0, REGIME_WARMUP).every((v) => v === null)).toBe(true)
    expect(ribbon.values[REGIME_WARMUP]).not.toBeNull()
    expect(new Set(ribbon.values.filter((v) => v !== null))).toEqual(new Set(['low', 'mid', 'high']))
    expect(ribbon.values.slice(REGIME_WARMUP).some((v) => v === null)).toBe(true)
    expect(ribbon.states.low).toEqual({ label: G.states.low, glyph: G.glyphs.low })
    // Runs are long enough to read: the strip is not noise.
    const runs = ribbonRuns(stack.t, ribbon.values)
    expect(runs.length).toBeGreaterThan(10)
    expect(runs.filter((r) => r.sessions >= 5).length / runs.length).toBeGreaterThan(0.8)
  })

  it('has six lanes, the deepest first, two of them open', () => {
    expect(lanes.name).toBe(G.lanesName)
    expect(lanes.episodes.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6])
    expect(lanes.episodes.filter((e) => e.open)).toHaveLength(2)
    const depths = lanes.episodes.map((e) => number(e.depth))
    expect(depths.every((d) => d < 0)).toBe(true)
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
  })

  it('has lanes that agree with the curve: depth from the peak to the trough, recovered episodes back at the peak', () => {
    const last = stack.t.at(-1)!
    const at = (time: number) => stack.t.indexOf(time)
    for (const e of lanes.episodes) {
      expect(e.peak).toBeLessThan(e.trough)
      expect(e.trough).toBeLessThan(e.end)
      expect(e.end).toBeLessThanOrEqual(last)
      const peak = equity[at(e.peak)]!
      const trough = equity[at(e.trough)]!
      expect(e.depth).toBe(`${((trough / peak - 1) * 100).toFixed(1)}%`)
      if (e.open) expect(e.end).toBe(last)
      else expect(equity[at(e.end)]!).toBeGreaterThanOrEqual(peak)
    }
  })

  it('reads as text at a session inside a window: the window, the regime and the episodes', () => {
    const covid = stack.spans[0]!
    const idx = stack.t.findIndex((x) => x >= covid.from)
    const text = contextReadout(stack.t, idx, stack.spans, stack.ribbon, [lanes])
    expect(text).toContain(`inside ${G.windowLabels[0]}`)
    expect(text).toContain(`${G.regimeName}: `)
    const tables = contextTables(G.contextTitle, stack.t, stack.spans, stack.ribbon, [lanes])
    expect(tables.map((t) => t.rows.length)).toEqual([5, ribbonRuns(stack.t, stack.ribbon.values).length, 6])
  })
})
