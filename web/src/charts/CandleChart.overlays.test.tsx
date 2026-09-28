// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Legends, type LegendsProps } from './CandleChart.overlays'

afterEach(cleanup)

const BARS = { t: [1, 2, 3], o: [10, 11, 12], h: [11, 12, 13], l: [9, 10, 11], c: [11, 12, 12.5], v: [100, 200, 300] }
const PROPS: LegendsProps = {
  name: 'NQ1 Index',
  bars: BARS,
  index: 2,
  stats: { high: 13, highIndex: 2, low: 9, lowIndex: 0, average: 11.8 },
  precision: 2,
  intraday: false,
  timeZone: 'America/New_York',
  paneTops: [0, 300],
}

const names = (root: HTMLElement) => [...root.querySelectorAll('.candle-legend-name')].map((n) => n.textContent)

describe('CandleChart legends (look spec 6.1)', () => {
  it('shows Last price, High on, Average and Low on in a price pane with room for them', () => {
    const { container } = render(<Legends {...PROPS} />)
    expect(names(container).slice(0, 4)).toEqual([
      'NQ1 Index - Last price', expect.stringMatching(/^High on /), 'Average', expect.stringMatching(/^Low on /),
    ])
  })

  it('prints the Average at the series precision, like the prices around it', () => {
    const { container } = render(<Legends {...PROPS} stats={{ ...PROPS.stats!, average: 14411.9895 }} />)
    const values = [...container.querySelectorAll('.chart-legend-value')].map((n) => n.textContent)
    expect(values).toContain('14411.99')
    expect(values).not.toContain('14411.9895')
  })

  it('born failing: keeps only the Last price row in a short price pane, so the legend never runs over the volume pane', () => {
    const { container } = render(<Legends {...PROPS} paneTops={[0, 60]} />)
    expect(names(container)).toEqual(['NQ1 Index - Last price', 'NQ1 Index - Volume'])
  })

  it('insets the legend of the pane under the price pane clear of the attribution logo', () => {
    const { container } = render(<Legends {...PROPS} />)
    const legends = container.querySelectorAll<HTMLElement>('.chart-legend')
    expect(legends[1]!.classList.contains('candle-legend-clear-logo')).toBe(true)
    expect(legends[0]!.classList.contains('candle-legend-clear-logo')).toBe(false)
  })

  // U29: the attribution logo sits in the terminal's lowest pane, which is RV22 (the indicator pane)
  // whenever an indicator is drawn, not the volume pane above it; Legends always insets the volume
  // legend and never RV22's, so with an indicator drawn the clear-logo inset was on the wrong pane.
  it('insets the indicator legend (RV22, the lowest pane) clear of the logo when an indicator is drawn, not the volume legend above it', () => {
    const { container } = render(
      <Legends {...PROPS} paneTops={[0, 200, 300]} indicator={{ name: 'SMA 20', values: [null, null, 14400] }} />,
    )
    const legends = container.querySelectorAll<HTMLElement>('.chart-legend')
    expect(legends).toHaveLength(3)
    expect(legends[1]!.classList.contains('candle-legend-clear-logo')).toBe(false)
    expect(legends[2]!.classList.contains('candle-legend-clear-logo')).toBe(true)
  })

  it('keeps the volume legend clear of the logo when there is no indicator pane beneath it', () => {
    const { container } = render(<Legends {...PROPS} indicator={{ name: 'SMA 20', values: [null, null, 14400] }} />)
    const legends = container.querySelectorAll<HTMLElement>('.chart-legend')
    expect(legends).toHaveLength(2)
    expect(legends[1]!.classList.contains('candle-legend-clear-logo')).toBe(true)
  })
})
