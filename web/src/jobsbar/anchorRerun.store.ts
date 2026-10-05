// What this page has started as an anchor re-run, by base run id, so RUN and LEDG show the same progress and the same
// result for one base while the page stays open. Memory only: a reload forgets it, and the new run is still in RUNS
// as an anchor with its own comparison. The launcher is the one thing the page supplies: it asks the server for the
// re-run (the actions route) and answers the job that was queued.
import { createContext, useContext } from 'react'
import { create } from 'zustand'

/** The job a launch queued: only the two fields this module reads. */
export interface LaunchedJob {
  readonly id: string
  readonly run_id: string
}

export type AnchorLauncher = (baseRunId: string) => Promise<LaunchedJob>

export type AnchorRerunEntry =
  | { readonly phase: 'starting' }
  | { readonly phase: 'tracking'; readonly jobId: string; readonly runId: string }
  | { readonly phase: 'refused'; readonly detail: string }

interface AnchorRerunState {
  readonly byBase: Readonly<Record<string, AnchorRerunEntry>>
}

export const useAnchorReruns = create<AnchorRerunState>()(() => ({ byBase: {} }))

export function setAnchorRerun(baseRunId: string, entry: AnchorRerunEntry): void {
  useAnchorReruns.setState((prev) => ({ byBase: { ...prev.byBase, [baseRunId]: entry } }))
}

/** Back to nothing started (tests). */
export function resetAnchorReruns(): void {
  useAnchorReruns.setState({ byBase: {} }, true)
}

/** The page's launcher; null until the page provides one, and then the re-run controls draw nothing. */
export const AnchorLauncherContext = createContext<AnchorLauncher | null>(null)

export const useAnchorLauncher = (): AnchorLauncher | null => useContext(AnchorLauncherContext)
