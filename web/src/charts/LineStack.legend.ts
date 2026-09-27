// The HTML legend overlay of one LineStack pane (look spec 6.1): top-left on --legend-bg, a 13px
// colour square, the name with its axis tag, the value right-aligned. A single-series pane adds
// High on <date>, Average and Low on <date>. Values track the crosshair, so the legend is plain DOM
// updated from uPlot's hooks: pointer moves never re-render React. It repeats what the chart's
// summary and table view give, so it is hidden from assistive technology (the figure is role="img").
import { LINE_STACK } from '../copy/lineStack'
import { fillCopy } from '../copy/workspace'

export interface LegendSeries {
  readonly name: string
  readonly colour: string
}

export interface LegendDated {
  readonly date: string
  readonly value: string
}

export interface LegendStats {
  readonly high: LegendDated
  readonly average: string
  readonly low: LegendDated
}

export interface LegendHandle {
  readonly element: HTMLElement
  /** One value per series, and the single-series stats (null blanks them). */
  update(values: readonly string[], stats: LegendStats | null): void
  destroy(): void
}

function cell(parent: HTMLElement, className: string, text = ''): HTMLElement {
  const el = document.createElement('span')
  el.className = className
  el.textContent = text
  parent.append(el)
  return el
}

/** Sets text only when it changed, so a crosshair move touches the fewest nodes. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

export function createLegend(host: HTMLElement, series: readonly LegendSeries[], single: boolean): LegendHandle {
  const box = document.createElement('div')
  box.className = 'chart-legend linestack-legend'
  box.setAttribute('aria-hidden', 'true')
  const values = series.map((s) => {
    const swatch = cell(box, 'chart-legend-swatch')
    swatch.style.backgroundColor = s.colour
    cell(box, 'chart-legend-name', `${s.name} ${LINE_STACK.axisTag}`)
    return cell(box, 'chart-legend-value')
  })
  const statRows = single
    ? [0, 1, 2].map(() => {
        cell(box, 'chart-legend-swatch linestack-legend-blank linestack-legend-stat')
        return { name: cell(box, 'chart-legend-name linestack-legend-stat'), value: cell(box, 'chart-legend-value linestack-legend-stat') }
      })
    : []
  host.append(box)
  return {
    element: box,
    update(next, stats) {
      values.forEach((el, i) => setText(el, next[i] ?? ''))
      if (statRows.length === 0) return
      const texts: [string, string][] = stats
        ? [
            [fillCopy(LINE_STACK.legendHigh, { date: stats.high.date }), stats.high.value],
            [LINE_STACK.legendAverage, stats.average],
            [fillCopy(LINE_STACK.legendLow, { date: stats.low.date }), stats.low.value],
          ]
        : [['', ''], ['', ''], ['', '']]
      statRows.forEach((row, i) => {
        setText(row.name, texts[i]![0])
        setText(row.value, texts[i]![1])
      })
    },
    destroy() {
      box.remove()
    },
  }
}
