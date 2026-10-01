// react-query hooks of the JOBS screen. Reads poll fast while a job is active and slowly otherwise; the two writes are
// mutations that are never retried (a retried queue request could queue twice). The reads go through api/jobsClient.ts
// with the generated contract types; the keys here are the screen's own ('jobs', ...).
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { ApiError } from '../../api/client'
import { getJob, listJobs, queueJob, stopJob } from '../../api/jobsClient'
import { POLL_ACTIVE_MS, newlyFinished, pollMs } from './model'
import type { JobDetail, JobSpec, JobView, JobsList } from './types'

const JOBS_KEY = ['jobs'] as const
const RUN_INDEX_KEYS = [['api', '/api/runs'], ['api', '/api/commands']] as const

export function useJobsList(): UseQueryResult<JobsList, ApiError> {
  return useQuery<JobsList, ApiError>({
    queryKey: [...JOBS_KEY, 'list'],
    queryFn: ({ signal }) => listJobs({ signal }),
    refetchInterval: (query) => pollMs(query.state.data?.jobs),
    staleTime: 0,
  })
}

/** One job with its log tail; idle until a job is chosen, and polled while that job is active. */
export function useJobDetail(jobId: string | null, active: boolean): UseQueryResult<JobDetail, ApiError> {
  return useQuery<JobDetail, ApiError>({
    queryKey: [...JOBS_KEY, 'one', jobId],
    queryFn: ({ signal }) => getJob(jobId ?? '', { signal }),
    enabled: jobId !== null,
    refetchInterval: active ? POLL_ACTIVE_MS : false,
    staleTime: 0,
  })
}

export function useQueueJob(): UseMutationResult<JobView, ApiError, JobSpec> {
  const client = useQueryClient()
  return useMutation<JobView, ApiError, JobSpec>({
    mutationFn: (spec) => queueJob(spec),
    onSuccess: () => client.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

export function useStopJob(): UseMutationResult<JobView, ApiError, string> {
  const client = useQueryClient()
  return useMutation<JobView, ApiError, string>({
    mutationFn: (jobId) => stopJob(jobId),
    onSuccess: () => client.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}

/**
 * When a job turns from active to a finished run, the run index (RUNS, RUN, the command line's context list) is
 * read again, so the "Open in RUN" link resolves at once instead of after the next minute's poll.
 */
export function useRunIndexRefresh(jobs: readonly JobView[] | undefined): void {
  const client = useQueryClient()
  const previous = useRef<readonly JobView[] | undefined>(undefined)
  useEffect(() => {
    const before = previous.current
    previous.current = jobs
    if (before === undefined || jobs === undefined) return
    if (newlyFinished(before, jobs).length === 0) return
    for (const queryKey of RUN_INDEX_KEYS) void client.invalidateQueries({ queryKey })
  }, [jobs, client])
}
