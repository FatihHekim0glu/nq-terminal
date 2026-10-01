// Types of the JOBS screen: the generated contract types of /api/jobs (ARCHITECTURE section 8), under the names the
// screen reads. Nothing here is read from disk by the browser.
import type { Schemas } from '../../api/types'

/** The six keys of the server's JobSpec (extra keys are refused, so these are the only ones ever sent). */
export type JobSpec = Schemas['JobSpec']

/**
 * queued and running are active; ok is exit 0, failed is exit 1 (a failed check, the result is still written),
 * error is any other exit, stopped is a job the owner stopped. An unknown wire value is shown as it came
 * (model.statusLabel).
 */
export const JOB_STATUSES = ['queued', 'running', 'ok', 'failed', 'error', 'stopped'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** One job: id, run id, state, spec, UTC stamps, exit code, a fixed message and the tail of its log. */
export type JobView = Schemas['Job']

/** The list route answers the same job shape (with its log tail), so a job read on its own is a JobView. */
export type JobDetail = JobView

/** The queue: newest first, the counts of waiting and running jobs, the cap and whether the runner is on. */
export type JobsList = Schemas['JobList']
