// Robustness model (roadmap #4 DES robustness, slice 1 of 3; ANALYTICS_CATALOG C7): pure readers from a
// screen file (HypothesisDetail.screen) to the rows and ladders the robustness view draws. Every reader
// is total (never throws on null, {} or a malformed field) and every number it returns is === the value
// the screen file recorded: nothing here is recomputed. Readers never read a p-value leaf beside a slice
// (C7): p, p_one_sided, p_value, pvalue and every named variant a screen file records (p_x3, p_gap_le_0,
// ...) are dropped by name, not by an exact list; the terminal shows no p-value on a user-picked cut.
import type { BarLadderInput, LadderBar } from '../../charts/echarts/barLadderModel'
import { DES_ROBUSTNESS } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { decimalsFor, flattenValue } from './desModel'

export type ScreenJson = Readonly<Record<string, unknown>>

function num(o: ScreenJson | null | undefined, key: string): number | null {
  const v = o?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function text(o: ScreenJson | null | undefined, key: string): string | null {
  const v = o?.[key]
  return typeof v === 'string' ? v : null
}

function obj(v: unknown): ScreenJson | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as ScreenJson) : null
}

// --- Spec curve: the headline rule plus every pre-registered variant, 1 tick per side ------------------

export interface VariantRow {
  readonly key: string
  readonly no: number
  readonly sharpeM: number | null
  readonly sharpeBh: number | null
  readonly dsr1: number | null
  readonly dsr2: number | null
  readonly alphaPct1: number | null
  readonly tMin1: number | null
  readonly b1: number | null
  readonly turnover: number | null
  readonly tradeDays: number | null
  readonly nEval: number | null
  readonly t0: string | null
}

export interface SpecCurve {
  readonly headline: VariantRow | null
  readonly variants: readonly VariantRow[]
  /** Variants recorded with neither dsr_1 nor alpha_annual_pct_1 finite: read, but left out and counted. */
  readonly dropped: number
}

function variantRow(key: string, no: number, o: ScreenJson): VariantRow {
  return {
    key,
    no,
    sharpeM: num(o, 'sharpe_m_1'),
    sharpeBh: num(o, 'sharpe_bh_1'),
    dsr1: num(o, 'dsr_1'),
    dsr2: num(o, 'dsr_2'),
    alphaPct1: num(o, 'alpha_annual_pct_1'),
    tMin1: num(o, 't_min_1'),
    b1: num(o, 'b_1'),
    turnover: num(o, 'turnover'),
    tradeDays: num(o, 'trade_days'),
    nEval: num(o, 'n_eval'),
    t0: text(o, 't0'),
  }
}

function headlineRow(screen: ScreenJson): VariantRow | null {
  const headline = obj(screen['headline'])
  const h1 = headline ? obj(headline['1tick']) : null
  if (!h1) return null
  const h2 = headline ? obj(headline['2tick']) : null
  const alpha = obj(h1['alpha'])
  return {
    key: 'headline',
    no: 0,
    sharpeM: num(h1, 'sharpe_m'),
    sharpeBh: num(h1, 'sharpe_bh'),
    dsr1: num(h1, 'dsr'),
    dsr2: h2 ? num(h2, 'dsr') : null,
    alphaPct1: alpha ? num(alpha, 'alpha_annual_pct') : null,
    tMin1: alpha ? num(alpha, 't_min') : null,
    b1: alpha ? num(alpha, 'b') : null,
    turnover: null,
    tradeDays: null,
    nEval: num(screen, 'n_eval'),
    t0: text(screen, 't0'),
  }
}

/** The headline rule and every pre-registered variant, in file order; null when the screen has none. */
export function readSpecCurve(screen: ScreenJson | null | undefined): SpecCurve | null {
  const variantsObj = screen ? obj(screen['variants']) : null
  if (!screen || !variantsObj) return null
  const headline = headlineRow(screen)
  const variants: VariantRow[] = []
  let dropped = 0
  let no = 0
  for (const [key, value] of Object.entries(variantsObj)) {
    const o = obj(value)
    if (!o || (num(o, 'dsr_1') === null && num(o, 'alpha_annual_pct_1') === null)) {
      dropped += 1
      continue
    }
    no += 1
    variants.push(variantRow(key, no, o))
  }
  return { headline, variants, dropped }
}

function curveRows(curve: SpecCurve | null): readonly VariantRow[] {
  if (!curve) return []
  return curve.headline ? [curve.headline, ...curve.variants] : curve.variants
}

type SpecMeasure = 'dsr1' | 'alphaPct1'

/** The spec curve as a bar ladder: the headline row (emphasised) plus every variant, sorted ascending. */
export function specCurveLadder(curve: SpecCurve | null, measure: SpecMeasure, name: string): BarLadderInput {
  const withValue = curveRows(curve).filter((r) => r[measure] !== null)
  const sorted = [...withValue].sort((a, b) => (a[measure] as number) - (b[measure] as number))
  const bars: LadderBar[] = sorted.map((r) => ({
    label: r.key === 'headline' ? DES_ROBUSTNESS.headlineShort : String(r.no),
    value: r[measure],
    ...(r.key === 'headline' ? { emphasis: true } : {}),
  }))
  return {
    name: fillCopy(measure === 'dsr1' ? DES_ROBUSTNESS.dsrName : DES_ROBUSTNESS.alphaName, { name }),
    unit: measure === 'alphaPct1' ? '%' : '',
    decimals: decimalsFor(sorted.map((r) => r[measure])),
    bars,
  }
}

/** How many pre-registered variants (never the headline) have a negative measure at 1 tick, of the
 * variants that record the measure. */
export function negativeCount(curve: SpecCurve | null, measure: SpecMeasure = 'dsr1'): { negative: number; of: number } {
  if (!curve) return { negative: 0, of: 0 }
  const recorded = curve.variants.filter((v) => v[measure] !== null)
  const negative = recorded.filter((v) => (v[measure] as number) < 0).length
  return { negative, of: recorded.length }
}

// --- Exposure-shift placebo -------------------------------------------------------------------------

export interface PlaceboQuantile {
  readonly q: number
  readonly value: number
}

export interface Placebo {
  readonly actual: number | null
  readonly percentile: number | null
  readonly draws: number | null
  readonly seed: number | null
  readonly minShift: number | null
  readonly quantiles: readonly PlaceboQuantile[]
}

/** The exposure-shift placebo: actual alpha, its percentile among shifted draws, and the quantile rail. */
export function readPlacebo(screen: ScreenJson | null | undefined): Placebo | null {
  const placebo = screen ? obj(screen['placebo']) : null
  if (!placebo) return null
  const quantilesObj = obj(placebo['placebo_a_annual_pct_quantiles']) ?? {}
  const quantiles = Object.entries(quantilesObj)
    .map(([k, v]): PlaceboQuantile | null => {
      const q = Number(k)
      return Number.isFinite(q) && typeof v === 'number' && Number.isFinite(v) ? { q, value: v } : null
    })
    .filter((q): q is PlaceboQuantile => q !== null)
    .sort((a, b) => a.q - b.q)
  return {
    actual: num(placebo, 'actual_a_annual_pct'),
    percentile: num(placebo, 'percentile'),
    draws: num(placebo, 'draws'),
    seed: num(placebo, 'seed'),
    minShift: num(placebo, 'min_shift'),
    quantiles,
  }
}

/** The placebo quantile rail as a bar ladder, the actual result emphasised with a reference line at it. */
export function placeboLadder(p: Placebo | null, name: string): BarLadderInput {
  const quantileBars: LadderBar[] = (p?.quantiles ?? []).map((q) => ({
    label: fillCopy(DES_ROBUSTNESS.placeboQ, { q: q.q * 100 }),
    value: q.value,
  }))
  const actualBar: LadderBar[] = p && p.actual !== null ? [{ label: DES_ROBUSTNESS.actual, value: p.actual, emphasis: true }] : []
  return {
    name: fillCopy(DES_ROBUSTNESS.placeboName, { name }),
    unit: '%',
    decimals: decimalsFor([...(p?.quantiles ?? []).map((q) => q.value), p?.actual]),
    bars: [...quantileBars, ...actualBar],
    ...(p && p.actual !== null ? { reference: { value: p.actual, label: DES_ROBUSTNESS.actual } } : {}),
  }
}

// --- Stability: leave one year out, and per year --------------------------------------------------------

export interface YearRow {
  readonly year: string
  readonly alphaPct: number | null
  readonly tMin: number | null
  readonly n: number | null
  readonly b: number | null
}

export interface Stability {
  readonly loyo: readonly YearRow[]
  readonly perYear: readonly YearRow[]
}

function yearRows(section: unknown): YearRow[] {
  const o = obj(section)
  if (!o) return []
  return Object.keys(o)
    .sort()
    .map((year) => {
      const row = obj(o[year])
      return { year, alphaPct: num(row, 'alpha_annual_pct'), tMin: num(row, 't_min'), n: num(row, 'n'), b: num(row, 'b') }
    })
}

/** Leave-one-year-out and per-year rows, year keys sorted ascending; null when the screen has neither. */
export function readStability(screen: ScreenJson | null | undefined): Stability | null {
  const stability = screen ? obj(screen['stability']) : null
  if (!stability) return null
  return { loyo: yearRows(stability['leave_one_year_out']), perYear: yearRows(stability['per_year']) }
}

/** A year-keyed section as a bar ladder (n carried for the table view); an optional reference line. */
export function yearLadder(
  rows: readonly YearRow[],
  name: string,
  reference?: { readonly value: number; readonly label: string },
): BarLadderInput {
  const bars: LadderBar[] = rows.map((r) => ({ label: r.year, value: r.alphaPct, ...(r.n === null ? {} : { n: r.n }) }))
  return {
    name,
    unit: '%',
    decimals: decimalsFor(rows.map((r) => r.alphaPct)),
    bars,
    ...(reference ? { reference } : {}),
  }
}

// --- Volatility quintiles and tails --------------------------------------------------------------------

export interface QuintileRow {
  readonly quintile: number | null
  readonly n: number | null
  readonly sigma2Median: number | null
  readonly meanPct: number | null
  readonly sdPct: number | null
  readonly meanOverVar: number | null
}

/** The recorded volatility quintiles, in file order; null when the screen records none. */
export function readQuintiles(screen: ScreenJson | null | undefined): readonly QuintileRow[] | null {
  const arr = screen?.['quintiles']
  if (!Array.isArray(arr)) return null
  return arr.map((v): QuintileRow => {
    const o = obj(v)
    return {
      quintile: num(o, 'quintile'),
      n: num(o, 'n'),
      sigma2Median: num(o, 'sigma2_median'),
      meanPct: num(o, 'mean_pct'),
      sdPct: num(o, 'sd_pct'),
      meanOverVar: num(o, 'mean_over_var'),
    }
  })
}

export interface TailRow {
  readonly measure: string
  readonly managed: number | null
  readonly bh: number | null
}

/** Tail measures, managed against buy and hold, in tails.managed's own key order; null when absent. */
export function readTails(screen: ScreenJson | null | undefined): readonly TailRow[] | null {
  const tails = screen ? obj(screen['tails']) : null
  const managed = tails ? obj(tails['managed']) : null
  if (!managed) return null
  const bh = tails ? obj(tails['bh']) : null
  return Object.keys(managed).map((measure) => ({ measure, managed: num(managed, measure), bh: num(bh, measure) }))
}

// --- Recorded subsets (C7: never p_one_sided) ----------------------------------------------------------

export interface SubsetRow {
  readonly key: string
  readonly n: number | null
  readonly mean: number | null
  readonly median: number | null
  readonly sd: number | null
  readonly t: number | null
  readonly hitRate: number | null
  readonly total: number | null
}

/** screen.subsets entries that are objects with a numeric or null n (a list, such as long_gap_list, is
 * skipped); never reads p_one_sided (C7). Null when the screen records no subsets. */
export function readSubsets(screen: ScreenJson | null | undefined): readonly SubsetRow[] | null {
  const subsets = screen ? obj(screen['subsets']) : null
  if (!subsets) return null
  const rows: SubsetRow[] = []
  for (const [key, value] of Object.entries(subsets)) {
    const o = obj(value)
    if (!o) continue
    const n = o['n']
    if (n !== null && typeof n !== 'number') continue
    rows.push({
      key,
      n: num(o, 'n'),
      mean: num(o, 'mean'),
      median: num(o, 'median'),
      sd: num(o, 'sd'),
      t: num(o, 't'),
      hitRate: num(o, 'hit_rate'),
      total: num(o, 'total'),
    })
  }
  return rows
}

// --- Other recorded sections, generically -------------------------------------------------------------

const HANDLED_KEYS: ReadonlySet<string> = new Set(['variants', 'placebo', 'stability', 'quintiles', 'tails', 'subsets'])

const EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  'name', 'spec_sha256', 'serve', 'headline', 'pass_checks', 'verdict', 'verdict_if_valid', 'validity',
  'diagnostics', 'multiple_testing', 'reported', 'cost_ladder', 'blocks_1tick', 'identity_check', 'skipped',
  'skipped_reasons', 'unrepairable_day_nights', 't0', 't0_literal', 'last', 'n_eval', 'years', 'n_nights',
  'late_exits', 'intraday_skipped', 'baseline_line',
])

/** Matches a p-value leaf by its last key or path part: p, p_one_sided, p_value, pvalue, and every
 * p-value variant recorded in a screen file (p_x3, p_x4, p_x9, p_x10, p_gap_le_0, ...). */
const P_LEAF = /^p(?:_|$)|pval/i

/** A deep copy of value with every object key matching P_LEAF dropped, recursing into objects and
 * arrays (C7 defence in depth: no p-value leaf, named or not, ever reaches a generic section). */
function withoutPLeaves(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPLeaves)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (P_LEAF.test(key)) continue
      out[key] = withoutPLeaves(v)
    }
    return out
  }
  return value
}

function hasNumericLeaf(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasNumericLeaf)
  if (value !== null && typeof value === 'object') return Object.values(value).some(hasNumericLeaf)
  return false
}

export interface GenericSection {
  readonly key: string
  readonly rows: ReadonlyArray<readonly [string, string]>
  /** Rows recorded past maxRows, not returned. */
  readonly more: number
}

/** Every other top-level object the screen records (not the sections above, not internal bookkeeping),
 * its p leaves dropped by name before flattening (C7, any p_* or *pval* key, not just the four exact
 * names), capped at `max` sections of `maxRows` rows each, file order. A section with no numeric leaf
 * left once its p leaves are gone is skipped. */
export function genericSections(screen: ScreenJson | null | undefined, max = 8, maxRows = 60): readonly GenericSection[] {
  if (!screen) return []
  const sections: GenericSection[] = []
  for (const [key, value] of Object.entries(screen)) {
    if (sections.length >= max) break
    if (HANDLED_KEYS.has(key) || EXCLUDED_KEYS.has(key)) continue
    const o = obj(value)
    if (!o) continue
    const kept = withoutPLeaves(o)
    if (!hasNumericLeaf(kept)) continue
    const rows = flattenValue(kept)
    if (rows.length === 0) continue
    sections.push({ key, rows: rows.slice(0, maxRows), more: Math.max(0, rows.length - maxRows) })
  }
  return sections
}

// --- Everything together --------------------------------------------------------------------------------

export interface Robustness {
  readonly specCurve: SpecCurve | null
  readonly placebo: Placebo | null
  readonly stability: Stability | null
  readonly quintiles: readonly QuintileRow[] | null
  readonly tails: readonly TailRow[] | null
  readonly subsets: readonly SubsetRow[] | null
  readonly generic: readonly GenericSection[]
}

/** Every robustness section a screen file may carry, read once. Never throws; never recomputes. */
export function readRobustness(screen: ScreenJson | null | undefined): Robustness {
  return {
    specCurve: readSpecCurve(screen),
    placebo: readPlacebo(screen),
    stability: readStability(screen),
    quintiles: readQuintiles(screen),
    tails: readTails(screen),
    subsets: readSubsets(screen),
    generic: genericSections(screen),
  }
}
