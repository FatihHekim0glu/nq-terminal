// The CORR model (TASKS 7.2, look spec 7.8, ANALYTICS MV5): the /api/market/universe correlation blocks
// as the Heatmap draws them, and the /api/market/pair-corr series as the linked LineStack draws it. Pure
// functions only. The matrix is only reordered, never recomputed: the clustered order is the API's
// average-linkage order, the sector order keeps the API's order inside each sector.
import type { Schemas } from '../../api/types'
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import { fillCopy } from '../../copy/workspace'
import { sectorRank, type Universe, type UniverseRow } from '../mon/model'
import { CORR } from './copy'

export type Correlation = Schemas['Correlation']
export type PairCorrelation = Schemas['PairCorrelationSeries']
export type CorrMatrix = 'window' | 'full'
export type CorrOrder = 'clustered' | 'sector'

/** 2022-01-01T00:00:00Z: no served point at or after it is ever drawn (UI_SPEC 6). */
export const FENCE_T = Date.UTC(2022, 0, 1) / 1000
export const CORR_DECIMALS = 2
const DEFAULT_A = 'NQ.V.0'
const DEFAULT_B = 'ZN.V.0'

/** `NQ.V.0` to `NQ`. */
export function rootOf(symbol: string): string {
  return symbol.split('.')[0] ?? symbol
}

export function blockOf(universe: Universe, matrix: CorrMatrix): Correlation {
  return matrix === 'window' ? universe.correlation_window : universe.correlation_full
}

/** Indices of `symbols` by sector (equity first), the API's order kept inside each sector. */
export function sectorOrder(symbols: readonly string[], rows: readonly UniverseRow[]): number[] {
  const sectorOf = new Map(rows.map((r) => [r.symbol, r.sector]))
  return symbols
    .map((symbol, i) => ({ i, rank: sectorRank(sectorOf.get(symbol) ?? '') }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.i)
}

function checkPermutation(order: readonly number[], n: number): void {
  const seen = new Set(order)
  if (order.length !== n || seen.size !== n || order.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) {
    throw new Error(`correlation order is not a permutation of the ${n} symbols`)
  }
}

function heatName(universe: Universe, block: Correlation, order: CorrOrder): string {
  const matrix = block.sessions === null
    ? fillCopy(CORR.heatNameFull, { asOf: universe.as_of })
    : fillCopy(CORR.heatNameWindow, { n: block.sessions })
  const orderName = order === 'clustered' ? CORR.orderNameClustered : CORR.orderNameSector
  return fillCopy(CORR.heatName, { matrix, order: orderName })
}

/** The Heatmap input: labels are roots, values the served matrix in the chosen order. */
export function corrHeatmapInput(universe: Universe, matrix: CorrMatrix, order: CorrOrder): HeatmapInput {
  const block = blockOf(universe, matrix)
  const n = block.symbols.length
  const idx = order === 'clustered' ? [...block.order] : sectorOrder(block.symbols, universe.rows)
  checkPermutation(idx, n)
  const labels = idx.map((i) => rootOf(block.symbols[i] ?? ''))
  const values = idx.map((r) => idx.map((c) => block.matrix[r]?.[c] ?? null))
  return { kind: 'corr', name: heatName(universe, block, order), columns: labels, rows: labels, values, decimals: CORR_DECIMALS }
}

/** NQ against ZN when both are served, else the first two symbols. */
export function defaultPair(symbols: readonly string[]): readonly [string, string] {
  if (symbols.includes(DEFAULT_A) && symbols.includes(DEFAULT_B)) return [DEFAULT_A, DEFAULT_B]
  return [symbols[0] ?? '', symbols[1] ?? '']
}

export function matrixEntry(block: Correlation, a: string, b: string): number | null {
  const i = block.symbols.indexOf(a)
  const j = block.symbols.indexOf(b)
  if (i < 0 || j < 0) return null
  return block.matrix[i]?.[j] ?? null
}

export interface PairView {
  readonly t: number[]
  readonly values: (number | null)[]
  /** Points at or after the fence, left out (the API serves none; this is the second guard). */
  readonly fenced: number
  readonly last: { readonly value: number; readonly date: string } | null
}

/** The pair series inside the fence, with its last value and date as served. */
export function pairSeries(pair: Pick<PairCorrelation, 't' | 'corr' | 'date'>): PairView {
  const keep = pair.t.map((_, i) => i).filter((i) => (pair.t[i] ?? FENCE_T) < FENCE_T)
  const t = keep.map((i) => pair.t[i]!)
  const values = keep.map((i) => pair.corr[i] ?? null)
  let last: PairView['last'] = null
  for (let k = keep.length - 1; k >= 0; k--) {
    const v = values[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      last = { value: v, date: pair.date[keep[k]!] ?? '' }
      break
    }
  }
  return { t, values, fenced: pair.t.length - keep.length, last }
}
