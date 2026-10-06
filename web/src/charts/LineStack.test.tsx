// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Component, StrictMode, type ReactNode } from 'react'
import type uPlot from 'uplot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINE_STACK } from '../copy/lineStack'
import { FENCE_TIME } from './fence'
import type { UplotConstructor } from './lazy'
import LineStack from './LineStack'
import { recordingContext } from './LineStack.testUtil'
import { DEFAULT_CHART_TOKENS, FORCED_COLOURS_QUERY, readSystemColours } from './theme'
import { fakeMedia } from './theme/themeTestUtil'
import type { LanesSpec, LineStackPane, LineStackProps, RibbonSpec, StackSpan } from './LineStack.types'

/** A minimal error boundary, the same shape ScreenBoundary gives a panel whose child throws. */
class Boundary extends Component<{ readonly children: ReactNode }, { readonly error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (this.state.error !== null) return <div role="alert">{this.state.error}</div>
    return this.props.children
  }
}

type Hook = (u: FakeUplot) => void

/** Enough of uPlot for the component: options, scales, cursor, hooks and the calls made on it. */
class FakeUplot {
  static instances: FakeUplot[] = []
  /** As uPlot's: `event` is the pointer's own mouse event, and null on a pane a synced move only follows. */
  readonly cursor = { idx: null as number | null, left: -10, top: -10, event: null as object | null }
  readonly scales: { x: { min: number; max: number }; y: { min: number; max: number } }
  readonly over = { clientWidth: 600, clientHeight: 200 }
  readonly bbox = { left: 8, top: 8, width: 600, height: 200 }
  readonly ctx = recordingContext(700, 260)
  readonly width = 700
  readonly cursorCalls: [{ left: number; top: number }, boolean | undefined, boolean | undefined][] = []
  readonly scaleCalls: [string, { min: number; max: number }][] = []
  /** Each `setData(data, resetScales)` made on the plot. */
  readonly dataCalls: boolean[] = []
  destroyed = false

  readonly opts: uPlot.Options
  readonly data: (number | null)[][]
  readonly el: HTMLElement

  constructor(opts: uPlot.Options, data: (number | null)[][], el: HTMLElement) {
    this.opts = opts
    this.data = data
    this.el = el
    const t = data[0] as number[]
    const range = opts.scales!.x!.range as (u: unknown, lo: number, hi: number) => [number, number]
    const [min, max] = range(this, t[0]!, t.at(-1)!)
    this.scales = { x: { min, max }, y: { min: 0, max: 2 } }
    this.rangeY()
    FakeUplot.instances.push(this)
    const root = document.createElement('div')
    root.className = 'uplot'
    el.append(root)
    this.plugins('init')
    queueMicrotask(() => this.fire('draw'))
  }

  /** uPlot asks the y scale's range function when it is built and whenever the data are set again. */
  private rangeY() {
    const range = this.opts.scales!.y!.range
    if (typeof range === 'function') range(this as unknown as uPlot, 0, 2, 'y')
  }

  setData(_data: unknown, resetScales?: boolean) {
    this.dataCalls.push(resetScales === true)
    this.rangeY()
  }

  private plugins(name: 'init' | 'destroy') {
    for (const p of this.opts.plugins ?? []) (p.hooks[name] as Hook | undefined)?.(this)
  }

  fire(name: 'draw' | 'setCursor' | 'setScale') {
    for (const h of (this.opts.hooks?.[name] ?? []) as unknown as Hook[]) h(this)
  }

  valToPos(v: number, key: string, canvas = false) {
    const s = key === 'x' ? this.scales.x : this.scales.y
    const f = (v - s.min) / (s.max - s.min)
    const px = key === 'x' ? f * this.over.clientWidth : (1 - f) * this.over.clientHeight
    return canvas ? px + 8 : px
  }

  posToIdx(left: number) {
    const t = this.data[0] as number[]
    const v = this.scales.x.min + (left / this.over.clientWidth) * (this.scales.x.max - this.scales.x.min)
    let best = 0
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i]! - v) < Math.abs(t[best]! - v)) best = i
    return best
  }

  setCursor(o: { left: number; top: number }, fire?: boolean, pub?: boolean) {
    this.cursorCalls.push([o, fire, pub])
    this.cursor.left = o.left
    this.cursor.top = o.top
    this.cursor.idx = o.left < 0 ? null : this.posToIdx(o.left)
    if (fire) this.fire('setCursor')
  }

  /** The pointer moved over this pane (uPlot: a mousemove, which sets the cursor event). */
  pointer(o: { left: number; top: number }) {
    this.cursor.event = { type: o.left < 0 ? 'mouseleave' : 'mousemove' }
    this.setCursor(o, true)
  }

  /** A move on another pane of the group reached this one: uPlot sets no event, and the top is proportional. */
  synced(o: { left: number; top: number }) {
    this.cursor.event = null
    this.setCursor(o, true)
  }

  setScale(key: string, lim: { min: number; max: number }) {
    this.scaleCalls.push([key, lim])
    const range = this.opts.scales!.x!.range as (u: unknown, lo: number, hi: number) => [number, number]
    const [min, max] = range(this, lim.min, lim.max)
    this.scales.x = { min, max }
    this.fire('setScale')
    this.fire('draw')
  }

  setSize() {}

  batch(fn: (u: FakeUplot) => void) {
    fn(this)
  }

  redraw() {
    this.fire('draw')
  }

  destroy() {
    this.destroyed = true
    this.plugins('destroy')
  }
}

const loader = () => Promise.resolve(FakeUplot as unknown as UplotConstructor)

const DAY = 86_400
// Ten weekdays ending 2021-12-31, the last in-sample day.
const T = [
  '2021-12-20', '2021-12-21', '2021-12-22', '2021-12-23', '2021-12-24',
  '2021-12-27', '2021-12-28', '2021-12-29', '2021-12-30', '2021-12-31',
].map((d) => Date.parse(`${d}T00:00:00Z`) / 1000)
const LAST = T.at(-1)!

const PANES: LineStackPane[] = [
  {
    id: 'eq',
    weight: 2,
    logAllowed: true,
    summaryDrawdown: { value: '-1.00%', basis: 'Basis B' },
    series: [
      { name: 'Strategy', style: 'primary', values: [1, 1.01, 1.02, Number.NaN, 1.04, 1.03, 1.05, 1.06, 1.07, 1.08] },
      { name: 'Benchmark', style: 'benchmark', values: [1, 1, 1.01, 1.01, 1.02, 1.02, 1.03, 1.03, 1.04, 1.04] },
    ],
  },
  { id: 'dd', unit: '%', decimals: 1, zero: 'white', series: [{ name: 'Underwater', style: 'underwater', values: [0, 0, 0, null, 0, -1, 0, 0, 0, 0] }] },
]

function renderStack(extra: Partial<LineStackProps> = {}) {
  return render(<LineStack title="Fixture equity" t={T} panes={PANES} loader={loader} {...extra} />)
}

async function ready() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  FakeUplot.instances = []
})
afterEach(cleanup)

describe('LineStack (TASKS 5.1)', () => {
  it('is one role="img" named by a data summary, busy until every pane has drawn', async () => {
    renderStack()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toMatch(/^Strategy: 9 points from 2021-12-20 to 2021-12-31; .*max drawdown -1\.00% \(Basis B\)\. Underwater: 9 points/)
    expect(img.querySelector('[aria-busy="true"]')).not.toBeNull()
    await ready()
    expect(FakeUplot.instances).toHaveLength(2)
    expect(img.querySelector('[aria-busy="true"]')).toBeNull()
    expect(img.querySelector('[data-chart-lib="uplot"]')).not.toBeNull()
  })

  it('passes gaps (NaN) to uPlot as null, one x array shared by the panes', async () => {
    renderStack()
    await ready()
    const [eq, dd] = FakeUplot.instances
    expect(eq!.data[0]).toEqual(T)
    expect(eq!.data[1]![3]).toBeNull()
    expect(dd!.data[1]![3]).toBeNull()
  })

  it('draws the time axis on the bottom pane only and reaches out to the fence', async () => {
    renderStack()
    await ready()
    const [eq, dd] = FakeUplot.instances
    expect(eq!.opts.axes![0]!.show).toBe(false)
    expect(dd!.opts.axes![0]!.show).toBe(true)
    expect(eq!.scales.x).toEqual({ min: T[0], max: FENCE_TIME + (FENCE_TIME - T[0]!) * 0.025 })
    expect(eq!.el.closest('[data-pane]')!.getAttribute('data-fence-x')).not.toBe('')
  })

  // The legend is built empty and gets its values on the first draw, so it grows after the y range was fitted to it.
  describe('the y range follows the legend as it grows', () => {
    const sizeOf = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    afterEach(() => {
      if (sizeOf) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', sizeOf)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth
    })

    it('born failing: takes the range again once, after the first draw filled the legend', async () => {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('chart-legend') ? this.textContent!.length : 0
        },
      })
      renderStack()
      await ready()
      await ready()
      expect(FakeUplot.instances.map((u) => u.dataCalls)).toEqual([[true], [true]])
    })

    it('does not take it again when the legend is the size it was fitted to', async () => {
      renderStack()
      await ready()
      await ready()
      expect(FakeUplot.instances.map((u) => u.dataCalls)).toEqual([[], []])
    })
  })

  it('gives each pane an HTML legend with the series names', async () => {
    renderStack()
    await ready()
    const legends = document.querySelectorAll('.chart-legend')
    expect(legends).toHaveLength(2)
    expect(legends[0]!.textContent).toContain('Strategy (R1)')
    expect(legends[0]!.textContent).toContain('1.08')
    expect(legends[1]!.textContent).toContain('High on')
  })

  it('offers the range buttons 1D to Max with Max pressed, and a range button moves every pane', async () => {
    renderStack()
    await ready()
    const group = screen.getByRole('group', { name: LINE_STACK.rangeGroup })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['1D', '3D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'])
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Max'])
    fireEvent.click(within(group).getByRole('button', { name: '3D' }))
    for (const u of FakeUplot.instances) expect(u.scaleCalls.at(-1)).toEqual(['x', { min: LAST - 3 * DAY, max: FENCE_TIME }])
    expect(within(group).getByRole('button', { name: '3D' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('moves the readout with the arrow keys and publishes the move to the link group', async () => {
    renderStack({ link: 'A' })
    await ready()
    const img = screen.getByRole('img')
    const readout = screen.getByRole('status')
    expect(readout.textContent).toBe(LINE_STACK.readoutIdle)
    fireEvent.keyDown(img, { key: 'ArrowRight' })
    expect(readout.textContent).toBe('2021-12-20: Strategy 1.00, Benchmark 1.00, Underwater 0.0%')
    fireEvent.keyDown(img, { key: 'ArrowRight' })
    expect(readout.textContent).toMatch(/^2021-12-21: /)
    const [, fire, pub] = FakeUplot.instances[0]!.cursorCalls.at(-1)!
    expect([fire, pub]).toEqual([true, true])
    fireEvent.keyDown(img, { key: 'End' })
    expect(readout.textContent).toBe('2021-12-31: Strategy 1.08, Benchmark 1.04, Underwater 0.0%')
    // Right at the last bar is left to the panel, so focus can move on.
    expect(fireEvent.keyDown(img, { key: 'ArrowRight' })).toBe(true)
    fireEvent.keyDown(img, { key: 'Home' })
    expect(readout.textContent).toMatch(/^2021-12-20: /)
  })

  it('holds the readout while an arrow key auto-repeats, then announces where it settled', async () => {
    renderStack()
    await ready()
    const img = screen.getByRole('img')
    const readout = screen.getByRole('status')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.keyDown(img, { key: 'Home' })
      expect(readout.textContent).toMatch(/^2021-12-20: /)
      // A held key: the crosshair moves on each repeat, the live region waits for the train to stop.
      for (let i = 0; i < 3; i += 1) fireEvent.keyDown(img, { key: 'ArrowRight', repeat: true })
      expect(readout.textContent).toMatch(/^2021-12-20: /)
      act(() => vi.advanceTimersByTime(299))
      expect(readout.textContent).toMatch(/^2021-12-20: /)
      act(() => vi.advanceTimersByTime(1))
      expect(readout.textContent).toMatch(/^2021-12-23: /)
    } finally {
      vi.useRealTimers()
    }
  })

  it('zooms with + and - about the crosshair, clearing the pressed range', async () => {
    renderStack()
    await ready()
    const img = screen.getByRole('img')
    fireEvent.keyDown(img, { key: 'End' })
    fireEvent.keyDown(img, { key: '+' })
    const [, lim] = FakeUplot.instances[0]!.scaleCalls.at(-1)!
    expect(lim.max - lim.min).toBeCloseTo((FENCE_TIME - T[0]!) / 2, 6)
    const group = screen.getByRole('group', { name: LINE_STACK.rangeGroup })
    expect(within(group).queryAllByRole('button', { pressed: true })).toHaveLength(0)
    fireEvent.keyDown(img, { key: '-' })
    expect(FakeUplot.instances[0]!.scaleCalls.at(-1)![1]).toEqual({ min: T[0], max: FENCE_TIME })
  })

  it('has a table view with a date column and one column per series', async () => {
    renderStack()
    await ready()
    fireEvent.keyDown(screen.getByRole('img'), { key: 't' })
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Strategy', 'Benchmark', 'Underwater'])
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(table.querySelector('caption')!.textContent).toBe('Fixture equity, every point')
  })

  it('switches the equity pane to a log scale with the Log toggle', async () => {
    renderStack()
    await ready()
    const log = screen.getByRole('button', { name: LINE_STACK.logToggle })
    expect(log.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(log)
    await ready()
    expect(log.getAttribute('aria-pressed')).toBe('true')
    const rebuilt = FakeUplot.instances.slice(2)
    expect(rebuilt.map((u) => u.opts.scales!.y!.distr)).toEqual([3, 1])
    expect(FakeUplot.instances.slice(0, 2).every((u) => u.destroyed)).toBe(true)
  })

  it('disables Log when a log-scale pane has a value at or below zero', async () => {
    const panes: LineStackPane[] = [{ ...PANES[0]!, series: [{ name: 'Total return', style: 'primary', values: T.map((_, i) => i - 2) }] }]
    renderStack({ panes })
    await ready()
    const log = screen.getByRole('button', { name: LINE_STACK.logToggle })
    expect(log.hasAttribute('disabled')).toBe(true)
    expect(log.getAttribute('title')).toBe(LINE_STACK.logUnavailable)
  })

  it('syncs the crosshair by link group: one key for group A, a private key for an unlinked stack', async () => {
    renderStack({ link: 'A' })
    await ready()
    expect(FakeUplot.instances.map((u) => u.opts.cursor!.sync!.key)).toEqual(['nqt-link-A', 'nqt-link-A'])
    cleanup()
    FakeUplot.instances = []
    renderStack({ link: '-' })
    renderStack({ link: '-' })
    await ready()
    const keys = FakeUplot.instances.map((u) => u.opts.cursor!.sync!.key)
    expect(keys[0]).toMatch(/^nqt-stack-/)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('reports the build-to-drawn time once per build, and destroys every pane on unmount', async () => {
    const onRender = vi.fn()
    const { unmount } = renderStack({ onRender })
    await ready()
    expect(onRender).toHaveBeenCalledTimes(1)
    expect(onRender.mock.calls[0]![0]).toBeGreaterThanOrEqual(0)
    unmount()
    expect(FakeUplot.instances.every((u) => u.destroyed)).toBe(true)
  })

  it('says so when uPlot fails to load', async () => {
    render(<LineStack title="x" t={T} panes={PANES} loader={() => Promise.reject(new Error('offline'))} />)
    await ready()
    expect(screen.getByRole('alert').textContent).toBe('The chart failed to load: offline')
  })

  // D33: the toolbar (including the Log toggle) stays rendered in table view, so toggling it, or any
  // other change to the build effect's deps, must not throw just because the pane hosts are unmounted.
  it('D33: does not crash when a build dependency (Log) changes while the table view is open', async () => {
    const { rerender } = render(
      <Boundary>
        <LineStack title="Fixture equity" t={T} panes={PANES} loader={loader} />
      </Boundary>,
    )
    await ready()
    const img = screen.getByRole('img')
    fireEvent.keyDown(img, { key: 't' })
    expect(screen.getByRole('table')).toBeTruthy()
    const log = screen.getByRole('button', { name: LINE_STACK.logToggle })
    fireEvent.click(log)
    await ready()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('table')).toBeTruthy()

    // A refetch (new t/panes, as LIVE gets) while the table view stays open must not throw either.
    const newPanes: LineStackPane[] = PANES.map((p) => ({ ...p, series: p.series.map((s) => ({ ...s })) }))
    rerender(
      <Boundary>
        <LineStack title="Fixture equity" t={[...T]} panes={newPanes} loader={loader} />
      </Boundary>,
    )
    await ready()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('table')).toBeTruthy()
  })

  // D34: after a table-view round trip (T, T), ChartA11y remounts fresh empty `.linestack-pane` divs;
  // the plot effect must rebuild into them (and destroy the old, now-detached uPlot instances).
  it('D34: redraws every pane after a table view round trip (T, T)', async () => {
    renderStack()
    await ready()
    const before = FakeUplot.instances.slice()
    expect(before).toHaveLength(2)
    const img = screen.getByRole('img')
    fireEvent.keyDown(img, { key: 't' })
    const region = screen.getByRole('region', { name: 'Fixture equity, every point' })
    fireEvent.keyDown(region, { key: 't' })
    await ready()
    const panes = document.querySelectorAll('.linestack-pane')
    expect(panes).toHaveLength(2)
    for (const p of panes) expect(p.querySelector('.uplot')).not.toBeNull()
    expect(before.every((u) => u.destroyed)).toBe(true)
    const after = FakeUplot.instances.filter((u) => !before.includes(u))
    expect(after).toHaveLength(2)
    expect(after.every((u) => u.destroyed)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// The context layer (roadmap 12): marked windows, a regime strip and a lanes pane.

const SPANS: StackSpan[] = [
  { from: T[1]!, to: T[3]!, label: 'Stress A' },
  { from: T[6]!, to: T[8]!, label: 'Stress B [SPENT]' },
]
const RIBBON: RibbonSpec = {
  name: 'Regime',
  values: [null, 'low', 'low', 'mid', 'mid', 'mid', 'high', 'high', 'low', 'low'],
  states: { low: { label: 'low volatility', glyph: 'L' }, mid: { label: 'mid volatility', glyph: 'M' }, high: { label: 'high volatility', glyph: 'H' } },
  missing: '--',
}
const LANES: LanesSpec = {
  name: 'Episodes',
  episodes: [
    { rank: 1, peak: T[1]!, trough: T[3]!, end: T[6]!, open: false, depth: '-3.0%' },
    { rank: 2, peak: T[5]!, trough: T[7]!, end: T[9]!, open: true, depth: '-1.0%' },
    { rank: 3, peak: T[2]!, trough: T[4]!, end: T[5]!, open: false, depth: '-0.5%' },
  ],
}
const WITH_LANES: LineStackPane[] = [...PANES, { id: 'lanes', series: [], lanes: LANES }]

function contextStack(extra: Partial<LineStackProps> = {}) {
  return <LineStack title="Fixture equity" t={T} panes={WITH_LANES} spans={SPANS} ribbon={RIBBON} loader={loader} {...extra} />
}

/** The lanes pane's newest plot (a rebuild leaves the earlier, destroyed ones in the list). */
function lanesPlot(): FakeUplot {
  return FakeUplot.instances.filter((u) => u.el.closest('[data-pane]')!.getAttribute('data-pane') === 'lanes').at(-1)!
}

describe('LineStack context layer', () => {
  it('T lists the marked windows, the regime runs and the episodes after the values table', async () => {
    render(contextStack())
    await ready()
    fireEvent.keyDown(screen.getByRole('img'), { key: 't' })
    const tables = screen.getAllByRole('table')
    expect(tables.map((table) => table.querySelector('caption')!.textContent)).toEqual([
      'Fixture equity, every point',
      'Fixture equity, marked windows',
      'Fixture equity, Regime runs',
      'Fixture equity, episodes',
    ])
    const cells = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map((row) => [...row.querySelectorAll('th, td')].map((c) => c.textContent))
    expect(cells(tables[1]!)).toEqual([
      ['Stress A', '2021-12-21', '2021-12-23', 'yes'],
      ['Stress B [SPENT]', '2021-12-28', '2021-12-30', 'yes'],
    ])
    expect(within(tables[2]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['State', 'From', 'To', 'Sessions'])
    expect(cells(tables[2]!)[0]).toEqual(['low volatility', '2021-12-21', '2021-12-22', '2'])
    // Six labels: the sixth is the depth, and the state reads recovered or open.
    expect(within(tables[3]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['#', 'Peak', 'Trough', 'End', 'State', 'Depth'])
    expect(cells(tables[3]!).map((row) => [row[0], row[4], row[5]])).toEqual([['1', 'recovered', '-3.0%'], ['2', 'open', '-1.0%'], ['3', 'recovered', '-0.5%']])
  })

  it('names the window, the regime and the episode at the crosshair, after the values', async () => {
    render(contextStack())
    await ready()
    const img = screen.getByRole('img')
    const readout = screen.getByRole('status')
    fireEvent.keyDown(img, { key: 'Home' })
    // The first session has no regime state: the strip gives the missing text, not a state.
    expect(readout.textContent).toBe('2021-12-20: Strategy 1.00, Benchmark 1.00, Underwater 0.0% | Regime --')
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(img, { key: 'ArrowRight' })
    expect(readout.textContent).toBe(
      '2021-12-23: Strategy --, Benchmark 1.01, Underwater -- | inside Stress A | Regime: mid volatility (M) | episode 1 falling | episode 3 falling',
    )
  })

  it('leaves every label, table and readout as it was without the context props', async () => {
    renderStack()
    await ready()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).not.toMatch(/marked windows|episode lanes/i)
    fireEvent.keyDown(img, { key: 'Home' })
    expect(screen.getByRole('status').textContent).toBe('2021-12-20: Strategy 1.00, Benchmark 1.00, Underwater 0.0%')
    fireEvent.keyDown(img, { key: 't' })
    expect(screen.getAllByRole('table')).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole('region'), { key: 't' })
    await ready()
    const flex = [...document.querySelectorAll<HTMLElement>('.linestack-pane')].map((el) => el.style.flex)
    expect(flex).toEqual(['2 1 0px', '1 1 45px'])
  })

  it('appends the marked windows in view and the episode lanes to the accessible name, following the zoom', async () => {
    render(contextStack())
    await ready()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toMatch(/Marked windows in view: 2\. Episode lanes: 3\.$/)
    // The 3D range starts on 2021-12-28: only the second window reaches it.
    fireEvent.click(within(screen.getByRole('group', { name: LINE_STACK.rangeGroup })).getByRole('button', { name: '3D' }))
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Marked windows in view: 1\. Episode lanes: 3\.$/)
    // Zooming with the keys moves the view too, without a range button.
    fireEvent.click(within(screen.getByRole('group', { name: LINE_STACK.rangeGroup })).getByRole('button', { name: 'Max' }))
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Marked windows in view: 2\./)
  })

  it('says nothing about windows or lanes for a strip alone', async () => {
    render(contextStack({ panes: PANES, spans: undefined }))
    await ready()
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/marked windows|episode lanes/i)
  })

  it('makes room for the strip under the bottom pane only when there is one', async () => {
    const { rerender } = render(contextStack({ ribbon: undefined }))
    await ready()
    const flex = () => [...document.querySelectorAll<HTMLElement>('.linestack-pane')].map((el) => el.style.flex)
    expect(flex()).toEqual(['2 1 0px', '1 1 0px', '1 1 45px'])
    rerender(contextStack())
    await ready()
    // 45px of time axis plus the 6px strip and its 2px gap.
    expect(flex()).toEqual(['2 1 0px', '1 1 0px', '1 1 53px'])
  })

  it('gives a lanes pane no legend, and passes the strip to the bottom pane only', async () => {
    render(contextStack())
    await ready()
    expect(FakeUplot.instances).toHaveLength(3)
    expect(document.querySelectorAll('.chart-legend')).toHaveLength(2)
    expect(FakeUplot.instances.map((u) => u.opts.axes![0]!.size)).toEqual([45, 45, 53])
    // The lanes pane is one uPlot with the times alone: it has no series.
    expect(lanesPlot().data).toHaveLength(1)
    expect(lanesPlot().opts.scales!.y!.auto).toBe(false)
  })

  it('draws the marked windows on every pane and the strip under the bottom one', async () => {
    render(contextStack())
    await ready()
    for (const u of FakeUplot.instances) expect(u.ctx.calls.some((c) => c[0] === 'set:globalAlpha' && c[1] === 0.12)).toBe(true)
    const strip = (u: FakeUplot) => u.ctx.calls.filter((c) => c[0] === 'fillRect' && c[4] === 6).length
    expect(FakeUplot.instances.map(strip)).toEqual([0, 0, 4])
  })

  it('rebuilds the panes for new windows or a new strip, and for nothing that stays the same', async () => {
    const { rerender } = render(contextStack())
    await ready()
    expect(FakeUplot.instances).toHaveLength(3)
    rerender(contextStack())
    await ready()
    expect(FakeUplot.instances).toHaveLength(3)
    const moved = [...SPANS]
    rerender(contextStack({ spans: moved }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(6)
    expect(FakeUplot.instances.slice(0, 3).every((u) => u.destroyed)).toBe(true)
    rerender(contextStack({ spans: moved, ribbon: { ...RIBBON } }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(9)
  })

  it('redraws the lanes pane alone when the highlighted lane changes, and builds no new plot', async () => {
    const { rerender } = render(contextStack({ highlightLane: null }))
    await ready()
    // Each pane has drawn once (one band pass each): mounting is not a change of highlight.
    const passes = (u: FakeUplot) => u.ctx.calls.filter((c) => c[0] === 'set:globalAlpha' && c[1] === 0.12).length
    expect(FakeUplot.instances.map(passes)).toEqual([1, 1, 1])
    const before = FakeUplot.instances.map((u) => u.ctx.calls.length)
    expect(lanesPlot().ctx.calls.some((c) => c[0] === 'strokeRect')).toBe(false)
    rerender(contextStack({ highlightLane: 2 }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(3)
    expect(FakeUplot.instances.some((u) => u.destroyed)).toBe(false)
    const after = FakeUplot.instances.map((u) => u.ctx.calls.length)
    FakeUplot.instances.forEach((u, i) => {
      if (u === lanesPlot()) expect(after[i]!).toBeGreaterThan(before[i]!)
      else expect(after[i], `pane ${i}`).toBe(before[i])
    })
    // The redraw carries the outline of lane 2.
    expect(lanesPlot().ctx.calls.filter((c) => c[0] === 'strokeRect')).toHaveLength(1)
    // New panes with the same highlight draw once each: the highlight did not change.
    rerender(contextStack({ highlightLane: 2, panes: [...WITH_LANES] }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(6)
    expect(FakeUplot.instances.slice(3).map(passes)).toEqual([1, 1, 1])
    rerender(contextStack({ highlightLane: 2 }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(9)
    expect(FakeUplot.instances.slice(6).map(passes)).toEqual([1, 1, 1])
    // The same highlight again draws nothing new; clearing it redraws without the outline.
    rerender(contextStack({ highlightLane: 2 }))
    await ready()
    expect(lanesPlot().ctx.calls.filter((c) => c[0] === 'strokeRect')).toHaveLength(1)
    const drawn = lanesPlot().ctx.calls.length
    rerender(contextStack({ highlightLane: null }))
    await ready()
    expect(lanesPlot().ctx.calls.length).toBeGreaterThan(drawn)
    expect(lanesPlot().ctx.calls.filter((c) => c[0] === 'strokeRect')).toHaveLength(1)
  })

  it('calls onLaneHover with the rank of the lane under the pointer, once per change', async () => {
    const onLaneHover = vi.fn()
    render(contextStack({ onLaneHover }))
    await ready()
    const lanes = lanesPlot()
    // The plot is 200px tall: three rows of about 67px. The second row is rank 2.
    lanes.pointer({ left: 100, top: 100 })
    expect(onLaneHover).toHaveBeenLastCalledWith(2)
    lanes.pointer({ left: 120, top: 110 })
    expect(onLaneHover).toHaveBeenCalledTimes(1)
    lanes.pointer({ left: 120, top: 190 })
    expect(onLaneHover).toHaveBeenLastCalledWith(3)
    lanes.pointer({ left: 120, top: 10 })
    expect(onLaneHover).toHaveBeenLastCalledWith(1)
    // The pointer leaves the pane.
    lanes.pointer({ left: -10, top: -10 })
    expect(onLaneHover).toHaveBeenLastCalledWith(null)
    expect(onLaneHover).toHaveBeenCalledTimes(4)
  })

  it('does not report a lane for a crosshair that only follows a move on another pane', async () => {
    const onLaneHover = vi.fn()
    render(contextStack({ onLaneHover }))
    await ready()
    // A synced cursor keeps the source pane's relative height, so its top can land on any lane.
    lanesPlot().synced({ left: 100, top: 100 })
    expect(onLaneHover).not.toHaveBeenCalled()
    lanesPlot().pointer({ left: 100, top: 100 })
    expect(onLaneHover).toHaveBeenLastCalledWith(2)
    lanesPlot().synced({ left: 100, top: 100 })
    expect(onLaneHover).toHaveBeenLastCalledWith(null)
  })

  it('does not report a lane for a crosshair from another library after the pointer has left', async () => {
    const onLaneHover = vi.fn()
    render(contextStack({ onLaneHover }))
    await ready()
    lanesPlot().pointer({ left: 100, top: 100 })
    expect(onLaneHover).toHaveBeenLastCalledWith(2)
    lanesPlot().pointer({ left: -10, top: -10 })
    expect(onLaneHover).toHaveBeenLastCalledWith(null)
    const calls = onLaneHover.mock.calls.length
    // sync.ts moves a uPlot cursor for a lightweight-charts crosshair: uPlot leaves the stale event
    // (the pointer's mouseleave) in place, so the event's type, not its presence, says who moved it.
    lanesPlot().setCursor({ left: 100, top: 100 }, true)
    expect(onLaneHover).toHaveBeenCalledTimes(calls)
  })

  it('reports no lane when the panes rebuild while one is reported, so an outline cannot stick', async () => {
    const onLaneHover = vi.fn()
    const { rerender } = render(contextStack({ onLaneHover }))
    await ready()
    lanesPlot().pointer({ left: 100, top: 100 })
    expect(onLaneHover).toHaveBeenLastCalledWith(2)
    rerender(contextStack({ onLaneHover, spans: [...SPANS] }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(6)
    expect(onLaneHover.mock.calls).toEqual([[2], [null]])
    // The new panes start with nothing reported: a second rebuild says nothing more.
    rerender(contextStack({ onLaneHover, spans: [...SPANS] }))
    await ready()
    expect(onLaneHover.mock.calls).toEqual([[2], [null]])
  })

  it('reports no lane when the stack unmounts while one is reported', async () => {
    const onLaneHover = vi.fn()
    const { unmount } = render(contextStack({ onLaneHover }))
    await ready()
    lanesPlot().pointer({ left: 100, top: 100 })
    unmount()
    expect(onLaneHover.mock.calls).toEqual([[2], [null]])
  })

  it('says nothing about lanes on mount, on a rebuild or under StrictMode while none is reported', async () => {
    const onLaneHover = vi.fn()
    const { rerender } = render(<StrictMode>{contextStack({ onLaneHover })}</StrictMode>)
    await ready()
    rerender(<StrictMode>{contextStack({ onLaneHover, spans: [...SPANS] })}</StrictMode>)
    await ready()
    expect(onLaneHover).not.toHaveBeenCalled()
  })

  it('reads the latest onLaneHover and highlight without rebuilding for a new function', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(contextStack({ onLaneHover: first }))
    await ready()
    rerender(contextStack({ onLaneHover: second }))
    await ready()
    expect(FakeUplot.instances).toHaveLength(3)
    lanesPlot().pointer({ left: 100, top: 10 })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(1)
  })

  it('survives the table view round trip with the context layer on', async () => {
    render(contextStack())
    await ready()
    fireEvent.keyDown(screen.getByRole('img'), { key: 't' })
    fireEvent.keyDown(screen.getByRole('region', { name: 'Fixture equity, every point' }), { key: 't' })
    await ready()
    expect(FakeUplot.instances).toHaveLength(6)
    expect(FakeUplot.instances.slice(3).every((u) => !u.destroyed)).toBe(true)
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Marked windows in view: 2\. Episode lanes: 3\.$/)
  })
})

// Roadmap D9: canvas charts cannot be restyled by CSS, so the stack rebuilds its panes with system colours
// when a Windows contrast theme turns on (forced colours), with a dash on every line but the lead.
describe('LineStack under a contrast change', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => {
    uninstall?.()
    uninstall = null
  })

  it('rebuilds every pane in system colours, the benchmark dashed and the legend drawing the dash', async () => {
    const media = fakeMedia()
    uninstall = media.install()
    renderStack()
    await ready()
    expect(FakeUplot.instances).toHaveLength(2)
    const before = FakeUplot.instances[0]!.opts.series
    expect(before[2]).toMatchObject({ stroke: DEFAULT_CHART_TOKENS.color.accent2 })
    expect(before[2]).not.toHaveProperty('dash')
    expect(document.querySelector('.chart-legend-swatch-line')).toBeNull()

    act(() => media.set(FORCED_COLOURS_QUERY, true))
    await ready()
    expect(FakeUplot.instances).toHaveLength(4)
    expect(FakeUplot.instances.slice(0, 2).every((u) => u.destroyed)).toBe(true)
    const eq = FakeUplot.instances[2]!.opts
    // Draw order: the strategy's area, the benchmark, then the strategy's line on top.
    expect(eq.series[2]).toMatchObject({ label: 'Benchmark', stroke: readSystemColours().highlight, dash: [10, 4] })
    expect(eq.series[3]).toMatchObject({ label: 'Strategy', stroke: readSystemColours().canvasText })
    expect(eq.series[3]).not.toHaveProperty('dash')
    const lines = [...document.querySelectorAll('.chart-legend-swatch-line line')]
    expect(lines.map((l) => [l.getAttribute('stroke'), l.getAttribute('stroke-dasharray')])).toEqual([
      [readSystemColours().canvasText, null],
      [readSystemColours().highlight, '5 2'],
      [readSystemColours().canvasText, null],
    ])
  })

  it('leaves the default build alone while no contrast query matches', async () => {
    uninstall = fakeMedia().install()
    renderStack()
    await ready()
    expect(FakeUplot.instances).toHaveLength(2)
    const swatches = [...document.querySelectorAll<HTMLElement>('.chart-legend-swatch')].filter((s) => !s.classList.contains('linestack-legend-blank'))
    expect(swatches.map((s) => s.style.backgroundColor)).toEqual(['rgb(255, 255, 255)', 'rgb(240, 96, 0)', 'rgb(255, 255, 255)'])
  })
})
