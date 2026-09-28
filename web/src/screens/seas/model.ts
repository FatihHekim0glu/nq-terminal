// SEAS model (TASKS Phase 11; ANALYTICS MV7 and C7: descriptive, [POST HOC], no p-value): pure functions from
// the API body to what the screen draws. Fractions (instrument returns, Basis A returns on capital)
// are shown in percent with 2 decimals, except an instrument's 30-minute panel, in basis points with 2 decimals
// (its bucket means are a fraction of a basis point, 0.00% at 2 decimals of a percent); USD books in USD with
// 0 decimals. Each group's bar is its mean
// with a band of plus and minus one standard error, drawn as whiskers; the grid gives the same numbers.
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import { fixed, signed } from '../../charts/echarts/format'
import { toCsv } from '../../chrome/exportCsv'
import { SEAS } from '../../copy/seas'
import { fillCopy } from '../../copy/workspace'
import type { SeasPanelId, SeasonBucket, SeasonPanel, Seasonality } from './types'

export const FIRST_YEAR = 2010
export const LAST_YEAR = 2021
export const MISSING = '--'
export const PANEL_IDS: readonly SeasPanelId[] = ['month', 'weekday', 'week_of_month', 'intraday']
export type SeasTab = SeasPanelId | 'heatmap'
export const TABS: readonly SeasTab[] = [...PANEL_IDS, 'heatmap']

const PERCENT = 100
const PERCENT_DECIMALS = 2
const BASIS_POINTS = 10000
const BASIS_POINT_DECIMALS = 2
const USD_DECIMALS = 0
const HIT_DECIMALS = 1

export interface Scale {
  readonly factor: number
  readonly unit: string
  readonly decimals: number
  readonly note: string
}


export function scaleOf(data: Pick<Seasonality, 'fraction' | 'kind' | 'unit'>, panel?: SeasPanelId): Scale {
  if (!data.fraction) return { factor: 1, unit: ' USD', decimals: USD_DECIMALS, note: SEAS.unitsUsd }
  const note = data.kind === 'hypothesis' ? SEAS.unitsCapital : SEAS.unitsPercent
  if (panel === 'intraday') return { factor: BASIS_POINTS, unit: ' bp', decimals: BASIS_POINT_DECIMALS, note }
  return { factor: PERCENT, unit: '%', decimals: PERCENT_DECIMALS, note }
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function yearOptions(): { value: string; label: string }[] {
  return Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => String(FIRST_YEAR + i)).map((y) => ({ value: y, label: y }))
}

export function panelOf(data: Seasonality, id: SeasPanelId): SeasonPanel | null {
  return data.panels.find((p) => p.id === id) ?? null
}

function measure(data: Seasonality): string {
  return data.fraction ? SEAS.measureReturn : SEAS.measurePnl
}

export function panelName(data: Seasonality, id: SeasPanelId): string {
  return fillCopy(SEAS.panelName[id], { subject: data.subject, measure: measure(data) })
}

export function ladderInput(data: Seasonality, panel: SeasonPanel): BarLadderInput {
  const s = scaleOf(data, panel.id)
  const scaled = (v: number | null) => (finite(v) ? v * s.factor : null)
  return {
    name: panelName(data, panel.id),
    unit: s.unit.trim(),
    decimals: s.decimals,
    ci: SEAS.whiskers,
    bars: panel.buckets.map((b) => ({
      label: b.label,
      value: scaled(b.mean),
      lo: finite(b.mean) && finite(b.se) ? (b.mean - b.se) * s.factor : null,
      hi: finite(b.mean) && finite(b.se) ? (b.mean + b.se) * s.factor : null,
      n: b.n,
    })),
  }
}

export interface GridRow {
  readonly id: string
  readonly label: string
  readonly n: number
  readonly mean: number | null
  readonly se: number | null
  readonly lo: number | null
  readonly hi: number | null
  readonly hit: number | null
}

export function gridRows(data: Seasonality, panel: SeasonPanel): GridRow[] {
  const f = scaleOf(data, panel.id).factor
  return panel.buckets.map((b: SeasonBucket) => {
    const band = finite(b.mean) && finite(b.se)
    return {
      id: `${panel.id}-${b.key}`,
      label: b.label,
      n: b.n,
      mean: finite(b.mean) ? b.mean * f : null,
      se: finite(b.se) ? b.se * f : null,
      lo: band ? (b.mean! - b.se!) * f : null,
      hi: band ? (b.mean! + b.se!) * f : null,
      hit: finite(b.hit_rate) ? b.hit_rate * PERCENT : null,
    }
  })
}

export function formatSigned(value: number | null, decimals: number): string {
  return finite(value) ? signed(value, decimals) : MISSING
}

export function formatPlain(value: number | null, decimals: number): string {
  return finite(value) ? fixed(value, decimals) : MISSING
}

export function formatHit(value: number | null): string {
  return finite(value) ? `${fixed(value, HIT_DECIMALS)}%` : MISSING
}

export function pickText(row: GridRow, s: Scale): string {
  if (row.n === 0) return fillCopy(SEAS.pickNone, { label: row.label })
  return fillCopy(SEAS.pick, {
    label: row.label,
    mean: `${formatSigned(row.mean, s.decimals)}${s.unit.trim() === '%' ? '%' : s.unit}`,
    se: `${formatPlain(row.se, s.decimals)}${s.unit.trim() === '%' ? '%' : s.unit}`,
    hit: formatHit(row.hit),
    n: row.n,
  })
}

/** Years newest first, months across (the MRET layout), scaled like the bars. */
export function heatInput(data: Seasonality): HeatmapInput {
  const s = scaleOf(data)
  const h = data.heatmap
  const order = h.years.map((_, i) => i).reverse()
  return {
    kind: 'mret',
    name: fillCopy(SEAS.heatName, { subject: data.subject, measure: measure(data) }),
    columns: [...h.months],
    rows: order.map((i) => String(h.years[i])),
    values: order.map((i) => (h.values[i] ?? []).map((v) => (finite(v) ? v * s.factor : null))),
    unit: s.unit.trim() === '%' ? '%' : s.unit,
    decimals: s.decimals,
  }
}

export function panelCsv(data: Seasonality, panel: SeasonPanel): string {
  const c = SEAS.cols
  const header = [c.group, c.n, `${c.mean} (${data.unit})`, `${c.se} (${data.unit})`, `${c.hit} (share)`]
  return toCsv(header, panel.buckets.map((b) => [b.label, b.n, b.mean, b.se, b.hit_rate]))
}

export function heatCsv(data: Seasonality): string {
  const h = data.heatmap
  return toCsv(['Year', ...h.months], h.years.map((y, i) => [String(y), ...(h.values[i] ?? [])]))
}

/** A hypothesis only ever offers the costs its card recorded (card.series_costs); anything else 404s. */
export function costOptions(costs: readonly number[]): { value: string; label: string }[] {
  return costs.map((n) => ({ value: String(n), label: fillCopy(SEAS.costOption, { n }) }))
}

/** The project's standard cost, 1 tick per side, when the card recorded it; else the first recorded cost, else none. */
export function defaultCost(costs: readonly number[]): number | null {
  if (costs.includes(1)) return 1
  return costs[0] ?? null
}

export function excludedText(panel: SeasonPanel): string | null {
  if (!panel.available || panel.excluded_sessions === null) return null
  const source = panel.source ?? MISSING
  return panel.excluded_sessions > 0
    ? fillCopy(SEAS.excluded, { count: panel.excluded_sessions, source })
    : fillCopy(SEAS.excludedNone, { source })
}
