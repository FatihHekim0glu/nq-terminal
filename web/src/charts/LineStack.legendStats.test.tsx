// @vitest-environment jsdom
// LineStackPane.legendStats: a single-series pane's legend adds High on, Average and Low on rows, which
// are statistics the terminal computes from the plotted values. A view that shows served values only
// (REG 95) Compare) turns them off. The default keeps them.
import { act, cleanup, render } from '@testing-library/react'
import type uPlot from 'uplot'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UplotConstructor } from './lazy'
import LineStack from './LineStack'
import { recordingContext } from './LineStack.testUtil'
import type { LineStackPane } from './LineStack.types'

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

  setCursor(o: { left: number; top: number }, fire?: boolean) {
    this.cursor.left = o.left
    this.cursor.top = o.top
    this.cursor.idx = o.left < 0 ? null : this.posToIdx(o.left)
    if (fire) this.fire('setCursor')
  }

  setScale(_key: string, lim: { min: number; max: number }) {
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

const T = [
  '2021-12-20', '2021-12-21', '2021-12-22', '2021-12-23', '2021-12-24',
  '2021-12-27', '2021-12-28', '2021-12-29', '2021-12-30', '2021-12-31',
].map((d) => Date.parse(`${d}T00:00:00Z`) / 1000)

const VALUES = [1, 1.01, 1.02, 1.03, 1.04, 1.03, 1.05, 1.06, 1.07, 1.08]
const single = (extra: Partial<LineStackPane> = {}): LineStackPane[] => [
  { id: 'one', series: [{ name: 'Only (1 tick)', style: 'compare1', values: VALUES }], ...extra },
]

async function legendOf(panes: LineStackPane[]): Promise<HTMLElement> {
  render(<LineStack title="Fixture" t={T} panes={panes} loader={loader} />)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  const legend = document.querySelector<HTMLElement>('.chart-legend')
  expect(legend).not.toBeNull()
  return legend!
}

beforeEach(() => {
  FakeUplot.instances = []
})
afterEach(cleanup)

describe('LineStackPane.legendStats', () => {
  it('leaves out High on, Average and Low on on a single-series pane when it is false', async () => {
    const legend = await legendOf(single({ legendStats: false }))
    expect(legend.textContent).toContain('Only (1 tick)')
    expect(legend.textContent).toContain('1.08')
    expect(legend.textContent).not.toContain('High on')
    expect(legend.textContent).not.toContain('Average')
    expect(legend.textContent).not.toContain('Low on')
    expect(legend.querySelectorAll('.linestack-legend-stat')).toHaveLength(0)
  })

  it('keeps them by default, so EQ, DD and the other single-series panes are unchanged', async () => {
    const legend = await legendOf(single())
    expect(legend.textContent).toContain('High on')
    expect(legend.textContent).toContain('Average')
    expect(legend.textContent).toContain('Low on')
  })

  it('keeps them when it is explicitly true', async () => {
    const legend = await legendOf(single({ legendStats: true }))
    expect(legend.textContent).toContain('High on')
  })
})
