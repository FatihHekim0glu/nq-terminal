// Reads a panel's charts off the page for GRAB. Every chart sits in ChartA11y's figure (role="img",
// named by its data summary); the canvases inside it are the pixels already drawn, so nothing is
// recomputed and nothing is requested. A chart drawn with SVG has no canvas to copy and is counted, not
// drawn. In the table view the figure is not in the page at all, so it is simply absent here.

const FIGURE = '.chart-a11y-figure[role="img"]'

/** One canvas of a figure, placed relative to the figure's own top left corner (CSS px). */
export interface GrabLayer {
  readonly source: CanvasImageSource
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface GrabFigure {
  /** The figure's accessible name: the data summary the chart already states. */
  readonly summary: string
  readonly width: number
  readonly height: number
  /** Bottom to top: the canvases in document order (lightweight-charts stacks several). */
  readonly layers: readonly GrabLayer[]
}

export interface GrabCollection {
  readonly figures: readonly GrabFigure[]
  /** Figures drawn without any canvas (SVG), left out of the image. */
  readonly skipped: number
}

function sized(box: { readonly width: number; readonly height: number }): boolean {
  return box.width > 0 && box.height > 0
}

function invisible(el: Element): boolean {
  return getComputedStyle(el).visibility === 'hidden'
}

function layersOf(figure: Element, origin: DOMRect): GrabLayer[] {
  const layers: GrabLayer[] = []
  for (const canvas of figure.querySelectorAll('canvas')) {
    const box = canvas.getBoundingClientRect()
    if (!sized(box) || !sized(canvas)) continue
    layers.push({ source: canvas, x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height })
  }
  return layers
}

/** The chart figures inside `panel`, in document order, and how many SVG-only figures were left out. */
export function collectFigures(panel: ParentNode): GrabCollection {
  const figures: GrabFigure[] = []
  let skipped = 0
  for (const figure of panel.querySelectorAll(FIGURE)) {
    const box = figure.getBoundingClientRect()
    if (!sized(box) || invisible(figure)) continue
    const layers = layersOf(figure, box)
    if (layers.length > 0) {
      figures.push({ summary: figure.getAttribute('aria-label')?.trim() ?? '', width: box.width, height: box.height, layers })
    } else if (figure.querySelector('svg')) {
      skipped += 1
    }
  }
  return { figures, skipped }
}
