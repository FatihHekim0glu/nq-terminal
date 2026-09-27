// COST (TASKS 9.4; UI_SPEC section 5, P1; look spec 7): costs on a screen of their own.
//   hypothesis  the DES cost ladder (EX4 as the screen JSON recorded it) as a numbered table beside the
//               DES bar ladder, with the break-even line; values printed exactly as DES prints them.
//   run         the run books' cost card (EX3 waterfall, EX4 sensitivity ladder) plus the costs by
//               instrument and the sensitivity rungs as tables, from GET /api/analytics/run/{id}/costs.
// `98) Export` saves what the screen shows at full precision. A sealed-window confirmation has its costs
// in its own result and says where to look. Every request is a GET.
import { useMemo, useRef } from 'react'
import { useApiQuery, useHypothesis } from '../../api/queries'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { requestLine } from '../../chrome/CommandLine.bus'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { usePanelPage, type PanelPage } from '../../chrome/PanelChrome.page'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { BOOKS, COST } from '../../copy/books'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { costRows, ladderCsv } from '../blk/ladder'
import LadderTable from '../blk/LadderTable'
import { MISSING, breakEvenText, costInput, type HypothesisDetail } from '../des/desModel'
import { DesCard } from '../des/DesParts'
import { CostsCard } from '../tear/RunBooks'
import { formatNumber } from '../tear/tearFormat'
import { BookBar, EmptyGuide, Failed, HypothesisRoute, Loading, type Confirmation } from './BookFrame'
import { NameLine } from './NameLine'
import { instrumentRows, runCostsCsv, sensitivityRows, type RunCosts } from './runCosts'
import '../tear/tear.css'

interface BarProps {
  readonly name: string
  readonly page: PanelPage | null
  readonly kind: 'hypothesis' | 'run' | null
  readonly onExport?: () => void
}

function Bar({ name, page, kind, onExport }: BarProps) {
  const open = kind === 'run'
    ? { label: BOOKS.actionsRun, onSelect: () => requestLine(`${name} RUN`) }
    : { label: BOOKS.actionsDes, onSelect: () => requestLine(`${name} DES`) }
  return (
    <BookBar
      title={COST.title}
      mnemonic="COST"
      fieldLabel={COST.fieldHypothesis}
      placeholder={COST.placeholder}
      current={name}
      helpLine={COST.helpLine}
      page={page}
      onExport={onExport}
      actions={kind ? [open] : []}
    />
  )
}

function Ladder({ detail }: { readonly detail: HypothesisDetail }) {
  const { card, des } = detail
  const rows = useMemo(() => costRows(des), [des])
  const ladder = useMemo(() => costInput(des, card.name), [des, card.name])
  const unit = des.cost_ladder_unit ?? MISSING
  return (
    <div className="books-page">
      <NameLine card={card} />
      <p className="books-note">{BOOKS.basis}</p>
      {rows.length === 0 ? <p className="books-status">{fillCopy(COST.ladderNone, { name: card.name })}</p> : (
        <div className="books-cols">
          <DesCard title={fillCopy(COST.ladderTitle, { name: card.name })}>
            <LadderTable
              caption={fillCopy(COST.ladderCaption, { name: card.name, unit })}
              columns={{ n: COST.ladderCols.n, label: COST.ladderCols.ticks, value: COST.ladderCols.value }}
              rows={rows}
              testId="cost-ladder-table"
            />
            <p className="books-note" data-testid="cost-break-even">{breakEvenText(des)}</p>
          </DesCard>
          <DesCard title={fillCopy(DES.unitLine, { unit })}>
            {ladder ? <div className="books-ladder"><BarLadder data={ladder} chartId="cost-ladder" /></div> : null}
          </DesCard>
        </div>
      )}
    </div>
  )
}

function exportLadder(detail: HypothesisDetail): void {
  const rows = costRows(detail.des)
  exportCsv(csvFileName(detail.card.name, COST.exportName), ladderCsv([COST.ladderCols.ticks, COST.ladderCols.value], rows), rows.length)
}

function HypothesisCosts({ name, page }: { readonly name: string; readonly page: PanelPage | null }) {
  const query = useHypothesis(name)
  const detail = query.data
  const onExport = detail && detail.des.cost_ladder.length > 0 ? () => exportLadder(detail) : undefined
  return (
    <>
      <Bar name={name} page={page} kind="hypothesis" onExport={onExport} />
      {query.isPending ? <Loading name={name} /> : null}
      {query.isError ? <Failed name={name} error={query.error} /> : null}
      {detail ? <Ladder detail={detail} /> : null}
    </>
  )
}

function InstrumentTable({ costs }: { readonly costs: RunCosts }) {
  const rows = useMemo(() => instrumentRows(costs), [costs])
  const C = COST.byInstrumentCols
  return (
    <div className="nqt-grid-scroll">
      <table className="nqt-grid books-table" data-testid="cost-by-instrument">
        <caption className="books-note">{fillCopy(COST.byInstrumentCaption, { run: costs.run_id, unit: costs.waterfall.unit })}</caption>
        <thead>
          <tr>
            <th scope="col">{C.instrument}</th>
            <th scope="col" className="num">{C.sides}</th>
            <th scope="col" className="num">{C.commissions}</th>
            <th scope="col" className="num">{C.slippage}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.instrument}>
              <th scope="row" className="name">{r.instrument}</th>
              <td className="num">{r.sides}</td>
              <td className="num">{r.commissions}</td>
              <td className="num">{r.slippage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SensitivityTable({ costs }: { readonly costs: RunCosts }) {
  const rows = useMemo(() => sensitivityRows(costs), [costs])
  const C = COST.sensitivityCols
  return (
    <div className="nqt-grid-scroll">
      <table className="nqt-grid books-table" data-testid="cost-sensitivity">
        <caption className="books-note">{fillCopy(COST.sensitivityCaption, { run: costs.run_id })}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">{C.ticks}</th>
            <th scope="col" className="num">{C.usd}</th>
            <th scope="col" className="num">{C.pct}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticks} className={r.charged ? 'charged-row' : undefined}>
              <th scope="row" className="num name">{r.ticks}</th>
              <td className="num">{r.usd}</td>
              <td className="num">{r.pct}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RunCostsView({ run, page }: { readonly run: string; readonly page: PanelPage | null }) {
  const query = useApiQuery('/api/analytics/run/{run_id}/costs', { path: { run_id: run } }, { enabled: run !== '' })
  const costs = query.data
  const onExport = costs
    ? () => {
        const out = runCostsCsv(costs)
        exportCsv(csvFileName(run, COST.exportName), out.csv, out.rows)
      }
    : undefined
  return (
    <>
      <Bar name={run} page={page} kind="run" onExport={onExport} />
      {query.isPending ? <Loading name={run} /> : null}
      {query.isError ? <Failed name={run} error={query.error} /> : null}
      {costs ? (
        <div className="books-page">
          <div className="books-head"><h3 className="books-name">{run}</h3></div>
          <div className="books-cols">
            <div className="books-col"><CostsCard costs={costs} runId={run} /></div>
            <div className="books-col">
              <DesCard title={COST.byInstrumentTitle}><InstrumentTable costs={costs} /></DesCard>
              <DesCard title={fillCopy(COST.sensitivityTitle, { run })}>
                <SensitivityTable costs={costs} />
                <p className="books-note">{fillCopy(COST.costPerTick, { usd: formatNumber(costs.sensitivity.cost_per_tick_usd, 2, { thousands: true }) })}</p>
              </DesCard>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ConfirmationCosts({ conf, page }: { readonly conf: Confirmation; readonly page: PanelPage | null }) {
  return (
    <>
      <Bar name={conf.name} page={page} kind="hypothesis" />
      <p className="books-status">{fillCopy(COST.confirmation, { name: conf.name, parent: conf.parent ?? MISSING })}</p>
    </>
  )
}

export default function CostScreen({ context }: ScreenProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const name = context?.value ?? ''
  const kind = context?.kind === 'run' || context?.kind === 'hypothesis' ? context.kind : null
  return (
    <div className="books" ref={ref} role="group" aria-label={name ? `${COST.title} ${name}` : COST.title}>
      {kind === 'run' ? <RunCostsView key={name} run={name} page={page} /> : null}
      {kind === 'hypothesis' ? (
        <HypothesisRoute
          key={name}
          name={name}
          confirmation={(conf) => <ConfirmationCosts conf={conf} page={page} />}
          hypothesis={(n) => <HypothesisCosts name={n} page={page} />}
        />
      ) : null}
      {kind === null ? (
        <>
          <Bar name="" page={page} kind={null} />
          <EmptyGuide text={COST.empty} />
        </>
      ) : null}
    </div>
  )
}
