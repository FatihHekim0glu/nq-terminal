// The job queue's client (ARCHITECTURE section 8; PRD U3, DL5): the ONLY module of the web app that sends anything
// but a GET, and the only one besides client.ts that calls fetch. It speaks to /api/jobs and nothing else:
// - reads: GET /api/jobs (the list) and GET /api/jobs/{job_id} (one job with its log tail);
// - launch (release 0.2.0): GET /api/jobs/actions/presets and POST /api/jobs/actions (a backtest from a ledger preset, or an
//   anchor re-run), which end in the same queue;
// - writes: one POST to queue a run, one POST to launch an action and one DELETE to stop a job, both with the X-NQT: 1 header and the JSON content
//   type the server requires (the DELETE has no body), same origin only, redirects refused, no credentials elsewhere.
// Nothing here can place or change a broker order: the queue runs in-sample backtests (run_base.py) and no more.
// The GET-only source scan (client.test.ts, findWriteRequests) must allow exactly this file and exactly these
// methods (see the wiring notes of the JOBS slice); every other module keeps the scan.
import type { JobDetail, JobSpec, JobView, JobsList } from '../screens/jobs/types'
import { ApiError, CLIENT_HEADER, CLIENT_ID } from './client'
import type { Schemas } from './types'

export const JOBS_PATH = '/api/jobs'
/** The header the server requires on a write (a cross-site page cannot set it without a pre-flight the server refuses). */
export const WRITE_HEADER = 'X-NQT'
export const WRITE_HEADER_VALUE = '1'
/** What a job id looks like on the wire; anything else is refused before a request is built. */
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const DETAIL_TEXT_LIMIT = 300

export interface CallOptions {
  readonly signal?: AbortSignal
}

interface Sent {
  readonly method: string
  readonly url: string
  readonly body?: unknown
  readonly write: boolean
  readonly signal?: AbortSignal
}

function refuse(path: string, detail: string): ApiError {
  return new ApiError({ kind: 'refused', path, detail })
}

function jobUrl(jobId: string): string {
  if (!JOB_ID.test(jobId) || jobId === '.' || jobId === '..') throw refuse(JOBS_PATH, 'a job id is letters, digits, underscore, dot or hyphen')
  return `${JOBS_PATH}/${encodeURIComponent(jobId)}`
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function detailText(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== 'object' || !('detail' in parsed)) return null
  const detail = (parsed as { detail: unknown }).detail
  if (typeof detail === 'string') return detail
  if (!Array.isArray(detail)) return null
  return detail.map((item: unknown) => (item !== null && typeof item === 'object' && typeof (item as { msg?: unknown }).msg === 'string' ? (item as { msg: string }).msg : JSON.stringify(item))).join('; ')
}

async function httpError(url: string, response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  const fallback = text.trim().slice(0, DETAIL_TEXT_LIMIT) || response.statusText || `HTTP ${response.status}`
  return new ApiError({ kind: 'http', path: url, status: response.status, body: null, detail: detailText(parsed) ?? fallback })
}

async function call<T>(sent: Sent): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', [CLIENT_HEADER]: CLIENT_ID }
  // The server refuses a write whose content type is not JSON, a DELETE with no body included (api/jobs.py write_guard).
  if (sent.write) {
    headers[WRITE_HEADER] = WRITE_HEADER_VALUE
    headers['Content-Type'] = 'application/json'
  }
  let response: Response
  try {
    response = await globalThis.fetch(sent.url, {
      method: sent.method,
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers,
      ...(sent.body === undefined ? {} : { body: JSON.stringify(sent.body) }),
      signal: sent.signal,
    })
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError({ kind: 'network', path: sent.url, detail: error instanceof Error ? error.message : 'the request failed', cause: error })
  }
  if (!response.ok) throw await httpError(sent.url, response)
  try {
    return (await response.json()) as T
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError({ kind: 'decode', path: sent.url, status: response.status, detail: 'the response was not valid JSON', cause: error })
  }
}

/** GET /api/jobs: every job and the queue cap. */
export const listJobs = (options: CallOptions = {}): Promise<JobsList> =>
  call<JobsList>({ method: 'GET', url: JOBS_PATH, write: false, signal: options.signal })

/** GET /api/jobs/{job_id}: one job with the tail of its log. */
export async function getJob(jobId: string, options: CallOptions = {}): Promise<JobDetail> {
  return call<JobDetail>({ method: 'GET', url: jobUrl(jobId), write: false, signal: options.signal })
}

/** Queues a run: the JobSpec as the JSON body. The server answers the new job, or 409, 422 or 503 in words. */
export const queueJob = (spec: JobSpec, options: CallOptions = {}): Promise<JobView> =>
  call<JobView>({ method: 'POST', url: JOBS_PATH, body: spec, write: true, signal: options.signal })

/** Stops a queued or running job. The server answers the job as it now stands. */
export async function stopJob(jobId: string, options: CallOptions = {}): Promise<JobView> {
  return call<JobView>({ method: 'DELETE', url: jobUrl(jobId), write: true, signal: options.signal })
}

export const PRESETS_PATH = `${JOBS_PATH}/actions/presets`
export const ACTIONS_PATH = `${JOBS_PATH}/actions`

/** GET /api/jobs/actions/presets: the ledger rows that can start a run and the parameters of each strategy. Price free. */
export const getPresets = (options: CallOptions = {}): Promise<Schemas['PresetList']> =>
  call<Schemas['PresetList']>({ method: 'GET', url: PRESETS_PATH, write: false, signal: options.signal })

/** One action of the launch route: a backtest from a preset, or a re-run of a finished run as an anchor. */
export type ActionRequest = Schemas['BacktestAction'] | Schemas['AnchorAction']

/** POST /api/jobs/actions: queues the action in the JOBS queue. The server answers the job and the action as it resolved it, or 404, 409, 422, 429 or 503 in words. */
export const postAction = (request: ActionRequest, options: CallOptions = {}): Promise<Schemas['ActionResult']> =>
  call<Schemas['ActionResult']>({ method: 'POST', url: ACTIONS_PATH, body: request, write: true, signal: options.signal })
