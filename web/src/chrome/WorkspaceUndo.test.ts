import { describe, expect, it } from 'vitest'
import { EMPTY_RING, UNDO_DEPTH, popUndo, pushUndo, type UndoEntry } from './WorkspaceUndo'

const CONTEXTS = { A: null, B: null, C: null } as const

function entry(n: number, cause: UndoEntry['cause'] = 'change'): UndoEntry {
  return { screen: 'HOME', dock: { n }, stored: null, contexts: CONTEXTS, cause }
}

describe('WorkspaceUndo (a 10 deep ring, oldest first)', () => {
  it('starts empty', () => {
    expect(EMPTY_RING).toEqual([])
  })

  it('pops null from an empty ring', () => {
    expect(popUndo(EMPTY_RING)).toBeNull()
  })

  it('appends and pops the newest entry first (LIFO)', () => {
    const ring = pushUndo(pushUndo(EMPTY_RING, entry(1)), entry(2))
    const popped = popUndo(ring)
    expect(popped?.entry).toEqual(entry(2))
    expect(popped?.ring).toEqual([entry(1)])
  })

  it('caps at UNDO_DEPTH (10), dropping the oldest entries first', () => {
    let ring = EMPTY_RING
    for (let i = 1; i <= 12; i += 1) ring = pushUndo(ring, entry(i))
    expect(UNDO_DEPTH).toBe(10)
    expect(ring).toHaveLength(10)
    expect(ring[0]).toEqual(entry(3))
    expect(ring.at(-1)).toEqual(entry(12))
  })

  it('skips a push identical to the newest entry (same screen and dock JSON)', () => {
    const ring = pushUndo(pushUndo(EMPTY_RING, entry(1)), entry(1))
    expect(ring).toHaveLength(1)
  })

  it('does not skip when the dock differs, even for the same screen', () => {
    const ring = pushUndo(pushUndo(EMPTY_RING, entry(1)), entry(2))
    expect(ring).toHaveLength(2)
  })

  it('does not skip when only the screen differs, even for an identical dock', () => {
    const a: UndoEntry = { screen: 'HOME', dock: { n: 1 }, stored: null, contexts: CONTEXTS, cause: 'change' }
    const b: UndoEntry = { screen: 'REG', dock: { n: 1 }, stored: null, contexts: CONTEXTS, cause: 'change' }
    const ring = pushUndo(pushUndo(EMPTY_RING, a), b)
    expect(ring).toHaveLength(2)
  })

  it('dedup compares only screen and dock: cause, stored and contexts do not matter', () => {
    const ring = pushUndo(pushUndo(EMPTY_RING, entry(1, 'change')), entry(1, 'reset'))
    expect(ring).toHaveLength(1)
    expect(ring[0]?.cause).toBe('change')
  })

  it('the dedup check only ever looks at the newest entry, not the whole ring', () => {
    const ring = pushUndo(pushUndo(pushUndo(EMPTY_RING, entry(1)), entry(2)), entry(1))
    expect(ring).toHaveLength(3)
  })
})
