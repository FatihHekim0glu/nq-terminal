// DES model (TASKS 6.2; UI_SPEC section 7 "DES"; ANALYTICS_CATALOG C4, C7, RL5, EX4): pure functions
// from the API's HypothesisDetail to what the screen draws. Every number passes through unchanged; the
// only work here is formatting, labelling and choosing what to show. Blocks and the cost ladder are the
// screen JSON's own values (never recomputed), and the screen JSON's `dsr` is the Sharpe difference
// (managed minus buy and hold), so it is always labelled that way (C4).
import type { Schemas } from '../../api/types'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'

export type HypothesisCard = Schemas['HypothesisCard']
export type HypothesisDetail = Schemas['HypothesisDetail']
export type DesExtract = Schemas['DesExtract']
export type Confirmation = Schemas['Confirmation']
export type SealedItem = Schemas['SealedItem']
export type PassCheck = Schemas['PassCheck']
export type Kpi = Schemas['Kpi']

export const MISSING = '--'
const SHA_KEEP = 4
const MIN_DECIMALS = 2
const MAX_DECIMALS = 8
const VALUE_DECIMALS = 4
/** The cost the tear sheet opens at: 1 tick per side, the registered headline cost. */
const HEADLINE_COST = 1

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Decimals that keep two significant figures of the largest magnitude, and at least two. */
export function decimalsFor(values: ReadonlyArray<number | null | undefined>): number {
  const largest = values.reduce<number>((m, v) => (isNumber(v) ? Math.max(m, Math.abs(v)) : m), 0)
  if (largest === 0 || largest >= 1) return MIN_DECIMALS
  const decimals = 1 - Math.floor(Math.log10(largest))
  return Math.min(MAX_DECIMALS, Math.max(MIN_DECIMALS, decimals))
}

/** Fixed decimals, ASCII minus, `+` on signed positives, `--` when missing; never `-0.00`. */
export function formatNumber(value: number | null | undefined, decimals: number, signed = false): string {
  if (!isNumber(value)) return MISSING
  const text = value.toFixed(decimals)
  if (/^-0(\.0+)?$/.test(text)) return text.slice(1)
  return signed && value > 0 ? `+${text}` : text
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return MISSING
  return sha.length <= SHA_KEEP * 2 ? sha : `${sha.slice(0, SHA_KEEP)}...${sha.slice(-SHA_KEEP)}`
}

type SpecObject = Readonly<Record<string, unknown>> | null | undefined

/** The spec's frozen pass bar, verbatim: a string as it is, anything else as indented JSON. */
export function passBarText(spec: SpecObject): string | null {
  const bar = spec?.['pass_bar']
  if (bar === undefined || bar === null) return null
  return typeof bar === 'string' ? bar : JSON.stringify(bar, null, 2)
}

/** The spec's hypothesis sentence, verbatim, when it is a string. */
export function hypothesisText(spec: SpecObject): string | null {
  const text = spec?.['hypothesis']
  return typeof text === 'string' && text.trim() !== '' ? text : null
}

const COMPARATORS: Readonly<Record<string, string>> = DES.comparators
const DIGITS = /^\d+$/

/** A field name as the screen shows it: `dsr` is the Sharpe difference (C4). */
export function fieldLabel(name: string): string {
  return name.toLowerCase() === 'dsr' ? DES.dsrLabel : name
}

/** A check name read as text: `t_ge_2_5` is `t >= 2.5`, `dsr` the Sharpe difference. */
export function checkReading(name: string): string {
  const tokens = name.split('_').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    const comparator = COMPARATORS[token.toLowerCase()]
    if (comparator === undefined) {
      out.push(fieldLabel(token))
      continue
    }
    out.push(comparator)
    const whole = tokens[i + 1]
    if (whole === undefined || !DIGITS.test(whole)) continue
    const fraction = tokens[i + 2]
    const hasFraction = fraction !== undefined && DIGITS.test(fraction)
    out.push(hasFraction ? `${whole}.${fraction}` : whole)
    i += hasFraction ? 2 : 1
  }
  return out.join(' ')
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return MISSING
    if (Number.isInteger(value)) return String(value)
    return formatNumber(value, Math.max(VALUE_DECIMALS, decimalsFor([value])))
  }
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  return null
}

/** A check value as `[path, text]` pairs: a scalar is one pair with an empty path; objects flatten. */
export function flattenValue(value: unknown, path = ''): Array<readonly [string, string]> {
  if (value === null || value === undefined) return []
  const scalar = scalarText(value)
  if (scalar !== null) return [[path, scalar]]
  if (Array.isArray(value)) return value.flatMap((item, i) => flattenValue(item, path ? `${path}.${i}` : String(i)))
  if (typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const label = fieldLabel(key)
    return flattenValue(child, path ? `${path}.${label}` : label)
  })
}

export interface CheckRow {
  readonly n: number
  readonly key: string
  readonly reading: string
  readonly result: 'pass' | 'fail' | 'value'
  readonly value: ReadonlyArray<readonly [string, string]>
}

export function checkRows(checks: ReadonlyArray<PassCheck>, start: number): CheckRow[] {
  return checks.map((check, i) => ({
    n: start + i,
    key: check.name,
    reading: checkReading(check.name),
    result: check.passed === true ? 'pass' : check.passed === false ? 'fail' : 'value',
    value: flattenValue(check.value),
  }))
}

/** RL5: the block bars as the screen recorded them; null when the screen records no block extract. */
export function blocksInput(des: DesExtract, name: string): BarLadderInput | null {
  if (!des.blocks_unit || des.blocks.length === 0) return null
  return {
    name: fillCopy(DES.blocksName, { name }),
    unit: des.blocks_unit,
    decimals: decimalsFor(des.blocks.map((b) => b.value)),
    bars: des.blocks.map((b) => ({ label: b.label, value: b.value })),
  }
}

export function ticksLabel(ticks: number): string {
  return fillCopy(ticks === 1 ? DES.ladderTick : DES.ladderTicks, { n: ticks })
}

/** Where a break-even cost sits on the rungs, as a fractional category index; null off the ladder. */
function markerPosition(ticks: readonly number[], at: number): number | null {
  for (let i = 0; i < ticks.length - 1; i += 1) {
    const lo = ticks[i] ?? 0
    const hi = ticks[i + 1] ?? 0
    if (at >= lo && at <= hi && hi > lo) return i + (at - lo) / (hi - lo)
  }
  return ticks.length === 1 && ticks[0] === at ? 0 : null
}

/** EX4: the recorded cost ladder, one bar per rung, with the break-even marker when it is on the ladder. */
export function costInput(des: DesExtract, name: string): BarLadderInput | null {
  if (des.cost_ladder.length === 0) return null
  const ticks = des.cost_ladder.map((r) => r.ticks_per_side)
  const even = des.break_even_ticks_per_side
  const at = isNumber(even) ? markerPosition(ticks, even) : null
  return {
    name: fillCopy(DES.costName, { name }),
    unit: des.cost_ladder_unit ?? undefined,
    decimals: decimalsFor(des.cost_ladder.map((r) => r.value)),
    bars: des.cost_ladder.map((r) => ({ label: ticksLabel(r.ticks_per_side), value: r.value })),
    ...(at === null ? {} : { marker: { at, label: DES.breakEven } }),
  }
}

/** The break-even line under the ladder: on it, beyond it, or not recorded. */
export function breakEvenText(des: DesExtract): string {
  const even = des.break_even_ticks_per_side
  if (!isNumber(even)) return DES.breakEvenNone
  const ticks = des.cost_ladder.map((r) => r.ticks_per_side)
  const text = formatNumber(even, MIN_DECIMALS)
  return fillCopy(markerPosition(ticks, even) === null ? DES.breakEvenOff : DES.breakEvenAt, { ticks: text })
}

export interface KpiSpec {
  readonly kpi: Kpi
  readonly decimals: number
  readonly signed: boolean
  readonly description: string
}

type CardKey = 'n' | 't_stat' | 'p' | 'control_p' | 'bonferroni_p' | 'holm_p' | 'bh_q'

const TEST_FIGURES: ReadonlyArray<readonly [CardKey, string, string, number, keyof typeof DES.kpiDescription]> = [
  ['n', DES.kpi.n, DES.units.count, 0, 'n'],
  ['t_stat', DES.kpi.t, DES.units.ratio, 2, 't'],
  ['p', DES.kpi.p, DES.units.probability, 4, 'p'],
  ['control_p', DES.kpi.controlP, DES.units.probability, 4, 'controlP'],
  ['bonferroni_p', DES.kpi.bonferroni, DES.units.probability, 4, 'bonferroni'],
  ['holm_p', DES.kpi.holm, DES.units.probability, 4, 'holm'],
  ['bh_q', DES.kpi.bhq, DES.units.probability, 4, 'bhq'],
]

/** The KPI row: the headline, then n, t, p, control p, Bonferroni, Holm and BH q, all basis A. */
export function registrationKpis(card: HypothesisCard): KpiSpec[] {
  const tag = card.registered ? '[PRE-REG]' : '[POST HOC]'
  const headline: KpiSpec = {
    kpi: {
      key: 'headline',
      label: card.headline_display ?? card.headline_label ?? DES.kpiDescription.headline,
      value: card.headline_value,
      unit: card.headline_unit ?? '',
      basis: 'A',
      tag,
      note: card.headline_label ? fillCopy(DES.headlineNote, { path: card.headline_label }) : null,
    },
    decimals: decimalsFor([card.headline_value]),
    signed: true,
    description: DES.kpiDescription.headline,
  }
  const tests = TEST_FIGURES.map(([key, label, unit, decimals, about]): KpiSpec => {
    const value = card[key]
    return {
      kpi: {
        key,
        label: key === 't_stat' ? (card.t_label ?? label) : label,
        value,
        unit,
        basis: 'A',
        tag,
        note: value === null ? DES.notRecorded : null,
      },
      decimals,
      signed: key === 't_stat',
      description: DES.kpiDescription[about],
    }
  })
  return [headline, ...tests]
}

/** The series cost the equity card opens at. */
export function defaultCost(card: HypothesisCard): number | null {
  if (card.series_costs.includes(HEADLINE_COST)) return HEADLINE_COST
  return card.series_costs[0] ?? null
}

export interface SpentStrip {
  readonly confirmations: readonly Confirmation[]
  readonly sealed: ReadonlyArray<{ readonly name: string; readonly kind: string | null; readonly label: string }>
  readonly label: string
}

/** The in-sample against sealed strip (UI_SPEC 7 DES): the confirmations and sealed files of a card. */
export function spentStrip(
  card: HypothesisCard,
  confirmations: readonly Confirmation[] | undefined,
  sealedIndex: readonly SealedItem[] | undefined,
): SpentStrip | null {
  const mine = (confirmations ?? []).filter((c) => card.confirmations.includes(c.name) || c.parent === card.name)
  if (mine.length === 0 && card.sealed.length === 0) return null
  const label = mine[0]?.label ?? sealedIndex?.find((s) => card.sealed.includes(s.name))?.label ?? DES.spentLabelFallback
  const sealed = card.sealed.map((name) => {
    const item = sealedIndex?.find((s) => s.name === name)
    return { name, kind: item?.kind ?? null, label: item?.label ?? label }
  })
  return { confirmations: mine, sealed, label }
}

/** A registry-style verdict text as its badge: PASS, FAIL, or CHECK for anything else. */
export function verdictBadge(verdict: string): 'PASS' | 'FAIL' | 'CHECK' {
  if (/^PASS/i.test(verdict)) return 'PASS'
  if (/^FAIL/i.test(verdict)) return 'FAIL'
  return 'CHECK'
}

export function findConfirmation(name: string, list: readonly Confirmation[] | undefined): Confirmation | undefined {
  return list?.find((c) => c.name === name)
}
