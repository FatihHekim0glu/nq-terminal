// SV7 on RET (ANALYTICS_CATALOG SV7 and C4): the Ledoit-Wolf and Memmel tests of the Sharpe difference
// against buy and hold, as the screen JSON stores them per cost and the API copies them into
// validity.sharpe_difference_tests. Pure functions: every value is the file's own and nothing is recomputed.
// The API types the object as {[cost]: unknown}, so each entry is narrowed here; one in any other shape is
// left out and counted, never guessed at. An absent test (the API sends null) stays a row with nothing in it.
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { formatP } from '../../charts/echarts/format'
import { TEAR_SV7 } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { MISSING, formatNumber } from './tearFormat'
import type { Analytics } from './tearKpis'

export type Sv7Tests = Analytics['validity']['sharpe_difference_tests']

export interface Sv7LedoitWolf {
  readonly d_annual: number | null
  readonly se_annual: number | null
  readonly p_one_sided: number | null
  readonly ci90_annual: readonly [number, number] | null
  readonly block: number | null
  readonly reps: number | null
  readonly seed: number | null
  readonly n: number | null
}

export interface Sv7Memmel {
  readonly z: number | null
  readonly p_one_sided: number | null
  readonly rho: number | null
}

export interface Sv7Row {
  /** The file's cost key, `1tick`. */
  readonly cost: string
  readonly ticks: number
  /** The file's own label for the headline value (C4). */
  readonly label: string
  /** The screen's headline Sharpe difference (its `dsr` field). */
  readonly sharpe_difference: number | null
  readonly ledoit_wolf: Sv7LedoitWolf | null
  readonly memmel: Sv7Memmel | null
}

export interface Sv7 {
  /** One row per cost, by tick count. */
  readonly rows: readonly Sv7Row[]
  /** Entries in another shape, left out and counted. */
  readonly dropped: number
  /** The label every row carries, or null when they differ or there is no row. */
  readonly label: string | null
}

/** The cost key's tick count: `1tick`, `2ticks`; any other key is malformed. */
const TICKS = /^(\d+)\s*ticks?$/
const MALFORMED = Symbol('malformed')
type Read<T> = T | typeof MALFORMED

const LW_FIELDS = ['d_annual', 'se_annual', 'p_one_sided', 'block', 'reps', 'seed', 'n'] as const
const MEMMEL_FIELDS = ['z', 'p_one_sided', 'rho'] as const

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A number the file holds, or null where it holds none (JSON has no NaN: the API sends null). */
function num(value: unknown): Read<number | null> {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : MALFORMED
}

function numbers<K extends string>(source: Readonly<Record<string, unknown>>, keys: readonly K[]): Read<Record<K, number | null>> {
  const out = {} as Record<K, number | null>
  for (const key of keys) {
    const value = num(source[key])
    if (value === MALFORMED) return MALFORMED
    out[key] = value
  }
  return out
}

/** A two-ended interval; null when the file holds none or an end is missing (no whisker to draw). */
function interval(value: unknown): Read<readonly [number, number] | null> {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length !== 2) return MALFORMED
  const lo = num(value[0])
  const hi = num(value[1])
  if (lo === MALFORMED || hi === MALFORMED) return MALFORMED
  return lo === null || hi === null ? null : [lo, hi]
}

function ledoitWolf(source: Readonly<Record<string, unknown>>): Read<Sv7LedoitWolf> {
  const fields = numbers(source, LW_FIELDS)
  const ci = interval(source.ci90_annual)
  if (fields === MALFORMED || ci === MALFORMED) return MALFORMED
  return { ...fields, ci90_annual: ci }
}

/** One test of an entry: null when the file has none, else narrowed by `read`. */
function test<T>(value: unknown, read: (source: Readonly<Record<string, unknown>>) => Read<T>): Read<T | null> {
  if (value === undefined || value === null) return null
  return isRecord(value) ? read(value) : MALFORMED
}

function entry(cost: string, value: unknown): Read<Sv7Row> {
  const ticks = TICKS.exec(cost)
  if (!ticks || !isRecord(value) || typeof value.label !== 'string') return MALFORMED
  const headline = num(value.sharpe_difference)
  const lw = test(value.ledoit_wolf, ledoitWolf)
  const memmel = test(value.memmel, (source) => numbers(source, MEMMEL_FIELDS))
  if (headline === MALFORMED || lw === MALFORMED || memmel === MALFORMED) return MALFORMED
  return { cost, ticks: Number(ticks[1]), label: value.label, sharpe_difference: headline, ledoit_wolf: lw, memmel }
}

export function readSv7(tests: Sv7Tests): Sv7 {
  const rows: Sv7Row[] = []
  let dropped = 0
  for (const [cost, value] of Object.entries(isRecord(tests) ? tests : {})) {
    const row = entry(cost, value)
    if (row === MALFORMED) dropped += 1
    else rows.push(row)
  }
  rows.sort((a, b) => a.ticks - b.ticks || a.cost.localeCompare(b.cost, 'en'))
  const labels = new Set(rows.map((r) => r.label))
  return { rows, dropped, label: labels.size === 1 ? rows[0]!.label : null }
}

// ---------------------------------------------------------------- display

/** The point and its spread at 4 decimals (a difference near zero keeps its sign); the interval ends at 2. */
const POINT_DECIMALS = 4
const INTERVAL_DECIMALS = 2
const STAT_DECIMALS = 2

/** The card's title: the file's own label, else the catalogue's (C4). */
export function sv7Title(sv7: Sv7): string {
  return sv7.label ?? TEAR_SV7.title
}

function costLabel(ticks: number): string {
  return fillCopy(ticks === 1 ? TEAR_SV7.cost : TEAR_SV7.costPlural, { n: ticks })
}

/** The Ledoit-Wolf point per cost as a bar, its 90% interval as the whisker, its sample size in the table view. */
export function sv7Ladder(sv7: Sv7, name: string): BarLadderInput {
  return {
    name: fillCopy(TEAR_SV7.chartName, { name, label: sv7Title(sv7) }),
    decimals: POINT_DECIMALS,
    ci: TEAR_SV7.ci,
    bars: sv7.rows.map((r) => {
      const lw = r.ledoit_wolf
      const ci = lw?.ci90_annual ?? null
      return { label: costLabel(r.ticks), value: lw?.d_annual ?? null, lo: ci?.[0] ?? null, hi: ci?.[1] ?? null, ...(typeof lw?.n === 'number' ? { n: lw.n } : {}) }
    }),
  }
}

export interface Sv7TableRow {
  readonly id: string
  readonly label: string
  /** One display value per cost, in the order of the columns. */
  readonly values: readonly string[]
}

export interface Sv7Section {
  readonly id: 'headline' | 'lw' | 'memmel' | 'provenance'
  /** The band over the section; the headline has none. */
  readonly title: string | null
  readonly rows: readonly Sv7TableRow[]
}

export interface Sv7Table {
  readonly columns: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly sections: readonly Sv7Section[]
}

const R = TEAR_SV7.rows

const signed = (value: number | null | undefined, decimals: number) => formatNumber(value, decimals, { signed: true })
const pValue = (value: number | null | undefined) => (typeof value === 'number' ? formatP(value) : MISSING)
const count = (value: number | null | undefined) => formatNumber(value, 0, { thousands: true })

/** Every measure per cost, costs across (the rows of the model become columns), in the stats table's bands. */
export function sv7Table(sv7: Sv7): Sv7Table {
  const line = (id: string, label: string, value: (r: Sv7Row) => string): Sv7TableRow => ({ id, label, values: sv7.rows.map(value) })
  return {
    columns: sv7.rows.map((r) => ({ id: r.cost, label: costLabel(r.ticks) })),
    sections: [
      { id: 'headline', title: null, rows: [line('headline', R.headline, (r) => signed(r.sharpe_difference, POINT_DECIMALS))] },
      {
        id: 'lw',
        title: TEAR_SV7.bands.lw,
        rows: [
          line('point', R.point, (r) => signed(r.ledoit_wolf?.d_annual, POINT_DECIMALS)),
          line('se', R.se, (r) => formatNumber(r.ledoit_wolf?.se_annual, POINT_DECIMALS)),
          line('lo', R.lo, (r) => signed(r.ledoit_wolf?.ci90_annual?.[0], INTERVAL_DECIMALS)),
          line('hi', R.hi, (r) => signed(r.ledoit_wolf?.ci90_annual?.[1], INTERVAL_DECIMALS)),
          line('lwP', R.lwP, (r) => pValue(r.ledoit_wolf?.p_one_sided)),
        ],
      },
      {
        id: 'memmel',
        title: TEAR_SV7.bands.memmel,
        rows: [
          line('z', R.z, (r) => signed(r.memmel?.z, STAT_DECIMALS)),
          line('rho', R.rho, (r) => formatNumber(r.memmel?.rho, STAT_DECIMALS)),
          line('memmelP', R.memmelP, (r) => pValue(r.memmel?.p_one_sided)),
        ],
      },
      {
        id: 'provenance',
        title: TEAR_SV7.bands.provenance,
        rows: [
          line('block', R.block, (r) => count(r.ledoit_wolf?.block)),
          line('reps', R.reps, (r) => count(r.ledoit_wolf?.reps)),
          line('seed', R.seed, (r) => (typeof r.ledoit_wolf?.seed === 'number' ? String(r.ledoit_wolf.seed) : MISSING)),
          line('n', R.n, (r) => count(r.ledoit_wolf?.n)),
        ],
      },
    ],
  }
}

/** The entries left out, said under the card when some were. */
export function sv7Notes(sv7: Sv7): string[] {
  if (sv7.dropped === 0) return []
  return [sv7.dropped === 1 ? TEAR_SV7.droppedOne : fillCopy(TEAR_SV7.dropped, { n: sv7.dropped })]
}

/** What RET says in place of the card when there is no row to draw; null when there is one. */
export function sv7Empty(sv7: Sv7): string | null {
  if (sv7.rows.length > 0) return null
  if (sv7.dropped === 0) return TEAR_SV7.notRecorded
  return sv7.dropped === 1 ? TEAR_SV7.allDroppedOne : fillCopy(TEAR_SV7.allDropped, { n: sv7.dropped })
}
