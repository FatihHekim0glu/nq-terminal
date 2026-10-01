// The P2 risk extras as display rows and tiles (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5). Pure functions
// over the API's RiskExtras body: values are the API's, a fraction shown times 100, and nothing new is computed. The
// modified ES is greyed wherever it is not defined (outside the Cornish-Fisher domain, or below zero), and the row
// then shows the historical CVaR (RK1) with the reason. No p-value appears anywhere here.
import { RISK_EXTRAS } from '../../copy/riskExtras'
import { fillCopy } from '../../copy/workspace'
import { TEAR } from '../../copy/tear'
import { formatNumber, formatValue, shortUnit, toDisplay } from '../tear/tearFormat'
import type { TileSpec } from '../tear/tearKpis'
import type { CornishFisherEsLevel, RiskExtrasView } from './types'

const DAILY = 252
const RATIO_DECIMALS = 2
const MOMENT_DECIMALS = 4

function per(view: RiskExtrasView): string {
  return view.periods_per_year === DAILY ? RISK_EXTRAS.periods.sessions : RISK_EXTRAS.periods.months
}

function tile(kpi: RiskExtrasView['drawdown_tiles'][number], description: string): TileSpec {
  return {
    kpi: { ...kpi, value: toDisplay(kpi.value, kpi.unit), unit: shortUnit(kpi.unit) },
    decimals: RATIO_DECIMALS,
    signed: false,
    description: `${description} ${fillCopy(TEAR.kpiDescription, { label: kpi.label, unit: kpi.unit, tag: kpi.tag })}`,
    ci: null,
    unit: kpi.unit,
  }
}

/** PF11: the ulcer index (in the drawdown unit) and the recovery factor, for the RET tab. */
export function drawdownTiles(view: RiskExtrasView): TileSpec[] {
  const n = formatNumber(view.n, 0, { thousands: true })
  return view.drawdown_tiles.map((kpi) => {
    const text = kpi.key === 'ulcer_index'
      ? fillCopy(RISK_EXTRAS.drawdown.ulcer, { n, per: per(view), unit: kpi.unit })
      : fillCopy(RISK_EXTRAS.drawdown.recovery, { unit: kpi.unit })
    return tile(kpi, text)
  })
}

export interface EsRow {
  readonly level: string
  readonly gaussian: string
  readonly historical: string
  readonly modified: string
  readonly raw: string
  readonly value: string
  /** The modified ES is not defined here: the shown value is the historical CVaR and the Gaussian ES is greyed. */
  readonly greyed: boolean
  readonly used: string
  readonly method: string
}

function used(level: CornishFisherEsLevel): string {
  if (!level.in_domain) return RISK_EXTRAS.es.usedHistorical
  if (level.modified === null) return RISK_EXTRAS.es.usedInverse
  return level.floored ? RISK_EXTRAS.es.usedFloored : RISK_EXTRAS.es.usedModified
}

/** RK4 at 95% and 99%, a positive loss in the series' unit. */
export function esRows(view: RiskExtrasView): EsRow[] {
  const es = view.modified_es
  const v = (x: number | null) => formatValue(x, es.unit, RATIO_DECIMALS)
  return es.levels.map((l) => {
    const defined = l.in_domain && l.modified !== null
    return {
      level: `${l.level}%`,
      gaussian: v(l.gaussian),
      historical: v(l.historical),
      modified: defined ? v(l.modified) : RISK_EXTRAS.es.notDefined,
      raw: v(l.raw_expansion),
      value: v(l.value),
      greyed: !defined,
      used: used(l),
      method: l.method,
    }
  })
}

export function esMoments(view: RiskExtrasView): string {
  const es = view.modified_es
  return fillCopy(RISK_EXTRAS.es.moments, {
    mean: formatValue(es.mean, es.unit, MOMENT_DECIMALS, true),
    sigma: formatValue(es.sigma, es.unit, MOMENT_DECIMALS),
    skew: formatNumber(es.skew, RATIO_DECIMALS),
    kurt: formatNumber(es.excess_kurtosis, RATIO_DECIMALS),
  })
}

/** BR5 for the RR tab: the ratio, with its CAGR, beta and benchmark in the popover. */
export function treynorTile(view: RiskExtrasView): TileSpec {
  const t = view.treynor
  const text = fillCopy(RISK_EXTRAS.treynor.description, {
    cagr: formatValue(t.cagr, RISK_EXTRAS.treynor.cagrUnit, RATIO_DECIMALS, true),
    beta: formatNumber(t.beta, RATIO_DECIMALS),
    bench: t.bench_label ?? RISK_EXTRAS.treynor.benchFallback,
    pairs: formatNumber(t.n_pairs, 0, { thousands: true }),
    per: per(view),
  })
  return tile(t.tile, text)
}

/** The note under the Treynor tile: why it is empty, or how to read it (a negative beta, Basis A's CAGR). */
export function treynorLine(view: RiskExtrasView): string | null {
  const t = view.treynor
  if (t.note === null) return null
  return t.tile.value === null ? fillCopy(RISK_EXTRAS.treynor.none, { note: t.note }) : t.note
}
