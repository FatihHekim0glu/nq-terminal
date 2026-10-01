// The demo's answers for the P2 paths that have an honest body: the backtest queue is off and the IB snapshot is off,
// as they are on any server that has not turned them on. Everything else P2 is NOT_IN_DEMO (see routes.ts).
import type { SuccessOf } from '../../api/types'

/** The queue as a server with no job runner reports it: empty and not enabled. */
export const JOBS_OFF: SuccessOf<'/api/jobs'> = { jobs: [], queued: 0, running: 0, queue_cap: 10, enabled: false }

/** The IB snapshot as a server without NQT_IB_READONLY reports it: nothing was contacted. */
export const IB_OFF: SuccessOf<'/api/ib/snapshot'> = {
  state: 'disabled',
  message: 'The IB snapshot is off: the demo never contacts TWS.',
  read_only: true,
  order_path: 'none',
  client_id: 95,
  accounts_masked: [],
  server_time_utc: null,
  fetched_at_utc: null,
  cached: false,
  age_s: 0,
  cache_seconds: 5,
  incomplete: [],
  truncated: false,
  notes: [],
  summary: [],
  positions: [],
  open_orders: [],
  executions: [],
}
