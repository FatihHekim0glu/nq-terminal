// The event tape on GET /api/audit/oos-log: the newest three entries, re-read every few seconds while
// the tape is shown (it is mounted only when switched on). GET only, like every other read.
import { useApiQuery } from '../api/queries'
import { EventTape, TAPE_LINES } from './EventTape'

export const TAPE_POLL_MS = 10_000

export function LiveEventTape() {
  const log = useApiQuery('/api/audit/oos-log', { query: { limit: TAPE_LINES } }, { refetchInterval: TAPE_POLL_MS, staleTime: 0 })
  const state = log.isError ? 'error' : log.data ? 'ok' : 'loading'
  return <EventTape entries={log.data?.entries ?? []} state={state} />
}
