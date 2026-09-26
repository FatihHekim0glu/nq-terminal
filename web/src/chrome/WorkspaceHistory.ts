// Per-panel back and forward history (look spec 5.2): an immutable {back, fwd} per panel,
// each list capped at 50. Entries are opaque strings (the controller stores serialised panel
// params and sanitises them again on the way back). Every function returns a new value.

export interface PanelHistory {
  readonly back: readonly string[]
  readonly fwd: readonly string[]
}

export interface HistoryStep {
  readonly target: string
  readonly history: PanelHistory
}

export const HISTORY_CAP = 50
export const EMPTY_HISTORY: PanelHistory = Object.freeze({ back: Object.freeze([]), fwd: Object.freeze([]) })

function capped(list: readonly string[]): readonly string[] {
  return list.length > HISTORY_CAP ? list.slice(list.length - HISTORY_CAP) : list
}

/** The panel is about to leave `current` for somewhere new: remember it, and forget the forward list. */
export function recordVisit(history: PanelHistory, current: string): PanelHistory {
  if (history.back.at(-1) === current) return { back: history.back, fwd: [] }
  return { back: capped([...history.back, current]), fwd: [] }
}

/** Back one step from `current`, or null when there is nothing behind it. */
export function stepBack(history: PanelHistory, current: string): HistoryStep | null {
  const target = history.back.at(-1)
  if (target === undefined) return null
  return { target, history: { back: history.back.slice(0, -1), fwd: capped([...history.fwd, current]) } }
}

/** Forward one step from `current`, or null when nothing was stepped back from. */
export function stepForward(history: PanelHistory, current: string): HistoryStep | null {
  const target = history.fwd.at(-1)
  if (target === undefined) return null
  return { target, history: { back: capped([...history.back, current]), fwd: history.fwd.slice(0, -1) } }
}
