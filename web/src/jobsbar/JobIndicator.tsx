// The global job indicator (release 0.2.0): a quiet strip in the chrome that shows a backtest while it waits or runs,
// with the time it has taken and the typical time of past runs of that strategy, and a notice when one ends, with
// Open in RUN. It draws nothing when there is nothing to say. Nothing here is a pop-up: the notice is a row in the
// frame, and the screen reader is told through one live region that is always mounted (a region that appears with
// its text is not reliably announced). The ticking elapsed time sits outside any live region on purpose.
import { useLayoutEffect, useRef } from 'react'
import { requestLine } from '../chrome/CommandLine.bus'
import { JOBS_BAR } from '../copy/jobsBar'
import { fillCopy } from '../copy/workspace'
import type { JobView } from '../screens/jobs/types'
import {
  activeJobs,
  elapsedSeconds,
  formatSpan,
  indicatorState,
  leadJob,
  noticeText,
  runLine,
  typicalSeconds,
  type FinishNotice,
} from './model'
import { useJobIndicator, useTickingNow } from './useJobIndicator'
import './JobIndicator.css'

export interface JobIndicatorViewProps {
  readonly jobs: readonly JobView[]
  readonly notices: readonly FinishNotice[]
  readonly nowMs: number
  readonly onOpenRun: (runId: string) => void
  readonly onOpenJobs: () => void
  readonly onDismiss: () => void
}

function ActiveRow({ jobs, lead, nowMs, onOpenJobs }: { readonly jobs: readonly JobView[]; readonly lead: JobView; readonly nowMs: number; readonly onOpenJobs: () => void }) {
  const running = lead.state === 'running'
  const elapsed = elapsedSeconds(lead, nowMs)
  const typical = typicalSeconds(jobs, lead.spec.strategy)
  const others = activeJobs(jobs).length - 1
  return (
    <div className="jobbar-row jobbar-active" role="group" aria-label={JOBS_BAR.label}>
      <b className="jobbar-state">{running ? JOBS_BAR.running : JOBS_BAR.queued}</b>
      <span className="jobbar-run">{fillCopy(JOBS_BAR.runLine, { run: lead.run_id, strategy: lead.spec.strategy })}</span>
      {elapsed === null ? null : <span>{fillCopy(running ? JOBS_BAR.elapsed : JOBS_BAR.waiting, { span: formatSpan(elapsed) })}</span>}
      <span className="jobbar-typical">{typical === null ? JOBS_BAR.typicalNone : fillCopy(JOBS_BAR.typical, { span: formatSpan(typical) })}</span>
      {others > 0 ? <span className="jobbar-more">{fillCopy(JOBS_BAR.more, { n: others })}</span> : null}
      <button type="button" className="jobbar-btn" aria-label={JOBS_BAR.openJobsLabel} onClick={onOpenJobs}>
        {JOBS_BAR.openJobs}
      </button>
    </div>
  )
}

function NoticeRow({ notices, onOpenRun, onDismiss }: { readonly notices: readonly FinishNotice[]; readonly onOpenRun: (runId: string) => void; readonly onDismiss: () => void }) {
  const latest = notices[notices.length - 1]
  if (latest === undefined) return null
  const earlier = notices.length - 1
  return (
    <div className="jobbar-row jobbar-notice" data-kind={latest.kind} role="group" aria-label={JOBS_BAR.notice.group}>
      <span className="jobbar-text">{noticeText(latest)}</span>
      {earlier > 0 ? <span className="jobbar-more">{fillCopy(JOBS_BAR.notice.earlier, { n: earlier })}</span> : null}
      {latest.canOpen ? (
        <button type="button" className="jobbar-btn" aria-label={fillCopy(JOBS_BAR.notice.openLabel, { run: latest.runId })} onClick={() => onOpenRun(latest.runId)}>
          {JOBS_BAR.notice.open}
        </button>
      ) : null}
      <button type="button" className="jobbar-btn" aria-label={JOBS_BAR.notice.dismissLabel} onClick={onDismiss}>
        {JOBS_BAR.notice.dismiss}
      </button>
    </div>
  )
}

/** The command line, where focus goes when no row of the strip is left to hold it (the same fallback as Esc). */
const COMMAND_LINE_ID = 'cmd'

/**
 * Keeps keyboard focus when the notice row unmounts under the button that was used (WCAG 2.4.3). Buttons of the row
 * call `armed()` first; once the notices are gone, if focus was inside the strip and fell to the page, it moves to
 * Open JOBS while a job is active, otherwise to the command line. Focus that went elsewhere in the same turn (Open in
 * RUN opening a panel) or was never in the strip is left alone.
 */
function useFocusAfterNotice(root: React.RefObject<HTMLDivElement | null>, noticeShown: boolean) {
  const armedRef = useRef(false)
  const armed = (): void => {
    armedRef.current = root.current?.contains(document.activeElement) === true
  }
  useLayoutEffect(() => {
    if (noticeShown || !armedRef.current) return
    armedRef.current = false
    const active = document.activeElement
    if (active !== null && active !== document.body && active.isConnected) return
    const target = root.current?.querySelector<HTMLElement>('.jobbar-active button') ?? document.getElementById(COMMAND_LINE_ID)
    target?.focus()
  }, [noticeShown, root])
  return armed
}

/** The strip as a pure view of the jobs, the notices and the clock. */
export function JobIndicatorView({ jobs, notices, nowMs, onOpenRun, onOpenJobs, onDismiss }: JobIndicatorViewProps) {
  const root = useRef<HTMLDivElement>(null)
  const lead = leadJob(jobs)
  const latest = notices[notices.length - 1]
  const armed = useFocusAfterNotice(root, latest !== undefined)
  const openRun = (runId: string): void => {
    armed()
    onOpenRun(runId)
  }
  const dismiss = (): void => {
    armed()
    onDismiss()
  }
  return (
    <div ref={root} className="jobbar" data-chrome="jobs" data-state={indicatorState(jobs, notices)}>
      <p className="sr-only" role="status" aria-live="polite">{latest === undefined ? '' : noticeText(latest)}</p>
      {lead === null ? null : <ActiveRow jobs={jobs} lead={lead} nowMs={nowMs} onOpenJobs={onOpenJobs} />}
      <NoticeRow notices={notices} onOpenRun={openRun} onDismiss={dismiss} />
    </div>
  )
}

/** The indicator for the chrome: reads the job list, ticks while a job is active, and opens the run through the command line. */
export default function JobIndicator() {
  const { jobs, notices, dismiss } = useJobIndicator()
  const nowMs = useTickingNow(leadJob(jobs) !== null)
  const openRun = (runId: string): void => {
    requestLine(runLine(runId))
    dismiss()
  }
  return <JobIndicatorView jobs={jobs} notices={notices} nowMs={nowMs} onOpenRun={openRun} onOpenJobs={() => requestLine('JOBS')} onDismiss={dismiss} />
}
