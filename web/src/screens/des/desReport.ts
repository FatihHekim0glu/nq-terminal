// 98) Report on DES (look spec 7.3 `98)Report`): the description the panel shows, as a Markdown file
// saved in the viewer's browser. Built from the response the screen already holds; no request is made
// and nothing is recomputed. Numbers carry the precision the screen prints; the spec's hypothesis and
// pass bar are quoted verbatim; every section names where its values come from.
import type { Schemas } from '../../api/types'
import { DES, DES_REPORT } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import {
  MISSING, breakEvenText, checkRows, decimalsFor, formatNumber, hypothesisText, passBarText, registrationKpis, ticksLabel,
  type HypothesisDetail,
} from './desModel'

type Cell = string | number | null | undefined

/** A Markdown table cell: pipes escaped, line breaks flattened, `--` for a missing value. */
export function mdCell(value: Cell): string {
  if (value === null || value === undefined || value === '') return MISSING
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function table(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<Cell>>): string[] {
  return [
    `| ${header.map(mdCell).join(' | ')} |`,
    `|${header.map(() => ' --- ').join('|')}|`,
    ...rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`),
  ]
}

const section = (title: string, lines: readonly string[]): string[] => ['', `## ${title}`, '', ...lines]
const quote = (text: string): string[] => text.split(/\r?\n/).map((l) => `> ${l}`)

function registration(detail: HypothesisDetail): string[] {
  const c = detail.card
  const R = DES_REPORT
  const amendments = c.amendment_files.length === 0
    ? R.amendmentsNone
    : fillCopy(R.amendmentsList, { files: c.amendment_files.join(', '), ok: c.amendments_ok === false ? R.amendmentsBad : c.amendments_ok ? R.amendmentsOk : R.amendmentsUnknown })
  return [
    `- ${R.registered}: ${c.registered ? DES.registration.yes : DES.registration.no}`,
    `- ${R.verdict}: [${c.verdict_badge}]${c.verdict_note ? ` (${c.verdict_note})` : ''}`,
    `- ${R.tag}: ${c.tag}`,
    `- ${R.round}: ${c.round === null ? MISSING : c.round}`,
    `- ${R.spec}: ${c.spec}`,
    `- ${R.sha}: ${c.spec_sha256} (${c.spec_sha_ok ? R.registryOk : R.registryBad}, ${c.spec_rehash_ok ? R.rehashOk : R.rehashBad})`,
    `- ${R.amendments}: ${amendments}`,
    `- ${R.screen}: ${c.screen ?? MISSING}`,
  ]
}

function testValues(detail: HypothesisDetail): string[] {
  const rows = registrationKpis(detail.card).map((k) => [
    k.kpi.label, formatNumber(k.kpi.value, k.decimals, k.signed), k.kpi.unit, k.kpi.tag,
  ])
  return table(DES_REPORT.testCols, rows)
}

function checks(detail: HypothesisDetail): string[] {
  const rows = checkRows(detail.card.pass_checks, 1)
  if (rows.length === 0) return [DES.checksNone]
  return table(DES_REPORT.checkCols, rows.map((r) => [r.n, r.reading, r.result === 'pass' ? DES.checkPass : r.result === 'fail' ? DES.checkFail : DES.checkValue, r.value.map(([k, v]) => `${k} ${v}`).join('; ')]))
}

function ladder(detail: HypothesisDetail): string[] {
  const d = detail.des
  if (d.cost_ladder.length === 0) return [DES.ladderNone]
  const decimals = decimalsFor(d.cost_ladder.map((r) => r.value))
  return [
    fillCopy(DES.unitLine, { unit: d.cost_ladder_unit ?? MISSING }),
    '',
    ...table(DES_REPORT.ladderCols, d.cost_ladder.map((r) => [ticksLabel(r.ticks_per_side), formatNumber(r.value, decimals, true)])),
    '',
    breakEvenText(d),
  ]
}

function blocks(detail: HypothesisDetail): string[] {
  const d = detail.des
  if (d.blocks.length === 0) return [DES.blocksNone]
  const decimals = decimalsFor(d.blocks.map((b) => b.value))
  return [fillCopy(DES.unitLine, { unit: d.blocks_unit ?? MISSING }), '', ...table(DES_REPORT.blockCols, d.blocks.map((b) => [b.label, formatNumber(b.value, decimals, true)]))]
}

/** The hypothesis DES as Markdown. */
export function desReport(detail: HypothesisDetail): string {
  const c = detail.card
  const hyp = hypothesisText(detail.spec)
  const bar = passBarText(detail.spec)
  const lines = [
    fillCopy(DES_REPORT.title, { name: c.name }),
    '',
    fillCopy(DES_REPORT.source, { name: c.name }),
    ...section(DES_REPORT.registration, registration(detail)),
    ...section(DES_REPORT.tests, testValues(detail)),
    ...section(DES.hypothesis, hyp ? quote(hyp) : [DES_REPORT.none]),
    ...section(DES.passBar, bar ? quote(bar) : [DES.passBarNone]),
    ...section(DES.cards.checks, checks(detail)),
    ...section(DES.cards.cost, ladder(detail)),
    ...section(DES_REPORT.blocks, blocks(detail)),
    ...section(DES.cards.runs, c.nautilus_runs.length === 0 ? [DES.runsNone] : c.nautilus_runs.map((r) => `- ${r}`)),
    ...section(DES_REPORT.confirmations, c.confirmations.length === 0 ? [DES.confirmationsNone] : c.confirmations.map((r) => `- ${r}`)),
  ]
  return `${lines.join('\n')}\n`
}

const money = (v: number) => `${v.toFixed(2)} USD`

/** The instrument DES as Markdown. */
export function instrumentReport(d: Schemas['InstrumentDes'], name: string): string {
  const I = DES_REPORT.instrument
  const k = d.contract
  const contract = k
    ? table(I.pairCols, [
        [I.symbol, k.symbol], [I.venue, k.venue], [I.sector, k.sector], [I.units, k.units], [I.tick, k.tick],
        [I.tickUsd, money(k.tick_usd)], [I.pointValue, money(k.point_value_usd)], [I.costPerSide, money(k.cost_per_side_1tick_usd)], [I.source, k.source],
      ])
    : [I.noContract]
  const codes = d.month_codes.map((m) => `${m.name} ${m.code}${m.active ? ` ${I.listed}` : ''}`).join(', ')
  const r = d.related
  const related = table(I.pairCols, [
    [I.lastTrading, r.last_trading_rule], [I.firstNotice, r.first_notice_rule], [I.rollRule, r.roll_rule],
    [I.nextContract, r.next_contract], [I.nextRoll, r.next_roll], [I.asOf, r.as_of_et], [I.source, r.source],
  ])
  const cov = d.coverage
  const lines = [
    fillCopy(I.title, { name }),
    '',
    d.label,
    ...section(I.contract, contract),
    ...section(I.months, [codes, '', fillCopy(I.cycle, { source: d.cycle_source ?? MISSING })]),
    ...section(I.hours, [...table(I.hourCols, d.hours.map((h) => [h.label, h.value, h.source])), '', d.hours_note]),
    ...section(I.related, related),
    ...section(I.coverage, [
      fillCopy(I.window, { from: cov.in_sample_from ?? MISSING, to: cov.in_sample_to, start: cov.fence.is_start, end: cov.fence.is_end }),
      fillCopy(I.reads, { logged: cov.gate_reads_logged, process: cov.gate_reads_this_process }),
      '',
      ...table(I.seriesCols, cov.series.map((s) => [s.timeframe, s.variant, s.file, s.rows, s.first_ts, s.extends_past_fence === null ? null : s.extends_past_fence ? DES.instrument.yes : DES.instrument.no])),
    ]),
    ...section(I.notes, d.notes.map((n) => `- ${n.title}: ${n.text} (${n.source})`)),
  ]
  return `${lines.join('\n')}\n`
}
