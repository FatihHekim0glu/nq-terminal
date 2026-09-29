// A compare basket is drawn on the union of several series' times, so a null in one series only means
// that series has no row at that time. A series can therefore ask for its own values to be joined across
// its nulls (spanGaps); every other series keeps the rule that a null is a gap (LineStack.types.ts).
import type uPlot from 'uplot'
import { describe, expect, it } from 'vitest'
import { FENCE_TIME } from './fence'
import { paneOptions, type PaneBuild } from './LineStack.options'
import { DEFAULT_CHART_TOKENS } from './theme'
import type { LineStackPane } from './LineStack.types'

const DAY = 86_400
const t = Array.from({ length: 10 }, (_, i) => FENCE_TIME - (10 - i) * DAY)
const EQ: LineStackPane = {
  id: 'eq',
  logAllowed: true,
  zero: 'white',
  series: [
    { name: 'Strategy', style: 'primary', values: [] },
    { name: 'Benchmark', style: 'benchmark', values: [] },
  ],
}
const cursorSync = { key: 'nqt-link-A', scales: ['x', null] as ['x', null], filters: { pub: () => true, sub: () => true } }
const syncPlugin = { hooks: {} }

function build(overrides: Partial<PaneBuild> = {}): uPlot.Options {
  const pane = overrides.pane ?? EQ
  return paneOptions({
    pane,
    data: pane.series.map(() => t.map((_, i) => 1 + i / 10)),
    t,
    isBottom: true,
    showFenceLabel: true,
    tokens: DEFAULT_CHART_TOKENS,
    width: 800,
    height: 300,
    log: false,
    view: () => [t[0]!, FENCE_TIME],
    sync: { cursorSync, plugin: syncPlugin },
    fence: FENCE_TIME,
    pxRatio: 1,
    ...overrides,
  })
}

describe('LineStackSeries.spanGaps', () => {
  it('joins the values of a series that asks for it, and only that series', () => {
    const pane: LineStackPane = {
      id: 'compare',
      series: [
        { name: 'a', style: 'compare1', values: [], spanGaps: true },
        { name: 'b', style: 'compare2', values: [] },
      ],
    }
    const series = build({ pane }).series
    expect(series[1]).toMatchObject({ label: 'a', spanGaps: true })
    expect(series[2]).toMatchObject({ label: 'b', spanGaps: false })
  })

  it('still draws no hover or resting point for a series that spans gaps', () => {
    const pane: LineStackPane = { id: 'compare', series: [{ name: 'a', style: 'compare1', values: [], spanGaps: true }] }
    expect(build({ pane }).series[1]).toMatchObject({ points: { show: false } })
  })

  it('treats spanGaps: false like the default: a null is a gap', () => {
    const pane: LineStackPane = { id: 'compare', series: [{ name: 'a', style: 'compare1', values: [], spanGaps: false }] }
    expect(build({ pane }).series[1]).toMatchObject({ spanGaps: false })
  })

  it('leaves an equity pane, which never sets the flag, spanning no gap', () => {
    for (const s of build().series.slice(1)) expect(s).toMatchObject({ spanGaps: false })
  })
})
