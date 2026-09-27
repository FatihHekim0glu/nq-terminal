// The VCONE model (TASKS Phase 11, ANALYTICS MV9 over MV3): the /api/market/vcone cone and the /api/market/vcone/universe
// small multiples as the screen shows them. Pure functions only. Every displayed value is the API value (an
// annualised fraction) as % to 1 decimal, the rank as % to 0 decimals; nothing is computed from prices here.
import type { ChartTable } from '../../charts/ChartA11y'
import { niceAxis } from '../../charts/echarts/shared'
import { MISSING } from '../../chrome/QuoteHeader.format'
import { toCsv } from '../../chrome/exportCsv'
import type { ResolvedContext } from '../../commands/types'
import { CONTRACT_NAMES } from '../../copy/market'
import { VCONE } from '../../copy/vcone'
import { fillCopy } from '../../copy/workspace'
import { toDecimal } from '../../format/decimal'
import { contractName, tickerOf } from '../mon/model'
import { PCT, type ConeInput } from './coneOption'
import type { VolCone, VolConeRow, VolConeUniverse } from './types'

export { coneKey, coneOption, type ConeInput } from './coneOption'

export const HORIZONS = [5, 10, 21, 63, 126, 252] as const
export const DEFAULT_HORIZON = 21
export const FALLBACK_ROOT = 'NQ'
export const UNIVERSE_ROOTS: readonly string[] = Object.keys(CONTRACT_NAMES)
const SHORT = 21
const LONG = 252
const RANK_DECIMALS = 0
const PCT_DECIMALS = 1

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export const symbolOf = (root: string): string => `${root}.V.0`

export interface RootChoice {
  readonly root: string
  /** The instrument the context asked for; null when the context is not an instrument. */
  readonly asked: string | null
  readonly known: boolean
}

export function resolveRoot(context: ResolvedContext | null): RootChoice {
  if (!context || context.kind !== 'instrument') return { root: FALLBACK_ROOT, asked: null, known: true }
  const known = UNIVERSE_ROOTS.includes(context.value)
  return { root: known ? context.value : FALLBACK_ROOT, asked: context.value, known }
}

export function pct(v: number | null | undefined): string {
  return finite(v) ? toDecimal(v * PCT, PCT_DECIMALS) : MISSING
}

export function rankText(v: number | null | undefined): string {
  return finite(v) ? toDecimal(v, RANK_DECIMALS) : MISSING
}

const withPct = (v: number | null | undefined): string => (finite(v) ? `${pct(v)}%` : MISSING)
const hasCone = (r: VolConeRow): boolean => finite(r.min) && finite(r.max)

export function coneInput(cone: VolCone, ticker: string): ConeInput {
  const rows = cone.horizons.filter(hasCone)
  return { name: fillCopy(VCONE.coneName, { ticker }), asOf: cone.as_of, steps: rows.map((r) => r.sessions), rows }
}

export function describeCone(input: ConeInput): string {
  if (input.rows.length === 0) return fillCopy(VCONE.coneSummaryEmpty, { name: input.name })
  const short = input.rows.find((r) => r.sessions === SHORT) ?? input.rows[0]!
  const long = input.rows.find((r) => r.sessions === LONG) ?? input.rows.at(-1)!
  return fillCopy(VCONE.coneSummary, {
    name: input.name,
    asOf: input.asOf,
    short: short.sessions,
    shortMedian: withPct(short.p50),
    shortMin: withPct(short.min),
    shortMax: withPct(short.max),
    shortLatest: withPct(short.latest),
    long: long.sessions,
    longMedian: withPct(long.p50),
    longLatest: withPct(long.latest),
  })
}

const STAT_COLUMNS = [
  ['min', VCONE.colMin],
  ['p10', VCONE.colP10],
  ['p25', VCONE.colP25],
  ['p50', VCONE.colP50],
  ['p75', VCONE.colP75],
  ['p90', VCONE.colP90],
  ['max', VCONE.colMax],
  ['latest', VCONE.colLatest],
] as const

export function statCells(r: VolConeRow): Record<string, string> {
  return { ...Object.fromEntries(STAT_COLUMNS.map(([k]) => [k, pct(r[k])])), rank: rankText(r.latest_rank) }
}

export function coneTable(input: ConeInput): ChartTable {
  return {
    caption: fillCopy(VCONE.coneCaption, { name: input.name }),
    columns: [
      { key: 'horizon', label: VCONE.colHorizon, numeric: true },
      { key: 'n', label: VCONE.colWindows, numeric: true },
      ...STAT_COLUMNS.map(([key, label]) => ({ key, label, numeric: true })),
      { key: 'rank', label: VCONE.colRank, numeric: true },
    ],
    rows: input.rows.map((r) => ({ horizon: String(r.sessions), n: String(r.n), ...statCells(r) })),
  }
}

const RAW_KEYS = ['min', 'p10', 'p25', 'p50', 'p75', 'p90', 'max', 'latest', 'latest_rank'] as const

export function coneCsv(cone: VolCone): string {
  const header = ['symbol', 'sessions', 'windows', 'first_window_end', ...RAW_KEYS]
  return toCsv(header, cone.horizons.map((r) => [cone.symbol, r.sessions, r.n, r.first_date, ...RAW_KEYS.map((k) => r[k])]))
}

export function smallCsv(small: VolConeUniverse): string {
  const header = ['symbol', 'sector', 'sessions', 'windows', ...RAW_KEYS]
  return toCsv(header, small.rows.map((r) => [r.symbol, r.sector, small.sessions, r.stats.n, ...RAW_KEYS.map((k) => r.stats[k])]))
}

type TileKey = 'min' | 'p10' | 'p25' | 'p50' | 'p75' | 'p90' | 'max' | 'latest'
const TILE_KEYS: readonly TileKey[] = ['min', 'p10', 'p25', 'p50', 'p75', 'p90', 'max', 'latest']

export interface Tile {
  readonly root: string
  readonly symbol: string
  readonly ticker: string
  readonly name: string
  readonly stats: VolConeRow
  /** Each statistic's position on the shared scale, 0 to 1; null when the API sent none. */
  readonly x: Readonly<Record<TileKey, number | null>>
  readonly summary: string
}

export interface SmallView {
  readonly tiles: readonly Tile[]
  /** The shared scale's top, in %. */
  readonly scaleMax: number
  readonly label: string
  readonly table: ChartTable
}

function tileSummary(root: string, s: VolConeRow, n: number): string {
  const base = { ticker: tickerOf(root), name: contractName(root), n }
  if (!hasCone(s)) return fillCopy(VCONE.tileEmpty, base)
  return fillCopy(VCONE.tileSummary, {
    ...base,
    latest: withPct(s.latest),
    rank: finite(s.latest_rank) ? `${rankText(s.latest_rank)}%` : MISSING,
    median: withPct(s.p50),
    p10: withPct(s.p10),
    p90: withPct(s.p90),
    min: withPct(s.min),
    max: withPct(s.max),
  })
}

export function smallView(small: VolConeUniverse): SmallView {
  const top = Math.max(0, ...small.rows.flatMap((r) => [r.stats.max, r.stats.latest]).filter(finite).map((v) => v * PCT))
  const scaleMax = niceAxis(0, top > 0 ? top : 1).max
  const place = (v: number | null | undefined) => (finite(v) ? Math.min(1, Math.max(0, (v * PCT) / scaleMax)) : null)
  const tiles = small.rows.map((r) => ({
    root: r.root,
    symbol: r.symbol,
    ticker: tickerOf(r.root),
    name: contractName(r.root),
    stats: r.stats,
    x: Object.fromEntries(TILE_KEYS.map((k) => [k, place(r.stats[k])])) as Record<TileKey, number | null>,
    summary: tileSummary(r.root, r.stats, small.sessions),
  }))
  const table: ChartTable = {
    caption: fillCopy(VCONE.smallCaption, { n: small.sessions }),
    columns: [
      { key: 'ticker', label: VCONE.colTicker },
      ...STAT_COLUMNS.map(([key, label]) => ({ key, label, numeric: true })),
      { key: 'rank', label: VCONE.colRank, numeric: true },
    ],
    rows: tiles.map((t) => ({ ticker: t.ticker, ...statCells(t.stats) })),
  }
  return { tiles, scaleMax, label: `${fillCopy(VCONE.smallLabel, { n: small.sessions })}. ${fillCopy(VCONE.scaleNote, { max: scaleMax })}`, table }
}
