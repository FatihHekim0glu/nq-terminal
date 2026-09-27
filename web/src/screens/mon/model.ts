// The MON model (TASKS 7.2, look spec 7.7, ANALYTICS MV4): the /api/market/universe rows as the futures
// monitor shows them. Pure functions only. Every displayed value is the API value at a fixed precision:
// returns (fractions) as % to 2 decimals, vol-normalised returns in sd to 2 decimals, realised vol as an
// annualised % to 1 decimal, correlations signed to 2 decimals, and the last close at the contract's tick
// precision (Treasuries in 32nds, decision D5). Nothing is computed from prices here.
import {
  MISSING,
  formatPercent,
  formatPercentChange,
  formatPrice,
  formatSignedChange,
} from '../../chrome/QuoteHeader.format'
import type { Schemas } from '../../api/types'
import { displayInstrument } from '../../commands/sectors'
import { fillCopy } from '../../copy/workspace'
import { CONTRACT_NAMES, MARKET, SECTOR_TITLES } from './copy'

export type Universe = Schemas['Universe']
export type UniverseRow = Schemas['UniverseRow']
export type GateInfo = Schemas['GateInfo']

/** The monitor's two views: horizon returns in %, or the same returns in units of their own spread. */
export type MonView = 'returns' | 'normalised'
export type HeatStep = 'up2' | 'up1' | 'dn1' | 'dn2'
export type RowFlag = 'served' | 'stale'

export const SECTOR_SEQUENCE = ['equity', 'rates', 'fx', 'energy', 'metals', 'grains', 'livestock'] as const

/** Sessions for realised vol and correlation to NQ; the API's default is 252. */
export const WINDOW_OPTIONS = [63, 126, 252] as const
export const DEFAULT_WINDOW = 252

/** A move of at least this many sd (vol-normalised) takes the strong heat step (house choice). */
export const STRONG_SD = 1

const PCT = 100
const RETURN_DECIMALS = 2
const SD_DECIMALS = 2
const VOL_DECIMALS = 1
const CORR_DECIMALS = 2
const FALLBACK_PRICE_DECIMALS = 4

/** Most decimals a tick is looked at to (6J's 0.0000005 needs 7). */
const MAX_TICK_DECIMALS = 10
const TICK_EPSILON = 1e-9

export interface MonRow {
  readonly symbol: string
  readonly root: string
  readonly sector: string
  readonly sectorTitle: string
  readonly ticker: string
  readonly name: string
  readonly units: string
  readonly lastValue: number | null
  readonly last: string
  readonly flag: RowFlag
  /** Horizon values in the view's display unit (% or sd), for sorting. */
  readonly values: Readonly<Record<string, number | null>>
  /** Horizon values as printed. */
  readonly cells: Readonly<Record<string, string>>
  readonly heat: Readonly<Record<string, HeatStep | null>>
  readonly rvValue: number | null
  readonly rv: string
  readonly corrValue: number | null
  readonly corr: string
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function sectorTitle(sector: string): string {
  return (SECTOR_TITLES as Readonly<Record<string, string>>)[sector] ?? sector
}

export function sectorRank(sector: string): number {
  const i = (SECTOR_SEQUENCE as readonly string[]).indexOf(sector)
  return i < 0 ? SECTOR_SEQUENCE.length : i
}

/** `NQ1 Index`, `TU1 Comdty`, `EC1 Curncy`: the chrome's display form of a root. */
export function tickerOf(root: string): string {
  return displayInstrument(root, null)
}

export function contractName(root: string): string {
  return CONTRACT_NAMES[root] ?? MISSING
}

/**
 * Decimals of the contract's tick as the API serves it (UniverseRow.tick): the last close is printed to
 * the tick, so it equals the served value wherever the value sits on the tick grid. Treasuries print
 * in 32nds regardless (formatPrice).
 */
export function priceDecimals(tick: number | null | undefined): number {
  if (!finite(tick) || tick <= 0) return FALLBACK_PRICE_DECIMALS
  for (let d = 0; d <= MAX_TICK_DECIMALS; d += 1) {
    const scaled = tick * 10 ** d
    if (Math.abs(scaled - Math.round(scaled)) < TICK_EPSILON * 10 ** d) return d
  }
  return MAX_TICK_DECIMALS
}

/** The last close at its tick; from a backend that sends no tick yet, to the decimals the value itself
 * needs, so a served value is never rounded. */
export function formatLast(root: string, value: number | null | undefined, tick: number | null | undefined): string {
  const known = finite(tick) && tick > 0
  const decimals = known ? priceDecimals(tick) : finite(value) ? priceDecimals(Math.abs(value)) : FALLBACK_PRICE_DECIMALS
  return formatPrice(root, value, decimals)
}

/** The horizon value in the view's display unit: % for returns, sd for vol-normalised. */
export function displayValue(value: number | null | undefined, view: MonView): number | null {
  if (!finite(value)) return null
  return view === 'returns' ? value * PCT : value
}

export function formatHorizon(value: number | null | undefined, view: MonView): string {
  const shown = displayValue(value, view)
  return view === 'returns' ? formatPercentChange(shown, RETURN_DECIMALS) : formatSignedChange(shown, SD_DECIMALS)
}

export function formatVol(value: number | null | undefined): string {
  return formatPercent(finite(value) ? value * PCT : null, VOL_DECIMALS)
}

export function formatCorr(value: number | null | undefined): string {
  return formatSignedChange(value, CORR_DECIMALS)
}

/** Heat step: the sign of the return picks the side, |vol-normalised| of STRONG_SD or more the strong step. */
export function heatStep(ret: number | null | undefined, sd: number | null | undefined): HeatStep | null {
  if (!finite(ret) || ret === 0) return null
  const strong = finite(sd) && Math.abs(sd) >= STRONG_SD
  if (ret > 0) return strong ? 'up2' : 'up1'
  return strong ? 'dn2' : 'dn1'
}

function horizonsOf(row: UniverseRow, horizons: readonly string[], view: MonView) {
  const source = view === 'returns' ? row.returns : row.vol_normalised
  const values: Record<string, number | null> = {}
  const cells: Record<string, string> = {}
  const heat: Record<string, HeatStep | null> = {}
  for (const h of horizons) {
    values[h] = displayValue(source[h], view)
    cells[h] = formatHorizon(source[h], view)
    heat[h] = heatStep(row.returns[h], row.vol_normalised[h])
  }
  return { values, cells, heat }
}

export function toMonRow(row: UniverseRow, horizons: readonly string[], view: MonView): MonRow {
  return {
    symbol: row.symbol,
    root: row.root,
    sector: row.sector,
    sectorTitle: sectorTitle(row.sector),
    ticker: tickerOf(row.root),
    name: contractName(row.root),
    units: row.units,
    lastValue: finite(row.last_close) ? row.last_close : null,
    last: formatLast(row.root, row.last_close, row.tick),
    flag: row.stale_last ? 'stale' : 'served',
    ...horizonsOf(row, horizons, view),
    rvValue: finite(row.realised_vol) ? row.realised_vol * PCT : null,
    rv: formatVol(row.realised_vol),
    corrValue: finite(row.corr_to_nq) ? row.corr_to_nq : null,
    corr: formatCorr(row.corr_to_nq),
  }
}

/** The 27 rows in sector order (equity first), the API's order kept inside each sector. */
export function buildMonRows(universe: Universe, view: MonView): MonRow[] {
  const ranked = universe.rows.map((row, i) => ({ row, i, rank: sectorRank(row.sector) }))
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i)
  return ranked.map(({ row }) => toMonRow(row, universe.horizons, view))
}

/** The gate's bookkeeping for the served frames, in one line. */
export function gateText(gate: GateInfo): string {
  const years = gate.served_years
  if (years.length === 0) return fillCopy(MARKET.gateNone, { caller: gate.caller })
  return fillCopy(MARKET.gate, {
    caller: gate.caller,
    first: Math.min(...years),
    last: Math.max(...years),
    reads: gate.reads_this_process,
    cached: gate.cached ? MARKET.gateCached : '',
  })
}
