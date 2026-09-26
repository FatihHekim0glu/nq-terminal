// What the panels read from the workspace while they render (look spec 4.3, 4.7): their
// number in reading order, which one is focused, which one owns the related functions menu, and
// which one is maximised. The controller writes it; ScreenPanel subscribes with a selector.
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface WorkspaceViewState {
  /** Panel ids in reading order (DOM order of their groups): panel N is order[N - 1]. */
  readonly order: readonly string[]
  readonly focused: string | null
  readonly menu: string | null
  readonly maximised: string | null
}

export type WorkspaceView = StoreApi<WorkspaceViewState>

export function createWorkspaceView(): WorkspaceView {
  return createStore<WorkspaceViewState>()(() => ({ order: [], focused: null, menu: null, maximised: null }))
}

export interface OrderedGroup {
  readonly element: Element
  readonly panelIds: readonly string[]
}

/** Panel ids in document order of their group elements (the grid is built row by row). */
export function readingOrder(groups: ReadonlyArray<OrderedGroup>): string[] {
  const sorted = [...groups].sort((a, b) => {
    if (a.element === b.element) return 0
    return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
  return sorted.flatMap((g) => g.panelIds)
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Writes only what changed, so subscribers re-render only when their slice does. */
export function patchView(view: WorkspaceView, patch: Partial<WorkspaceViewState>): void {
  const now = view.getState()
  const next: Partial<WorkspaceViewState> = {}
  if (patch.order && !sameList(patch.order, now.order)) Object.assign(next, { order: patch.order })
  for (const key of ['focused', 'menu', 'maximised'] as const) {
    if (key in patch && patch[key] !== now[key]) Object.assign(next, { [key]: patch[key] })
  }
  if (Object.keys(next).length > 0) view.setState(next)
}
