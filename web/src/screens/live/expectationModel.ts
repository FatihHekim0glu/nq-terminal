// LV6 and LV6b on LIVE (ANALYTICS_CATALOG section 13). [POST HOC]
//
// The terminal serves the placement (GET /api/analytics/paper-expectation, backend analytics/expectation.py): the
// paper and model cumulative P&L as a fraction of K, placed step by step on two cones, the SV6 cone of the hypothesis
// that owns the paper journal (backtest start) and a cone resampled from the paper book's own sessions (live start).
// This module only turns the served view into what the card draws: the chosen cone with its realised line blanked, the
// two paths over it as percent of K, and the lines that name K, its run, the anchor, the basis and the latest
// placement, or the words for a refusal. Nothing is placed or resampled here; the browser's client-phase arithmetic
// is kept in expectationReference.ts as a test reference only.
import type { Schemas } from '../../api/types'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { MISSING, formatNumber, formatValue, isPercentUnit, shortUnit, toDisplay } from '../tear/tearFormat'

export type PaperExpectation = Schemas['PaperExpectation']
export type ServedCone = Schemas['ExpectationCone']
export type ServedPlacement = Schemas['ConePlacement']
export type ServedRefusal = Schemas['ExpectationRefusal']
type Band = ServedPlacement['paper']['bands'][number]

/** The two cones, in the order the toggle offers them. */
export const CONE_STARTS = ['backtest', 'live'] as const
export type ConeStart = (typeof CONE_STARTS)[number]

/** Every number on the card is a placement by the terminal after the fact. */
export const EXPECTATION_TAG = '[POST HOC]'

/** Decimals of a placed value, in percent of K: a paper session moves a book of about 1,000,000 USD by hundredths. */
const VALUE_DECIMALS = 4
const CONE_DECIMALS = 2
const BLOCK_DECIMALS = 2
const PERCENTILES = [5, 25, 50, 75, 95] as const

export type ExpectationView =
  | {
      readonly kind: 'ok'
      readonly cone: ConeInput
      readonly lines: string[]
      readonly tag: typeof EXPECTATION_TAG
      /** Both cones are served, so the card offers the toggle. */
      readonly switchable: boolean
    }
  | { readonly kind: 'refused'; readonly text: string; readonly switchable: boolean }

const param = (refusal: ServedRefusal, key: string): string => refusal.params[key] ?? MISSING

/** The words of a served refusal; `journal` names the journal no registered hypothesis owns. */
export function refusalText(refusal: ServedRefusal, journal: string): string {
  switch (refusal.code) {
    case 'empty':
      return EXPECTATION.empty
    case 'no_book':
      return fillCopy(EXPECTATION.noBook, { journal })
    case 'no_cost':
      return fillCopy(EXPECTATION.noCost, { hypothesis: param(refusal, 'hypothesis') })
    case 'no_run':
      return fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun })
    case 'no_capital':
      return fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: param(refusal, 'run') }) })
    case 'unit':
      return fillCopy(EXPECTATION.unitRefused, { unit: param(refusal, 'unit'), how: param(refusal, 'how') })
    case 'no_bootstrap':
      return fillCopy(EXPECTATION.noBootstrap, { detail: param(refusal, 'detail') })
    case 'live_short':
      return fillCopy(EXPECTATION.liveShort, { n: param(refusal, 'n'), min: param(refusal, 'min') })
    case 'live_flat':
      return fillCopy(EXPECTATION.liveFlat, { n: param(refusal, 'n') })
  }
}

const costWords = (cost: number): string => fillCopy(cost === 1 ? EXPECTATION.costOne : EXPECTATION.costMany, { n: cost })

function placement(value: number | null | undefined, band: Band | undefined, unit: string): { value: string; band: string } {
  return { value: formatValue(value, unit, VALUE_DECIMALS, true), band: band ? EXPECTATION.bands[band] : EXPECTATION.unplaced }
}

function latestLine(placed: ServedPlacement, unit: string): string {
  const at = placed.latest_step - 1
  const p = placement(placed.paper.fraction[at], placed.paper.bands[at], unit)
  const m = placement(placed.model.fraction[at], placed.model.bands[at], unit)
  return fillCopy(EXPECTATION.latest, {
    step: placed.latest_step, date: placed.latest_date ?? MISSING, paper: p.value, paperBand: p.band, model: m.value, modelBand: m.band,
  })
}

/** The served cone as the chart takes it: display units, the realised line blanked, Paper and Model over it. */
function coneOf(cone: Schemas['ConeView'], placed: ServedPlacement, name: string): ConeInput {
  const unit = cone.unit
  const scaled = (values: ReadonlyArray<number | null>) => values.map((v) => toDisplay(v, unit))
  return {
    name,
    label: cone.label,
    unit: isPercentUnit(unit) ? '%' : shortUnit(unit) === 'USD' ? 'USD' : '',
    decimals: CONE_DECIMALS,
    steps: cone.steps,
    bands: PERCENTILES.map((p) => ({ p, values: scaled(cone.quantiles[String(p)] ?? []) })),
    realised: cone.steps.map(() => null),
    realisedDates: [],
    overlays: [
      { id: 'paper', label: EXPECTATION.paper, values: scaled(placed.paper.fraction), tone: 'accent2' },
      { id: 'model', label: EXPECTATION.model, values: scaled(placed.model.fraction), tone: 'cyanChart' },
    ],
  }
}

function anchorLine(served: PaperExpectation, chosen: ServedCone, placed: ServedPlacement): string {
  const date = placed.anchor_date ?? MISSING
  if (chosen.start === 'backtest') {
    return fillCopy(EXPECTATION.anchorLine, { date, hypothesis: served.hypothesis ?? MISSING, cost: costWords(served.cost ?? 0) })
  }
  return fillCopy(EXPECTATION.liveAnchorLine, {
    date,
    n: formatNumber(chosen.source_n, 0, { thousands: true }),
    start: chosen.source_start ?? MISSING,
    end: chosen.source_end ?? MISSING,
    block: formatNumber(chosen.block, BLOCK_DECIMALS),
    reps: formatNumber(chosen.reps, 0, { thousands: true }),
    seed: chosen.seed,
  })
}

/**
 * The LIVE card for the chosen cone: the served placement drawn on it with the lines that name K and its run, the
 * anchor session, the basis, the latest placement (when a step has a value), the sessions past the horizon (when
 * there are any) and the cone's own label, verbatim; or the words of a served refusal. No verdict is ever given.
 */
export function expectationView(served: PaperExpectation, start: ConeStart): ExpectationView {
  if (served.refusal) return { kind: 'refused', text: refusalText(served.refusal, served.journal), switchable: false }
  const switchable = served.backtest !== null && served.live !== null
  const chosen = start === 'live' ? served.live : served.backtest
  if (!chosen) return { kind: 'refused', text: EXPECTATION.loading, switchable }
  if (chosen.refusal) return { kind: 'refused', text: refusalText(chosen.refusal, served.journal), switchable }
  const { cone, placement: placed } = chosen
  if (!cone || !placed) return { kind: 'refused', text: EXPECTATION.loading, switchable }

  const hypothesis = served.hypothesis ?? MISSING
  const capital = served.capital ?? Number.NaN
  const name = start === 'live' ? EXPECTATION.liveConeName : fillCopy(EXPECTATION.coneName, { hypothesis })
  const lines = [
    fillCopy(EXPECTATION.kLine, {
      k: formatNumber(capital, Number.isInteger(capital) ? 0 : 2, { thousands: true }), run: served.run_id ?? MISSING, hypothesis,
    }),
    anchorLine(served, chosen, placed),
    chosen.start === 'backtest' ? fillCopy(EXPECTATION.costNote, { cost: costWords(served.cost ?? 0) }) : EXPECTATION.liveCostNote,
    ...(placed.latest_step === 0 ? [] : [latestLine(placed, cone.unit)]),
    ...(placed.latest_step === 0 || chosen.start === 'backtest' ? [] : [EXPECTATION.liveLatestNote]),
    ...(placed.beyond === 0
      ? []
      : [fillCopy(placed.beyond === 1 ? EXPECTATION.beyondOne : EXPECTATION.beyond, { n: placed.beyond, horizon: placed.horizon })]),
    cone.label,
  ]
  return { kind: 'ok', cone: coneOf(cone, placed, name), lines, tag: EXPECTATION_TAG, switchable }
}
