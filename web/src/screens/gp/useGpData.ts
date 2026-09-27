// The GP and GIP reads: bars through the gate, the catalog (which variants exist), RV22 from the
// universe on daily charts that end at the fence, the RV22 line for the indicator pane on daily charts
// (/api/market/rv), and the fills of a linked run. Every read is a GET
// through the shared query hooks. A window past the fence never becomes a query: the bars read is
// disabled and the refusal text comes from the model instead.
import { useMemo } from 'react'
import type { ApiError } from '../../api/client'
import { useApiQuery, useCatalog, useMarketRv, useRunFills, useRuns } from '../../api/queries'
import type { SuccessOf } from '../../api/types'
import type { CandleFill } from '../../charts/CandleChart.model'
import {
  FENCE_MS, availableVariants, barsQuery, fenceRefusal, fillsFor, isoDate, rangeAllowed,
  type DateWindow, type GpTimeframe, type Variant,
} from './model'

/** One page of fills is plenty for a chart; the note says when a run has more. */
export const FILLS_LIMIT = 5000
export const RV_WINDOW = 22

export type BarsData = SuccessOf<'/api/bars'>

export interface GpRequest {
  readonly root: string
  readonly symbol: string | null
  readonly tf: GpTimeframe
  readonly variant: Variant
  readonly window: DateWindow
  readonly runId: string | null
}

export interface GpData {
  /** The variant actually requested (vendor when the chosen one has no series at this timeframe). */
  readonly variant: Variant
  readonly variants: readonly Variant[]
  /** The gate rule text when the window leaves the fence; nothing was requested. */
  readonly refusal: string | null
  /** False when the window is longer than one request may span. */
  readonly spanOk: boolean
  readonly bars: BarsData | undefined
  readonly barsError: ApiError | null
  readonly barsLoading: boolean
  readonly universeRows: SuccessOf<'/api/market/universe'>['rows'] | undefined
  /** The RV22 line for the indicator pane (daily charts only). */
  readonly rv: SuccessOf<'/api/market/rv'> | undefined
  readonly rvError: ApiError | null
  readonly runs: readonly string[]
  readonly fills: readonly CandleFill[]
  readonly fillsTotal: number
  readonly fillsError: ApiError | null
}

const NO_FILLS: readonly CandleFill[] = []
const NO_RUNS: readonly string[] = []
const DISABLED_QUERY = { symbol: '' } as const

function useVariants(symbol: string | null, tf: GpTimeframe, chosen: Variant): { variant: Variant; variants: readonly Variant[] } {
  const catalog = useCatalog()
  return useMemo(() => {
    // Without the catalog the choice stands and the API answers for it (404 when the series is missing).
    const listed = catalog.data && symbol ? availableVariants(catalog.data.series, symbol, tf) : null
    const variants = listed && listed.length > 0 ? listed : (['vendor', 'repaired'] as const)
    return { variant: variants.includes(chosen) ? chosen : 'vendor', variants }
  }, [catalog.data, symbol, tf, chosen])
}

function useFills(root: string, runId: string | null) {
  const query = useRunFills(runId ?? '', { limit: FILLS_LIMIT })
  const items = query.data?.items
  const fills = useMemo(() => (items && runId ? fillsFor(root, items) : NO_FILLS), [items, root, runId])
  return { fills, total: runId ? query.data?.total ?? 0 : 0, error: runId ? query.error : null }
}

export function useGpData(req: GpRequest): GpData {
  const { variant, variants } = useVariants(req.symbol, req.tf, req.variant)
  const refusal = fenceRefusal(req.window)
  const spanOk = rangeAllowed(req.tf, req.window)
  const enabled = req.symbol !== null && refusal === null && spanOk
  const query = enabled && req.symbol ? barsQuery(req.symbol, req.tf, variant, req.window) : DISABLED_QUERY
  const bars = useApiQuery('/api/bars', { query }, { enabled })
  const lastDate = bars.data && bars.data.t.length > 0 ? isoDate((bars.data.t[bars.data.t.length - 1] ?? 0) * 1000) : null
  const wantRv = enabled && req.tf === '1d' && req.window.endMs === FENCE_MS && lastDate !== null
  const universe = useApiQuery('/api/market/universe', { query: { window: RV_WINDOW } }, { enabled: wantRv })
  const wantLine = enabled && req.tf === '1d'
  const rv = useMarketRv(wantLine && req.symbol ? req.symbol : '', RV_WINDOW)
  const runs = useRuns()
  const runIds = useMemo(() => runs.data?.map((r) => r.run_id) ?? NO_RUNS, [runs.data])
  const fills = useFills(req.root, req.runId)
  return {
    variant, variants, refusal, spanOk,
    bars: enabled ? bars.data : undefined,
    barsError: enabled ? bars.error : null,
    barsLoading: enabled && bars.isPending,
    universeRows: wantRv ? universe.data?.rows : undefined,
    rv: wantLine ? rv.data : undefined,
    rvError: wantLine ? rv.error : null,
    runs: runIds,
    fills: fills.fills,
    fillsTotal: fills.total,
    fillsError: fills.error,
  }
}
