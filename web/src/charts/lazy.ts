// Lazy loaders for the chart libraries (TASKS Phase 5): each library is its own chunk (vite.config.ts
// LIBRARY_CHUNKS) fetched on first use, so the shell never downloads them. Chart components get the
// library from here, never through a static import; they may import its types with `import type`
// (erased). A test (libraryImports.test.ts) and the bundle check (scripts/bundleCheck.ts) enforce it.
// A failed load is not cached, so the next mount retries (onceLoader).
import { useEffect, useState } from 'react'
import type uPlot from 'uplot'

export type UplotConstructor = typeof uPlot
export type LwcModule = typeof import('lightweight-charts')
export type EchartsModule = typeof import('./echarts/core')

export function onceLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null
      throw err
    })
    return pending
  }
}

/** uPlot's constructor (LineStack). Also import 'uplot/dist/uPlot.min.css' in the component. */
export const loadUplot: () => Promise<UplotConstructor> = onceLoader(() => import('uplot').then((m) => m.default))

/** The lightweight-charts v5 module (CandleChart): createChart, CandlestickSeries and so on. */
export const loadLwc: () => Promise<LwcModule> = onceLoader(() => import('lightweight-charts'))

/** The tree-shaken ECharts build (./echarts/core): init, graphic and the option type. */
export const loadEcharts: () => Promise<EchartsModule> = onceLoader(() => import('./echarts/core'))

export type ChartLibraryState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly lib: T }
  | { readonly status: 'error'; readonly error: Error }

/**
 * The library for a chart component. While it loads, render the chart container with
 * aria-busy="true" (the gallery helper and screen readers wait for it); on error, show the message.
 * Pass a stable loader (loadUplot, loadLwc or loadEcharts).
 */
export function useChartLibrary<T>(load: () => Promise<T>): ChartLibraryState<T> {
  const [state, setState] = useState<ChartLibraryState<T>>({ status: 'loading' })
  useEffect(() => {
    let live = true
    load().then(
      (lib) => {
        if (live) setState({ status: 'ready', lib })
      },
      (err: unknown) => {
        if (live) setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      },
    )
    return () => {
      live = false
    }
  }, [load])
  return state
}
