// The research-record watch (roadmap 16): a local, this-browser comparison of the records the terminal
// reads from the API, with what was there when the viewer last marked them seen. Pure functions. This is
// a lazy module: the shell reaches it only through chrome/RecordWatch.lazy.ts, so nothing in the shell may
// import it (state/recordWatch.split.test.ts). It is a change alarm, not a proof: a digest can collide,
// and a record rewritten and rewritten back between two visits leaves no trace.
import { canonicalJson, fnv1a } from './fnv1a'
import {
  OOS_TRACKED,
  WATCH_SOURCES,
  WATCH_VERSION,
  type FieldValue,
  type SourceSnapshot,
  type WatchDiff,
  type WatchInputs,
  type WatchItem,
  type WatchRecord,
  type WatchSnapshot,
  type WatchSource,
} from './recordWatch.schema'

/** Fields that are allowed to move (a new amendment, a confirmation's result). Every other field is frozen. */
export const TRACKED_FIELDS: Readonly<Record<WatchSource, ReadonlySet<string>>> = {
  registry: new Set(['amendments']),
  confirmations: new Set(['p', 'verdict', 'n', 'opening_closed']),
  openings: new Set(['closed']),
  ledger: new Set(),
  oos: new Set(),
  runs: new Set(),
}

// holm_p, bh_q and family_k are all left out of the registry on purpose: they move whenever the family
// grows, and the lab rewrites family_k on every registered row when one hypothesis is added.
const REGISTRY_FIELDS = ['p', 'verdict', 'spec', 'spec_sha256', 'n', 'control_p', 'registered', 'amendments'] as const
const CONFIRMATION_FIELDS = ['spec', 'spec_sha256', 'parent', 'alpha', 'p', 'verdict', 'n', 'opening_closed'] as const
const LEDGER_FIELDS = ['pnl_total', 'n_trades', 't_net_r', 'fees_total', 'exp_id', 'matches_result'] as const
const RUN_FIELDS = ['created_utc', 'pnl_total', 'n_trades'] as const
/** Closing an opening adds these to its own entry; the close is followed as the `closed` field instead. */
const OPENING_LIFECYCLE: ReadonlySet<string> = new Set(['closed', 'closed_utc'])
// The API derives these from the line at request time; only the raw line is watched.
const OOS_DERIVED: ReadonlySet<string> = new Set([
  'line_no', 'key_set', 'is_sealed', 'past_fence', 'ts_epoch_s', 'start_epoch_s', 'end_epoch_s', 'severity', 'alert',
])

function fieldValue(value: unknown): FieldValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return fnv1a(canonicalJson(value))
}

function pick(row: object, fields: readonly string[]): WatchRecord {
  const source = row as Readonly<Record<string, unknown>>
  return Object.fromEntries(fields.map((field) => [field, fieldValue(source[field])]))
}

/**
 * A digest of an entry without the keys in `leaveOut` and without any key whose value is null or undefined
 * (an optional field the API adds as null must not move the digest). Anything that is not a plain object
 * is digested whole.
 */
function digestWithout(entry: unknown, leaveOut: ReadonlySet<string>): string {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return fnv1a(canonicalJson(entry))
  const kept = Object.fromEntries(Object.entries(entry).filter(([key, value]) => !leaveOut.has(key) && value !== null && value !== undefined))
  return fnv1a(canonicalJson(kept))
}

function sourceOf(entries: ReadonlyArray<readonly [string, WatchRecord]>, count: number = entries.length): SourceSnapshot {
  return { count, records: Object.fromEntries(entries) }
}

/** What the watch keeps of the records it was given; a source that was not read is left out. */
export function snapshotOf(inputs: WatchInputs, takenAt: number): WatchSnapshot {
  const sources: Partial<Record<WatchSource, SourceSnapshot>> = {}
  const { registry, confirmations, openings, ledger, oos, runs } = inputs
  if (registry) sources.registry = sourceOf(registry.rows.map((r) => [r.name, pick(r, REGISTRY_FIELDS)] as const))
  if (confirmations) sources.confirmations = sourceOf(confirmations.map((c) => [c.name, pick(c, CONFIRMATION_FIELDS)] as const))
  if (openings) sources.openings = sourceOf(openings.openings.map((entry, index) => [`#${index}`, { digest: digestWithout(entry, OPENING_LIFECYCLE), closed: entry.closed === true }] as const))
  if (ledger) sources.ledger = sourceOf(ledger.rows.map((r) => [`${r.run_id}@${r.ts_utc ?? ''}`, pick(r, LEDGER_FIELDS)] as const))
  if (oos) {
    const newest = [...oos.entries].sort((a, b) => b.line_no - a.line_no).slice(0, OOS_TRACKED)
    sources.oos = sourceOf(newest.map((entry) => [String(entry.line_no), { digest: digestWithout(entry, OOS_DERIVED) }] as const), oos.total)
  }
  if (runs) sources.runs = sourceOf(runs.map((r) => [r.run_id, pick(r, RUN_FIELDS)] as const))
  return { version: WATCH_VERSION, takenAt, sources }
}

const KEY_COLLATOR = new Intl.Collator('en', { numeric: true })
const SOURCE_RANK: Readonly<Record<WatchSource, number>> = { registry: 0, confirmations: 1, openings: 2, ledger: 3, oos: 4, runs: 5 }

function compareItems(a: WatchItem, b: WatchItem): number {
  return SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || KEY_COLLATOR.compare(a.key, b.key) || KEY_COLLATOR.compare(a.field, b.field)
}

/** The command line that opens a record's screen. */
function lineFor(source: WatchSource, key: string): string {
  if (source === 'registry' || source === 'confirmations') return `${key} DES`
  if (source === 'ledger') return `${key.slice(0, key.lastIndexOf('@') >= 0 ? key.lastIndexOf('@') : key.length)} RUN`
  return source === 'runs' ? `${key} RUN` : 'OOS'
}

function item(source: WatchSource, key: string, kind: WatchItem['kind'], field = '', before: FieldValue = null, after: FieldValue = null): WatchItem {
  return { source, key, kind, field, before, after, line: lineFor(source, key) }
}

/** The smallest gate log line number in a source; Infinity when it holds none. */
function smallestLine(source: SourceSnapshot): number {
  return Math.min(Number.POSITIVE_INFINITY, ...Object.keys(source.records).map(Number))
}

interface Buckets {
  readonly appended: WatchItem[]
  readonly updated: WatchItem[]
  readonly changed: WatchItem[]
}

function compareSource(source: WatchSource, before: SourceSnapshot, after: SourceSnapshot, out: Buckets): void {
  // The gate log is followed through a window of its newest lines. A line below the smallest line in
  // the current window is outside it, not gone; a line below the smallest in the old window was never
  // watched, so it cannot have been appended. (An empty old window has nothing to compare.)
  const gate = source === 'oos'
  const floorNow = gate ? smallestLine(after) : Number.NEGATIVE_INFINITY
  const floorThen = gate && Object.keys(before.records).length > 0 ? smallestLine(before) : Number.NEGATIVE_INFINITY
  const tracked = TRACKED_FIELDS[source]
  for (const [key, was] of Object.entries(before.records)) {
    const now = Object.hasOwn(after.records, key) ? after.records[key] : undefined
    if (now === undefined) {
      if (!gate || Number(key) >= floorNow) out.changed.push(item(source, key, 'removed'))
      continue
    }
    for (const field of Object.keys(now)) {
      const from = was[field]
      const to = now[field]
      if (from === undefined || to === undefined || from === to) continue
      const kind = tracked.has(field) ? 'updated' : 'changed'
      out[kind].push(item(source, key, kind, field, from, to))
    }
  }
  for (const key of Object.keys(after.records)) {
    if (!Object.hasOwn(before.records, key) && (!gate || Number(key) >= floorThen)) out.appended.push(item(source, key, 'appended'))
  }
  if (gate && after.count < before.count) out.changed.push(item(source, '', 'shortened', 'total', before.count, after.count))
}

/**
 * What differs between the checkpoint and a fresh read, for the sources both hold. Appended records are
 * new; a tracked field that moved is `updated`; a frozen field that moved, a removed record and a shorter
 * gate log are `changed`. Each list is sorted by source, then key.
 */
export function diffWatch(before: WatchSnapshot, after: WatchSnapshot): WatchDiff {
  const out: Buckets = { appended: [], updated: [], changed: [] }
  for (const source of WATCH_SOURCES) {
    const then = before.sources[source]
    const now = after.sources[source]
    if (then && now) compareSource(source, then, now, out)
  }
  return {
    since: before.takenAt,
    appended: out.appended.sort(compareItems),
    updated: out.updated.sort(compareItems),
    changed: out.changed.sort(compareItems),
  }
}

/**
 * The checkpoint with a baseline added for each source it has not seen yet (a source whose read failed
 * on an earlier visit), or null when there is nothing to add. Records already in the checkpoint, and its
 * time, are left as they are: a new record must still show as new until the viewer marks it seen.
 */
export function extendCheckpoint(before: WatchSnapshot, after: WatchSnapshot): WatchSnapshot | null {
  const sources: Partial<Record<WatchSource, SourceSnapshot>> = { ...before.sources }
  let added = false
  for (const source of WATCH_SOURCES) {
    const now = after.sources[source]
    if (now && !before.sources[source]) {
      sources[source] = now
      added = true
    }
  }
  return added ? { ...before, sources } : null
}

/** Everything in a fresh read marked as seen: its sources replace the checkpoint's, the rest are kept. */
export function mergeAccepted(before: WatchSnapshot | null, after: WatchSnapshot): WatchSnapshot {
  const sources: Partial<Record<WatchSource, SourceSnapshot>> = { ...before?.sources }
  for (const source of WATCH_SOURCES) {
    const now = after.sources[source]
    if (now) sources[source] = now
  }
  return { version: WATCH_VERSION, takenAt: after.takenAt, sources }
}
