// Hooks of the global job indicator: one read of the job list that every part of the chrome shares (the same query
// key as the JOBS screen, so a read made there is not made twice), a 1 s clock that runs only while a job is active,
// and the finish notices (a job that ended since this page began watching). The list is read quietly: a server whose
// runner is off, or that does not answer, shows nothing here (the JOBS screen is where that is explained).
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiError } from '../api/client'
import { listJobs } from '../api/jobsClient'
import { POLL_IDLE_MS, isActive, pollMs } from '../screens/jobs/model'
import type { JobView, JobsList } from '../screens/jobs/types'
import { useRunIndexRefresh } from '../screens/jobs/useJobs'
import { noticeFor, unseenFinished, type FinishNotice } from './model'

/** The shared key of the job list: JOBS reads ['jobs', 'list'] too. */
export const JOBS_LIST_KEY = ['jobs', 'list'] as const
/** A server that does not answer is asked again once a minute, not every few seconds. */
export const POLL_ERROR_MS = 60_000
const TICK_MS = 1000

export function feedInterval(data: JobsList | undefined, failed: boolean): number | false {
  if (data !== undefined && !data.enabled) return false
  if (failed && data === undefined) return POLL_ERROR_MS
  return data === undefined ? POLL_IDLE_MS : pollMs(data.jobs)
}

/** The job list. While the runner is off nothing is polled; while a job is active it is read every 2 s. */
export function useJobsFeed(enabled = true): UseQueryResult<JobsList, ApiError> {
  return useQuery<JobsList, ApiError>({
    queryKey: JOBS_LIST_KEY,
    enabled,
    queryFn: ({ signal }) => listJobs({ signal }),
    refetchInterval: (query) => feedInterval(query.state.data, query.state.status === 'error'),
    retry: false,
    staleTime: 0,
  })
}

/** The jobs of the feed, or none when the runner is off or the read failed. */
export function jobsOf(feed: UseQueryResult<JobsList, ApiError>): readonly JobView[] {
  return feed.data !== undefined && feed.data.enabled ? feed.data.jobs : NO_JOBS
}
const NO_JOBS: readonly JobView[] = []

/** `Date.now()`, refreshed every second while `active`; frozen otherwise (nothing ticks for a row that is not shown). */
export function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export interface FinishNotices {
  readonly notices: readonly FinishNotice[]
  readonly dismiss: () => void
}

/**
 * A notice for each job that ended after the first read this page made. Jobs that had already ended at the first read
 * are marked seen without a notice (a reload must not replay old news); a job the owner stopped is marked seen too.
 * Each job id is announced once, even if the list is read again.
 */
export function useFinishNotices(jobs: readonly JobView[], loaded: boolean): FinishNotices {
  const seen = useRef<ReadonlySet<string> | null>(null)
  const [notices, setNotices] = useState<readonly FinishNotice[]>([])
  useEffect(() => {
    if (!loaded) return
    const before = seen.current
    if (before === null) {
      seen.current = new Set(jobs.filter((j) => !isActive(j)).map((j) => j.id))
      return
    }
    const fresh = unseenFinished(jobs, before)
    if (fresh.length === 0) return
    seen.current = new Set([...before, ...fresh.map((j) => j.id)])
    const made = fresh
      .slice()
      .sort((a, b) => ((a.finished ?? '') < (b.finished ?? '') ? -1 : (a.finished ?? '') > (b.finished ?? '') ? 1 : 0))
      .map(noticeFor)
      .filter((n): n is FinishNotice => n !== null)
    if (made.length > 0) setNotices((prev) => [...prev, ...made])
  }, [jobs, loaded])
  const dismiss = useCallback(() => setNotices([]), [])
  return { notices, dismiss }
}

/** Everything the indicator draws: the jobs, the notices, and the run index read again when a job finishes. */
export function useJobIndicator(): FinishNotices & { readonly jobs: readonly JobView[] } {
  const query = useJobsFeed()
  const jobs = jobsOf(query)
  useRunIndexRefresh(query.data?.enabled ? query.data.jobs : undefined)
  const { notices, dismiss } = useFinishNotices(jobs, query.data !== undefined && query.data.enabled)
  return { jobs, notices, dismiss }
}
