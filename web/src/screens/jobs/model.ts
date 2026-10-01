// Pure helpers of the JOBS screen: status words and tones, what a job allows, the queue counts, the polling pace.
import { JOBS } from '../../copy/jobs'
import { fillCopy } from '../../copy/workspace'
import type { JobView } from './types'

export type StatusTone = 'up' | 'down' | 'warn'

export const POLL_ACTIVE_MS = 2000
export const POLL_IDLE_MS = 15000

const ACTIVE: ReadonlySet<string> = new Set(['queued', 'running'])
const UTC_STAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]00:?00)?$/

function known(status: string): status is keyof typeof JOBS.statuses {
  return Object.hasOwn(JOBS.statuses, status)
}

/** The words for a status; a value the screen does not know is shown as it came. */
export function statusLabel(status: string): string {
  return known(status) ? JOBS.statuses[status] : fillCopy(JOBS.statusUnknown, { value: status })
}

/** Colour is only ever on top of the words. An unknown status is a warning. */
export function statusTone(status: string): StatusTone | undefined {
  if (!known(status)) return 'warn'
  if (status === 'ok') return 'up'
  if (status === 'failed') return 'warn'
  if (status === 'error') return 'down'
  return undefined
}

export const isActive = (job: JobView): boolean => ACTIVE.has(job.state)
export const canStop = isActive

/** A run wrote its result.json on exit 0 (ok) and on exit 1 (failed checks); any other end wrote none. */
export function canOpenRun(job: JobView): boolean {
  return (job.state === 'ok' && job.exit_code === 0) || (job.state === 'failed' && job.exit_code === 1)
}

/** The command line text that opens the produced run in RUN. */
export const runLinkLine = (job: JobView): string => `${job.run_id} RUN`

export interface QueueState {
  readonly running: number
  readonly queued: number
  readonly cap: number
  readonly full: boolean
}

/** Counts only active jobs. The server's cap counts the jobs that WAIT (one more may run), so the queue is full when queued reaches the cap. */
export function queueState(jobs: readonly JobView[], cap: number): QueueState {
  const running = jobs.filter((j) => j.state === 'running').length
  const queued = jobs.filter((j) => j.state === 'queued').length
  return { running, queued, cap, full: queued >= cap }
}

export function pollMs(jobs: readonly JobView[] | undefined): number {
  return jobs !== undefined && jobs.some(isActive) ? POLL_ACTIVE_MS : POLL_IDLE_MS
}

/** Every run id a new job may not reuse: each job's own and each run already on disk. */
export function takenRunIds(jobs: readonly JobView[], runIds: readonly string[]): ReadonlySet<string> {
  return new Set([...jobs.map((j) => j.run_id), ...runIds])
}

/** Newest queued first; a new list, the input is not changed. */
export function jobRows(jobs: readonly JobView[]): readonly JobView[] {
  return [...jobs].sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
}

/** A UTC stamp to the second as `YYYY-MM-DD HH:MM:SS`; missing as dashes; unreadable text as it came. */
export function formatUtc(stamp: string | null): string {
  if (stamp === null) return JOBS.missing
  const m = UTC_STAMP.exec(stamp)
  if (m) return `${m[1]} ${m[2]}`
  const ms = Date.parse(stamp)
  return Number.isNaN(ms) ? stamp : new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

/** Run ids of jobs that went from active to a finished run (ok or failed checks) between two reads. */
export function newlyFinished(before: readonly JobView[], after: readonly JobView[]): readonly string[] {
  const wasActive = new Set(before.filter(isActive).map((j) => j.id))
  return after.filter((j) => wasActive.has(j.id) && canOpenRun(j)).map((j) => j.run_id)
}
