// The research-record watch's reader (roadmap 16): after the first idle moment it reads six records the terminal
// already serves, compares them with this browser's checkpoint, and offers the result to the status line
// (WatchSegment), the command line (WATCH and WATCH SEEN) and the grids (useWatchMarks) through the view store in
// RecordWatch.view.tsx.
// SHELL RULE: this file loads on demand (App.tsx mounts it through a dynamic import after the first idle moment),
// so nothing in the first-paint shell may import it; the shell reads RecordWatch.view.tsx. The diff, the WATCH <GO>
// list and their long copy load through one dynamic import of ./RecordWatch.lazy, so this file must never import
// them statically (state/recordWatch.split.test.ts). It re-exports the view module, so callers and tests keep one
// import path. A local change watch from this browser, not a proof.
import { useEffect } from 'react'
import { useConfirmations, useLedger, useOosLog, useOpenings, useRegistry, useRuns } from '../api/queries'
import { WATCH_READ } from '../copy/watchReader'
import { fillCopy } from '../copy/workspace'
import {
  WATCH_SOURCES,
  emptyDiff,
  type WatchDiff,
  type WatchInputs,
  type WatchSnapshot,
  type WatchSource,
  type WatchState,
} from '../state/recordWatch.schema'
import { useRecordWatchStore } from '../state/recordWatch.store'
import { postMessage } from './MessageLine.store'
import { useWatchMarksStore, type WatchMark, type WatchMarks as Marks } from './RecordWatch.marks'
import { useWatchStore, watchListMenu, type RecordWatchView, type WatchLazy } from './RecordWatch.view'

// Screens import these from ./RecordWatch.marks directly (see the leaf's header) and the shell reads the view from
// ./RecordWatch.view; the re-exports keep this module's own callers working.
export { useWatchMarks, type WatchMark } from './RecordWatch.marks'
export { WatchSegment, resetRecordWatchView, useIdleReady, useRecordWatch, type RecordWatchView } from './RecordWatch.view'

/** The gate log is read with the OOS screen's own unfiltered request, so both share one cache entry. */
const OOS_READ = { limit: 5000 } as const

let etFormat: Intl.DateTimeFormat | undefined

/** A time as Eastern day, month and clock, for the copy (the terminal's clock is Eastern). */
export function formatEt(ms: number): string {
  etFormat ??= new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  return etFormat.format(ms)
}

// ---- the view -----------------------------------------------------------------------------------------

function accept(): string | null {
  const { lazy, snapshot } = useWatchStore.getState()
  if (!lazy || !snapshot) return null
  const now = Date.now()
  const kept = useRecordWatchStore.getState()
  const merged = lazy.mergeAccepted(kept.checkpoint, { ...snapshot, takenAt: now })
  if (!kept.setCheckpoint(merged)) return WATCH_READ.unsaved
  show(lazy, snapshot, merged, emptyDiff(merged.takenAt), 'clean')
  return fillCopy(WATCH_READ.seen, { time: formatEt(now) })
}

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
  const view: RecordWatchView = { state, diff, since: formatEt(checkpoint.takenAt), title: state === 'changed' && first ? lazy.itemText(first) : null, menu: watchListMenu, accept }
  useWatchStore.setState({ view, snapshot, lazy })
  useWatchMarksStore.setState((prev) => ({ marks: marksOf(diff, prev.marks) }))
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
        postMessage(WATCH_READ.unkept)
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
