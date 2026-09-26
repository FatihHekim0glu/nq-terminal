import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  loadHistory,
  newer,
  older,
  record,
  saveHistory,
  type HistoryState,
  type HistoryStorage,
} from './history'

function withEntries(...entries: string[]): HistoryState {
  return entries.reduce(record, EMPTY_HISTORY)
}

describe('command history (Up and Down in the empty line)', () => {
  it('records newest last, skips blanks and an immediate repeat, and never mutates', () => {
    const one = record(EMPTY_HISTORY, 'NQ GP')
    const two = record(one, 'NQ GP')
    const three = record(two, '   ')
    expect(one.entries).toEqual(['NQ GP'])
    expect(two.entries).toEqual(['NQ GP'])
    expect(three.entries).toEqual(['NQ GP'])
    expect(EMPTY_HISTORY.entries).toEqual([])
  })

  it('keeps at most HISTORY_LIMIT entries, dropping the oldest', () => {
    const lines = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => `REG ${i}`)
    const state = withEntries(...lines)
    expect(state.entries.length).toBe(HISTORY_LIMIT)
    expect(state.entries[0]).toBe('REG 5')
  })

  it('Up from an empty line starts at the newest entry and walks back, stopping at the oldest', () => {
    const state = withEntries('REG', 'NQ GP', 'HELP')
    const a = older(state, '')
    expect(a?.line).toBe('HELP')
    const b = older(a!.state, a!.line)
    expect(b?.line).toBe('NQ GP')
    const c = older(b!.state, b!.line)
    expect(c?.line).toBe('REG')
    const d = older(c!.state, c!.line)
    expect(d?.line).toBe('REG')
  })

  it('Up does nothing on a line with text that is not a history walk', () => {
    expect(older(withEntries('REG'), 'NQ')).toBeNull()
    expect(older(EMPTY_HISTORY, '')).toBeNull()
  })

  it('Down walks forward and returns to an empty line past the newest', () => {
    const state = withEntries('REG', 'HELP')
    const up1 = older(state, '')!
    const up2 = older(up1.state, up1.line)!
    const down1 = newer(up2.state)!
    expect(down1.line).toBe('HELP')
    const down2 = newer(down1.state)!
    expect(down2.line).toBe('')
    expect(down2.state.cursor).toBeNull()
    expect(newer(down2.state)).toBeNull()
  })

  it('recording ends a walk', () => {
    const walking = older(withEntries('REG'), '')!.state
    expect(record(walking, 'HELP').cursor).toBeNull()
  })
})

describe('history storage (per-viewer convenience; failures are ignored)', () => {
  function memoryStorage(): HistoryStorage & { data: Map<string, string> } {
    const data = new Map<string, string>()
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    }
  }

  it('round-trips entries', () => {
    const storage = memoryStorage()
    saveHistory(withEntries('REG', 'NQ GP'), storage)
    expect(loadHistory(storage).entries).toEqual(['REG', 'NQ GP'])
  })

  it('returns an empty history when storage throws or holds junk', () => {
    const throwing: HistoryStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadHistory(throwing)).toEqual(EMPTY_HISTORY)
    expect(() => saveHistory(withEntries('REG'), throwing)).not.toThrow()
    const junk = memoryStorage()
    junk.data.set('nqt.cmd.history', '{"not":"a list"}')
    expect(loadHistory(junk)).toEqual(EMPTY_HISTORY)
    junk.data.set('nqt.cmd.history', '[1, "REG", {"x":1}, "' + 'x'.repeat(500) + '"]')
    expect(loadHistory(junk).entries).toEqual(['REG'])
  })

  it('returns an empty history when no storage is available', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadHistory()).toEqual(EMPTY_HISTORY)
    vi.unstubAllGlobals()
  })
})
