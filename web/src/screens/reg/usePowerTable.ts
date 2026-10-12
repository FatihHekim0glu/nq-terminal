// The SV9 power table, read from the backend (GET /api/analytics/power, ANALYTICS_CATALOG SV9): one row per trial of
// the Deflated Sharpe view, the minimum detectable annual Sharpe and the power at the reference Sharpe at the family
// alpha and at alpha / k. It was computed in the browser (quant/powerReference.ts, now a test reference) and is served now; this
// hook maps the served snake_case body onto the PowerView that powerModel.ts formats, so PowerPanel's table, summary
// and wording are unchanged. [POST HOC], Basis A, best case, never a verdict.
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ApiError, apiGet } from '../../api/client'
import type { Schemas } from '../../api/types'
import { STALE_MS } from '../../api/queries'
import { POWER_SERVED } from '../../copy/plan'

import { POWER_TAG, type PowerRow, type PowerView } from './powerModel'

export const POWER_PATH = '/api/analytics/power'

export type ServedPowerRow = Schemas['PowerRow']
export type ServedPowerTable = Schemas['PowerTable']

function isServedPowerTable(value: unknown): value is ServedPowerTable {
  if (value === null || typeof value !== 'object') return false
  const table = value as Partial<ServedPowerTable>
  return typeof table.alpha === 'number' && typeof table.k === 'number' && Array.isArray(table.rows)
}

function powerRow(row: ServedPowerRow): PowerRow {
  return {
    name: row.name,
    kind: row.kind,
    periods: row.periods,
    n: row.n,
    years: row.years,
    sharpe: row.sharpe,
    mdeNominal: row.mde_nominal,
    mdeFamily: row.mde_family,
    ratio: row.ratio,
    powerNominal: row.power_nominal,
    powerFamily: row.power_family,
  }
}

/** The served table as the view powerModel.ts formats: the same figures, named as the browser's view named them. */
export function powerViewFromServed(table: ServedPowerTable): PowerView {
  return {
    tag: POWER_TAG,
    basis: 'A',
    family: { alpha: table.alpha, k: table.k },
    alphaFamily: table.alpha_family,
    rows: table.rows.map(powerRow),
  }
}

async function fetchPowerTable(signal: AbortSignal): Promise<PowerView> {
  const body = await apiGet(POWER_PATH, {}, { signal })
  if (!isServedPowerTable(body)) {
    throw new ApiError({ kind: 'decode', path: POWER_PATH, detail: POWER_SERVED.malformed })
  }
  return powerViewFromServed(body)
}

/**
 * The served power table. Asked once the Deflated Sharpe view it is computed from has arrived (`view`, which the
 * panel already holds), and only while `wanted` (REG asks for it on 92) Evidence alone); the same query key serves
 * every panel that shows it.
 */
export function usePowerTable(
  view: { readonly rows: readonly unknown[] } | undefined,
  wanted = true,
): UseQueryResult<PowerView, ApiError> {
  return useQuery<PowerView, ApiError>({
    queryKey: ['api', POWER_PATH, {}],
    queryFn: ({ signal }) => fetchPowerTable(signal),
    enabled: wanted && (view?.rows.length ?? 0) > 0,
    staleTime: STALE_MS,
  })
}
