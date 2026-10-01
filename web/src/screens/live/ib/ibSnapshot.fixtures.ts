// Fixture bodies for GET /api/ib/snapshot, in the shape the backend answers (backend/nq_terminal/models/ib.py). The
// accounts are masked the way the API serves them. A fixed clock keeps the staleness cases exact.
import type { IbSnapshot } from './ibTypes'

export const FETCHED_MS = Date.parse('2026-10-01T14:02:00Z')
export const NOW_FRESH_MS = FETCHED_MS + 8_000
export const NOW_STALE_MS = FETCHED_MS + 5 * 60_000

const BASE = {
  read_only: true,
  order_path: 'none',
  client_id: 95,
  cache_seconds: 5,
  incomplete: [] as string[],
  truncated: false,
  notes: [] as string[],
} as const

export const LIVE_SNAPSHOT: IbSnapshot = {
  ...BASE,
  state: 'ok',
  message: 'Read 2 positions, 1 working order and 1 execution from TWS.',
  accounts_masked: ['DU*******'],
  server_time_utc: '2026-10-01T14:01:59Z',
  fetched_at_utc: '2026-10-01T14:02:00Z',
  cached: false,
  age_s: 0,
  summary: [
    { account_masked: 'DU*******', tag: 'AccountType', value: 'INDIVIDUAL', number: null, currency: '' },
    { account_masked: 'DU*******', tag: 'NetLiquidation', value: '1000482.55', number: 1_000_482.55, currency: 'USD' },
  ],
  positions: [
    { account_masked: 'DU*******', symbol: 'MNQ', local_symbol: 'MNQZ6', sec_type: 'FUT', exchange: 'CME', currency: 'USD', expiry: '20261218', quantity: 6, average_cost: 41_250.5 },
    { account_masked: 'DU*******', symbol: 'MES', local_symbol: 'MESZ6', sec_type: 'FUT', exchange: 'CME', currency: 'USD', expiry: '20261218', quantity: -2, average_cost: 6_020.25 },
  ],
  open_orders: [
    {
      order_id: 17, perm_id: 9001, client_id: 11, account_masked: 'DU*******', symbol: 'MNQ', local_symbol: 'MNQZ6', sec_type: 'FUT',
      action: 'SELL', order_type: 'LMT', quantity: 6, limit_price: 21_900.25, stop_price: null, tif: 'DAY', status: 'Submitted', filled: 0, remaining: 6,
    },
  ],
  executions: [
    {
      exec_id: '0001f4e8.6501a2b3.01.01', time: '20261001 09:59:31 US/Eastern', account_masked: 'DU*******', symbol: 'MNQ', local_symbol: 'MNQZ6', sec_type: 'FUT',
      exchange: 'CME', side: 'BOT', shares: 6, price: 21_850.5, cumulative_quantity: 6, average_price: 21_850.5, order_id: 16, perm_id: 9000, client_id: 11,
    },
  ],
}

export const EMPTY_SNAPSHOT: IbSnapshot = { ...LIVE_SNAPSHOT, positions: [], open_orders: [], executions: [] }

export const DISABLED_SNAPSHOT: IbSnapshot = {
  ...BASE,
  state: 'disabled',
  message: 'The IB snapshot is off: set NQT_IB_READONLY=1 to turn it on.',
  accounts_masked: [],
  server_time_utc: null,
  fetched_at_utc: null,
  cached: false,
  age_s: 0,
  summary: [],
  positions: [],
  open_orders: [],
  executions: [],
}

export const UNAVAILABLE_SNAPSHOT: IbSnapshot = {
  ...DISABLED_SNAPSHOT,
  state: 'unavailable',
  message: 'No TWS or IB Gateway answered on 127.0.0.1:7497 in time.',
}

export const REFUSED_SNAPSHOT: IbSnapshot = {
  ...DISABLED_SNAPSHOT,
  state: 'refused',
  message: 'The read was stopped before any request: the port 7496 is a live port.',
}

/** An ok body whose TWS reply for one section did not finish, with a note TWS sent. */
export const INCOMPLETE_SNAPSHOT: IbSnapshot = {
  ...LIVE_SNAPSHOT,
  incomplete: ['executions'],
  truncated: true,
  notes: ['Market data farm connection is OK:usfarm'],
}
