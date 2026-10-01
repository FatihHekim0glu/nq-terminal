// The IB snapshot panel's model (PRD U3; ARCHITECTURE section 8): which state the panel is in, how old the data is,
// the masked accounts and the formatted rows. Pure functions over the GET /api/ib/snapshot body; nothing is
// recomputed from it and nothing here can act on an instruction (no function name is an action).
import { IB } from '../../../copy/ib'
import type { StateItem } from '../liveModel'
import type { IbExecutionRow, IbPositionRow, IbSnapshot, IbSnapshotState, IbSummaryRow, IbWorkingRow } from './ibTypes'

/** The panel polls this often; the backend caches one TWS read for about 5 seconds. */
export const IB_POLL_MS = 10_000
/** A snapshot older than this is shown as stale: three missed polls. */
export const STALE_AFTER_MS = 30_000

/** The tones a row can take: an up or down cell, never the warn tone of the strips. */
export type SideTone = 'up' | 'down'

export type IbViewState = 'loading' | 'error' | 'disabled' | 'unavailable' | 'refused' | 'stale' | 'live'

const NONE = '--'
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const PRICE_DECIMALS = 2
const ACCOUNT_VISIBLE = 2
const NET_LIQUIDATION_TAG = 'NetLiquidation'
const SNAPSHOT_STATES: ReadonlySet<string> = new Set<IbSnapshotState>(['ok', 'disabled', 'unavailable', 'refused'])

const grouped = new Intl.NumberFormat('en-GB', { minimumFractionDigits: PRICE_DECIMALS, maximumFractionDigits: PRICE_DECIMALS })
const whole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 })

const price = (n: number | null): string => (n === null ? NONE : grouped.format(n))
const count = (n: number | null): string => (n === null ? NONE : whole.format(n))
const orDash = (text: string): string => (text === '' ? NONE : text)

/** Epoch milliseconds of a UTC ISO time, or null when it is missing or not a time. */
function parseTime(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The age of the snapshot in milliseconds (null without a usable read time).
 * Without `receivedAtMs` it is the browser clock minus the server's read time, and is negative when the clocks
 * disagree. With `receivedAtMs` (the browser's own time of receipt) the age is judged on the browser clock alone:
 * the server's `age_s` (how long the body had been cached when it was sent) plus the time since receipt, so clock
 * skew and a lagging tick cannot make a fresh body look old or future; it is never negative.
 */
export function snapshotAgeMs(snapshot: IbSnapshot, nowMs: number, receivedAtMs?: number): number | null {
  const at = parseTime(snapshot.fetched_at_utc)
  if (at === null) return null
  if (receivedAtMs === undefined) return nowMs - at
  const servedAgeMs = Number.isFinite(snapshot.age_s) && snapshot.age_s > 0 ? snapshot.age_s * MS_PER_SECOND : 0
  return Math.max(0, nowMs - receivedAtMs) + servedAgeMs
}

/**
 * The panel's state. `failed` is true when the latest read failed; with no body that is "error", with an earlier body
 * the body stays on screen as stale. An ok body is live only when the time it was read proves it fresh: a missing or
 * unreadable time and (without a receipt time) a time in the future are both stale. The other three states are the server's own words.
 */
export function ibViewState(snapshot: IbSnapshot | null, failed: boolean, nowMs: number, receivedAtMs?: number): IbViewState {
  if (snapshot === null) return failed ? 'error' : 'loading'
  if (snapshot.state !== 'ok') return snapshot.state
  if (failed) return 'stale'
  const age = snapshotAgeMs(snapshot, nowMs, receivedAtMs)
  return age !== null && age >= 0 && age <= STALE_AFTER_MS ? 'live' : 'stale'
}

/** "8 s", "5 min", "3 h", "2 d": the largest whole unit, never negative. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND))
  if (seconds < SECONDS_PER_MINUTE) return `${seconds} s`
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours} h`
  return `${Math.floor(hours / HOURS_PER_DAY)} d`
}

/**
 * One account as shown: the API's masked form passes through; anything else (a raw id) is cut to its first two
 * characters and asterisks, so the real id never reaches the screen even if a server sent it.
 */
export function maskAccount(raw: string | null): string {
  if (raw === null || raw === '') return NONE
  if (/^[A-Za-z]{1,2}\*+$/.test(raw)) return raw
  const visible = raw.slice(0, ACCOUNT_VISIBLE)
  return visible + '*'.repeat(Math.max(1, raw.length - visible.length))
}

/** Every account TWS listed, masked, comma separated; a dash when there is none. */
export const maskAccounts = (accounts: readonly string[]): string => (accounts.length === 0 ? NONE : accounts.map(maskAccount).join(', '))

/** Net liquidation from the summary rows: the first row tagged NetLiquidation that holds a number. */
export function netLiquidation(summary: readonly IbSummaryRow[]): string {
  const row = summary.find((r) => r.tag === NET_LIQUIDATION_TAG && r.number !== null)
  return row === undefined || row.number === null ? NONE : `${grouped.format(row.number)} ${row.currency}`.trim()
}

/** "13:59:31 UTC" from a UTC ISO time; a dash when it is missing or unreadable. */
export function formatUtcTime(iso: string | null): string {
  const ms = parseTime(iso)
  return ms === null ? NONE : `${new Date(ms).toISOString().slice(11, 19)} UTC`
}

const signed = (n: number): string => (n > 0 ? `+${whole.format(n)}` : whole.format(n))

export interface PositionRowView {
  readonly key: string
  readonly symbol: string
  readonly secType: string
  readonly exchange: string
  readonly currency: string
  readonly expiry: string
  readonly position: string
  readonly avgCost: string
  readonly tone: SideTone | undefined
}

export interface WorkingRowView {
  readonly key: string
  readonly symbol: string
  readonly action: string
  readonly kind: string
  readonly quantity: string
  readonly limit: string
  readonly status: string
  readonly filled: string
  readonly remaining: string
  readonly tone: SideTone | undefined
}

export interface ExecutionRowView {
  readonly key: string
  readonly time: string
  readonly symbol: string
  readonly side: string
  readonly shares: string
  readonly price: string
  readonly exchange: string
  readonly tone: SideTone | undefined
}

/** Buy side up, sell side down; TWS writes BUY and SELL for instructions and BOT and SLD for fills. */
function sideTone(side: string): SideTone | undefined {
  const s = side.toUpperCase()
  if (s === 'BUY' || s === 'BOT') return 'up'
  if (s === 'SELL' || s === 'SLD') return 'down'
  return undefined
}

function positionRow(p: IbPositionRow, index: number): PositionRowView {
  return {
    key: `${p.account_masked}:${p.local_symbol}:${index}`,
    symbol: p.local_symbol,
    secType: p.sec_type,
    exchange: orDash(p.exchange),
    currency: orDash(p.currency),
    expiry: orDash(p.expiry),
    position: p.quantity > 0 ? signed(p.quantity) : whole.format(p.quantity),
    avgCost: price(p.average_cost),
    tone: p.quantity > 0 ? 'up' : p.quantity < 0 ? 'down' : undefined,
  }
}

export const positionRows = (s: IbSnapshot): PositionRowView[] => s.positions.map(positionRow)

function workingRow(w: IbWorkingRow): WorkingRowView {
  return {
    key: `${w.client_id}:${w.order_id}:${w.perm_id}`,
    symbol: w.local_symbol,
    action: w.action,
    kind: w.order_type,
    quantity: count(w.quantity),
    limit: price(w.limit_price),
    status: w.status,
    filled: count(w.filled),
    remaining: count(w.remaining),
    tone: sideTone(w.action),
  }
}

export const workingRows = (s: IbSnapshot): WorkingRowView[] => s.open_orders.map(workingRow)

function executionRow(e: IbExecutionRow): ExecutionRowView {
  return {
    key: e.exec_id,
    time: orDash(e.time),
    symbol: e.local_symbol,
    side: e.side,
    shares: count(e.shares),
    price: price(e.price),
    exchange: orDash(e.exchange),
    tone: sideTone(e.side),
  }
}

export const executionRows = (s: IbSnapshot): ExecutionRowView[] => s.executions.map(executionRow)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The body when it has the shape the panel reads (a known state, a message and the lists), otherwise null. */
export function readIbSnapshot(raw: unknown): IbSnapshot | null {
  if (!isRecord(raw)) return null
  if (typeof raw.state !== 'string' || !SNAPSHOT_STATES.has(raw.state) || typeof raw.message !== 'string') return null
  const lists = [raw.summary, raw.positions, raw.open_orders, raw.executions, raw.accounts_masked, raw.incomplete, raw.notes]
  if (!lists.every(Array.isArray)) return null
  return raw as unknown as IbSnapshot
}

/** The strip under the panel title: accounts, net liquidation, when it was read, TWS's own clock and the client id. */
export function accountItems(s: IbSnapshot): StateItem[] {
  return [
    { key: 'account', label: IB.account, value: maskAccounts(s.accounts_masked) },
    { key: 'netLiquidation', label: IB.netLiquidation, value: netLiquidation(s.summary) },
    { key: 'asOf', label: IB.asOf, value: formatUtcTime(s.fetched_at_utc) },
    { key: 'twsTime', label: IB.twsTime, value: formatUtcTime(s.server_time_utc) },
    { key: 'clientId', label: IB.clientId, value: String(s.client_id) },
  ]
}
