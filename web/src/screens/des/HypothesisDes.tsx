// DES for a hypothesis (TASKS 6.2; UI_SPEC section 7 "DES"; look spec 7.3): the red function bar with the
// amber hypothesis field, the numbered trapezoid tabs `1) Profile 2) Pass checks 3) Costs and blocks
// 4) Linked runs`, then the registration line (cyan name, verdict, tag, spec hash with its checks, round),
// the spec's hypothesis and frozen pass bar verbatim (two lines, More opens them), and the selected page.
// Everything is read from GET /api/hypotheses/{name}; nothing is recomputed.
import { useId, useMemo, useRef, useState } from 'react'
import { useHypothesis } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { useNumbered, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import TabStrip from '../../chrome/TabStrip'
import type { PanelLink } from '../../state/linkGroups'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import DesChecks from './DesChecks'
import DesCosts from './DesCosts'
import DesLinks from './DesLinks'
import { DesBar, LoadError, ShaChecks, Status, Tag, VerdictBadge, roving } from './DesParts'
import DesProfile from './DesProfile'
import { hypothesisText, passBarText, shortSha, type HypothesisDetail } from './desModel'
import { DES_NUMBERS, DES_TABS, MAX_NUMBERED_RUNS, confirmationNumber, runNumber, type DesTab } from './desNumbers'

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

function Head({ detail }: { readonly detail: HypothesisDetail }) {
  const { card } = detail
  const hypothesis = hypothesisText(detail.spec)
  const passBar = passBarText(detail.spec)
  return (
    <div className="des-head-block">
      <div className="des-head" data-testid="des-head">
        <h3 className="des-name">{card.name}</h3>
        <VerdictBadge badge={card.verdict_badge} />
        <Tag tag={card.registered ? DES.preReg : DES.postHoc} />
        <span className="des-spec" title={card.spec_sha256}>{fillCopy(DES.specLine, { sha: shortSha(card.spec_sha256) })}</span>
        <ShaChecks ok={card.spec_sha_ok} rehash={card.spec_rehash_ok} />
        <span className="des-round">{card.round === null ? DES.roundNone : fillCopy(DES.round, { round: card.round })}</span>
      </div>
      {hypothesis ? <Clamped label={DES.hypothesis} text={hypothesis} testId="des-hypothesis" /> : null}
      {passBar ? <Clamped label={DES.passBar} text={passBar} testId="des-passbar" /> : <p className="des-note">{DES.passBarNone}</p>}
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
      ...card.confirmations.map((name, i) => ({ n: confirmationNumber(i), label: name, run: () => requestLine(`${name} DES`) })),
    ]
  }, [detail, actions, setTab])
  useNumbered(actions.panelId, 'des-links', items)
}

function Page({ tab, detail, link, onTab }: { readonly tab: DesTab; readonly detail: HypothesisDetail; readonly link: PanelLink; readonly onTab: (tab: DesTab) => void }) {
  if (tab === 'checks') return <DesChecks detail={detail} />
  if (tab === 'costs') return <DesCosts detail={detail} />
  if (tab === 'links') return <DesLinks detail={detail} />
  return <DesProfile detail={detail} link={link} onTab={onTab} />
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
  return (
    <div className="des" ref={ref} aria-label={fillCopy(DES.bodyLabel, { name })} role="group">
      <DesBar title={DES.title} page={page} current={name} />
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
