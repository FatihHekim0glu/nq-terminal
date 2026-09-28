// HOME [B] (look spec 7.1, UI_SPEC section 7, ARCHITECTURE section 4 HomePanel): what the equity panel
// of the launchpad shows, as pure functions of the API body. Values are the API's; the only change is
// a fraction of K (or of the account) shown in percent (times 100, with a % unit). Every tile names its
// basis and unit; the tag is the API's ([POST HOC]: the terminal computed it, descriptive only).
import type { Schemas } from '../../api/types'
import type { SummaryDrawdown } from '../../charts/ChartA11ySummary'
import type { LineStackPane, LineStackSeries } from '../../charts/LineStack.types'
import type { ResolvedContext } from '../../commands/types'
import { HOME_EQ } from '../../copy/home'
import { fillCopy } from '../../copy/workspace'
import type { Kpi } from '../../tiles/KpiTile'
import { shortUnit, summaryDrawdown, toDisplay } from '../tear/tearFormat'

export type HomePanel = Schemas['HomePanel']

export interface HomeTarget {
  readonly kind: 'hypothesis' | 'run'
  readonly name: string
}

export interface HomeTile {
  readonly kpi: Kpi
  readonly decimals: number
  readonly signed: boolean
  readonly description: string
  /** The API's own unit, before shortUnit() shortens `kpi.unit` for the tile face (G08): the popover
   * states this one, so a shortened or dropped tile-face unit is never all a reader can see. */
  readonly unit?: string
}

export interface HomeStack {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
}

type Values = ReadonlyArray<number | null>

const RATIO_DECIMALS = 2
const PERCENT_DECIMALS = 1
const MONEY_DECIMALS = 2
const K_DECIMALS = 3
const ACCOUNT_DECIMALS = 0

/** The panel endpoint a link-group context reads: hypotheses and runs only. */
export function homeTarget(context: ResolvedContext | null): HomeTarget | null {
  if (!context || context.value.trim() === '') return null
  if (context.kind === 'hypothesis' || context.kind === 'run') return { kind: context.kind, name: context.value }
  return null
}

const per = (p: HomePanel) => HOME_EQ.per[p.rolling_unit]
const one = (p: HomePanel) => HOME_EQ.perOne[p.rolling_unit]

// Fields the Phase 6 and 7 merge added to HomePanel. A backend started before it serves none of them,
// and the panel must still work until that backend restarts: each is read through `merged`.
type MergeFields = Partial<Pick<HomePanel, 'alpha' | 'drawdown_unit' | 'rolling_unit_label'>>
const merged = (p: HomePanel): MergeFields => p as MergeFields

/** The drawdown unit as the API names it; from an older backend, the tear sheet's wording for the basis. */
export function drawdownUnit(p: HomePanel): string {
  const served = merged(p).drawdown_unit
  if (served) return served
  if (!p.on_capital) return fillCopy(HOME_EQ.drawdownUnitOlder.sum, { unit: p.unit })
  return HOME_EQ.drawdownUnitOlder[p.basis]
}

/** The unit of a cumulative one-contract figure: the per-period unit without "per session". */
function cumulativeUnit(unit: string): string {
  return unit.replace(/ per (session|month)\b/, '')
}

const percent = (v: number | null): number | null => (v === null ? null : v * 100)

function kpi(p: HomePanel, key: string, label: string, value: number | null, unit: string, note: string | null = null): Kpi {
  return { key, label, value, unit, basis: p.basis, tag: p.tag, note }
}

function drawdownTile(p: HomePanel, key: string, label: string, value: number | null, bench: boolean): HomeTile {
  const noBench = bench && p.bench_label === null ? HOME_EQ.describe.benchSharpeNone : null
  const unit = drawdownUnit(p)
  const own = p.on_capital ? fillCopy(HOME_EQ.describe.maxDdPercent, { unit }) : fillCopy(HOME_EQ.describe.maxDd, { unit })
  const description = bench && p.bench_label ? `${fillCopy(HOME_EQ.describe.benchMaxDd, { bench: p.bench_label })} ${own}` : own
  return {
    kpi: kpi(p, key, label, p.on_capital ? percent(value) : value, p.on_capital ? '%' : cumulativeUnit(p.unit), noBench),
    decimals: p.on_capital ? PERCENT_DECIMALS : MONEY_DECIMALS,
    signed: false,
    description,
  }
}

/** The tear sheet's two alpha tiles as the API serves them: the value in display units (as the tear sheet
 * shows it), the API's key, label, basis, tag and note, and its full unit in the description. */
function alphaTiles(p: HomePanel): HomeTile[] {
  return (merged(p).alpha ?? []).map((a) => ({
    kpi: { ...a, value: toDisplay(a.value, a.unit), unit: shortUnit(a.unit) },
    decimals: RATIO_DECIMALS,
    signed: a.key === 'alpha_annual',
    description: fillCopy(HOME_EQ.describe.alpha, { label: a.label, unit: a.unit }),
    unit: a.unit,
  }))
}

/** Sharpe, benchmark Sharpe, max drawdown, benchmark max drawdown, alpha and alpha t, and the row count. */
export function homeTiles(p: HomePanel): HomeTile[] {
  const t = HOME_EQ.tiles
  const d = HOME_EQ.describe
  const ratioUnit = merged(p).rolling_unit_label
  const sharpeBase = fillCopy(d.sharpe, { p: p.periods_per_year })
  const sharpeText = ratioUnit ? `${sharpeBase} ${fillCopy(d.unit, { unit: ratioUnit })}` : sharpeBase
  const ratio = shortUnit(ratioUnit ?? 'ratio')
  const noBench = p.bench_label === null ? d.benchSharpeNone : null
  const benchText = p.bench_label ? fillCopy(d.benchSharpe, { bench: p.bench_label }) : d.benchSharpeNone
  return [
    { kpi: kpi(p, 'sharpe', t.sharpe, p.sharpe, ratio), decimals: RATIO_DECIMALS, signed: false, description: sharpeText },
    { kpi: kpi(p, 'bench_sharpe', t.benchSharpe, p.bench_sharpe, ratio, noBench), decimals: RATIO_DECIMALS, signed: false, description: `${benchText} ${sharpeText}` },
    drawdownTile(p, 'max_drawdown', t.maxDd, p.max_drawdown, false),
    drawdownTile(p, 'bench_max_drawdown', t.benchMaxDd, p.bench_max_drawdown, true),
    ...alphaTiles(p),
    {
      kpi: kpi(p, 'n', t.sessions, p.n, HOME_EQ.unitCount),
      decimals: 0,
      signed: false,
      description: fillCopy(d.sessions, { per: per(p), first: p.first, last: p.last }),
    },
  ]
}

function series(name: string, style: LineStackSeries['style'], values: Values | null): LineStackSeries[] {
  return values ? [{ name, style, values }] : []
}

function equityDecimals(p: HomePanel): number {
  if (!p.on_capital) return MONEY_DECIMALS
  return p.basis === 'A' ? K_DECIMALS : ACCOUNT_DECIMALS
}

/** The API's max drawdown and basis for an equity pane's accessible name (never derived from the curve). */
export function panelDrawdown(p: HomePanel): SummaryDrawdown | undefined {
  return summaryDrawdown(p.max_drawdown, drawdownUnit(p), p.basis)
}

/**
 * The three panes: equity against the benchmark, underwater, rolling Sharpe over the long window. A
 * rolling pane with no value (a series shorter than the window) is left out, so the other two get its
 * room; homeNotes says why it is missing.
 */
export function homeStack(p: HomePanel): HomeStack {
  const dd = panelDrawdown(p)
  const name = p.context.name
  const s = HOME_EQ.series
  const asPercent = (v: Values | null) => (v && p.on_capital ? v.map(percent) : v)
  const panes: LineStackPane[] = [
    {
      id: 'equity',
      series: [...series(fillCopy(s.equity, { name }), 'primary', p.equity), ...series(s.bench, 'benchmark', p.bench_equity)],
      weight: 3,
      zero: 'white',
      decimals: equityDecimals(p),
      logAllowed: p.on_capital,
      ...(dd ? { summaryDrawdown: dd } : {}),
    },
    {
      id: 'underwater',
      series: [...series(fillCopy(s.underwater, { name }), 'underwater', asPercent(p.underwater)), ...series(s.benchUnderwater, 'benchmark', asPercent(p.bench_underwater))],
      weight: 1.5,
      zero: 'white',
      decimals: p.on_capital ? PERCENT_DECIMALS : MONEY_DECIMALS,
      unit: p.on_capital ? '%' : '',
    },
  ]
  if (p.rolling_sharpe.some((v) => v !== null)) {
    panes.push({
      id: 'rolling',
      series: series(fillCopy(s.rolling, { window: p.rolling_window, one: one(p) }), 'rollLong', p.rolling_sharpe),
      weight: 1.5,
      zero: 'grey',
      decimals: RATIO_DECIMALS,
      signed: true,
    })
  }
  return { title: fillCopy(HOME_EQ.chartTitle, { name }), t: p.t, panes }
}

/** The basis, unit, window, benchmark, dropped rows and an empty rolling pane, in words. */
export function homeNotes(p: HomePanel): string[] {
  const notes = [
    fillCopy(HOME_EQ.basis, { basis: p.basis, basisLabel: p.basis_label, unit: p.unit, equityUnit: p.equity_unit }),
    fillCopy(HOME_EQ.window, { n: p.n, per: per(p), first: p.first, last: p.last }),
    p.bench_label ? fillCopy(HOME_EQ.bench, { bench: p.bench_label }) : HOME_EQ.noBench,
  ]
  if (p.dropped.length > 0) notes.push(fillCopy(HOME_EQ.dropped, { list: p.dropped.join(', ') }))
  if (p.rolling_sharpe.every((v) => v === null)) {
    notes.push(fillCopy(HOME_EQ.rollingEmpty, { window: p.rolling_window, one: one(p), per: per(p), n: p.n }))
  }
  return notes
}
