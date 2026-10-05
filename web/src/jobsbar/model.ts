// Pure helpers of the global job indicator (release 0.2.0): which job leads, how long it has been going, the typical
// time of past runs of the same strategy, and the finish notice a job that ended turns into. Nothing here reads the
// clock or the network; the caller passes `now` and the jobs it already holds.
import { JOBS_BAR } from '../copy/jobsBar'
import { fillCopy } from '../copy/workspace'
import { canOpenRun, isActive } from '../screens/jobs/model'
import type { JobView } from '../screens/jobs/types'

export type IndicatorState = 'none' | 'running' | 'queued' | 'finished' | 'failed'

/** One finished job the reader has not yet been told about. `failed` covers failed checks and an error end. */
export interface FinishNotice {
  readonly jobId: string
  readonly runId: string
  readonly strategy: string
  readonly kind: 'finished' | 'failed'
  readonly canOpen: boolean
  readonly seconds: number | null
  readonly exit: number | null
  readonly state: string
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const MS_PER_SECOND = 1000

function stampMs(stamp: string | null): number | null {
  if (stamp === null) return null
  const ms = Date.parse(stamp)
  return Number.isNaN(ms) ? null : ms
}

/** A span in words that read aloud: `12 s`, `1 min 5 s`, `1 h 2 min`. Never negative, never unreadable. */
export function formatSpan(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0
  const h = Math.floor(total / SECONDS_PER_HOUR)
  const m = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const s = total % SECONDS_PER_MINUTE
  if (h > 0) return fillCopy(JOBS_BAR.span.hours, { h, m })
  if (m > 0) return fillCopy(JOBS_BAR.span.minutes, { m, s })
  return fillCopy(JOBS_BAR.span.seconds, { s })
}

/** The command line text that opens a run in RUN (the same words as the JOBS screen's Open in RUN). */
export const runLine = (runId: string): string => `${runId} RUN`

export const activeJobs = (jobs: readonly JobView[]): readonly JobView[] => jobs.filter(isActive)

/** The job the indicator names: the earliest running one, else the earliest queued one; null when nothing is active. */
export function leadJob(jobs: readonly JobView[]): JobView | null {
  const byCreated = (a: JobView, b: JobView): number => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0)
  const running = jobs.filter((j) => j.state === 'running').sort(byCreated)
  if (running[0] !== undefined) return running[0]
  return jobs.filter((j) => j.state === 'queued').sort(byCreated)[0] ?? null
}

/** Whole seconds since a running job started (a queued job: since it was queued); null when the stamp is unreadable. */
export function elapsedSeconds(job: JobView, nowMs: number): number | null {
  const from = stampMs(job.state === 'running' ? (job.started ?? job.created) : job.created)
  return from === null ? null : Math.max(0, Math.floor((nowMs - from) / MS_PER_SECOND))
}

/** Seconds a run took, from start to finish; only for a run that completed (ok or failed checks). */
export function durationSeconds(job: JobView): number | null {
  if (job.state !== 'ok' && job.state !== 'failed') return null
  const start = stampMs(job.started)
  const end = stampMs(job.finished)
  if (start === null || end === null || end < start) return null
  return (end - start) / MS_PER_SECOND
}

/** The median time of past completed runs of one strategy; null when there is none to learn from. */
export function typicalSeconds(jobs: readonly JobView[], strategy: string): number | null {
  const spans = jobs
    .filter((j) => j.spec.strategy === strategy)
    .map(durationSeconds)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b)
  if (spans.length === 0) return null
  const mid = Math.floor(spans.length / 2)
  return spans.length % 2 === 1 ? (spans[mid] as number) : ((spans[mid - 1] as number) + (spans[mid] as number)) / 2
}

/** Jobs that have ended and whose id is not in `seen`. */
export function unseenFinished(jobs: readonly JobView[], seen: ReadonlySet<string>): readonly JobView[] {
  return jobs.filter((j) => !isActive(j) && !seen.has(j.id))
}

/** The notice for an ended job; null for a job the owner stopped (nothing to report) or one still active. */
export function noticeFor(job: JobView): FinishNotice | null {
  if (job.state !== 'ok' && job.state !== 'failed' && job.state !== 'error') return null
  return {
    jobId: job.id,
    runId: job.run_id,
    strategy: job.spec.strategy,
    kind: job.state === 'ok' ? 'finished' : 'failed',
    canOpen: canOpenRun(job),
    seconds: durationSeconds(job),
    exit: job.exit_code,
    state: job.state,
  }
}

/** The notice in words. */
export function noticeText(notice: FinishNotice): string {
  const N = JOBS_BAR.notice
  const slots = { run: notice.runId, strategy: notice.strategy }
  const span = notice.seconds === null ? null : formatSpan(notice.seconds)
  if (notice.state === 'error') {
    return notice.exit === null ? fillCopy(N.errorNoExit, slots) : fillCopy(N.error, { ...slots, exit: notice.exit })
  }
  if (notice.kind === 'failed') return span === null ? fillCopy(N.failedNoSpan, slots) : fillCopy(N.failed, { ...slots, span })
  return span === null ? fillCopy(N.okNoSpan, slots) : fillCopy(N.ok, { ...slots, span })
}

/** What the indicator shows: a finish notice first (failed over finished), else the active state, else nothing. */
export function indicatorState(jobs: readonly JobView[], notices: readonly FinishNotice[]): IndicatorState {
  if (notices.some((n) => n.kind === 'failed')) return 'failed'
  if (notices.length > 0) return 'finished'
  if (jobs.some((j) => j.state === 'running')) return 'running'
  return jobs.some((j) => j.state === 'queued') ? 'queued' : 'none'
}
