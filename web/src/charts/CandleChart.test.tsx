// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FAKE_DAY, FAKE_T0, fakeBars, fakeLib } from './CandleChart.fake'

const state = vi.hoisted(() => ({ fake: null as ReturnType<typeof import('./CandleChart.fake').fakeLib> | null }))

vi.mock('./lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lazy')>()
  return { ...actual, loadLwc: () => Promise.resolve(state.fake!.lib) }
})

const { default: CandleChart } = await import('./CandleChart')

beforeEach(() => {
  state.fake = fakeLib()
})
afterEach(cleanup)

/** The pointer entering the chart (the engine passes move events on only then). */
const enter = () => document.querySelector('.candle-host')!.dispatchEvent(new Event('pointerenter'))

const BARS = fakeBars(30)
const FILLS = [{ t: FAKE_T0 + 27 * FAKE_DAY + 3600, side: 'sell' as const, qty: 2, price: 127.25 }]
const ROLLS = [{ t: FAKE_T0 + 10 * FAKE_DAY, gapPts: 12.5, gapPct: 0.1 }]
const RV = { name: 'RV22', values: BARS.t.map((_, i) => 10 + i / 10), unit: '%' }

async function renderChart() {
  const onRendered = vi.fn()
  render(<CandleChart name="NQ1 Index" bars={BARS} fills={FILLS} rolls={ROLLS} indicator={RV} link="A" timeZone="UTC" onRendered={onRendered} />)
  const figure = await screen.findByRole('img')
  await waitFor(() => expect(document.querySelector('[aria-busy="false"]')).not.toBeNull())
  return { figure, onRendered, readout: () => screen.getByRole('status').textContent ?? '' }
}

describe('CandleChart', () => {
  it('is busy while the library loads, then draws and reports its render time', async () => {
    const { onRendered } = await renderChart()
    expect(state.fake!.chart.options).not.toBeNull()
    expect(onRendered).toHaveBeenCalledWith(expect.any(Number))
  })

  it('names the chart with a data summary (role img)', async () => {
    const { figure } = await renderChart()
    expect(figure.getAttribute('aria-label')).toBe(
      'NQ1 Index: 30 daily bars from 2021-12-01 to 2021-12-30; last close 129.00; low 99.00 on 2021-12-01, high 130.00 on 2021-12-30. 1 fill and 1 roll marked. The 2022-01-01 fence follows the last bar.',
    )
  })

  it('reads out T O H L C V for the last bar before any move', async () => {
    const { readout } = await renderChart()
    expect(readout()).toMatch(/^T 2021-12-30O 128\.50H 130\.00L 128\.00C 129\.00V 1,290RV22 12\.9%/)
  })

  it('says how many bars are shown as soon as the chart has drawn (stable screenshots)', async () => {
    const { readout } = await renderChart()
    expect(readout()).toContain('30 of 30 bars shown')
  })

  it('steps the readout with Left and Right and handles the key', async () => {
    const { figure, readout } = await renderChart()
    expect(fireEvent.keyDown(figure, { key: 'ArrowLeft' })).toBe(false)
    expect(readout()).toMatch(/^T 2021-12-30/)
    fireEvent.keyDown(figure, { key: 'ArrowLeft' })
    expect(readout()).toMatch(/^T 2021-12-29/)
    fireEvent.keyDown(figure, { key: 'ArrowRight' })
    expect(readout()).toMatch(/^T 2021-12-30/)
  })

  it('holds the readout while an arrow key auto-repeats, then announces the bar it settled on', async () => {
    const { figure, readout } = await renderChart()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.keyDown(figure, { key: 'ArrowLeft' })
      fireEvent.keyDown(figure, { key: 'ArrowLeft' })
      expect(readout()).toMatch(/^T 2021-12-29/)
      // A held key: the crosshair moves on each repeat, the live region waits for the train to stop.
      for (let i = 0; i < 5; i += 1) fireEvent.keyDown(figure, { key: 'ArrowLeft', repeat: true })
      expect(readout()).toMatch(/^T 2021-12-29/)
      act(() => vi.advanceTimersByTime(299))
      expect(readout()).toMatch(/^T 2021-12-29/)
      act(() => vi.advanceTimersByTime(1))
      expect(readout()).toMatch(/^T 2021-12-24/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists the fills and rolls of the bar in the readout', async () => {
    const { figure, readout } = await renderChart()
    fireEvent.keyDown(figure, { key: 'Home' })
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(figure, { key: 'ArrowRight' })
    expect(readout()).toContain('Roll, gap +12.50 pts (+0.10%)')
    fireEvent.keyDown(figure, { key: 'End' })
    fireEvent.keyDown(figure, { key: 'ArrowLeft' })
    fireEvent.keyDown(figure, { key: 'ArrowLeft' })
    expect(readout()).toContain('Fill: sell 2 at 127.25')
  })

  it('zooms with + and - and says how many bars are shown', async () => {
    const { figure, readout } = await renderChart()
    const scale = state.fake!.chart.timeScale()
    act(() => scale.setVisibleLogicalRange({ from: 0, to: 29 }))
    fireEvent.keyDown(figure, { key: '+' })
    const zoomed = state.fake!.range()!
    expect(zoomed.to - zoomed.from).toBeCloseTo(29 * 0.8, 9)
    await waitFor(() => expect(readout()).toContain('24 of 30 bars shown'))
    fireEvent.keyDown(figure, { key: '-' })
    const back = state.fake!.range()!
    expect(back.to - back.from).toBeCloseTo(29, 9)
  })

  it('leaves keys with a modifier, and keys it does not use, to the page', async () => {
    const { figure } = await renderChart()
    expect(fireEvent.keyDown(figure, { key: 'ArrowLeft', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(figure, { key: 'q' })).toBe(true)
  })

  it('shows the price, volume and indicator legends, the price one tracking the pointer', async () => {
    await renderChart()
    expect(screen.getByText('NQ1 Index - Last price').nextSibling?.textContent).toBe('129.00')
    expect(screen.getByText('High on 2021-12-30').nextSibling?.textContent).toBe('130.00')
    expect(screen.getByText('Average').nextSibling?.textContent).toBe('114.5000')
    expect(screen.getByText('Low on 2021-12-01').nextSibling?.textContent).toBe('99.00')
    expect(screen.getByText('NQ1 Index - Volume').nextSibling?.textContent).toBe('1,290')
    const legend = (text: string) => [...document.querySelectorAll('.chart-legend span')].find((s) => s.textContent === text)
    expect(legend('RV22')?.nextSibling?.textContent).toBe('12.9%')
    act(() => {
      enter()
      for (const h of state.fake!.moveHandlers) h({ time: FAKE_T0 + 3 * FAKE_DAY, point: { x: 40, y: 50 } })
    })
    expect(screen.getByText('NQ1 Index - Last price').nextSibling?.textContent).toBe('103.00')
  })

  it('shows a data tip after the pointer rests on a fill, and hides it at once when it moves on', async () => {
    await renderChart()
    act(() => {
      enter()
      for (const h of state.fake!.moveHandlers) h({ time: FAKE_T0 + 27 * FAKE_DAY, point: { x: 40, y: 50 } })
    })
    expect(document.querySelector('.chart-datatip')).toBeNull()
    await waitFor(() => expect(document.querySelector('.chart-datatip')?.textContent).toBe('Fill: sell 2 at 127.25'))
    act(() => {
      for (const h of state.fake!.moveHandlers) h({ time: FAKE_T0 + 3 * FAKE_DAY, point: { x: 40, y: 50 } })
    })
    expect(document.querySelector('.chart-datatip')).toBeNull()
  })

  it('gives every bar in the table view (T)', async () => {
    const { figure } = await renderChart()
    fireEvent.keyDown(figure, { key: 't' })
    const region = screen.getByRole('region', { name: 'NQ1 Index bars' })
    expect(within(region).getAllByRole('row')).toHaveLength(31)
  })

  it('redraws the chart when the table view closes again, removing the old one', async () => {
    const { figure } = await renderChart()
    const first = state.fake!.chart
    const created = vi.spyOn(state.fake!.lib, 'createChart')
    fireEvent.keyDown(figure, { key: 't' })
    expect(first.removed).toBe(true)
    fireEvent.keyDown(screen.getByRole('region', { name: 'NQ1 Index bars' }), { key: 't' })
    await waitFor(() => expect(created).toHaveBeenCalledTimes(1))
    expect(document.querySelector('.candle-host')).not.toBeNull()
  })

  it('draws the second axis row, its month label giving way to the roll tag that would cover it', async () => {
    await renderChart()
    const labels = [...document.querySelectorAll('.candle-strip .candle-strip-label')]
    expect(labels).toHaveLength(1)
    expect(labels[0]!.textContent).toBe('')
    expect(document.querySelector('.candle-strip')?.textContent).toBe('2021-12-11')
  })

  it('draws the 5px 1-3-1 splitter over each pane boundary', async () => {
    await renderChart()
    // The fake's panes are 300, 100 and 80px tall with the library's 1px separator after each.
    const splitters = [...document.querySelectorAll<HTMLElement>('.candle-plot .chart-splitter')]
    expect(splitters.map((s) => s.style.top)).toEqual(['298px', '399px'])
    expect(splitters.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('tags each roll date in the second axis row', async () => {
    await renderChart()
    const tags = [...document.querySelectorAll('.candle-strip .candle-roll-tag')].map((t) => t.textContent)
    expect(tags).toEqual(['2021-12-11'])
  })

  it('removes the chart on unmount', async () => {
    await renderChart()
    cleanup()
    expect(state.fake!.chart.removed).toBe(true)
  })
})
