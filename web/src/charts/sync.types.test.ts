// Compile-time checks (`pnpm test:types`): the real library objects fit the adapters in sync.ts,
// so LineStack and CandleChart pass them in with no cast. The imports are type-only.
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts'
import type uPlot from 'uplot'
import { describe, expect, it } from 'vitest'
import type { LwcSyncChart, UplotCursorSync, UplotSyncPlot, UplotSyncPlugin } from './sync'

export const asSyncPlot = (u: uPlot): UplotSyncPlot => u
export const asCursorSync = (s: UplotCursorSync): uPlot.Cursor.Sync => s
export const asPlugin = (p: UplotSyncPlugin): uPlot.Plugin => p
export const asSyncChart = (c: IChartApi): LwcSyncChart<ISeriesApi<SeriesType>> => c

describe('sync adapter types', () => {
  it('compiles against uplot 1.6.32 and lightweight-charts 5.2.1', () => {
    expect([asSyncPlot, asCursorSync, asPlugin, asSyncChart].every((f) => typeof f === 'function')).toBe(true)
  })
})
