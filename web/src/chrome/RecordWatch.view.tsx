// The shell side of the research-record watch (roadmap 16): what the status line, the command line and the grids
// see of it. The view store starts "waiting"; the reader (RecordWatch.live.tsx) fills it after the first idle
// moment, so the six reads, the marks, WATCH SEEN and their words load with the reader and never with the shell.
// SHELL RULE: this file imports neither the reader nor the diff nor the query hooks (RecordWatch.view.test.tsx).
// A local change watch from this browser, not a proof.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { WATCH } from '../copy/watch'
import { fillCopy } from '../copy/workspace'
import type { WatchDiff, WatchInputs, WatchItem, WatchMenuView, WatchSnapshot, WatchState } from '../state/recordWatch.schema'
import type { MenuModel } from './CommandLine.menus'
import { EMPTY_MARKS, useWatchMarksStore } from './RecordWatch.marks'

/** How long a browser without an idle callback waits before the six reads start. */
const IDLE_DELAY_MS = 2000
/** The latest an idle callback may wait: a busy page still starts the reads. */
const IDLE_TIMEOUT_MS = 4000

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
export interface WatchLazy {
  snapshotOf(inputs: WatchInputs, takenAt: number): WatchSnapshot
  diffWatch(before: WatchSnapshot, after: WatchSnapshot): WatchDiff
  extendCheckpoint(before: WatchSnapshot, after: WatchSnapshot): WatchSnapshot | null
  mergeAccepted(before: WatchSnapshot | null, after: WatchSnapshot): WatchSnapshot
  watchMenu(view: WatchMenuView, diff: WatchDiff): MenuModel
  bootText(diff: WatchDiff, since: string): string | null
  itemText(item: WatchItem): string
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

export interface WatchStore {
  readonly view: RecordWatchView
  /** The latest read of the records, kept so WATCH SEEN can mark it. */
  readonly snapshot: WatchSnapshot | null
  readonly lazy: WatchLazy | null
}

/** The WATCH <GO> list: built by the diff module, so there is none until a read has been shown. */
export function watchListMenu(): MenuModel | null {
  const { lazy, view } = useWatchStore.getState()
  return lazy && view.state !== 'waiting' ? lazy.watchMenu({ state: view.state, since: view.since }, view.diff) : null
}

/**
 * Before the first read there is nothing to list and nothing to mark as seen; the reader supplies the real accept with
 * each view it shows. The empty diff is written out here (it is state/recordWatch.schema.ts emptyDiff(0)) so the shell
 * imports only the schema's types: the schema's checks and lists load with the reader.
 */
const WAITING: RecordWatchView = { state: 'waiting', diff: { since: 0, appended: [], updated: [], changed: [] }, since: null, title: null, menu: watchListMenu, accept: () => null }

export const useWatchStore = create<WatchStore>()(() => ({ view: WAITING, snapshot: null, lazy: null }))

/** The watch as the chrome shows it. */
export function useRecordWatch(): RecordWatchView {
  return useWatchStore((s) => s.view)
}

/** Back to waiting with nothing read (tests). */
export function resetRecordWatchView(): void {
  useWatchStore.setState({ view: WAITING, snapshot: null, lazy: null })
  useWatchMarksStore.setState({ marks: EMPTY_MARKS })
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
