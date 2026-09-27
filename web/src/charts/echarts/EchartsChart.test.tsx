// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  const lib = { init: vi.fn(() => chart), graphic: {} }
  const state: { load: () => Promise<unknown> } = { load: () => Promise.resolve(lib) }
  return { chart, lib, state }
})

vi.mock('../lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lazy')>()
  return { ...actual, loadEcharts: () => fake.state.load() }
})

import { DRAW_MEASURE_PREFIX, EchartsChart } from './EchartsChart'

beforeEach(() => {
  fake.state.load = () => Promise.resolve(fake.lib)
  fake.lib.init.mockClear()
  fake.chart.setOption.mockClear()
  fake.chart.dispose.mockClear()
  performance.clearMeasures()
})
afterEach(cleanup)

const OPTION = { series: [] }

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('EchartsChart (the shared ECharts host)', () => {
  it('is busy until the library has loaded and the option is drawn', async () => {
    let resolve: (v: unknown) => void = () => undefined
    fake.state.load = () => new Promise((r) => {
      resolve = r
    })
    render(<EchartsChart option={OPTION} chartId="t1" />)
    const host = document.querySelector('[data-chart-lib="echarts"]')!
    expect(host.getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      resolve(fake.lib)
      await Promise.resolve()
    })
    expect(fake.lib.init).toHaveBeenCalledWith(host, null, { renderer: 'canvas' })
    expect(fake.chart.setOption).toHaveBeenCalledWith(OPTION, { notMerge: true })
    expect(host.getAttribute('aria-busy')).toBe('false')
  })

  it('records the draw time as a performance measure', async () => {
    render(<EchartsChart option={OPTION} chartId="t2" />)
    await settle()
    expect(performance.getEntriesByName(`${DRAW_MEASURE_PREFIX}t2`, 'measure')).toHaveLength(1)
  })

  it('redraws when the option changes, and disposes of the chart on unmount', async () => {
    const view = render(<EchartsChart option={OPTION} chartId="t3" />)
    await settle()
    const next = { series: [{ type: 'bar' as const }] }
    view.rerender(<EchartsChart option={next} chartId="t3" />)
    expect(fake.chart.setOption).toHaveBeenLastCalledWith(next, { notMerge: true })
    expect(fake.lib.init).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(fake.chart.dispose).toHaveBeenCalledTimes(1)
  })

  it('shows the error when the library fails to load', async () => {
    const failed = Promise.reject(new Error('chunk failed'))
    failed.catch(() => undefined)
    fake.state.load = () => failed
    render(<EchartsChart option={OPTION} chartId="t4" />)
    await settle()
    expect(screen.getByRole('alert').textContent).toBe('The chart could not be drawn: chunk failed')
  })
})
