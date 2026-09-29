// The hypothesis description (DES) as a dossier. Pure, like dossierTear.ts: the detail the panel holds goes
// in, plain text comes out. The spec's hypothesis and pass bar are quoted verbatim, the registered test
// values, checks, cost ladder and blocks are the registry's and the screen JSON's own numbers through DES's
// formatters, and the tear sheet joins only when the browser already holds it (the dossier makes no request).
import { DES, DES_REPORT } from '../../copy/des'
import { DOSSIER } from '../../copy/dossier'
import { fillCopy } from '../../copy/workspace'
import {
  breakEvenText, checkRows, decimalsFor, formatNumber, hypothesisText, passBarText, registrationKpis, ticksLabel,
  type HypothesisCard, type HypothesisDetail,
} from '../../screens/des/desModel'
import { MISSING } from '../../screens/tear/tearFormat'
import {
  analyticsSource, bracket, cell, flags, footer, hypothesisSource, kpiSection, noteOf, registrationFacts, sv7Section,
} from './dossierTear'
import type { DesDossierInput, Dossier, DossierContext, DossierSection } from './types'

const text = (id: string, title: string, lines: readonly string[], verbatim = false): DossierSection => ({ kind: 'text', id, title, lines, verbatim })

/** The frozen text of the spec as lines that join back to it exactly. */
const linesOf = (quoted: string): string[] => quoted.split('\n')

function hypothesisSection(detail: HypothesisDetail): DossierSection {
  const quoted = hypothesisText(detail.spec)
  return quoted === null ? text('hypothesis', DES.hypothesis, [DES_REPORT.none]) : text('hypothesis', DES.hypothesis, linesOf(quoted), true)
}

function passBarSection(detail: HypothesisDetail): DossierSection {
  const quoted = passBarText(detail.spec)
  return quoted === null ? text('passBar', DES.passBar, [DES.passBarNone]) : text('passBar', DES.passBar, linesOf(quoted), true)
}

/** The registered test values: the headline, n, t, p, control p, Bonferroni, Holm and BH q, all basis A. */
function testsSection(card: HypothesisCard): DossierSection {
  const C = DOSSIER.cols
  return {
    kind: 'table',
    id: 'tests',
    title: DES.kpiRow,
    note: null,
    columns: [C.measure, C.value, C.unit, C.basis, C.tag, C.note],
    rows: registrationKpis(card).map((spec): readonly string[] => [
      spec.kpi.label,
      formatNumber(spec.kpi.value, spec.decimals, spec.signed),
      cell(spec.kpi.unit),
      spec.kpi.basis,
      spec.kpi.tag,
      spec.kpi.note ?? '',
    ]),
  }
}

function checkResult(result: 'pass' | 'fail' | 'value'): string {
  return result === 'pass' ? DES.checkPass : result === 'fail' ? DES.checkFail : DES.checkValue
}

/** A check's recorded value as `path value` pairs; a bare scalar has no path. */
function checkValue(value: ReadonlyArray<readonly [string, string]>): string {
  if (value.length === 0) return DES.checkNone
  return value.map(([path, shown]) => (path === '' ? shown : `${path} ${shown}`)).join('; ')
}

function checksSection(card: HypothesisCard): DossierSection {
  const rows = checkRows(card.pass_checks, 1)
  if (rows.length === 0) return text('checks', DES.cards.checks, [DES.checksNone])
  const C = DES.checksColumns
  return {
    kind: 'table',
    id: 'checks',
    title: DES.cards.checks,
    note: DES.thresholdNote,
    columns: [C.number, C.key, C.reading, C.result, C.value],
    rows: rows.map((row): readonly string[] => [String(row.n), row.key, row.reading, checkResult(row.result), checkValue(row.value)]),
  }
}

/** The recorded cost ladder with its unit, basis, tag and break-even line. */
function costsSection(detail: HypothesisDetail, tag: string): DossierSection {
  const d = detail.des
  if (d.cost_ladder.length === 0) return text('costs', DES.cards.cost, [DES.ladderNone])
  const decimals = decimalsFor(d.cost_ladder.map((rung) => rung.value))
  return {
    kind: 'table',
    id: 'costs',
    title: DES.cards.cost,
    note: noteOf(tag, fillCopy(DES.unitLine, { unit: d.cost_ladder_unit ?? MISSING }), DES.basisLine, breakEvenText(d)),
    columns: DES_REPORT.ladderCols,
    rows: d.cost_ladder.map((rung): readonly string[] => [ticksLabel(rung.ticks_per_side), formatNumber(rung.value, decimals, true)]),
  }
}

function blocksSection(detail: HypothesisDetail, tag: string): DossierSection {
  const d = detail.des
  if (d.blocks.length === 0) return text('blocks', DES_REPORT.blocks, [DES.blocksNone])
  const decimals = decimalsFor(d.blocks.map((block) => block.value))
  return {
    kind: 'table',
    id: 'blocks',
    title: DES_REPORT.blocks,
    note: noteOf(tag, fillCopy(DES.unitLine, { unit: d.blocks_unit ?? MISSING }), DES.basisLine),
    columns: DES_REPORT.blockCols,
    rows: d.blocks.map((block): readonly string[] => [block.label, formatNumber(block.value, decimals, true)]),
  }
}

/** What stands in for the tear sheet when it was never opened: it says so and how to get it; nothing is fetched. */
function tearMissing(name: string): DossierSection {
  return text('tearMissing', fillCopy(DOSSIER.titles.tear, { name }), [fillCopy(DOSSIER.tearMissing, { name })])
}

/** The hypothesis description as a dossier: what was claimed and the registered numbers first; checks, costs, blocks and links as proof. */
export function desDossier(input: DesDossierInput, ctx: DossierContext): Dossier {
  const { detail, analytics } = input
  const { card } = detail
  const facts = registrationFacts(card)
  const tag = bracket(card.registered ? DES.preReg : DES.postHoc)
  return {
    title: fillCopy(DOSSIER.titles.des, { name: card.name }),
    subtitle: DOSSIER.desSubtitle,
    flags: flags(ctx, [bracket(card.verdict_badge), tag, ...(card.tag === 'overlay' ? [bracket(DES.overlay)] : [])]),
    meta: [facts.registered, facts.verdict, facts.tag, facts.round, facts.spec, facts.sha, facts.amendments, facts.screen],
    story: [
      hypothesisSection(detail),
      passBarSection(detail),
      testsSection(card),
      ...(analytics === null ? [] : [kpiSection(analytics)]),
    ],
    evidence: [
      ...(analytics === null ? [tearMissing(card.name)] : []),
      checksSection(card),
      costsSection(detail, tag),
      blocksSection(detail, tag),
      text('runs', DES.cards.runs, card.nautilus_runs.length === 0 ? [DES.runsNone] : card.nautilus_runs),
      text('confirmations', DES_REPORT.confirmations, card.confirmations.length === 0 ? [DES.confirmationsNone] : card.confirmations),
      ...(analytics === null ? [] : [sv7Section(analytics)]),
    ],
    sources: [hypothesisSource(card.name), ...(analytics === null ? [] : [analyticsSource({ kind: 'hypothesis', name: card.name }, analytics)])],
    footer: footer(ctx),
  }
}
