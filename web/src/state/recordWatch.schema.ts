// The shape of the research-record watch (roadmap 16): what a checkpoint holds, what a diff lists, and a
// strict check of a checkpoint read back from storage. Types and this validator only, so the terminal's
// shell can hold them; the diff itself lives in state/recordWatch.ts and loads on demand.
import type { Schemas } from '../api/types'
import { isPlainObject } from './safeStorage'

export const WATCH_VERSION = 1
/** How many of the newest gate log lines the watch follows one by one. */
export const OOS_TRACKED = 2000
/** The largest time a Date holds, in epoch milliseconds; a time beyond it cannot be formatted. */
const MAX_TIME = 8.64e15

/** The six record sets the watch reads, in the sequence it lists them. */
export const WATCH_SOURCES = ['registry', 'confirmations', 'openings', 'ledger', 'oos', 'runs'] as const
export type WatchSource = (typeof WATCH_SOURCES)[number]

export type FieldValue = string | number | boolean | null
export type WatchRecord = Readonly<Record<string, FieldValue>>

export interface SourceSnapshot {
  /** Records in the set; for the gate log, the whole log's line count. */
  readonly count: number
  readonly records: Readonly<Record<string, WatchRecord>>
}

export interface WatchSnapshot {
  readonly version: typeof WATCH_VERSION
  /** Epoch milliseconds the records were read. */
  readonly takenAt: number
  readonly sources: Readonly<Partial<Record<WatchSource, SourceSnapshot>>>
}

export type WatchItemKind = 'appended' | 'updated' | 'changed' | 'removed' | 'shortened'

export interface WatchItem {
  readonly source: WatchSource
  readonly key: string
  readonly kind: WatchItemKind
  /** The field that differs; empty for an appended or removed record. */
  readonly field: string
  readonly before: FieldValue
  readonly after: FieldValue
  /** The command line that opens this record. */
  readonly line: string
}

export interface WatchDiff {
  /** Epoch milliseconds of the checkpoint the records were compared with. */
  readonly since: number
  readonly appended: readonly WatchItem[]
  /** Tracked fields that moved (an amendment count, a confirmation's result). */
  readonly updated: readonly WatchItem[]
  /** Fields that should never move, plus removed records and a shortened gate log. */
  readonly changed: readonly WatchItem[]
}

export type WatchState = 'waiting' | 'baseline' | 'clean' | 'news' | 'changed'

/** What the WATCH <GO> list needs to know of the watch: its state, and the Eastern time it compares with. */
export interface WatchMenuView {
  readonly state: Exclude<WatchState, 'waiting'>
  readonly since: string | null
}

/** Only the fields the watch reads, so a full API answer fits and a test needs no more. */
export interface WatchInputs {
  readonly registry?: {
    readonly rows: ReadonlyArray<Pick<Schemas['RegistryRow'], 'name' | 'p' | 'verdict' | 'spec' | 'spec_sha256' | 'n' | 'control_p' | 'registered' | 'amendments'>>
  }
  readonly confirmations?: ReadonlyArray<Pick<Schemas['Confirmation'], 'name' | 'spec' | 'spec_sha256' | 'parent' | 'alpha' | 'p' | 'verdict' | 'n' | 'opening_closed'>>
  readonly openings?: { readonly openings: ReadonlyArray<Readonly<Record<string, unknown>>> }
  readonly ledger?: {
    readonly rows: ReadonlyArray<Pick<Schemas['LedgerRow'], 'run_id' | 'ts_utc' | 'pnl_total' | 'n_trades' | 't_net_r' | 'fees_total' | 'exp_id' | 'matches_result'>>
  }
  readonly oos?: { readonly entries: ReadonlyArray<Readonly<{ line_no: number }> & Readonly<Record<string, unknown>>>; readonly total: number }
  readonly runs?: ReadonlyArray<Pick<Schemas['RunSummary'], 'run_id' | 'created_utc' | 'pnl_total' | 'n_trades'>>
}

/** A diff with nothing in it, for the states that have nothing to compare. */
export function emptyDiff(since: number): WatchDiff {
  return { since, appended: [], updated: [], changed: [] }
}

const SNAPSHOT_KEYS = ['version', 'takenAt', 'sources']
const SOURCE_KEYS = ['count', 'records']

/** Exactly these own keys, no more and no fewer. */
function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isFieldValue(value: unknown): value is FieldValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function isRecord(value: unknown): boolean {
  // '__proto__' is refused as a key: a record that carries it can only have come from hand-edited storage.
  return isPlainObject(value) && Object.entries(value).every(([key, field]) => key !== '__proto__' && isFieldValue(field))
}

function isSourceSnapshot(value: unknown): value is SourceSnapshot {
  if (!isPlainObject(value) || !hasExactKeys(value, SOURCE_KEYS)) return false
  const { count, records } = value
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return false
  return isPlainObject(records) && Object.entries(records).every(([key, record]) => key !== '__proto__' && isRecord(record))
}

/** Strict: version 1, a whole, in-range takenAt, known sources only, whole counts, records of plain values, nothing else. */
export function isWatchSnapshot(value: unknown): value is WatchSnapshot {
  if (!isPlainObject(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return false
  const { version, takenAt, sources } = value
  if (version !== WATCH_VERSION || typeof takenAt !== 'number') return false
  if (!Number.isSafeInteger(takenAt) || takenAt < 0 || takenAt > MAX_TIME) return false
  if (!isPlainObject(sources)) return false
  const known: readonly string[] = WATCH_SOURCES
  return Object.entries(sources).every(([source, snapshot]) => known.includes(source) && isSourceSnapshot(snapshot))
}
