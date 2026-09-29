// The power table on MT (ANALYTICS_CATALOG SV9): for every registered trial of the served Deflated Sharpe view, the
// smallest annual Sharpe ratio a one-sided test detects with 80% power (the MDE) at the family alpha and at alpha / k,
// the served Sharpe over that MDE, and the power at a fixed reference Sharpe of 0.50. [POST HOC], Basis A, computed in
// the browser by quant/power.ts (pinned to scipy by qa/crosscheck/p12_power.py); nothing here is a served number and
// none of it is a verdict.
//
// The reference Sharpe is deliberately a constant and not the trial's own Sharpe: power at the observed effect is a
// transform of the p-value and says nothing the p-value does not. A fixed 0.50 asks the useful question instead, how
// likely a test of this length is to notice a modest, plausible edge.
import { POWER } from '../../copy/power'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import { minimumDetectableSharpe, powerAtSharpe, trackYears } from '../../quant/power'
import { formatNumber } from '../tear/tearFormat'
import type { DeflatedView } from './deflatedModel'

/** Every figure here is computed by the terminal, so it is always [POST HOC]. */
export const POWER_TAG = SPEC.postHoc
/** The probability the MDE is stated at: a test that finds a real edge of the MDE size four times in five. */
export const POWER_TARGET = 0.8
/** The annual Sharpe ratio every power figure is read at. Fixed, never the trial's own and never user-picked. */
export const REFERENCE_SHARPE = 0.5

/** The registered family: the single-test alpha and the number of registered hypotheses k (alpha / k is Bonferroni). */
export interface PowerFamily {
  readonly alpha: number
  readonly k: number
}

/** A number, or null for NaN, an infinity or a missing value: the table prints null as `--`. */
type Figure = number | null

export interface PowerRow {
  readonly name: string
  readonly kind: string
  /** Observations per year (252 sessions, 12 months), as served. */
  readonly periods: number
  /** Observations, as served. */
  readonly n: number
  /** n / periods. */
  readonly years: Figure
  /** The served annual Sharpe ratio. */
  readonly sharpe: Figure
  /** MDE at the family alpha, 80% power. */
  readonly mdeNominal: Figure
  /** MDE at alpha / k, 80% power. */
  readonly mdeFamily: Figure
  /** Served Sharpe over the alpha / k MDE. */
  readonly ratio: Figure
  /** Power at REFERENCE_SHARPE, at the family alpha. */
  readonly powerNominal: Figure
  /** Power at REFERENCE_SHARPE, at alpha / k. */
  readonly powerFamily: Figure
}

export interface PowerView {
  readonly tag: typeof POWER_TAG
  readonly basis: 'A'
  readonly family: PowerFamily
  /** alpha / k, or null when k is not a positive number. */
  readonly alphaFamily: Figure
  readonly rows: readonly PowerRow[]
}

export type PowerCol = keyof typeof POWER.cols

const DECIMALS = 2
const PERCENT = 100
/** Significant digits of an alpha in the summary line: 0.05 stays 0.05, 0.05 / 21 reads 0.00238. */
const ALPHA_DIGITS = 3

function figure(value: number | null | undefined): Figure {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function familyAlpha(family: PowerFamily): Figure {
  return Number.isFinite(family.k) && family.k > 0 ? figure(family.alpha / family.k) : null
}

/** The MDE and power of one trial at one alpha; both null when the alpha is not usable. */
function atAlpha(row: DeflatedView['rows'][number], alpha: Figure): { readonly mde: Figure; readonly power: Figure } {
  if (alpha === null) return { mde: null, power: null }
  return {
    mde: figure(minimumDetectableSharpe(row.n, row.periods, alpha, POWER_TARGET)),
    power: figure(powerAtSharpe(REFERENCE_SHARPE, row.n, row.periods, alpha)),
  }
}

function ratioOf(sharpe: Figure, mdeFamily: Figure): Figure {
  return sharpe === null || mdeFamily === null || mdeFamily <= 0 ? null : figure(sharpe / mdeFamily)
}

/** One PowerRow per registered trial of the served view, in the served order. */
export function powerView(view: DeflatedView, family: PowerFamily): PowerView {
  const alphaFamily = familyAlpha(family)
  const rows = view.rows.map((row): PowerRow => {
    const nominal = atAlpha(row, figure(family.alpha))
    const wide = atAlpha(row, alphaFamily)
    const sharpe = figure(row.annual_sharpe)
    return {
      name: row.name,
      kind: row.kind,
      periods: row.periods,
      n: row.n,
      years: figure(trackYears(row.n, row.periods)),
      sharpe,
      mdeNominal: nominal.mde,
      mdeFamily: wide.mde,
      ratio: ratioOf(sharpe, wide.mde),
      powerNominal: nominal.power,
      powerFamily: wide.power,
    }
  })
  return { tag: POWER_TAG, basis: 'A', family, alphaFamily, rows }
}

function formatFigure(value: Figure, signed = false): string {
  return formatNumber(value, DECIMALS, { signed })
}

/** An alpha at three significant digits, no exponent: 0.05, 0.00238. Missing as `--`. */
function formatAlpha(alpha: Figure): string {
  return alpha === null ? formatNumber(alpha, DECIMALS) : String(Number(alpha.toPrecision(ALPHA_DIGITS)))
}

function rangeOf(rows: readonly PowerRow[], pick: (row: PowerRow) => Figure): readonly [string, string] {
  const values = rows.map(pick).filter((v): v is number => v !== null)
  if (values.length === 0) return [formatFigure(null), formatFigure(null)]
  return [formatFigure(Math.min(...values)), formatFigure(Math.max(...values))]
}

/** The one-line summary: the MDE ranges at alpha and at alpha / k, and the years they span, over every trial. */
export function powerSummary(view: PowerView): string {
  const [nominalLow, nominalHigh] = rangeOf(view.rows, (r) => r.mdeNominal)
  const [familyLow, familyHigh] = rangeOf(view.rows, (r) => r.mdeFamily)
  const [yearsLow, yearsHigh] = rangeOf(view.rows, (r) => r.years)
  return fillCopy(POWER.summary, {
    target: `${Math.round(POWER_TARGET * PERCENT)}%`,
    nominalLow,
    nominalHigh,
    alpha: formatAlpha(figure(view.family.alpha)),
    familyLow,
    familyHigh,
    alphaK: formatAlpha(view.alphaFamily),
    k: formatNumber(view.family.k, 0),
    yearsLow,
    yearsHigh,
  })
}

/** One trial's row as text: n with thousands separators, the Sharpe signed, every other figure at 2 decimals. */
export function powerCells(row: PowerRow): Record<PowerCol, string> {
  return {
    name: row.name,
    periods: String(row.periods),
    n: formatNumber(row.n, 0, { thousands: true }),
    years: formatFigure(row.years),
    sharpe: formatFigure(row.sharpe, true),
    mdeNominal: formatFigure(row.mdeNominal),
    mdeFamily: formatFigure(row.mdeFamily),
    ratio: formatFigure(row.ratio),
    powerNominal: formatFigure(row.powerNominal),
    powerFamily: formatFigure(row.powerFamily),
  }
}

/** The column headers: the copy, with the reference Sharpe named in both power headers. */
export function powerHeaders(): Record<PowerCol, string> {
  const s = formatNumber(REFERENCE_SHARPE, DECIMALS)
  return {
    ...POWER.cols,
    powerNominal: fillCopy(POWER.cols.powerNominal, { s }),
    powerFamily: fillCopy(POWER.cols.powerFamily, { s }),
  }
}
