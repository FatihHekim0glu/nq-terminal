// JOBS: the backtest queue (ARCHITECTURE section 8; PRD U3, DL5; the one screen that writes). It lists the jobs with
// their status in words, offers the log tail of one, links a finished run to RUN through the command line, takes a
// new job through a form limited to the JobSpec fields (checked on the client with the server's rules), and stops a
// queued or running job after one confirmation. Writes go through api/jobsClient.ts only (POST and DELETE with the
// X-NQT: 1 header). The queue runs in-sample backtests (backtests/run_base.py) and nothing else: there is no broker
// call anywhere on this screen.
//
//   red bar      96) Actions                                            Backtest queue
//   basis line   in-sample only; writes backtests/output/<run id>; no broker
//   counts       Running 1, queued 2, capacity 10.
//   form         strategy, variant, start, end, run id, parameters  [Queue run]
//   table        run id, strategy, variant, window, status, exit, times, View log / Open in RUN / Stop
//   log tail     the last lines of the chosen job
import { useMemo, useState } from 'react'
import type { ApiError } from '../../api/client'
import { useRuns } from '../../api/queries'
import { requestLine } from '../../chrome/CommandLine.bus'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { JOBS } from '../../copy/jobs'
import { fillCopy } from '../../copy/workspace'
import { actionsItem } from '../oos/panelMenu'
import JobForm from './JobForm'
import JobLog from './JobLog'
import JobsTable from './JobsTable'
import { isActive, queueState, runLinkLine, takenRunIds } from './model'
import { QUEUE_CAP } from './rules'
import type { JobView } from './types'
import { useJobsList, useRunIndexRefresh, useStopJob } from './useJobs'
import './jobs.css'

const NO_JOBS: readonly JobView[] = []
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([404, 405, 501, 503])

function loadMessage(error: ApiError): string {
  return fillCopy(UNAVAILABLE_STATUSES.has(error.status) ? JOBS.unavailable : JOBS.loadError, { detail: error.detail })
}

function Counts({ jobs, cap }: { readonly jobs: readonly JobView[]; readonly cap: number }) {
  const state = queueState(jobs, cap)
  return (
    <p className="jobs-counts">
      {fillCopy(JOBS.counts, { running: state.running, queued: state.queued, cap: state.cap })}
      {state.full ? <b className="jobs-warn"> {JOBS.fullShort}</b> : null}
    </p>
  )
}

function Body({ jobs, cap }: { readonly jobs: readonly JobView[]; readonly cap: number }) {
  const runs = useRuns()
  const stop = useStopJob()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ readonly kind: 'done' | 'refused'; readonly text: string } | null>(null)
  const taken = useMemo(() => takenRunIds(jobs, (runs.data ?? []).map((r) => r.run_id)), [jobs, runs.data])
  const state = queueState(jobs, cap)
  const selected = jobs.find((j) => j.id === selectedId) ?? null

  const onStop = (job: JobView) => {
    setConfirmId(null)
    stop.mutate(job.id, {
      onSuccess: () => setNotice({ kind: 'done', text: fillCopy(JOBS.row.stopped, { runId: job.run_id }) }),
      onError: (error) => setNotice({ kind: 'refused', text: fillCopy(JOBS.row.stopFailed, { runId: job.run_id, detail: error.detail }) }),
    })
  }

  return (
    <>
      <Counts jobs={jobs} cap={cap} />
      <JobForm taken={taken} full={state.full} cap={cap} />
      {notice?.kind === 'refused' ? <p className="jobs-summary" role="alert">{notice.text}</p> : null}
      {notice?.kind === 'done' ? <p className="jobs-note" role="status">{notice.text}</p> : null}
      <JobsTable
        jobs={jobs}
        selectedId={selectedId}
        confirmId={confirmId}
        stopping={stop.isPending}
        onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
        onOpenRun={(job) => requestLine(runLinkLine(job))}
        onAskStop={(id) => { setNotice(null); setConfirmId(id) }}
        onKeep={() => setConfirmId(null)}
        onStop={onStop}
      />
      <JobLog job={selected} active={selected !== null && isActive(selected)} />
    </>
  )
}

export default function JobsScreen(_props: ScreenProps) {
  const actions = usePanelActions()
  const query = useJobsList()
  const jobs = query.data?.jobs ?? NO_JOBS
  useRunIndexRefresh(query.data?.jobs)
  return (
    <div className="jobs-screen">
      <FunctionBar panelId={actions.panelId} title={JOBS.title} items={[actionsItem(actions)]} />
      <p className="jobs-note jobs-basis">{JOBS.basis}</p>
      {query.isError ? <p className="jobs-summary" role="alert">{loadMessage(query.error)}</p> : null}
      {query.isError && !query.data ? null : query.data && !query.data.enabled ? (
        <p className="jobs-summary" role="status">{JOBS.runnerOff}</p>
      ) : query.data ? (
        <Body jobs={jobs} cap={query.data.queue_cap > 0 ? query.data.queue_cap : QUEUE_CAP} />
      ) : (
        <p className="jobs-note" role="status" aria-busy="true">{JOBS.loading}</p>
      )}
    </div>
  )
}
