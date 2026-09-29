// DES for a hypothesis (TASKS 6.2; UI_SPEC section 7 "DES"; look spec 7.3): the red function bar with the
// amber hypothesis field, the numbered trapezoid tabs `1) Profile 2) Pass checks 3) Costs and blocks
// 4) Linked runs 5) Robustness`, then the registration line (cyan name, verdict, tag, spec hash with its checks, round),
// the spec's hypothesis and frozen pass bar verbatim (two lines, More opens them), and the selected page.
// A registered risk overlay carries [OVERLAY] beside its verdict. `98) Report` saves the description as
// Markdown. Everything is read from GET /api/hypotheses/{name}; nothing is recomputed.
import { useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState } from 'react'
import { useOosLog } from '../../api/queries'
import { apiQueryKey } from '../../api/queryKey'
import { useHypothesis } from '../../api/queries.screens'
import { requestLine } from '../../chrome/CommandLine.bus'
import { saveText } from '../../chrome/download'
import { postMessage } from '../../chrome/MessageLine.store'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import { usePanelSource, type PanelSource } from '../../chrome/panelSources'
import TabStrip from '../../chrome/TabStrip'
import type { PanelLink } from '../../state/linkGroups'
import { DES, DES_REPORT } from '../../copy/des'
import { OOS_LINK } from '../../copy/oos'
import { fillCopy } from '../../copy/workspace'
import type { DossierInput } from '../../export/dossier/types'
import { requestOosCaller } from '../oos/oosCaller'
import type { Analytics } from '../tear/tearKpis'
import { defaultCost } from '../tear/tearQueries'
import DesCosts from './DesCosts'
import DesLinks from './DesLinks'
import DesPassChecks from './DesPassChecks'
import { DesBar, LoadError, ShaChecks, Status, Tag, VerdictBadge, roving } from './DesParts'
import DesProfile from './DesProfile'
import DesRobustness from './DesRobustness'
import { desTabProvenance } from './desGrab'
import { hypothesisText, passBarText, shortSha, type HypothesisDetail } from './desModel'
import { desReport } from './desReport'
import { DES_NUMBERS, DES_TABS, MAX_NUMBERED_CONFIRMATIONS, MAX_NUMBERED_RUNS, confirmationNumber, runNumber, type DesTab } from './desNumbers'

export interface HypothesisDesProps {
  readonly name: string
  readonly link: PanelLink
}

function Clamped({ label, text, testId }: { readonly label: string; readonly text: string; readonly testId: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="des-clamp">
      <span className="des-clamp-label">{label}</span>
      <pre id={id} className="des-prose" data-clamped={!open} data-testid={testId}>{text}</pre>
      <button type="button" className="des-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} {...roving}>
        {open ? DES.less : DES.more}
      </button>
    </div>
  )
}

/**
 * U07: the way from a hypothesis to its reads of the sealed-window gate. The count is the gate log's own `matched`
 * for this exact caller name (one GET, limit 1), worded as what was queried: a screen may log its reads under its
 * own caller name, and a caller is never inferred from a name stem. Until it is known, or if it cannot be read,
 * the link stands alone. The link asks OOS for the caller in this panel (oosCaller) and then opens it; the count
 * is the link's description for assistive technology.
 */
function GateReads({ name }: { readonly name: string }) {
  const { panelId } = usePanelActions()
  const countId = useId()
  const matched = useOosLog({ caller: name, limit: 1 }).data?.matched
  const count = typeof matched !== 'number'
    ? null
    : fillCopy(matched === 0 ? OOS_LINK.none : matched === 1 ? OOS_LINK.readsOne : OOS_LINK.reads, { n: matched, caller: name })
  const open = () => {
    requestOosCaller(name, panelId)
    requestLine('OOS')
  }
  return (
    <p className="des-note" data-testid="des-gate-reads">
      <button type="button" className="des-link" onClick={open} aria-describedby={count === null ? undefined : countId} {...roving}>{OOS_LINK.link}</button>
      {count === null ? null : <span id={countId}> {count}</span>}
    </p>
  )
}

function Head({ detail }: { readonly detail: HypothesisDetail }) {
  const { card } = detail
  const hypothesis = hypothesisText(detail.spec)
  const passBar = passBarText(detail.spec)
  return (
    <div className="des-head-block">
      <div className="des-head" data-testid="des-head">
        <h3 className="des-name">{card.name}</h3>
        <VerdictBadge badge={card.verdict_badge} />
        {card.tag === 'overlay' ? <Tag tag={DES.overlay} /> : null}
        <Tag tag={card.registered ? DES.preReg : DES.postHoc} />
        <span className="des-spec" title={card.spec_sha256}>{fillCopy(DES.specLine, { sha: shortSha(card.spec_sha256) })}</span>
        <ShaChecks ok={card.spec_sha_ok} rehash={card.spec_rehash_ok} />
        <span className="des-round">{card.round === null ? DES.roundNone : fillCopy(DES.round, { round: card.round })}</span>
      </div>
      {hypothesis ? <Clamped label={DES.hypothesis} text={hypothesis} testId="des-hypothesis" /> : null}
      {passBar ? <Clamped label={DES.passBar} text={passBar} testId="des-passbar" /> : <p className="des-note">{DES.passBarNone}</p>}
      <GateReads name={card.name} />
    </div>
  )
}

/** The panel's Number <GO> items beyond the tabs: the boxes, the linked runs and the confirmations. */
function useDesNumbers(detail: HypothesisDetail | undefined, setTab: (tab: DesTab) => void): void {
  const actions = usePanelActions()
  const items = useMemo<NumberedItem[]>(() => {
    if (!detail) return []
    const { card } = detail
    return [
      { n: DES_NUMBERS.equity, label: DES.cards.equity, run: () => actions.open('EQ') },
      { n: DES_NUMBERS.mt, label: DES.registration.family, run: () => actions.open('MT') },
      { n: DES_NUMBERS.checks, label: DES.cards.checks, run: () => setTab('checks') },
      { n: DES_NUMBERS.costs, label: DES.cards.cost, run: () => setTab('costs') },
      { n: DES_NUMBERS.registration, label: DES.cards.registration, run: () => actions.open('REG') },
      { n: DES_NUMBERS.runs, label: DES.cards.runs, run: () => setTab('links') },
      ...card.nautilus_runs.slice(0, MAX_NUMBERED_RUNS).map((run, i) => ({ n: runNumber(i), label: run, run: () => requestLine(`${run} RUN`) })),
      ...card.confirmations.slice(0, MAX_NUMBERED_CONFIRMATIONS).map((name, i) => ({ n: confirmationNumber(i), label: name, run: () => requestLine(`${name} DES`) })),
    ]
  }, [detail, actions, setTab])
  useNumbered(actions.panelId, 'des-links', items)
}

function Page({ tab, detail, link, onTab }: { readonly tab: DesTab; readonly detail: HypothesisDetail; readonly link: PanelLink; readonly onTab: (tab: DesTab) => void }) {
  if (tab === 'checks') return <DesPassChecks detail={detail} />
  if (tab === 'costs') return <DesCosts detail={detail} />
  if (tab === 'links') return <DesLinks detail={detail} />
  if (tab === 'robustness') return <DesRobustness detail={detail} />
  return <DesProfile detail={detail} link={link} onTab={onTab} />
}

function report(detail: HypothesisDetail): void {
  const file = fillCopy(DES_REPORT.fileName, { name: detail.card.name })
  const saved = saveText(file, desReport(detail), 'text/markdown;charset=utf-8')
  postMessage(saved ? fillCopy(DES_REPORT.done, { file }) : DES_REPORT.unavailable, saved ? 'info' : 'error')
}

export default function HypothesisDes({ name, link }: HypothesisDesProps) {
  const query = useHypothesis(name)
  const actions = usePanelActions()
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const [tab, setTab] = useState<DesTab>('profile')
  const pageId = useId()
  useDesNumbers(query.data, setTab)
  const detail = query.data
  // What the shown tab's numbers came from, for GRAB's caption (roadmap 15); read from the card, nothing asked.
  // A panel keeps ONE provenance, so a tab whose own chart registers it (Profile: equity; Robustness: forks)
  // passes null here (not { provenance: null }), which registers nothing and so never shadows the child.
  usePanelSource(useMemo(() => {
    const provenance = detail ? desTabProvenance(detail, tab) : null
    return provenance ? { provenance } : null
  }, [detail, tab]))
  // What the evidence pack is made from (roadmap 15 part 2): the description on screen and, when the browser
  // already holds it, the hypothesis tear sheet, read from the cache by the exact key the tear sheet asks with
  // (its default cost). The cache is read when the pack is made, so a tear sheet opened after DES is in it;
  // nothing is ever fetched. Registered apart from the provenance above: the dossier is for the whole panel,
  // while the provenance is what the shown tab's chart draws, and neither may hide the other.
  const client = useQueryClient()
  const cost = detail ? defaultCost(detail.card.series_costs) : null
  usePanelSource(useMemo<PanelSource | null>(() => {
    if (!detail) return null
    const dossier = (): DossierInput => ({
      kind: 'des',
      detail,
      analytics: client.getQueryData<Analytics>(apiQueryKey('/api/analytics/hypothesis/{name}', { path: { name }, query: cost === null ? {} : { cost } })) ?? null,
    })
    return { provenance: null, dossier }
  }, [detail, client, name, cost]))
  return (
    <div className="des" ref={ref} aria-label={fillCopy(DES.bodyLabel, { name })} role="group">
      <DesBar title={DES.title} page={page} current={name} onReport={detail ? () => report(detail) : undefined} />
      {detail ? (
        <TabStrip
          panelId={actions.panelId}
          label={DES.tabsLabel}
          tabs={DES_TABS.map((id) => ({ id, label: DES.tabs[id] }))}
          selected={tab}
          onSelect={(id) => setTab(id as DesTab)}
          controls={pageId}
        />
      ) : null}
      {query.isPending ? <Status>{fillCopy(DES.loading, { name })}</Status> : null}
      {query.isError ? <LoadError name={name} error={query.error} /> : null}
      {detail ? (
        <>
          <Head detail={detail} />
          <div id={pageId} role="tabpanel" aria-label={DES.tabs[tab]}>
            <Page tab={tab} detail={detail} link={link} onTab={setTab} />
          </div>
        </>
      ) : null}
    </div>
  )
}
