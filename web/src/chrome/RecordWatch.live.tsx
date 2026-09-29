// The research-record watch in the shell (roadmap 16): after the first idle moment it reads six records
// the terminal already serves, compares them with this browser's checkpoint, and offers the result to the
// status line (WatchSegment), the command line (WATCH and WATCH SEEN) and the grids (useWatchMarks).
// SHELL RULE: the diff, the WATCH <GO> list and their long copy load through one dynamic import of
// ./RecordWatch.lazy, so this file must never import them statically (state/recordWatch.split.test.ts).
// A local change watch from this browser, not a proof.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useConfirmations, useLedger, useOosLog, useOpenings, useRegistry, useRuns } from '../api/queries'
import { WATCH } from '../copy/watch'
import { fillCopy } from '../copy/workspace'
import {
  WATCH_SOURCES,
  emptyDiff,
  type WatchDiff,
  type WatchInputs,
  type WatchItem,
  type WatchMenuView,
  type WatchSnapshot,
  type WatchSource,
  type WatchState,
} from '../state/recordWatch.schema'
import { useRecordWatchStore } from '../state/recordWatch.store'
import type { MenuModel } from './CommandLine.menus'
import { postMessage } from './MessageLine.store'

/** How long a browser without an idle callback waits before the six reads start. */
const IDLE_DELAY_MS = 2000
/** The latest an idle callback may wait: a busy page still starts the reads. */
const IDLE_TIMEOUT_MS = 4000
/** The gate log is read with the OOS screen's own unfiltered request, so both share one cache entry. */
const OOS_READ = { limit: 5000 } as const

export type WatchMark = 'new' | 'changed'
type Marks = Readonly<Record<WatchSource, ReadonlyMap<string, WatchMark>>>

/** What the rest of the terminal sees of the watch. */
export interface RecordWatchView {
  readonly state: WatchState
  readonly diff: WatchDiff
  /** The Eastern time of the checkpoint the records were compared with; null while waiting. */
  readonly since: string | null
  /** The text of the first rewritten record, for the segment's tooltip. */
  readonly title?: string | null
  /** The WATCH <GO> list; null until the diff has loaded. */
  menu(): MenuModel | null
  /** WATCH SEEN <GO>: mark what was read as seen. The text to post, or null before the first read. */
  accept(): string | null
}

/** The lazy module's side of the contract, so its shape is checked here without importing its types. */
interface WatchLazy {
  snapshotOf(inputs: WatchInputs, takenAt: number): WatchSnapshot
  diffWatch(before: WatchSnapshot, after: WatchSnapshot): WatchDiff
  extendCheckpoint(before: WatchSnapshot, after: WatchSnapshot): WatchSnapshot | null
  mergeAccepted(before: WatchSnapshot | null, after: WatchSnapshot): WatchSnapshot
  watchMenu(view: WatchMenuView, diff: WatchDiff): MenuModel
  bootText(diff: WatchDiff, since: string): string | null
  itemText(item: WatchItem): string
}

let etFormat: Intl.DateTimeFormat | undefined

/** A time as Eastern day, month and clock, for the copy (the terminal's clock is Eastern). */
export function formatEt(ms: number): string {
  etFormat ??= new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return etFormat.format(ms)
}

/** True after the browser's first idle moment (at the latest 4 s), or after `delayMs` where it has no idle callback. */
export function useIdleReady(delayMs: number = IDLE_DELAY_MS): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: IDLE_TIMEOUT_MS })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => setReady(true), delayMs)
    return () => window.clearTimeout(id)
  }, [delayMs])
  return ready
}

// ---- the view store -----------------------------------------------------------------------------------

interface WatchStore {
  readonly view: RecordWatchView
  /** The latest read of the records, kept so WATCH SEEN can mark it. */
  readonly snapshot: WatchSnapshot | null
  readonly lazy: WatchLazy | null
  readonly marks: Marks
}

const NO_MARKS = new Map<string, WatchMark>()
const EMPTY_MARKS: Marks = { registry: NO_MARKS, confirmations: NO_MARKS, openings: NO_MARKS, ledger: NO_MARKS, oos: NO_MARKS, runs: NO_MARKS }

function menu(): MenuModel | null {
  const { lazy, view } = useWatchStore.getState()
  return lazy && view.state !== 'waiting' ? lazy.watchMenu({ state: view.state, since: view.since }, view.diff) : null
}

function accept(): string | null {
  const { lazy, snapshot } = useWatchStore.getState()
  if (!lazy || !snapshot) return null
  const now = Date.now()
  const kept = useRecordWatchStore.getState()
  const merged = lazy.mergeAccepted(kept.checkpoint, { ...snapshot, takenAt: now })
  if (!kept.setCheckpoint(merged)) return WATCH.unsaved
  show(lazy, snapshot, merged, emptyDiff(merged.takenAt), 'clean')
  return fillCopy(WATCH.seen, { time: formatEt(now) })
}

const WAITING: RecordWatchView = { state: 'waiting', diff: emptyDiff(0), since: null, title: null, menu, accept }

const useWatchStore = create<WatchStore>()(() => ({ view: WAITING, snapshot: null, lazy: null, marks: EMPTY_MARKS }))

/** What the grids mark: new and moved records as NEW, rewritten ones as CHG. Removed rows are not on a grid. */
function marksOf(diff: WatchDiff, previous: Marks): Marks {
  const next = Object.fromEntries(WATCH_SOURCES.map((source) => [source, new Map<string, WatchMark>()])) as Record<WatchSource, Map<string, WatchMark>>
  for (const item of [...diff.appended, ...diff.updated]) next[item.source].set(item.key, 'new')
  for (const item of diff.changed) if (item.kind === 'changed') next[item.source].set(item.key, 'changed')
  const same = (a: ReadonlyMap<string, WatchMark>, b: ReadonlyMap<string, WatchMark>): boolean => a.size === b.size && [...a].every(([key, mark]) => b.get(key) === mark)
  // A map that did not change keeps its identity, so a grid's memoised columns are not rebuilt by a re-read.
  return Object.fromEntries(WATCH_SOURCES.map((source) => [source, same(next[source], previous[source]) ? previous[source] : next[source]])) as Marks
}

function show(lazy: WatchLazy, snapshot: WatchSnapshot, checkpoint: WatchSnapshot, diff: WatchDiff, state: Exclude<WatchState, 'waiting'>): void {
  const first = diff.changed[0]
  const view: RecordWatchView = { state, diff, since: formatEt(checkpoint.takenAt), title: state === 'changed' && first ? lazy.itemText(first) : null, menu, accept }
  useWatchStore.setState((prev) => ({ view, snapshot, lazy, marks: marksOf(diff, prev.marks) }))
}

/** The watch as the chrome shows it. */
export function useRecordWatch(): RecordWatchView {
  return useWatchStore((s) => s.view)
}

/** The rows of one source that are new or rewritten, by the key the watch uses for that source. */
export function useWatchMarks(source: WatchSource): ReadonlyMap<string, WatchMark> {
  return useWatchStore((s) => s.marks[source])
}

/** Back to waiting with nothing read (tests). */
export function resetRecordWatchView(): void {
  useWatchStore.setState({ view: WAITING, snapshot: null, lazy: null, marks: EMPTY_MARKS })
}

// ---- reading -------------------------------------------------------------------------------------------

let lazyLoad: Promise<WatchLazy> | null = null
let bootPosted = false

/** The diff module, fetched once; a failed fetch is forgotten so the next read tries again. */
function loadLazy(): Promise<WatchLazy> {
  lazyLoad ??= import('./RecordWatch.lazy').catch((error: unknown) => {
    lazyLoad = null
    throw error
  })
  return lazyLoad
}

/** The start-up line comes once per page load. Tests reset it. */
export function resetRecordWatchBoot(): void {
  bootPosted = false
}

function stateFor(diff: WatchDiff, previous: WatchState): Exclude<WatchState, 'waiting'> {
  if (diff.changed.length > 0) return 'changed'
  if (diff.appended.length + diff.updated.length > 0) return 'news'
  // The first visit stays a baseline until something differs or the viewer marks it seen.
  return previous === 'baseline' ? 'baseline' : 'clean'
}

function ingest(lazy: WatchLazy, inputs: WatchInputs): void {
  const snapshot = lazy.snapshotOf(inputs, Date.now())
  if (Object.keys(snapshot.sources).length === 0) return
  const kept = useRecordWatchStore.getState()
  let checkpoint = kept.checkpoint
  let state: Exclude<WatchState, 'waiting'> = 'baseline'
  let diff = emptyDiff(snapshot.takenAt)
  if (checkpoint) {
    const extended = lazy.extendCheckpoint(checkpoint, snapshot)
    if (extended) {
      kept.setCheckpoint(extended)
      checkpoint = extended
    }
    diff = lazy.diffWatch(checkpoint, snapshot)
    state = stateFor(diff, useWatchStore.getState().view.state)
  } else {
    if (!kept.setCheckpoint(snapshot)) {
      // Nothing was kept, so nothing can be compared: say so once, stay waiting and try again on the next read.
      if (!bootPosted) {
        bootPosted = true
        postMessage(WATCH.unkept)
      }
      return
    }
    checkpoint = snapshot
  }
  show(lazy, snapshot, checkpoint, diff, state)
  if (bootPosted) return
  bootPosted = true
  const text = lazy.bootText(diff, formatEt(checkpoint.takenAt))
  if (text) postMessage(text)
}

/**
 * Mount it once, after the first idle moment (useIdleReady): it renders nothing and calls the six GETs of
 * the records the watch follows, which start with the mount. Once all six have settled it loads the diff and
 * reads the ones that succeeded.
 */
export function RecordWatchReader(): null {
  const registry = useRegistry()
  const confirmations = useConfirmations()
  const openings = useOpenings()
  const ledger = useLedger()
  const oos = useOosLog(OOS_READ)
  const runs = useRuns()
  const settled = [registry, confirmations, openings, ledger, oos, runs].every((query) => query.status !== 'pending')
  useEffect(() => {
    if (!settled) return undefined
    let stale = false
    loadLazy()
      .then((lazy) => {
        if (!stale) ingest(lazy, { registry: registry.data, confirmations: confirmations.data, openings: openings.data, ledger: ledger.data, oos: oos.data, runs: runs.data })
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [settled, registry.data, confirmations.data, openings.data, ledger.data, oos.data, runs.data])
  return null
}

// ---- the status line ----------------------------------------------------------------------------------

function stateText(view: RecordWatchView): string {
  switch (view.state) {
    case 'baseline':
      return WATCH.baseline
    case 'news':
      return fillCopy(WATCH.news, { n: view.diff.appended.length + view.diff.updated.length })
    case 'changed':
      return fillCopy(WATCH.changed, { n: view.diff.changed.length })
    default:
      return WATCH.clean
  }
}

/** The status line segment: WATCH and its state. Amber, and read out in words, when a record was rewritten. */
export function WatchSegment({ view }: { readonly view: RecordWatchView }) {
  if (view.state === 'waiting') return null
  const changed = view.state === 'changed'
  return (
    <span className={`seg keep${changed ? ' warn' : ''}`} title={view.title ?? undefined}>
      <b>{WATCH.key}</b> {stateText(view)}
      {changed ? <span className="sr-only">. {WATCH.changedNote}</span> : null}
    </span>
  )
}
