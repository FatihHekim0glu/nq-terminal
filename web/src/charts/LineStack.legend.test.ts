// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createLegend } from './LineStack.legend'

afterEach(() => {
  document.body.innerHTML = ''
})

function host(): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

const cells = (el: Element) => [...el.children].map((c) => c.textContent)

describe('HTML legend overlay (look spec 6.1)', () => {
  it('shows a swatch, the name with its axis tag and the value for each series', () => {
    const h = host()
    const legend = createLegend(h, [{ name: 'Strategy', colour: '#FFFFFF' }, { name: 'Benchmark', colour: '#F06000' }], false)
    const box = h.querySelector('.chart-legend')!
    expect(box).toBe(legend.element)
    // The canvas figure is role="img"; the legend repeats what the summary and table give.
    expect(box.getAttribute('aria-hidden')).toBe('true')
    legend.update(['1.23', '0.98'], null)
    expect(cells(box)).toEqual(['', 'Strategy (R1)', '1.23', '', 'Benchmark (R1)', '0.98'])
    const swatches = box.querySelectorAll<HTMLElement>('.chart-legend-swatch')
    expect([...swatches].map((s) => s.style.backgroundColor)).toEqual(['rgb(255, 255, 255)', 'rgb(240, 96, 0)'])
    expect(box.querySelectorAll('.chart-legend-value')).toHaveLength(2)
  })

  it('adds High on, Average and Low on rows for a single series, tracking what it is given', () => {
    const h = host()
    const legend = createLegend(h, [{ name: 'Underwater', colour: '#FFFFFF' }], true)
    legend.update(['-3.2%'], { high: { date: '2019-01-03', value: '0.0%' }, average: '-4.1%', low: { date: '2020-03-23', value: '-18.0%' } })
    expect(cells(legend.element)).toEqual([
      '', 'Underwater (R1)', '-3.2%',
      '', 'High on 2019-01-03', '0.0%',
      '', 'Average', '-4.1%',
      '', 'Low on 2020-03-23', '-18.0%',
    ])
    legend.update(['--'], null)
    expect(cells(legend.element).slice(3)).toEqual(['', '', '', '', '', '', '', '', ''])
  })

  it('writes the same text only once and removes itself on destroy', () => {
    const h = host()
    const legend = createLegend(h, [{ name: 'Strategy', colour: '#FFFFFF' }], false)
    legend.update(['1.00'], null)
    const value = legend.element.querySelector('.chart-legend-value')!
    const node = value.firstChild
    legend.update(['1.00'], null)
    expect(value.firstChild).toBe(node)
    legend.destroy()
    expect(h.querySelector('.chart-legend')).toBeNull()
  })
})
