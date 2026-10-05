// react-query hooks of the Start from flow: the presets read (kept a minute, never retried, so a missing route costs one
// request) and the launch write (never retried: a retried launch could queue twice). A launch refreshes the JOBS keys,
// so the queue and the indicator see the new job at once.
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { JobView } from '../jobs/types'
import { useLaunchTransport } from './launchClient'
import type { LaunchRequest, PresetsView } from './types'

const PRESETS_KEY = ['launch', 'presets'] as const
const JOBS_KEY = ['jobs'] as const
const PRESETS_STALE_MS = 60_000

export function usePresets(): UseQueryResult<PresetsView, Error> {
  const transport = useLaunchTransport()
  return useQuery<PresetsView, Error>({
    queryKey: PRESETS_KEY,
    queryFn: ({ signal }) => transport.presets({ signal }),
    staleTime: PRESETS_STALE_MS,
    retry: false,
  })
}

export function useLaunchAction(): UseMutationResult<JobView, Error, LaunchRequest> {
  const transport = useLaunchTransport()
  const client = useQueryClient()
  return useMutation<JobView, Error, LaunchRequest>({
    mutationFn: (request) => transport.launch(request),
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: JOBS_KEY }),
  })
}
