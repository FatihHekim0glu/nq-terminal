// DES model (TASKS 6.2; UI_SPEC section 7 "DES"; ANALYTICS_CATALOG C4, C7, RL5, EX4): pure functions
// from the API's HypothesisDetail to what the screen draws. Every number passes through unchanged; the
// only work here is formatting, labelling and choosing what to show. Blocks and the cost ladder are the
// screen JSON's own values (never recomputed), and the screen JSON's `dsr` is the Sharpe difference
// (managed minus buy and hold), so it is always labelled that way (C4).
import type { Schemas } from '../../api/types'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { DES } from '../../copy/des'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import { toDecimal } from '../../format/decimal'

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
  const text = toDecimal(value, decimals)
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

// ---------------------------------------------------------------- U15: the gating statistic of each check

/** |alpha| above this many %/yr is flagged as an implausible magnitude beside the value (U15). */
export const IMPLAUSIBLE_ALPHA_PCT = 1000
const STAT_DECIMALS = 2
const RATE_DECIMALS = 1
const P_DECIMALS = 4

/** The recorded figure a boolean check gates on, and where it was read from (never computed). */
export interface CheckSource {
  /** What the figure is: 'alpha t (gating: ...)', 'Blocks', 'Cost ladder at 2 ticks', a raw check's name. */
  readonly label: string
  /** The figure or figures in full, with signs. */
  readonly text: string
  /** One figure for a narrow box: the block that decides, or the figure itself. */
  readonly short: string
  readonly unit: string | null
  /** The record it was read from, as it is named there. */
  readonly from: string
  /** The bar the check name spells (`>= 2.5`), or null when the name spells none (the pass bar has it). */
  readonly threshold: string | null
}

/** One formatted figure of a raw value; `flag` is set when its magnitude is implausible. */
export interface CheckCell {
  readonly path: string
  readonly text: string
  readonly flag: string | null
}

export interface PassCheckRow extends CheckRow {
  readonly source: CheckSource | null
  readonly cells: readonly CheckCell[]
}

const BAR = /(?:^|_)(ge|gt|le|lt|eq)_(\d+)(?:_(\d+))?$/
const STEP = /^c\d+$/
const TICKS = /^(\d+)tick$/
const GATING_KEYS: readonly string[] = ['t_min', 'welch_t', 't']
const T_KEYS: ReadonlySet<string> = new Set(['t', 't_b', 't_min', 'welch_t'])
const P_KEYS = /(^|_)p(_one_sided)?$/
const MEASURE_KEYS = /(^|_)(mean|median|sd)$|^diff$/
const PLAIN_KEYS: ReadonlySet<string> = new Set(['total'])

const tokensOf = (name: string): string[] => name.toLowerCase().split('_').filter(Boolean)

/** The bar a check name spells: `t_ge_2_5` is `>= 2.5`. */
function barOf(name: string): string | null {
  const m = BAR.exec(name.toLowerCase())
  if (!m) return null
  const comparator = COMPARATORS[m[1] ?? '']
  const number = m[3] === undefined ? m[2] : `${m[2]}.${m[3]}`
  return comparator === undefined || number === undefined ? null : `${comparator} ${number}`
}

/** The tick count a check name spells: `2tick` or `two_tick` is 2. */
function ticksOf(tokens: readonly string[]): number | null {
  for (const token of tokens) {
    const m = TICKS.exec(token)
    if (m?.[1] !== undefined) return Number(m[1])
  }
  return tokens.includes('two') && tokens.includes('tick') ? 2 : null
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const asNumber = (value: unknown): number | null => (isNumber(value) ? value : null)

/** The unit stem of a headline unit: 'points per trade (NQ), net at 1 tick per side' is 'points per trade (NQ)'. */
function unitStem(unit: string | null | undefined): string | null {
  const stem = (unit ?? '').split(',')[0]?.trim() ?? ''
  return stem === '' ? null : stem
}

/** A figure of a raw value by the key it is recorded under; `unit` is the headline unit stem. */
function formatLeaf(key: string, value: number, unit: string | null): { readonly text: string; readonly flag: string | null } {
  const k = key.toLowerCase()
  if (/^n(_|$)/.test(k) && Number.isInteger(value)) return { text: String(value), flag: null }
  if (k === 'alpha_annual_pct') {
    const flag = Math.abs(value) > IMPLAUSIBLE_ALPHA_PCT ? DES.passChecks.implausible : null
    return { text: `${formatNumber(value, STAT_DECIMALS)} ${DES.passChecks.perYear}`, flag }
  }
  if (k === 'hit_rate') return { text: `${formatNumber(value * 100, RATE_DECIMALS)}%`, flag: null }
  if (T_KEYS.has(k)) return { text: formatNumber(value, STAT_DECIMALS, true), flag: null }
  if (P_KEYS.test(k)) return { text: formatNumber(value, P_DECIMALS), flag: null }
  if (MEASURE_KEYS.test(k)) {
    const text = formatNumber(value, Math.max(STAT_DECIMALS, decimalsFor([value])))
    return { text: unit === null ? text : `${text} ${unit}`, flag: null }
  }
  if (PLAIN_KEYS.has(k)) return { text: formatNumber(value, STAT_DECIMALS), flag: null }
  return { text: scalarText(value) ?? MISSING, flag: null }
}

const isIndex = (key: string): boolean => DIGITS.test(key)

/** A raw value as formatted cells, one per figure: the same paths as `flattenValue`, with units and flags. */
function rawCells(value: unknown, key: string, unit: string | null, path = ''): CheckCell[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return [{ path, text: MISSING, flag: null }]
    return [{ path, ...formatLeaf(key, value, unit) }]
  }
  const scalar = scalarText(value)
  if (scalar !== null) return [{ path, text: scalar, flag: null }]
  if (Array.isArray(value)) return value.flatMap((item, i) => rawCells(item, key, unit, path ? `${path}.${i}` : String(i)))
  const record = asRecord(value)
  if (record === null) return []
  return Object.entries(record).flatMap(([child, item]) => {
    const label = fieldLabel(child)
    return rawCells(item, isIndex(child) ? key : child, unit, path ? `${path}.${label}` : label)
  })
}

/** The figures of a raw value with their leaf key: `alpha.t_min` is [t_min, 1.29]. */
function leafNumbers(value: unknown, key: string): Array<readonly [string, number]> {
  if (isNumber(value)) return [[key, value]]
  const record = asRecord(value)
  if (record === null) return Array.isArray(value) ? value.flatMap((item) => leafNumbers(item, key)) : []
  return Object.entries(record).flatMap(([child, item]) => leafNumbers(item, isIndex(child) ? key : child))
}

function tSource(card: HypothesisCard, bar: string | null): CheckSource | null {
  const t = asNumber(card.t_stat)
  if (t === null) return null
  const text = formatNumber(t, STAT_DECIMALS, true)
  return { label: card.t_label ?? DES.kpi.t, text, short: text, unit: DES.units.ratio, from: 'card.t_stat', threshold: bar }
}

function blocksSource(des: DesExtract, bar: string | null): CheckSource | null {
  const blocks = des.blocks.flatMap((b) => (isNumber(b.value) ? [{ label: b.label, value: b.value }] : []))
  if (blocks.length === 0) return null
  const decimals = decimalsFor(blocks.map((b) => b.value))
  const shown = blocks.map((b) => `${b.label} ${formatNumber(b.value, decimals, true)}`)
  const upper = bar?.startsWith('<') === true
  const decisive = blocks.reduce((a, b) => (upper ? (b.value > a.value ? b : a) : (b.value < a.value ? b : a)))
  return {
    label: DES.passChecks.blocks,
    text: shown.join(', '),
    short: `${decisive.label} ${formatNumber(decisive.value, decimals, true)}`,
    unit: des.blocks_unit ?? null,
    from: 'des.blocks',
    threshold: bar,
  }
}

function ladderSource(des: DesExtract, ticks: number, bar: string | null): CheckSource | null {
  const rung = des.cost_ladder.find((r) => r.ticks_per_side === ticks)
  if (rung === undefined || !isNumber(rung.value)) return null
  const text = formatNumber(rung.value, decimalsFor(des.cost_ladder.map((r) => r.value)), true)
  return {
    label: fillCopy(DES.passChecks.costLadder, { ticks: ticksLabel(ticks) }), text, short: text,
    unit: des.cost_ladder_unit ?? null, from: 'des.cost_ladder', threshold: bar,
  }
}

function dsrSource(screen: unknown, ticks: number, bar: string | null): CheckSource | null {
  const headline = asRecord(asRecord(screen)?.['headline'])
  const dsr = asNumber(asRecord(headline?.[`${ticks}tick`])?.['dsr'])
  if (dsr === null) return null
  const text = formatNumber(dsr, decimalsFor([dsr]), true)
  return {
    label: fillCopy(DES.passChecks.at, { label: DES.dsrLabel, ticks: ticksLabel(ticks) }), text, short: text,
    unit: null, from: `headline.${ticks}tick.dsr`, threshold: bar,
  }
}

/** A boolean check cN_x reads the raw value row named x (or containing all its words) that the check page also shows. */
function siblingSource(tokens: readonly string[], checks: readonly PassCheck[], unit: string | null, bar: string | null): CheckSource | null {
  const sibling = checks.find((c) => c.passed === null && c.value !== null && c.value !== undefined && tokens.every((t) => tokensOf(c.name).includes(t)))
  if (sibling === undefined) return null
  const figures = leafNumbers(sibling.value, sibling.name.toLowerCase())
  const key = GATING_KEYS.find((k) => figures.some(([leaf]) => leaf === k)) ?? (asRecord(sibling.value) === null ? sibling.name.toLowerCase() : null)
  const figure = figures.find(([leaf]) => leaf === key)
  if (key === null || figure === undefined) return null
  const { text } = formatLeaf(key, figure[1], unit)
  const scalar = asRecord(sibling.value) === null
  return {
    label: sibling.name, text, short: text,
    unit: T_KEYS.has(key) ? DES.units.ratio : /^n(_|$)/.test(key) ? DES.units.count : null,
    from: scalar ? sibling.name : `${sibling.name}.${key}`, threshold: bar,
  }
}

function headlineSource(card: HypothesisCard, bar: string | null): CheckSource | null {
  const value = asNumber(card.headline_value)
  if (value === null) return null
  const text = formatNumber(value, decimalsFor([value]), true)
  return {
    label: card.headline_display ?? card.headline_label ?? DES.kpiDescription.headline, text, short: text,
    unit: card.headline_unit ?? null, from: 'card.headline_value', threshold: bar,
  }
}

/**
 * The recorded statistic a boolean check gates on (U15), chosen by the words of its name: a t check reads the
 * card's gating t, a blocks check the extract's blocks, a `dsr` check the screen JSON's Sharpe difference at
 * that cost, a tick check the cost ladder's rung, a cN check the raw value row of the same name, and a mean
 * check the registered headline. A raw value row and a check that fits none of these have no statistic.
 */
function checkSource(detail: HypothesisDetail, check: PassCheck, checks: readonly PassCheck[], unit: string | null): CheckSource | null {
  if (check.passed === null || check.passed === undefined) return null
  const tokens = tokensOf(check.name).filter((t, i) => !(i === 0 && STEP.test(t)))
  const bar = barOf(check.name)
  const ticks = ticksOf(tokens)
  if (tokens.includes('dsr')) return ticks === null ? null : dsrSource(detail.screen, ticks, bar)
  if (tokens.includes('t')) return tSource(detail.card, bar)
  if (tokens.includes('block') || tokens.includes('blocks')) return blocksSource(detail.des, bar)
  if (ticks !== null) return ladderSource(detail.des, ticks, bar)
  const sibling = siblingSource(tokens, checks, unit, bar)
  if (sibling !== null) return sibling
  return tokens.includes('mean') ? headlineSource(detail.card, bar) : null
}

/**
 * The rows of the Pass checks page and of the Profile's box (U15): each check as `checkRows` gives it, with
 * the statistic a boolean gates on and, for a raw value, its figures formatted with the headline unit and
 * flagged when implausible. Every figure is read from the detail; nothing is computed.
 */
export function passCheckRows(detail: HypothesisDetail): PassCheckRow[] {
  const checks = detail.card.pass_checks
  const unit = unitStem(detail.card.headline_unit)
  return checkRows(checks, 1).map((row, i) => {
    const check = checks[i] as PassCheck
    return {
      ...row,
      source: checkSource(detail, check, checks, unit),
      cells: rawCells(check.value, check.name.toLowerCase(), unit),
    }
  })
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
  /** The unit for the tile's popover when the face shows something else in `kpi.unit` (U02: the family). */
  readonly unit?: string
}

export interface KpiOptions {
  /** U02: show 'registry family' beside Bonferroni, Holm and BH q. Off for the report and the dossier. */
  readonly family?: boolean
}

/** C7: a value read from a registered result carries [PRE-REG]; a card that is a check inside another spec does not. */
export const cardTag = (card: HypothesisCard): Kpi['tag'] => (card.registered ? SPEC.preReg : SPEC.postHoc)

const ADJUSTED: ReadonlySet<CardKey> = new Set<CardKey>(['bonferroni_p', 'holm_p', 'bh_q'])

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

/**
 * The KPI row: the headline, then n, t, p, control p, Bonferroni, Holm and BH q, all basis A. With
 * `family`, the three adjusted p tiles name the family they are adjusted over on their face (U02); the
 * popover keeps 'probability' as their unit.
 */
export function registrationKpis(card: HypothesisCard, options: KpiOptions = {}): KpiSpec[] {
  const tag = cardTag(card)
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
    const family = options.family === true && ADJUSTED.has(key)
    return {
      kpi: {
        key,
        label: key === 't_stat' ? (card.t_label ?? label) : label,
        value,
        unit: family ? DES.family.unit : unit,
        basis: 'A',
        tag,
        note: value === null ? DES.notRecorded : null,
      },
      decimals,
      signed: key === 't_stat',
      description: DES.kpiDescription[about],
      ...(family ? { unit } : {}),
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
