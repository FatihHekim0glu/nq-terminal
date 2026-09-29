import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateNumbered, numberedItems, registerNumbered, resetNumbered, runningPanel } from './NumberedActions'

afterEach(resetNumbered)

describe('NumberedActions: the per-panel registry behind Number <GO> (spec 5.1 item 5)', () => {
  it('runs the item a panel registered under that number', () => {
    const seven = vi.fn()
    registerNumbered('p1', [
      { n: 1, label: 'za_v0', run: vi.fn() },
      { n: 7, label: 'rebal_v0', run: seven },
    ])
    expect(activateNumbered('p1', 7)).toBe(true)
    expect(seven).toHaveBeenCalledTimes(1)
  })

  it('born failing: a number no item carries, or another panel, runs nothing', () => {
    const one = vi.fn()
    registerNumbered('p1', [{ n: 1, label: 'x', run: one }])
    expect(activateNumbered('p1', 42)).toBe(false)
    expect(activateNumbered('p2', 1)).toBe(false)
    expect(one).not.toHaveBeenCalled()
  })

  it('keeps several registrations per panel (grid rows and red-bar actions) and removes only its own', () => {
    const row = vi.fn()
    const help = vi.fn()
    const dropRows = registerNumbered('p1', [{ n: 3, label: 'row 3', run: row }])
    registerNumbered('p1', [{ n: 99, label: 'Help', run: help }])
    expect(numberedItems('p1').map((i) => i.n)).toEqual([3, 99])
    dropRows()
    expect(activateNumbered('p1', 3)).toBe(false)
    expect(activateNumbered('p1', 99)).toBe(true)
    expect(help).toHaveBeenCalledTimes(1)
  })

  it('the later registration wins when two carry the same number', () => {
    const first = vi.fn()
    const second = vi.fn()
    registerNumbered('p1', [{ n: 5, label: 'a', run: first }])
    registerNumbered('p1', [{ n: 5, label: 'b', run: second }])
    activateNumbered('p1', 5)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('never keeps a reference to the caller array, so a later change to it has no effect', () => {
    const run = vi.fn()
    const items = [{ n: 1, label: 'x', run }]
    registerNumbered('p1', items)
    items.length = 0
    expect(activateNumbered('p1', 1)).toBe(true)
  })

  it('ignores numbers that are not positive whole numbers', () => {
    registerNumbered('p1', [{ n: 1, label: 'x', run: vi.fn() }])
    expect(activateNumbered('p1', 0)).toBe(false)
    expect(activateNumbered('p1', 1.5)).toBe(false)
    expect(activateNumbered('p1', Number.NaN)).toBe(false)
  })
})

describe('NumberedActions: the panel whose item is running (G03)', () => {
  it('names the panel while its item runs, and nobody before or after', () => {
    const seen: Array<string | null> = []
    registerNumbered('p1', [{ n: 1, label: 'x', run: () => seen.push(runningPanel()) }])
    expect(runningPanel()).toBeNull()
    activateNumbered('p1', 1)
    expect(seen).toEqual(['p1'])
    expect(runningPanel()).toBeNull()
  })

  it('is not set for a number that runs nothing', () => {
    expect(activateNumbered('p1', 1)).toBe(false)
    expect(runningPanel()).toBeNull()
  })

  it('is cleared again when the item throws', () => {
    registerNumbered('p1', [{ n: 1, label: 'x', run: () => { throw new Error('boom') } }])
    expect(() => activateNumbered('p1', 1)).toThrow('boom')
    expect(runningPanel()).toBeNull()
  })

  it('gives an item that activates another panel its own panel, and hands the first one back afterwards', () => {
    const seen: Array<string | null> = []
    registerNumbered('p2', [{ n: 2, label: 'inner', run: () => seen.push(runningPanel()) }])
    registerNumbered('p1', [{ n: 1, label: 'outer', run: () => { seen.push(runningPanel()); activateNumbered('p2', 2); seen.push(runningPanel()) } }])
    activateNumbered('p1', 1)
    expect(seen).toEqual(['p1', 'p2', 'p1'])
  })
})
