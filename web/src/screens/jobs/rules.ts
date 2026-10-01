// The client-side rules of the queue form. They mirror the server's JobSpec (ARCHITECTURE section 8): strategy equal
// to a run_base.FEEDS key, params a JSON object (the server checks its keys against the strategy), variant, start not
// before 2010-01-01, end not after 2022-01-01, run_id matching ^t_[A-Za-z0-9_.-]{1,80}$. The server checks all of it
// again; these rules only spare a round trip and say what is wrong in words. The in-sample fence is the research
// fence (nothing after 2021-12-31), never a choice of the form.
import { JOBS } from '../../copy/jobs'
import { fillCopy } from '../../copy/workspace'
import type { JobSpec } from './types'

/** run_base.FEEDS keys, in the order the runner lists them. */
export const STRATEGIES = ['za_orb', 'overnight', 'volmanaged', 'volmanaged_bh', 'tsmom', 'dtsmom', 'eomtsy'] as const
/** The data variants nq_lab.data knows (EXCLUDE_BY_VARIANT). */
export const VARIANTS = ['repaired', 'vendor'] as const
export const WINDOW_START = '2010-01-01'
/** Exclusive: the research fence, the first day nothing may be read from. */
export const WINDOW_END = '2022-01-01'
export const QUEUE_CAP = 10
export const RUN_ID_PATTERN = /^t_[A-Za-z0-9_.-]{1,80}$/
/** The date a new draft starts from: the earliest start every feed can serve (the daily books begin in June 2010). */
export const DEFAULT_START = '2010-06-01'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface JobDraft {
  readonly strategy: string
  readonly variant: string
  readonly start: string
  readonly end: string
  readonly runId: string
  readonly paramsText: string
}

export type DraftField = keyof JobDraft
export type DraftErrors = Partial<Record<DraftField, string>>

export interface DraftCheck {
  /** The exact body the server takes, or null while any problem remains. */
  readonly spec: JobSpec | null
  readonly errors: DraftErrors
}

export function emptyDraft(): JobDraft {
  return { strategy: STRATEGIES[0], variant: VARIANTS[1], start: DEFAULT_START, end: WINDOW_END, runId: 't_', paramsText: '{}' }
}

/** True for YYYY-MM-DD that names a real calendar day. */
function isRealDate(text: string): boolean {
  const m = DATE.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(Date.UTC(y, mo - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d
}

type ParamsResult = { readonly params: Record<string, unknown> } | { readonly error: string }

function parseParams(text: string): ParamsResult {
  const trimmed = text.trim()
  if (trimmed === '') return { params: {} }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    return { error: fillCopy(JOBS.errors.paramsInvalid, { detail: error instanceof Error ? error.message : 'unreadable' }) }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { error: JOBS.errors.paramsNotObject }
  return { params: value as Record<string, unknown> }
}

function windowErrors(start: string, end: string): DraftErrors {
  const startOk = isRealDate(start)
  const endOk = isRealDate(end)
  return {
    ...(!startOk ? { start: JOBS.errors.startFormat } : start < WINDOW_START ? { start: JOBS.errors.startBefore } : {}),
    ...(!endOk
      ? { end: JOBS.errors.endFormat }
      : end > WINDOW_END
        ? { end: JOBS.errors.endAfter }
        : startOk && end <= start
          ? { end: JOBS.errors.endNotAfterStart }
          : {}),
  }
}

/** Checks a draft against the server's rules; `taken` holds every run id a job or a run already uses. */
export function checkDraft(draft: JobDraft, taken: ReadonlySet<string>): DraftCheck {
  const start = draft.start.trim()
  const end = draft.end.trim()
  const runId = draft.runId.trim()
  const params = parseParams(draft.paramsText)
  const errors: DraftErrors = {
    ...((STRATEGIES as readonly string[]).includes(draft.strategy) ? {} : { strategy: JOBS.errors.strategy }),
    ...((VARIANTS as readonly string[]).includes(draft.variant) ? {} : { variant: JOBS.errors.variant }),
    ...windowErrors(start, end),
    ...(!RUN_ID_PATTERN.test(runId) ? { runId: JOBS.errors.runIdFormat } : taken.has(runId) ? { runId: JOBS.errors.runIdTaken } : {}),
    ...('error' in params ? { paramsText: params.error } : {}),
  }
  if (Object.keys(errors).length > 0 || 'error' in params) return { spec: null, errors }
  const spec: JobSpec = {
    strategy: draft.strategy as JobSpec['strategy'], // checked against STRATEGIES above
    params: params.params,
    variant: draft.variant as JobSpec['variant'], // checked against VARIANTS above
    start,
    end,
    run_id: runId,
  }
  return { spec, errors }
}
