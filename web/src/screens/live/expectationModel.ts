// The paper path on the SV6 cone (ROADMAP 17 step 1; ANALYTICS_CATALOG SV6 cone, LV6 paper path). [POST HOC]
//
// The paper book's cumulative P&L (USD, from /api/analytics/paper-tracking) is divided by K, the served capital of
// the Nautilus reproduction behind the hypothesis, and placed step by step on the hypothesis's stationary-bootstrap
// cone (fraction of K, summed, pointwise percentiles p5 to p95). The placement says where the path sits among
// resampled history; it is descriptive, never a verdict, and it is computed in the browser (C8), not served.
//
// pathOnCone is pinned by qa/crosscheck/p12_expectation.py (numpy: usd / K, searchsorted side='right'): the
// golden file qa/golden/p12_expectation.json is read by expectationModel.test.ts, case by case. expectationView
// (further down) turns it into what the LIVE card draws: the cone with the realised line blanked, the paper and
// model paths over it as percent of K, and the lines that name K, its source run, the basis and the placement.
import type { Schemas } from '../../api/types'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { MISSING, formatNumber, formatValue, toDisplay } from '../tear/tearFormat'
import { coneInput } from '../tear/tearP1Model'
import type { Bootstrap } from '../tear/tearQueries'
import type { PaperTracking } from './trackingModel'

/** The band a value sits in, named by the percentiles around it (p5to25 is at or above p5 and below p25). */
export const CONE_BANDS = ['below5', 'p5to25', 'p25to50', 'p50to75', 'p75to95', 'above95'] as const
export type ConeBandName = (typeof CONE_BANDS)[number]

/** The five percentiles of the cone at one step: p5, p25, p50, p75, p95. */
export type ConePercentiles = readonly [number, number, number, number, number]

const PERCENTILE_KEYS = ['5', '25', '50', '75', '95'] as const
type PercentileKey = (typeof PERCENTILE_KEYS)[number]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The band of `value` among five percentiles: the count of percentiles at or below it, named. A value exactly on
 * a percentile is in the band above it (numpy.searchsorted side='right'). Null when the value or a percentile is
 * not a finite number, or the percentiles are not in ascending order (a placement against crossing percentiles
 * would say nothing).
 */
export function coneBand(value: number, q: ConePercentiles): ConeBandName | null {
  if (!finite(value) || q.length !== PERCENTILE_KEYS.length || !q.every(finite)) return null
  if (q.some((p, i) => i > 0 && p < q[i - 1]!)) return null
  return CONE_BANDS[q.filter((p) => p <= value).length]!
}

export interface PathOnConeInput {
  /** Cumulative P&L in USD, one entry per journal row; null before the first performance row and in a gap. */
  readonly usd: ReadonlyArray<number | null>
  /** K in USD: the served capital of the linked Nautilus reproduction. Must be finite and above zero. */
  readonly capital: number
  /** The cone's pointwise percentiles by step, in the cone's own unit (fraction of K). */
  readonly quantiles: Readonly<Record<PercentileKey, ReadonlyArray<number | null>>>
  /** The cone's number of steps. */
  readonly horizon: number
}

export interface PathOnCone {
  /** Index of the first row with a finite value, or null when there is none. Step 1 of the cone is this row. */
  readonly firstIndex: number | null
  /** Length `horizon`: step k is usd[firstIndex + k - 1] / capital, null where the row is absent or has no value. */
  readonly fraction: ReadonlyArray<number | null>
  /** Length `horizon`: the band of each fraction, null where it is null or a percentile is missing at that step. */
  readonly bands: ReadonlyArray<ConeBandName | null>
  /** Rows with a finite value after step `horizon`: counted, never placed. */
  readonly beyond: number
}

function percentilesAt(quantiles: PathOnConeInput['quantiles'], step: number): ConePercentiles | null {
  const cut = PERCENTILE_KEYS.map((key) => (quantiles[key] as ReadonlyArray<number | null> | undefined)?.[step])
  return cut.every(finite) ? (cut as unknown as ConePercentiles) : null
}

/**
 * Places a cumulative USD path on the cone, step by step. [POST HOC] basis: fraction of K = usd / capital; unit:
 * fraction of K, like the cone. Steps count journal rows from the first one with a value, not dates. Pinned by
 * qa/crosscheck/p12_expectation.py. Throws on a capital that is not finite or not above zero, and on a horizon
 * that is not a non-negative whole number.
 */
export function pathOnCone(input: PathOnConeInput): PathOnCone {
  const { usd, capital, quantiles, horizon } = input
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('capital must be a positive finite number')
  if (!Number.isInteger(horizon) || horizon < 0) throw new Error('horizon must be a non-negative whole number')
  const empty = (): null[] => Array.from({ length: horizon }, () => null)
  const first = usd.findIndex(finite)
  if (first < 0) return { firstIndex: null, fraction: empty(), bands: empty(), beyond: 0 }

  const fraction: Array<number | null> = []
  const bands: Array<ConeBandName | null> = []
  for (let step = 0; step < horizon; step += 1) {
    const value = usd[first + step]
    if (!finite(value)) {
      fraction.push(null)
      bands.push(null)
      continue
    }
    const share = value / capital
    const cut = percentilesAt(quantiles, step)
    fraction.push(share)
    bands.push(cut === null ? null : coneBand(share, cut))
  }
  return { firstIndex: first, fraction, bands, beyond: usd.slice(first + horizon).filter(finite).length }
}

/** The paper books that follow a registered hypothesis: the journal file name and the hypothesis behind it. */
export const PAPER_BOOKS: ReadonlyArray<{ readonly journal: RegExp; readonly hypothesis: string }> = [
  { journal: /^volmanaged_paper_journal\b/, hypothesis: 'volmanaged_v0' },
]

/** The hypothesis whose cone a paper journal is placed on, or null for a journal no registered hypothesis owns. */
export function paperBookHypothesis(journal: string | null | undefined): string | null {
  if (!journal) return null
  return PAPER_BOOKS.find((book) => book.journal.test(journal))?.hypothesis ?? null
}

type CardRuns = Pick<Schemas['HypothesisCard'], 'nautilus_runs'>
type RunBadges = Pick<Schemas['RunSummary'], 'run_id' | 'balance_ok' | 'is_probe'> & { readonly readable?: boolean }

/**
 * The run whose served capital is K: the first of the card's Nautilus runs that is not a probe, is readable and
 * has not failed its balance check (an unanswered check is accepted). While the run list loads (`undefined`) the
 * card's first run stands in; once loaded, a run the list does not know is skipped. Null when none qualifies.
 */
export function capitalRun(card: CardRuns, runs: ReadonlyArray<RunBadges> | undefined): string | null {
  if (runs === undefined) return card.nautilus_runs[0] ?? null
  const byId = new Map(runs.map((r) => [r.run_id, r]))
  return card.nautilus_runs.find((id) => {
    const run = byId.get(id)
    return run !== undefined && !run.is_probe && run.balance_ok !== false && run.readable !== false
  }) ?? null
}

// ---------------------------------------------------------------- the LIVE card (LV6)

/** The only cone the paper path can be placed on: the unit is exactly "fraction of K" and the paths are summed. */
const CONE_UNIT = /^fraction of K$/
const CONE_HOW = 'summed'
/** Decimals of a placed value, in percent of K: a paper session moves a book of about 1,000,000 USD by hundredths. */
const VALUE_DECIMALS = 4

export interface ExpectationGateInput {
  /** The paper tracking read; null or undefined while it is not there. */
  readonly tracking: PaperTracking | null | undefined
  /** K in USD: the served capital of the linked run, or null when there is none. */
  readonly capital: number | null | undefined
  /** The linked Nautilus run K comes from, or null when the hypothesis lists no usable one. */
  readonly runId: string | null
  /** The hypothesis whose cone the journal is placed on, or null when none owns the journal. */
  readonly hypothesis: string | null
  /** The cost per side (ticks) the cone is read at, or null when the hypothesis records none. */
  readonly cost: number | null
}

export interface ExpectationInput extends ExpectationGateInput {
  /** The hypothesis's bootstrap read (its SV6 cone); null or undefined while it is not there. */
  readonly boot: Bootstrap | null | undefined
}

/** Every number on the card is a placement by the terminal after the fact. */
export const EXPECTATION_TAG = '[POST HOC]'

export type ExpectationView =
  | { readonly kind: 'ok'; readonly cone: ConeInput; readonly lines: string[]; readonly tag: typeof EXPECTATION_TAG }
  | { readonly kind: 'refused'; readonly text: string }

/** Whether the tracking read holds a cumulative value to place: present, with a finite paper or model value. */
export function trackingHasValue(tracking: PaperTracking | null | undefined): tracking is PaperTracking {
  return !!tracking && tracking.present && (tracking.paper_cumulative.some(finite) || tracking.model_cumulative.some(finite))
}

interface Ready {
  readonly tracking: PaperTracking
  readonly hypothesis: string
  readonly cost: number
  readonly runId: string
  readonly capital: number
}

/** The first reason the path cannot be placed that needs no cone, as words; else what the placement needs. */
function gate(input: ExpectationGateInput): { readonly text: string } | Ready {
  const { tracking, capital, runId, hypothesis, cost } = input
  if (!trackingHasValue(tracking)) return { text: EXPECTATION.empty }
  if (hypothesis === null) return { text: fillCopy(EXPECTATION.noBook, { journal: tracking.journal }) }
  if (cost === null) return { text: fillCopy(EXPECTATION.noCost, { hypothesis }) }
  if (runId === null) return { text: fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun }) }
  if (!finite(capital) || capital <= 0) {
    return { text: fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: runId }) }) }
  }
  return { tracking, hypothesis, cost, runId, capital }
}

/**
 * The refusal expectationView gives before it needs the cone (no value, no book, no cost, no run, no capital), or
 * null when only the cone is left to check. The panel uses it to say so without waiting for the bootstrap.
 */
export function expectationGate(input: ExpectationGateInput): string | null {
  const found = gate(input)
  return 'text' in found ? found.text : null
}

/** The five percentile lines of a served cone by their keys; a line the cone lacks is empty, so it places nothing. */
function coneQuantiles(served: Readonly<Record<string, ReadonlyArray<number | null>>>): PathOnConeInput['quantiles'] {
  const line = (key: PercentileKey) => served[key] ?? []
  return { '5': line('5'), '25': line('25'), '50': line('50'), '75': line('75'), '95': line('95') }
}

const costWords = (cost: number): string => fillCopy(cost === 1 ? EXPECTATION.costOne : EXPECTATION.costMany, { n: cost })

/** The last cone step (1-based) at which the paper or the model path has a value, or 0 when neither has. */
function lastStep(paper: PathOnCone, model: PathOnCone): number {
  for (let step = Math.max(paper.fraction.length, model.fraction.length); step >= 1; step -= 1) {
    if (finite(paper.fraction[step - 1]) || finite(model.fraction[step - 1])) return step
  }
  return 0
}

function placement(value: number | null | undefined, band: ConeBandName | null | undefined, unit: string): { value: string; band: string } {
  return {
    value: formatValue(value, unit, VALUE_DECIMALS, true),
    band: band ? EXPECTATION.bands[band] : EXPECTATION.unplaced,
  }
}

/**
 * The LIVE card: the paper book's and the rule's cumulative P&L, as percent of K, on the SV6 cone of the
 * hypothesis, or the words for why it cannot be placed. [POST HOC] and computed in the browser (C8). The lines name
 * K and the run it comes from, the anchor session, the before-costs basis, the latest placement in words, the
 * sessions past the horizon (when there are any) and the cone's own label, verbatim. No verdict is ever given.
 */
export function expectationView(input: ExpectationInput): ExpectationView {
  const ready = gate(input)
  if ('text' in ready) return { kind: 'refused', text: ready.text }
  const { tracking, hypothesis, cost, runId, capital } = ready
  const { boot } = input
  if (!boot) return { kind: 'refused', text: EXPECTATION.loading }
  const c = boot.cone
  if (!CONE_UNIT.test(c.unit) || c.how !== CONE_HOW) {
    return { kind: 'refused', text: fillCopy(EXPECTATION.unitRefused, { unit: c.unit, how: c.how }) }
  }

  const horizon = c.steps.length
  const quantiles = coneQuantiles(c.quantiles)
  const paper = pathOnCone({ usd: tracking.paper_cumulative, capital, quantiles, horizon })
  const model = pathOnCone({ usd: tracking.model_cumulative, capital, quantiles, horizon })
  const first = paper.firstIndex ?? model.firstIndex ?? 0
  const dateAt = (row: number): string => tracking.date[row] ?? MISSING

  const base = coneInput(boot, hypothesis)
  const cone: ConeInput = {
    ...base,
    name: fillCopy(EXPECTATION.coneName, { hypothesis }),
    realised: base.steps.map(() => null),
    realisedDates: [],
    overlays: [
      { id: 'paper', label: EXPECTATION.paper, values: paper.fraction.map((v) => toDisplay(v, c.unit)), tone: 'accent2' },
      { id: 'model', label: EXPECTATION.model, values: model.fraction.map((v) => toDisplay(v, c.unit)), tone: 'cyanChart' },
    ],
  }

  const step = lastStep(paper, model)
  const beyond = Math.max(paper.beyond, model.beyond)
  const cash = Number.isInteger(capital) ? 0 : 2
  const costs = costWords(cost)
  const lines = [
    fillCopy(EXPECTATION.kLine, { k: formatNumber(capital, cash, { thousands: true }), run: runId, hypothesis }),
    fillCopy(EXPECTATION.anchorLine, { date: dateAt(first), hypothesis, cost: costs }),
    fillCopy(EXPECTATION.costNote, { cost: costs }),
    ...(step === 0 ? [] : [latestLine(step, dateAt(first + step - 1), paper, model, c.unit)]),
    ...(beyond === 0 ? [] : [fillCopy(beyond === 1 ? EXPECTATION.beyondOne : EXPECTATION.beyond, { n: beyond, horizon })]),
    c.label,
  ]
  return { kind: 'ok', cone, lines, tag: EXPECTATION_TAG }
}

function latestLine(step: number, date: string, paper: PathOnCone, model: PathOnCone, unit: string): string {
  const p = placement(paper.fraction[step - 1], paper.bands[step - 1], unit)
  const m = placement(model.fraction[step - 1], model.bands[step - 1], unit)
  return fillCopy(EXPECTATION.latest, { step, date, paper: p.value, paperBand: p.band, model: m.value, modelBand: m.band })
}
