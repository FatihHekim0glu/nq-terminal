// Test doubles for the LineStack drawing code: a canvas context that records every call and a plot
// with uPlot's geometry (bbox in canvas pixels, valToPos with the canvasPixels flag). Tests only.

export type CtxCall = [string, ...unknown[]]

/** A canvas 2D context as far as the code under test is concerned, plus the recorded calls. */
export type RecordingContext = CanvasRenderingContext2D & { readonly calls: CtxCall[] }

/** A 2D context stand-in: method calls are recorded as [name, ...args], property writes as ['set:name', value]. */
export function recordingContext(canvasWidth: number, canvasHeight: number): RecordingContext {
  const calls: CtxCall[] = []
  const state: Record<string, unknown> = { font: '10px sans-serif' }
  const target: Record<string, unknown> = { calls, canvas: { width: canvasWidth, height: canvasHeight } }
  const proxy = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      if (prop in state) return state[prop]
      if (prop === 'measureText') {
        return (text: string) => {
          const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10)
          return { width: text.length * size * 0.55 }
        }
      }
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
      }
    },
    set(_t, prop: string, value: unknown) {
      state[prop] = value
      calls.push([`set:${prop}`, value])
      return true
    },
  })
  return proxy as unknown as RecordingContext
}

export interface FakePlotOptions {
  readonly xMin: number
  readonly xMax: number
  readonly yMin?: number
  readonly yMax?: number
  readonly pxRatio?: number
  /** Whole chart size in CSS pixels. */
  readonly width?: number
  readonly height?: number
  readonly data?: ReadonlyArray<ReadonlyArray<number | null>>
  readonly log?: boolean
}

export interface FakePlot {
  readonly ctx: RecordingContext
  readonly bbox: { left: number; top: number; width: number; height: number }
  readonly scales: { x: { min: number; max: number }; y: { min: number; max: number; distr: number } }
  readonly width: number
  readonly height: number
  readonly pxRatio: number
  readonly data: ReadonlyArray<ReadonlyArray<number | null>>
  readonly cursor: { idx: number | null; left: number; top: number }
  readonly over: { clientWidth: number; clientHeight: number }
  valToPos(value: number, scaleKey: string, canvasPixels?: boolean): number
  posToVal(pos: number, scaleKey: string, canvasPixels?: boolean): number
}

/** A plot with an 8px left and top inset, a 57px right axis and a 45px time axis (look spec 6). */
export function fakePlot(opts: FakePlotOptions): FakePlot {
  const pr = opts.pxRatio ?? 1
  const width = opts.width ?? 800
  const height = opts.height ?? 400
  const cssBox = { left: 8, top: 8, width: width - 8 - 57 - 26, height: height - 8 - 45 }
  const bbox = { left: cssBox.left * pr, top: cssBox.top * pr, width: cssBox.width * pr, height: cssBox.height * pr }
  const scales = {
    x: { min: opts.xMin, max: opts.xMax },
    y: { min: opts.yMin ?? 0, max: opts.yMax ?? 1, distr: opts.log ? 3 : 1 },
  }
  const frac = (key: string, v: number) => {
    const s = key === 'x' ? scales.x : scales.y
    if (key !== 'x' && scales.y.distr === 3) return (Math.log10(v) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min))
    return (v - s.min) / (s.max - s.min)
  }
  return {
    ctx: recordingContext(width * pr, height * pr),
    bbox,
    scales,
    width,
    height,
    pxRatio: pr,
    data: opts.data ?? [[]],
    cursor: { idx: null, left: -10, top: -10 },
    over: { clientWidth: cssBox.width, clientHeight: cssBox.height },
    valToPos(value, key, canvasPixels = false) {
      const f = frac(key, value)
      if (key === 'x') return canvasPixels ? bbox.left + f * bbox.width : f * cssBox.width
      return canvasPixels ? bbox.top + (1 - f) * bbox.height : (1 - f) * cssBox.height
    },
    posToVal(pos, key, canvasPixels = false) {
      const s = key === 'x' ? scales.x : scales.y
      const f = key === 'x'
        ? (canvasPixels ? (pos - bbox.left) / bbox.width : pos / cssBox.width)
        : 1 - (canvasPixels ? (pos - bbox.top) / bbox.height : pos / cssBox.height)
      return s.min + f * (s.max - s.min)
    },
  }
}
