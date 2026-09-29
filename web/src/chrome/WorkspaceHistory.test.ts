import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, HISTORY_CAP, recordVisit, stepBack, stepForward, type PanelHistory } from './WorkspaceHistory'

describe('per-panel history (look spec 5.2)', () => {
  it('records what a panel showed before a command replaced it, and clears the forward list', () => {
    const h = recordVisit({ back: ['a'], fwd: ['z'] }, 'b')
    expect(h).toEqual({ back: ['a', 'b'], fwd: [] })
  })

  it('never changes the history it is given (immutable)', () => {
    const before: PanelHistory = { back: ['a'], fwd: ['z'] }
    const frozen = JSON.stringify(before)
    recordVisit(before, 'b')
    stepBack(before, 'c')
    stepForward(before, 'c')
    expect(JSON.stringify(before)).toBe(frozen)
  })

  it('steps back to the last entry and puts the current one on the forward list', () => {
    const out = stepBack({ back: ['a', 'b'], fwd: [] }, 'c')
    expect(out).toEqual({ target: 'b', history: { back: ['a'], fwd: ['c'] } })
  })

  it('steps forward again, the mirror of back', () => {
    const back = stepBack({ back: ['a', 'b'], fwd: [] }, 'c')
    const fwd = back && stepForward(back.history, back.target)
    expect(fwd).toEqual({ target: 'c', history: { back: ['a', 'b'], fwd: [] } })
  })

  it('returns null when there is nowhere to go', () => {
    expect(stepBack(EMPTY_HISTORY, 'a')).toBeNull()
    expect(stepForward(EMPTY_HISTORY, 'a')).toBeNull()
  })

  it('born failing: caps each list at 50, dropping the oldest', () => {
    let h: PanelHistory = EMPTY_HISTORY
    for (let i = 0; i < HISTORY_CAP + 7; i += 1) h = recordVisit(h, String(i))
    expect(HISTORY_CAP).toBe(50)
    expect(h.back).toHaveLength(50)
    expect(h.back[0]).toBe('7')
    expect(h.back.at(-1)).toBe(String(HISTORY_CAP + 6))
  })

  it('does not record a visit to the same place twice in a row', () => {
    expect(recordVisit({ back: ['a'], fwd: [] }, 'a')).toEqual({ back: ['a'], fwd: [] })
  })
})

describe('per-panel history: entries that would change nothing are passed over (U21)', () => {
  const noop = (entry: string): boolean => entry.startsWith('!')

  it('steps back over trailing no-op entries to the first real one, and does not put them on the forward list', () => {
    const out = stepBack({ back: ['a', 'b', '!c', '!d'], fwd: ['z'] }, 'e', noop)
    expect(out).toEqual({ target: 'b', history: { back: ['a'], fwd: ['z', 'e'] } })
  })

  it('steps forward over no-op entries the same way', () => {
    const out = stepForward({ back: ['a'], fwd: ['b', '!c'] }, 'd', noop)
    expect(out).toEqual({ target: 'b', history: { back: ['a', 'd'], fwd: [] } })
  })

  it('returns null when only no-op entries are left', () => {
    expect(stepBack({ back: ['!a', '!b'], fwd: [] }, 'c', noop)).toBeNull()
    expect(stepForward({ back: [], fwd: ['!a'] }, 'c', noop)).toBeNull()
  })

  it('leaves a no-op entry in the middle of the list alone: only the ones in the way are dropped', () => {
    const out = stepBack({ back: ['a', '!b', 'c'], fwd: [] }, 'd', noop)
    expect(out).toEqual({ target: 'c', history: { back: ['a', '!b'], fwd: ['d'] } })
  })

  it('steps to every entry when no test is given', () => {
    expect(stepBack({ back: ['!a'], fwd: [] }, 'b')).toEqual({ target: '!a', history: { back: [], fwd: ['b'] } })
  })
})

