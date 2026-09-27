// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type uPlot from 'uplot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINE_STACK } from '../copy/lineStack'
import { FENCE_TIME } from './fence'
import type { UplotConstructor } from './lazy'
import LineStack from './LineStack'
import { recordingContext } from './LineStack.testUtil'
import type { LineStackPane, LineStackProps } from './LineStack.types'

type Hook = (u: FakeUplot) => void

/** Enough of uPlot for the component: options, scales, cursor, hooks and the calls made on it. */
class FakeUplot {
  static instances: FakeUplot[] = []
  readonly cursor = { idx: null as number | null, left: -10, top: -10 }
  readonly scales: { x: { min: number; max: number }; y: { min: number; max: number } }
  readonly over = { clientWidth: 600, clientHeight: 200 }
  readonly bbox = { left: 8, top: 8, width: 600, height: 200 }
  readonly ctx = recordingContext(700, 260)
  readonly width = 700
  readonly cursorCalls: [{ left: number; top: number }, boolean | undefined, boolean | undefined][] = []
  readonly scaleCalls: [string, { min: number; max: number }][] = []
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
    FakeUplot.instances.push(this)
    const root = document.createElement('div')
    root.className = 'uplot'
    el.append(root)
    this.plugins('init')
    queueMicrotask(() => this.fire('draw'))
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
})
