// EXPO (TASKS 9.4; UI_SPEC section 5, P1; look spec 7): a run's exposure and turnover on a screen of
// its own, from GET /api/analytics/run/{id}/exposure. The run books' exposure card (gross and net over
// turnover, per session, with its price basis and reconcile line), the API's means as a table, and every
// session as a virtualised grid, newest first. A run with no snapshots says why. `98) Export` saves the
// per-session rows at full precision. [POST HOC]: the terminal's descriptive view of a run.
import { useMemo, useRef } from 'react'
import { useApiQuery, useRun } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import { csvFileName, exportCsv } from '../../chrome/exportCsv'
import { usePanelPage, type PanelPage } from '../../chrome/PanelChrome.page'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { BOOKS, EXPO } from '../../copy/books'
import { fillCopy } from '../../copy/workspace'
import MonitorGrid, { signTone, type MonitorColumn } from '../../grids/MonitorGrid'
import type { PanelLink } from '../../state/linkGroups'
import { BookBar, EmptyGuide, Failed, Loading } from '../cost/BookFrame'
import { DES } from '../../copy/des'
import { DesCard, Tag } from '../des/DesParts'
import { runTags } from '../runs/model'
import { ExposureCard } from '../tear/RunBooks'
import { formatNumber } from '../tear/tearFormat'
import { exposureCsv, sessionRows, summaryRows, type RunExposure, type SessionRow } from './expoModel'
import '../tear/tear.css'

const DECIMALS = 4

function number(v: number | null): string {
  return formatNumber(v, DECIMALS)
}

const COLUMNS: readonly MonitorColumn<SessionRow>[] = [
  { id: 'date', header: EXPO.cols.date, width: 110, kind: 'name', value: (r) => r.date },
  { id: 'gross', header: EXPO.cols.gross, width: 90, kind: 'num', value: (r) => r.gross, format: (r) => number(r.gross) },
  { id: 'net', header: EXPO.cols.net, width: 90, kind: 'num', value: (r) => r.net, format: (r) => number(r.net), tone: (r) => signTone(r.net) },
  { id: 'turnover', header: EXPO.cols.turnover, width: 90, kind: 'num', value: (r) => r.turnover, format: (r) => number(r.turnover) },
]

function Bar({ run, page, onExport }: { readonly run: string; readonly page: PanelPage | null; readonly onExport?: () => void }) {
  return (
    <BookBar
      title={EXPO.title}
      mnemonic="EXPO"
      fieldLabel={EXPO.field}
      placeholder={EXPO.placeholder}
      current={run}
      helpLine={EXPO.helpLine}
      page={page}
      onExport={onExport}
      actions={run ? [{ label: BOOKS.actionsRun, onSelect: () => requestLine(`${run} RUN`) }] : []}
    />
  )
}

function Summary({ view }: { readonly view: RunExposure }) {
  const rows = useMemo(() => summaryRows(view), [view])
  return (
    <table className="nqt-grid books-table" data-testid="expo-summary">
      <caption className="books-note">{fillCopy(EXPO.summaryCaption, { run: view.run_id })}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} data-row={r.id}>
            <th scope="row" className="name">{r.label}</th>
            <td className="num">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Sessions({ view, panelId }: { readonly view: RunExposure; readonly panelId?: string }) {
  const rows = useMemo(() => sessionRows(view), [view])
  return (
    <div className="books-grid">
      <MonitorGrid
        label={fillCopy(EXPO.gridLabel, { run: view.run_id, n: rows.length })}
        rows={rows}
        columns={COLUMNS}
        rowId={(r) => r.date}
        numbered={false}
        panelId={panelId}
      />
    </div>
  )
}

function Exposure({ run, page, link }: { readonly run: string; readonly page: PanelPage | null; readonly link: PanelLink }) {
  const query = useApiQuery('/api/analytics/run/{run_id}/exposure', { path: { run_id: run } }, { enabled: run !== '' })
  const view = query.data
  // Honesty tags (UI_SPEC section 6) travel with the run wherever it is shown, so a probe or anchor run
  // is labelled here exactly as it is on RUN and RUNS (D20).
  const runDetail = useRun(run)
  const tags = runDetail.data ? runTags(runDetail.data.summary) : []
  const onExport = view?.available
    ? () => {
        const out = exposureCsv(view)
        exportCsv(csvFileName(run, EXPO.exportName), out.csv, out.rows)
      }
    : undefined
  return (
    <>
      <Bar run={run} page={page} onExport={onExport} />
      {query.isPending ? <Loading name={run} /> : null}
      {query.isError ? <Failed name={run} error={query.error} /> : null}
      {view ? (
        <div className="books-page">
          <div className="books-head">
            <h3 className="books-name">{run}</h3>
            <Tag tag={DES.postHoc} />
            {tags.map((tag) => <span key={tag} className="tear-tag">{tag}</span>)}
          </div>
          <div className="books-cols">
            <div className="books-col">
              <DesCard title={fillCopy(EXPO.summaryTitle, { run })}>
                {view.available ? <Summary view={view} /> : <p className="books-status">{view.note}</p>}
              </DesCard>
            </div>
            <div className="books-col"><ExposureCard exposure={view} runId={run} link={link} /></div>
          </div>
          {view.available ? (
            <DesCard title={EXPO.seriesTitle}>
              <Sessions view={view} />
            </DesCard>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export default function ExpoScreen({ context, params }: ScreenProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const run = context?.kind === 'run' ? context.value : null
  return (
    <div className="books" ref={ref} role="group" aria-label={run ? `${EXPO.title} ${run}` : EXPO.title}>
      {run ? <Exposure key={run} run={run} page={page} link={params.group} /> : (
        <>
          <Bar run="" page={page} />
          <EmptyGuide text={EXPO.empty} />
        </>
      )}
    </div>
  )
}
