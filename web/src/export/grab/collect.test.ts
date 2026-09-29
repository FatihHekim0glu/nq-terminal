// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import ChartA11y, { type ChartTable } from '../../charts/ChartA11y'
import { CHART } from '../../copy/panelParts'
import { collectFigures } from './collect'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

/** jsdom lays nothing out, so a test says where an element sits. */
function place(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
}

function canvas(pixels: { width: number; height: number } = { width: 800, height: 600 }): HTMLCanvasElement {
  const el = document.createElement('canvas')
  el.width = pixels.width
  el.height = pixels.height
  return el
}

function figure(label: string, ...children: Element[]): HTMLElement {
  const el = document.createElement('div')
  el.className = 'chart-a11y-figure'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', label)
  el.append(...children)
  return el
}

function panelOf(...children: Element[]): HTMLElement {
  const panel = document.createElement('section')
  panel.setAttribute('data-nqt-panel', 'p1')
  panel.append(...children)
  document.body.append(panel)
  return panel
}

describe('collectFigures', () => {
  it('collects a figure with its summary, size and canvas layers in document order, offset from the figure', () => {
    const base = canvas()
    const overlay = canvas({ width: 400, height: 300 })
    const fig = figure('Equity: 3 points', base, overlay)
    place(fig, 100, 50, 400, 300)
    place(base, 100, 50, 400, 300)
    place(overlay, 110, 60, 380, 280)
    const { figures, skipped } = collectFigures(panelOf(fig))
    expect(skipped).toBe(0)
    expect(figures).toHaveLength(1)
    const [first] = figures
    expect(first).toMatchObject({ summary: 'Equity: 3 points', width: 400, height: 300 })
    expect(first?.layers).toEqual([
      { source: base, x: 0, y: 0, width: 400, height: 300 },
      { source: overlay, x: 10, y: 10, width: 380, height: 280 },
    ])
    expect(first?.layers[0]?.source).toBe(base)
  })

  it('keeps the figures in document order, whatever their position on screen', () => {
    const lower = canvas()
    const upper = canvas()
    const a = figure('first in the page', lower)
    const b = figure('second in the page', upper)
    place(a, 0, 400, 300, 200)
    place(lower, 0, 400, 300, 200)
    place(b, 0, 0, 300, 200)
    place(upper, 0, 0, 300, 200)
    const { figures } = collectFigures(panelOf(a, b))
    expect(figures.map((f) => f.summary)).toEqual(['first in the page', 'second in the page'])
  })

  it('finds a figure nested inside the panel body, not only a direct child', () => {
    const c = canvas()
    const fig = figure('nested', c)
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    const wrap = document.createElement('div')
    wrap.append(fig)
    expect(collectFigures(panelOf(wrap)).figures).toHaveLength(1)
  })

  it('leaves out a hidden figure without counting it as skipped', () => {
    const shown = canvas()
    const hiddenCanvas = canvas()
    const a = figure('shown', shown)
    const b = figure('hidden by layout', hiddenCanvas)
    place(a, 0, 0, 300, 200)
    place(shown, 0, 0, 300, 200)
    // b has no size: display none, or a tab that is not on screen
    place(hiddenCanvas, 0, 0, 300, 200)
    const { figures, skipped } = collectFigures(panelOf(a, b))
    expect(figures.map((f) => f.summary)).toEqual(['shown'])
    expect(skipped).toBe(0)
  })

  it('leaves out a figure that is hidden by visibility, even when it has a size', () => {
    const c = canvas()
    const fig = figure('invisible', c)
    fig.style.visibility = 'hidden'
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    expect(collectFigures(panelOf(fig)).figures).toEqual([])
  })

  it('counts a figure drawn with svg and no canvas as skipped', () => {
    const fig = figure('svg only', document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    place(fig, 0, 0, 300, 200)
    const { figures, skipped } = collectFigures(panelOf(fig))
    expect(figures).toEqual([])
    expect(skipped).toBe(1)
  })

  it('keeps a figure that has a canvas and an svg overlay, and does not count it as skipped', () => {
    const c = canvas()
    const fig = figure('mixed', c, document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    const { figures, skipped } = collectFigures(panelOf(fig))
    expect(figures).toHaveLength(1)
    expect(skipped).toBe(0)
  })

  it('does not count an empty figure as skipped: there is nothing in it to leave out', () => {
    const fig = figure('still loading')
    place(fig, 0, 0, 300, 200)
    const { figures, skipped } = collectFigures(panelOf(fig))
    expect(figures).toEqual([])
    expect(skipped).toBe(0)
  })

  it('ignores canvases with no size on screen or no pixels', () => {
    const good = canvas()
    const flat = canvas()
    const empty = canvas({ width: 0, height: 0 })
    const fig = figure('two of three', flat, good, empty)
    place(fig, 0, 0, 300, 200)
    place(flat, 0, 0, 0, 0)
    place(good, 0, 0, 300, 200)
    place(empty, 0, 0, 300, 200)
    const { figures } = collectFigures(panelOf(fig))
    expect(figures[0]?.layers.map((l) => l.source)).toEqual([good])
  })

  it('treats a figure whose canvases are all unusable, with no svg, as empty', () => {
    const empty = canvas({ width: 0, height: 0 })
    const fig = figure('blank', empty)
    place(fig, 0, 0, 300, 200)
    place(empty, 0, 0, 300, 200)
    const { figures, skipped } = collectFigures(panelOf(fig))
    expect(figures).toEqual([])
    expect(skipped).toBe(0)
  })

  it('ignores canvases that sit outside a chart figure', () => {
    const stray = canvas()
    place(stray, 0, 0, 300, 200)
    const c = canvas()
    const fig = figure('the chart', c)
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    const { figures } = collectFigures(panelOf(stray, fig))
    expect(figures).toHaveLength(1)
    expect(figures[0]?.layers.map((l) => l.source)).toEqual([c])
  })

  it('ignores an element with the figure class that is not an image role', () => {
    const c = canvas()
    const fig = figure('not an image', c)
    fig.removeAttribute('role')
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    expect(collectFigures(panelOf(fig)).figures).toEqual([])
  })

  it('finds nothing in a panel without charts, and reads nothing outside the panel it was given', () => {
    const c = canvas()
    const fig = figure('elsewhere', c)
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    document.body.append(fig)
    expect(collectFigures(panelOf(document.createElement('p')))).toEqual({ figures: [], skipped: 0 })
  })

  it('gives an empty summary for a figure without a label rather than the word null', () => {
    const c = canvas()
    const fig = figure('x', c)
    fig.removeAttribute('aria-label')
    place(fig, 0, 0, 300, 200)
    place(c, 0, 0, 300, 200)
    expect(collectFigures(panelOf(fig)).figures[0]?.summary).toBe('')
  })
})

describe('collectFigures over the real chart wrapper', () => {
  const TABLE: ChartTable = {
    caption: 'Equity',
    columns: [{ key: 'date', label: 'Date' }],
    rows: [{ date: '2019-01-02' }],
  }

  it('finds the figure ChartA11y draws, and nothing once the table view is on', () => {
    const { container, getByRole } = render(
      createElement(ChartA11y, {
        label: 'Equity: 1 point',
        table: TABLE,
        children: createElement('canvas', { width: 200, height: 100 }),
      }),
    )
    const fig = container.querySelector('.chart-a11y-figure') as HTMLElement
    const c = fig.querySelector('canvas') as HTMLCanvasElement
    place(fig, 5, 5, 200, 100)
    place(c, 5, 5, 200, 100)
    expect(collectFigures(container).figures.map((f) => f.summary)).toEqual(['Equity: 1 point'])
    fireEvent.click(getByRole('button', { name: CHART.tableToggle }))
    expect(collectFigures(container)).toEqual({ figures: [], skipped: 0 })
  })
})
