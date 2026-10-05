// Re-run anchor (rule 3): a button for one base run that asks the page's launcher for a fresh run of the same
// configuration, follows that job through the shared job list, and shows MATCH or MISMATCH when it has finished.
// It draws nothing until the page provides a launcher. The button stays in place while the job is active
// (enabled and described by the progress, a press while busy is ignored: an aria-disabled button would leave the
// roving walk and the keyboard with it) and the progress sits in one live region that is always mounted.
// It never writes the ledger: an anchor is a run and its comparison, nothing more.
import { useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { requestLine } from '../chrome/CommandLine.bus'
import { ROVING_ATTR } from '../chrome/WorkspaceFocus'
import { useApiQuery } from '../api/queries'
import { JOBS_BAR } from '../copy/jobsBar'
import { fillCopy } from '../copy/workspace'
import { canOpenRun, isActive } from '../screens/jobs/model'
import type { JobView } from '../screens/jobs/types'
import { AnchorViewBadge } from './AnchorBadge'
import { anchorCheckView } from './anchorModel'
import { setAnchorRerun, useAnchorLauncher, useAnchorReruns, type AnchorRerunEntry } from './anchorRerun.store'
import { runLine } from './model'
import { JOBS_LIST_KEY, jobsOf, useJobsFeed } from './useJobIndicator'
import './AnchorBadge.css'

const R = JOBS_BAR.rerun

// The buttons are roving items: the panel they sit in parks every other control at tabindex -1.
const roving = { [ROVING_ATTR]: '' }

/** The words of a failure: an API error's own detail, else the error's message. */
function errorDetail(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'detail' in error && typeof error.detail === 'string' && error.detail !== '') return error.detail
  return error instanceof Error ? error.message : String(error)
}

type Tracked = Extract<AnchorRerunEntry, { readonly phase: 'tracking' }>

function Progress({ entry, job, detail }: { readonly entry: Tracked; readonly job: JobView | null; readonly detail: ReturnType<typeof useRunDetail> }) {
  if (job === null || isActive(job)) return <>{fillCopy(R.queued, { run: entry.runId, state: job?.state ?? 'queued' })}</>
  if (!canOpenRun(job)) return <>{fillCopy(R.ended, { run: entry.runId, state: job.state })}</>
  if (detail.isPending) return <>{fillCopy(R.waitingResult, { run: entry.runId })}</>
  const check = detail.data
  if (check === undefined) return <>{fillCopy(R.noComparison, { run: entry.runId })}</>
  if (check.verdict === 'PENDING') return <>{fillCopy(R.waitingResult, { run: entry.runId })}</>
  return <AnchorViewBadge view={anchorCheckView(check)} />
}

/** The exact comparison of the re-run (every trade row, P&L, fees, Sharpe), not RUN's totals-only anchor pair. */
function useRunDetail(runId: string, enabled: boolean) {
  return useApiQuery('/api/jobs/actions/anchors/{run_id}', { path: { run_id: runId } }, { enabled, retry: false })
}

export default function AnchorRerun({ baseRunId }: { readonly baseRunId: string }) {
  const launch = useAnchorLauncher()
  const client = useQueryClient()
  const statusId = useId()
  const entry = useAnchorReruns((s) => s.byBase[baseRunId])
  const tracked = entry?.phase === 'tracking' ? entry : null
  const feed = useJobsFeed(tracked !== null)
  const job = tracked === null ? null : (jobsOf(feed).find((j) => j.id === tracked.jobId) ?? null)
  const finishedOk = job !== null && canOpenRun(job)
  const detail = useRunDetail(tracked?.runId ?? '', finishedOk)
  if (launch === null) return null

  const busy = entry?.phase === 'starting' || (tracked !== null && (job === null || isActive(job)))
  const done = tracked !== null && !busy
  const start = (): void => {
    if (busy) return
    setAnchorRerun(baseRunId, { phase: 'starting' })
    launch(baseRunId).then(
      (launched) => {
        setAnchorRerun(baseRunId, { phase: 'tracking', jobId: launched.id, runId: launched.run_id })
        void client.invalidateQueries({ queryKey: JOBS_LIST_KEY })
      },
      (error: unknown) => setAnchorRerun(baseRunId, { phase: 'refused', detail: errorDetail(error) }),
    )
  }
  const label = fillCopy(done ? R.againLabel : R.buttonLabel, { base: baseRunId })
  return (
    <span className="anchor-rerun" role="group" aria-label={fillCopy(R.group, { base: baseRunId })}>
      <button type="button" className="anchor-rerun-btn" aria-label={label} aria-describedby={busy ? statusId : undefined} onClick={start} {...roving}>
        {done ? R.again : R.button}
      </button>
      <span id={statusId} className="anchor-rerun-status" role="status" aria-live="polite">
        {entry?.phase === 'starting' ? fillCopy(R.starting, { base: baseRunId }) : null}
        {tracked === null ? null : <Progress entry={tracked} job={job} detail={detail} />}
      </span>
      {tracked !== null && finishedOk ? (
        <button type="button" className="anchor-rerun-btn" aria-label={fillCopy(R.openRun, { run: tracked.runId })} onClick={() => requestLine(runLine(tracked.runId))} {...roving}>
          {JOBS_BAR.notice.open}
        </button>
      ) : null}
      {entry?.phase === 'refused' ? <p className="anchor-rerun-refused" role="alert">{fillCopy(R.refused, { base: baseRunId, detail: entry.detail })}</p> : null}
    </span>
  )
}
