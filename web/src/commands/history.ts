// Command history: newest last, walked with Up and Down from an empty line (UI_SPEC section 5).
// Pure and immutable; storage is a per-viewer convenience whose failures are ignored.
import { MAX_LINE } from './parser'

export const HISTORY_LIMIT = 100
const STORAGE_KEY = 'nqt.cmd.history'

export interface HistoryState {
  readonly entries: readonly string[]
  /** Index of the entry on the line while walking, or null when not walking. */
  readonly cursor: number | null
}

export interface HistoryStep {
  readonly state: HistoryState
  readonly line: string
}

export interface HistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const EMPTY_HISTORY: HistoryState = { entries: [], cursor: null }

export function record(state: HistoryState, line: string): HistoryState {
  const text = line.trim()
  if (text === '' || state.entries.at(-1) === text) return { entries: state.entries, cursor: null }
  return { entries: [...state.entries, text].slice(-HISTORY_LIMIT), cursor: null }
}

/** Up: from an empty line, the newest entry; while walking, the one before (stops at the oldest). */
export function older(state: HistoryState, currentLine: string): HistoryStep | null {
  const last = state.entries.length - 1
  if (last < 0) return null
  if (state.cursor === null && currentLine.trim() !== '') return null
  const cursor = state.cursor === null ? last : Math.max(0, state.cursor - 1)
  return { state: { entries: state.entries, cursor }, line: state.entries[cursor] ?? '' }
}

/** Down: the next newer entry, then back to an empty line. Null when not walking. */
export function newer(state: HistoryState): HistoryStep | null {
  if (state.cursor === null) return null
  if (state.cursor >= state.entries.length - 1) return { state: { entries: state.entries, cursor: null }, line: '' }
  const cursor = state.cursor + 1
  return { state: { entries: state.entries, cursor }, line: state.entries[cursor] ?? '' }
}

function browserStorage(): HistoryStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadHistory(storage: HistoryStorage | null = browserStorage()): HistoryState {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return EMPTY_HISTORY
    const entries = parsed.filter((e): e is string => typeof e === 'string' && e.trim() !== '' && e.length <= MAX_LINE)
    return { entries: entries.slice(-HISTORY_LIMIT), cursor: null }
  } catch {
    return EMPTY_HISTORY
  }
}

export function saveHistory(state: HistoryState, storage: HistoryStorage | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state.entries))
  } catch {
    // Blocked or full storage: the history still works for this page view.
  }
}
