// Does the backend this window talks to read TWS right now? Options asks once when it opens, for the case the LIVE
// panel has never mounted (the panel is what sets the shared flag in ibLiveStore.ts). It is the same GET as LIVE's
// (the query key is shared, so an open LIVE panel and this probe read one cache entry), asked one time and not polled.
// The backend answers 200 with a state: `ok` is a read of TWS; `disabled`, `unavailable` and `refused` are the server's
// own words for "no read", so none of them counts. A failed or malformed answer, a body that is not fresh, and a
// request not yet answered all count as "not reading", so the note never claims more than the evidence.
//
// The rule for "an ok body that is fresh" is the LIVE panel's (ibViewState and readIbSnapshot in
// screens/live/ib/ibSnapshotModel.ts), written out here on purpose: importing that module would make it a chunk shared by
// two lazy chunks, and the shell's list of on-demand chunks (index.html's preload map) would grow by one name, which the
// shell budget counts. ibSwitchProbe.test.ts pins this copy to the model on every fixture, so the two cannot drift.
import { useApiQuery } from '../api/queries'

const STALE_AFTER_MS = 30_000
const MS_PER_SECOND = 1000
const LIST_FIELDS = ['summary', 'positions', 'open_orders', 'executions', 'accounts_masked', 'incomplete', 'notes'] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * True when `body` is a well-formed snapshot in state `ok` whose age, judged on the browser's own clock from the moment
 * it was received plus the server's `age_s`, is within the freshness window. Any other body is false.
 */
export function isFreshOkSnapshot(body: unknown, nowMs: number, receivedAtMs: number): boolean {
  if (!isRecord(body) || body.state !== 'ok' || typeof body.message !== 'string') return false
  if (!LIST_FIELDS.every((field) => Array.isArray(body[field]))) return false
  if (typeof body.fetched_at_utc !== 'string' || Number.isNaN(Date.parse(body.fetched_at_utc))) return false
  const age = typeof body.age_s === 'number' && Number.isFinite(body.age_s) && body.age_s > 0 ? body.age_s * MS_PER_SECOND : 0
  return Math.max(0, nowMs - receivedAtMs) + age <= STALE_AFTER_MS
}

/** True only when `enabled` and the one read came back as a fresh, well-formed ok snapshot. No request when not enabled. */
export function useBackendReadsTws(enabled: boolean): boolean {
  const query = useApiQuery('/api/ib/snapshot', {}, { enabled, refetchInterval: false, staleTime: 0, retry: false })
  if (!enabled || query.data === undefined || query.isError) return false
  return isFreshOkSnapshot(query.data, Date.now(), query.dataUpdatedAt)
}
