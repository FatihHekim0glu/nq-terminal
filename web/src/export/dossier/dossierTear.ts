// The tear sheet as a dossier (roadmap #15 part 2). Pure: the analytics the browser already holds go in, plain
// text comes out, and every number is printed by the formatter the screen itself uses (kpiTiles with the
// tile's own decimals and sign, tearFormat, the SV7 table); nothing is computed here and nothing is fetched.
//
// This file also holds the parts DES shares (the KPI, interval and SV7 sections, the flags, the footer, the
// registration facts and the source lines). dossierModel.ts re-exports them, so the three files import one
// way only: dossierModel -> dossierDes -> dossierTear, with no cycle.
import { etClock } from '../../chrome/StatusBar.format'
import { FRAME_STRIP, STATUS_BAR } from '../../copy/chrome'
import { DES, DES_REPORT } from '../../copy/des'
import { DOSSIER } from '../../copy/dossier'
import { FENCE } from '../../copy/lineStack'
import { TEAR, TEAR_DD, TEAR_EQ, TEAR_MRET, TEAR_SV7 } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { buildApiUrl } from '../../api/client'
import type { HypothesisCard } from '../../screens/des/desModel'
import { basisLine } from '../../screens/tear/tearCharts'
import { MISSING, displayUnit, formatNumber, formatValue, isPercentUnit, shortUnit } from '../../screens/tear/tearFormat'
import { kpiTiles, tearTags, type Analytics } from '../../screens/tear/tearKpis'
import type { TearTarget } from '../../screens/tear/tearQueries'
import { readSv7, sv7Empty, sv7Notes, sv7Table, sv7Title } from '../../screens/tear/tearSv7Model'
import { tearAnalyticsPath } from '../../screens/tear/tearSource'
import { formatKpi } from '../../tiles/KpiTile'
import type { Dossier, DossierContext, DossierSection, DossierTable, TearDossierInput } from './types'

export type Pair = readonly [string, string]

// ---------------------------------------------------------------- text helpers

/** A bracketed tag: `[POST HOC]`. */
export function bracket(tag: string): string {
  return fillCopy(DES.tag, { tag })
}

const SENTENCE_END = /[.!?]$/

/** The text as a sentence: trimmed, with a full stop unless it already ends in one. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`
}

/** A table note: the tag first, then each part as a sentence, so basis, unit and tag are always named. */
export function noteOf(tag: string, ...parts: readonly string[]): string {
  return [tag, ...parts.filter((part) => part.trim() !== '').map(sentence)].join(' ')
}

const text = (id: string, title: string, lines: readonly string[], verbatim = false): DossierSection => ({ kind: 'text', id, title, lines, verbatim })

/** A cell that is empty reads `--`, never blank. */
export const cell = (value: string): string => (value.trim() === '' ? MISSING : value)

// ---------------------------------------------------------------- flags, footer, sources

/**
 * The lead flags of the dossier, then DEMO DATA in the demo, or FIXTURE DATA on fixture data outside it. The demo's
 * health answer says fixture too, but the screen shows the one term there (chrome StatusBar and FrameStrip), so the
 * printed page does the same.
 */
export function flags(ctx: DossierContext, lead: readonly string[]): string[] {
  return [...lead, ...(ctx.demo ? [FRAME_STRIP.demoData] : []), ...(ctx.fixture && !ctx.demo ? [STATUS_BAR.fixture] : [])]
}

/** New York time of day, or null when the date does not parse (an invalid Date would throw). */
function clock(date: Date): string | null {
  return Number.isNaN(date.getTime()) ? null : etClock(date)
}

const isLine = (line: string | null): line is string => line !== null && line.trim() !== ''

/** What the dossier is, when it was made, the fence, and the demo note in the demo. A line with nothing to say is dropped. */
export function footer(ctx: DossierContext): string[] {
  const made = clock(ctx.now)
  const server = ctx.asOfUtc === null ? null : clock(new Date(ctx.asOfUtc))
  return [
    DOSSIER.descriptive,
    made === null ? null : fillCopy(DOSSIER.generated, { time: made }),
    server === null ? null : fillCopy(DOSSIER.serverClock, { time: server }),
    FENCE.label,
    ctx.demo ? DOSSIER.demoNote : null,
  ].filter(isLine)
}

/** `GET /api/hypotheses/{name}`, the card and its description. */
export function hypothesisSource(name: string): string {
  return fillCopy(DOSSIER.sourceLine, { path: buildApiUrl('/api/hypotheses/{name}', { path: { name } }) })
}

/** `GET` and the analytics path the tear sheet asked for. */
export function analyticsSource(target: TearTarget, analytics: Analytics): string {
  return fillCopy(DOSSIER.sourceLine, { path: tearAnalyticsPath(target, analytics.context) })
}

// ---------------------------------------------------------------- registration

export interface RegistrationFacts {
  readonly registered: Pair
  readonly verdict: Pair
  readonly tag: Pair
  readonly round: Pair
  readonly spec: Pair
  readonly sha: Pair
  readonly amendments: Pair
  readonly screen: Pair
}

function amendmentsText(card: HypothesisCard): string {
  const R = DES_REPORT
  if (card.amendment_files.length === 0) return R.amendmentsNone
  const ok = card.amendments_ok === false ? R.amendmentsBad : card.amendments_ok ? R.amendmentsOk : R.amendmentsUnknown
  return fillCopy(R.amendmentsList, { files: card.amendment_files.join(', '), ok })
}

/** The registration facts of a card with the DES report's labels; the badge and the hash checks are the card's own. */
export function registrationFacts(card: HypothesisCard): RegistrationFacts {
  const R = DES_REPORT
  const badge = bracket(card.verdict_badge)
  const shaChecks = `${card.spec_sha_ok ? R.registryOk : R.registryBad}, ${card.spec_rehash_ok ? R.rehashOk : R.rehashBad}`
  return {
    registered: [R.registered, card.registered ? DES.registration.yes : DES.registration.no],
    verdict: [R.verdict, card.verdict_note ? `${badge} (${card.verdict_note})` : badge],
    tag: [R.tag, card.tag],
    round: [R.round, card.round === null ? MISSING : String(card.round)],
    spec: [R.spec, card.spec],
    sha: [R.sha, `${card.spec_sha256} (${shaChecks})`],
    amendments: [R.amendments, amendmentsText(card)],
    screen: [R.screen, card.screen ?? MISSING],
  }
}

// ---------------------------------------------------------------- sections the tear sheet and DES share

/** Measure, value, unit, basis, tag and note of each KPI tile, in the API order and at the tile's own precision. */
export function kpiSection(data: Analytics): DossierTable {
  const C = DOSSIER.cols
  return {
    kind: 'table',
    id: 'kpis',
    title: DOSSIER.sections.kpis,
    note: null,
    columns: [C.measure, C.value, C.unit, C.basis, C.tag, C.note],
    rows: kpiTiles(data).map((tile) => {
      const unit = tile.unit ?? tile.kpi.unit
      const note = [tile.kpi.note ?? '', isPercentUnit(unit) ? TEAR.kpiPercent : ''].filter((part) => part !== '').join(' ')
      return [tile.kpi.label, formatKpi(tile.kpi.value, tile.kpi.unit, tile.decimals, tile.signed), cell(unit), tile.kpi.basis, tile.kpi.tag, note]
    }),
  }
}

/** The Sharpe interval the API sends, as one row. */
export function intervalSection(data: Analytics): DossierTable {
  const C = DOSSIER.cols
  const ci = data.ci
  return {
    kind: 'table',
    id: 'interval',
    title: DOSSIER.sections.interval,
    note: noteOf(data.tag, fillCopy(TEAR.basisShort, { basis: ci.basis }), fillCopy(DES.unitLine, { unit: ci.unit })),
    columns: [C.sharpe, C.low, C.high, C.z],
    rows: [[ci.sharpe, ci.lo, ci.hi, ci.z].map((value) => formatNumber(value, 2))],
  }
}

/** SV7 as one table, costs across and each band's rows flattened under the band's name; or the reason there is none. */
export function sv7Section(data: Analytics): DossierSection {
  const sv7 = readSv7(data.validity.sharpe_difference_tests)
  const title = sv7Title(sv7)
  const empty = sv7Empty(sv7)
  if (empty !== null) return text('sv7', title, [empty])
  const model = sv7Table(sv7)
  return {
    kind: 'table',
    id: 'sv7',
    title,
    note: noteOf(TEAR_SV7.tag, TEAR_SV7.basis, TEAR_SV7.pNote, ...sv7Notes(sv7)),
    columns: [TEAR_SV7.measure, ...model.columns.map((column) => column.label)],
    rows: model.sections.flatMap((band) =>
      band.rows.map((row): readonly string[] => [band.title === null ? row.label : `${band.title}: ${row.label}`, ...row.values]),
    ),
  }
}

// ---------------------------------------------------------------- tear sheet only

function setting(data: Analytics, target: TearTarget): string {
  if (target.kind === 'run') return data.context.freq === 'M' ? TEAR.freqMonthly : TEAR.freqDaily
  const cost = data.context.cost
  return cost === null ? MISSING : fillCopy(cost === 1 ? TEAR.costTicks : TEAR.costTicksPlural, { n: cost })
}

function seriesMeta(data: Analytics, target: TearTarget): Pair[] {
  return [
    [TEAR.basis, `${data.basis}: ${data.basis_label}`],
    [DOSSIER.fields.unit, data.unit],
    [TEAR.range, fillCopy(TEAR.rangeValue, { first: data.first, last: data.last })],
    [TEAR.sessions, formatNumber(data.n, 0, { thousands: true })],
    [DOSSIER.fields.periods, formatNumber(data.periods_per_year, 0)],
    [TEAR_EQ.benchmark, data.bench_label ?? TEAR.noBenchmark],
    [target.kind === 'run' ? TEAR.run : TEAR.hypothesis, fillCopy(DOSSIER.fields.context, { name: target.name, setting: setting(data, target) })],
    [DOSSIER.fields.source, data.source],
  ]
}

function drawdownSection(data: Analytics): DossierSection {
  const C = DOSSIER.cols
  const unit = data.drawdown.unit
  const rows = data.drawdown_table.map((row): readonly string[] => [
    row.peak ?? TEAR_DD.start,
    row.trough,
    row.recovery ?? MISSING,
    formatValue(row.depth, unit, 2),
    formatNumber(row.length, 0),
    row.open ? DES.instrument.yes : DES.instrument.no,
  ])
  if (rows.length === 0) return text('drawdowns', DOSSIER.sections.drawdowns, [TEAR_DD.tableEmpty])
  return {
    kind: 'table',
    id: 'drawdowns',
    title: DOSSIER.sections.drawdowns,
    note: noteOf(data.tag, basisLine(data, displayUnit(unit)), fillCopy(TEAR_DD.lengthUnit, { unit: data.rolling.window_unit })),
    columns: [C.peak, C.trough, C.recovery, C.depth, C.length, C.open],
    rows,
  }
}

function yearlySection(data: Analytics): DossierTable {
  const C = DOSSIER.cols
  const m = data.monthly
  return {
    kind: 'table',
    id: 'yearly',
    title: fillCopy(DOSSIER.sections.yearly, { unit: shortUnit(m.unit) || m.unit }),
    note: noteOf(data.tag, basisLine(data, displayUnit(m.unit)), fillCopy(TEAR_MRET.aggregation, { text: m.aggregation })),
    columns: [C.year, C.value],
    rows: m.yearly.map((y): readonly string[] => [String(y.year), formatValue(y.value, m.unit, 2)]),
  }
}

/** The tear sheet as a dossier: key figures and the Sharpe interval first; SV7, drawdowns and yearly returns as proof. */
export function tearDossier(input: TearDossierInput, ctx: DossierContext): Dossier {
  const { target, analytics: data, card } = input
  const registration = card === null ? null : registrationFacts(card)
  return {
    title: fillCopy(DOSSIER.titles.tear, { name: target.name }),
    subtitle: data.label,
    flags: flags(ctx, tearTags(data).map(bracket)),
    meta: [...seriesMeta(data, target), ...(registration === null ? [] : [registration.verdict, registration.sha, registration.round])],
    story: [kpiSection(data), intervalSection(data)],
    evidence: [sv7Section(data), drawdownSection(data), yearlySection(data)],
    sources: [analyticsSource(target, data), ...(card === null ? [] : [hypothesisSource(target.name)])],
    footer: footer(ctx),
  }
}
