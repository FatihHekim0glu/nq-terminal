// Page 1 of the DES tear sheet (look spec 7.3; UI_SPEC section 7 "DES"): the KPI row of registered
// values, then three columns of boxes (equity; pass checks and cost ladder; registration and linked
// runs), the in-sample against sealed strip where one exists, and the round summary. Numbers in box
// titles are the panel's Number <GO> items (HypothesisDes registers them).
import type { ReactNode } from 'react'
import { useSealedIndex, useConfirmations } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { PanelLink } from '../../state/linkGroups'
import KpiTile, { KpiRow } from '../../tiles/KpiTile'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import DesEquity from './DesEquity'
import DesMarkdown from './DesMarkdown'
import { DesCard, Jump, Pairs, ShaChecks, VerdictBadge, roving } from './DesParts'
import DesSpent from './DesSpent'
import {
  MISSING,
  breakEvenText,
  checkRows,
  decimalsFor,
  formatNumber,
  registrationKpis,
  shortSha,
  spentStrip,
  ticksLabel,
  type HypothesisDetail,
} from './desModel'
import { DES_NUMBERS, runNumber, type DesTab } from './desNumbers'

/** Linked runs listed on page 1; the rest are on page 4. */
const RUNS_ON_PROFILE = 6

export interface DesProfileProps {
  readonly detail: HypothesisDetail
  readonly link: PanelLink
  readonly onTab: (tab: DesTab) => void
}

function ChecksBox({ detail, onTab }: { readonly detail: HypothesisDetail; readonly onTab: (tab: DesTab) => void }) {
  const rows = checkRows(detail.card.pass_checks, 1).filter((r) => r.result !== 'value')
  return (
    <DesCard title={DES.cards.checks} n={DES_NUMBERS.checks} jump={{ label: `${DES.tabs.checks} »`, onRun: () => onTab('checks') }}>
      {rows.length === 0 ? <p className="des-note">{DES.checksNone}</p> : (
        <Pairs rows={rows.map((r) => [r.reading, <span className={r.result === 'pass' ? 'tone-up' : 'tone-down'}>{r.result === 'pass' ? DES.checkPass : DES.checkFail}</span>])} />
      )}
    </DesCard>
  )
}

function LadderBox({ detail, onTab }: { readonly detail: HypothesisDetail; readonly onTab: (tab: DesTab) => void }) {
  const ladder = detail.des.cost_ladder
  const decimals = decimalsFor(ladder.map((r) => r.value))
  return (
    <DesCard title={DES.cards.cost} n={DES_NUMBERS.costs} jump={{ label: `${DES.tabs.costs} »`, onRun: () => onTab('costs') }}>
      {ladder.length === 0 ? <p className="des-note">{DES.ladderNone}</p> : (
        <>
          <Pairs rows={ladder.map((r) => [ticksLabel(r.ticks_per_side), formatNumber(r.value, decimals, true)])} />
          <p className="des-note">{breakEvenText(detail.des)}</p>
          <p className="des-note">{fillCopy(DES.unitLine, { unit: detail.des.cost_ladder_unit ?? MISSING })}</p>
        </>
      )}
    </DesCard>
  )
}

/** The spec's accepted amendments and whether each binds to its spec and result (the registry's check). */
function amendmentsText(card: HypothesisDetail['card']): ReactNode {
  const r = DES.registration
  if (card.amendment_files.length === 0) return r.none
  const ok = card.amendments_ok
  return (
    <>
      {card.amendment_files.join(', ')}{' '}
      <span className={ok === false ? 'tone-down' : ok ? 'tone-up' : undefined}>{ok === false ? r.amendmentsBad : ok ? r.amendmentsOk : r.amendmentsUnknown}</span>
    </>
  )
}

function RegistrationBox({ detail }: { readonly detail: HypothesisDetail }) {
  const actions = usePanelActions()
  const { card } = detail
  const r = DES.registration
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [r.registered, card.registered ? r.yes : r.no],
    [r.verdict, <VerdictBadge badge={card.verdict_badge} />],
    ...(card.verdict_note ? [[r.note, card.verdict_note] as const] : []),
    [r.tag, card.tag === 'overlay' ? r.tagOverlay : card.tag],
    [r.amendments, amendmentsText(card)],
    [r.round, card.round === null ? MISSING : String(card.round)],
    [r.spec, card.spec],
    [r.sha, <span title={card.spec_sha256}>{shortSha(card.spec_sha256)} <ShaChecks ok={card.spec_sha_ok} rehash={card.spec_rehash_ok} /></span>],
    [r.screen, card.screen ?? MISSING],
    [r.history, detail.history.length > 0 ? detail.history.join(', ') : r.none],
    [r.auxiliaries, Object.keys(detail.auxiliaries).join(', ') || r.none],
    [r.family, <><span className="des-no">{`${DES_NUMBERS.mt})`}</span> <Jump label={fillCopy(DES.go, { code: 'MT' })} name={DES.jumpNames.MT} onRun={() => actions.open('MT')} /></>],
  ]
  return (
    <DesCard title={DES.cards.registration} n={DES_NUMBERS.registration} jump={{ label: fillCopy(DES.go, { code: 'REG' }), name: DES.jumpNames.REG, onRun: () => actions.open('REG') }}>
      <Pairs rows={rows} />
    </DesCard>
  )
}

function RunsBox({ detail, onTab }: { readonly detail: HypothesisDetail; readonly onTab: (tab: DesTab) => void }) {
  const runs = detail.card.nautilus_runs
  return (
    <DesCard title={DES.cards.runs} n={DES_NUMBERS.runs} jump={{ label: `${DES.tabs.links} »`, onRun: () => onTab('links') }}>
      {runs.length === 0 ? <p className="des-note">{DES.runsNone}</p> : (
        <ul className="des-runlist">
          {runs.slice(0, RUNS_ON_PROFILE).map((run, i) => (
            <li key={run}>
              <span className="des-no">{`${runNumber(i)})`}</span>
              <button type="button" className="des-link" {...roving} aria-label={fillCopy(DES.openRun, { run })} onClick={() => requestLine(`${run} RUN`)}>
                {run}
              </button>
            </li>
          ))}
        </ul>
      )}
    </DesCard>
  )
}

export default function DesProfile({ detail, link, onTab }: DesProfileProps) {
  const actions = usePanelActions()
  const confirmations = useConfirmations()
  const sealed = useSealedIndex()
  const strip = spentStrip(detail.card, confirmations.data, sealed.data)
  const summaryTitle = detail.summary_name ? fillCopy(DES.cards.summary, { file: detail.summary_name }) : DES.cards.summaryNone
  return (
    <div className="des-page">
      <KpiRow label={DES.kpiRow}>
        {registrationKpis(detail.card).map((k) => (
          <KpiTile key={k.kpi.key} kpi={k.kpi} decimals={k.decimals} signed={k.signed} description={k.description} />
        ))}
      </KpiRow>
      <div className="des-cols">
        <div className="des-col">
          <DesCard title={DES.cards.equity} n={DES_NUMBERS.equity} jump={{ label: fillCopy(DES.go, { code: 'EQ' }), name: DES.jumpNames.EQ, onRun: () => actions.open('EQ') }}>
            <DesEquity card={detail.card} link={link} />
          </DesCard>
        </div>
        <div className="des-col">
          <ChecksBox detail={detail} onTab={onTab} />
          <LadderBox detail={detail} onTab={onTab} />
        </div>
        <div className="des-col">
          <RegistrationBox detail={detail} />
          <RunsBox detail={detail} onTab={onTab} />
        </div>
      </div>
      {strip ? <DesSpent card={detail.card} strip={strip} /> : null}
      {detail.summary_md ? (
        <DesCard title={summaryTitle} className="des-summary">
          <DesMarkdown text={detail.summary_md} />
        </DesCard>
      ) : null}
    </div>
  )
}
