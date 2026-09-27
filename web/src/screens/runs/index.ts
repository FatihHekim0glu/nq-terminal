// RUNS and RUN (TASKS 6.3) for the workspace. The merge step registers them by mnemonic in
// src/chrome/WorkspaceScreens.tsx through lazy(), importing this folder dynamically so the screens, the
// grid library and uPlot load only when a panel shows RUNS or RUN:
//   const RunsScreens = () => import('../screens/runs')
//   RUNS: lazy(() => RunsScreens().then((m) => ({ default: m.RunsScreen }))),
//   RUN: lazy(() => RunsScreens().then((m) => ({ default: m.RunScreen }))),
// Both mnemonics are already in src/commands/registry.ts (RUNS: context none; RUN: context run).
import type { MnemonicCode } from '../../commands/registry'
import type { ContextKind } from '../../commands/types'
import { RUN, RUNS } from './copy'

export { default as RunsScreen } from './RunsScreen'
export { default as RunScreen } from './RunScreen'

export interface ScreenMeta {
  readonly code: MnemonicCode
  /** The red bar title (look spec 4.4). */
  readonly title: string
  /** The contexts the screen reads; empty for a screen that takes none. */
  readonly accepts: readonly ContextKind[]
  readonly phase: string
  /** Look spec 7.4: the reference function the screen follows. */
  readonly follows: string
}

export const RUNS_SCREEN_META: readonly ScreenMeta[] = [
  { code: 'RUNS', title: RUNS.title, accepts: [], phase: '6.3', follows: 'BT strategy table: filter field, sub-tabs 85) to 89), numbered rows' },
  { code: 'RUN', title: RUN.title, accepts: ['run'], phase: '6.3', follows: 'BT strategy analysis: tabs 1) to 8), chart two thirds, statistics one third' },
]
