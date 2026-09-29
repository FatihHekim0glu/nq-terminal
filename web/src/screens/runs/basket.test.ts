// The compare basket of RUNS and REG (roadmap 9): pure rules for marking rows and for choosing which
// marked runs can be drawn. Nothing here computes a statistic.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { BASKET_MAX, compareSelection, toggleMark } from './basket'
import { RUNS } from './runs.fixtures'

type Run = Schemas['RunSummary']

function run(id: string, patch: Partial<Run> = {}): Run {
  const base = RUNS[0]
  if (!base) throw new Error('no fixture run')
  return { ...base, run_id: id, readable: true, usable: true, balance_ok: true, is_probe: false, ...patch }
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i + 1}`)

describe('BASKET_MAX', () => {
  it('holds eight runs, one per compare line style', () => {
    expect(BASKET_MAX).toBe(8)
  })
})

describe('toggleMark', () => {
  it('appends a new id at the end and keeps the basket order', () => {
    expect(toggleMark([], 'a')).toEqual({ ids: ['a'], full: false })
    expect(toggleMark(['a', 'b'], 'c')).toEqual({ ids: ['a', 'b', 'c'], full: false })
  })

  it('removes a marked id and keeps the order of the others', () => {
    expect(toggleMark(['a', 'b', 'c'], 'b')).toEqual({ ids: ['a', 'c'], full: false })
    expect(toggleMark(['a'], 'a')).toEqual({ ids: [], full: false })
  })

  it('takes the eighth id and reports the ninth as full without changing the basket', () => {
    const seven = ids(7)
    const eight = toggleMark(seven, 'r8')
    expect(eight.ids).toHaveLength(8)
    expect(eight.full).toBe(false)
    const ninth = toggleMark(eight.ids, 'r9')
    expect(ninth.full).toBe(true)
    expect(ninth.ids).toEqual(eight.ids)
  })

  it('still unmarks an id when the basket is full', () => {
    const full = ids(BASKET_MAX)
    expect(toggleMark(full, 'r3')).toEqual({ ids: full.filter((x) => x !== 'r3'), full: false })
  })

  it('never changes the array it is given', () => {
    const before = ['a', 'b']
    toggleMark(before, 'c')
    toggleMark(before, 'a')
    expect(before).toEqual(['a', 'b'])
  })

  it('toggles twice back to where it started', () => {
    const once = toggleMark(['a', 'b'], 'z')
    expect(toggleMark(once.ids, 'z').ids).toEqual(['a', 'b'])
  })
})

describe('compareSelection', () => {
  it('draws the usable runs in basket order, not in the order of the runs list', () => {
    const runs = [run('a'), run('b'), run('c')]
    expect(compareSelection(['c', 'a', 'b'], runs, false)).toEqual({ drawn: ['c', 'a', 'b'], excluded: [] })
  })

  it('returns nothing for an empty basket', () => {
    expect(compareSelection([], [run('a')], false)).toEqual({ drawn: [], excluded: [] })
    expect(compareSelection([], [], true)).toEqual({ drawn: [], excluded: [] })
  })

  it('excludes an id the runs list does not hold as unknown', () => {
    expect(compareSelection(['a', 'gone'], [run('a')], false)).toEqual({ drawn: ['a'], excluded: [{ id: 'gone', reason: 'unknown' }] })
  })

  it('excludes a run that cannot be read as unreadable, ahead of every other reason', () => {
    const bad = run('bad', { readable: false, usable: false, balance_ok: false, is_probe: true })
    expect(compareSelection(['bad'], [bad], false).excluded).toEqual([{ id: 'bad', reason: 'unreadable' }])
  })

  it('excludes a run whose balance check failed as balance, ahead of unusable and probe', () => {
    const bad = run('bad', { balance_ok: false, usable: false, is_probe: true })
    expect(compareSelection(['bad'], [bad], false).excluded).toEqual([{ id: 'bad', reason: 'balance' }])
  })

  it('excludes an unusable run whose balance did not fail as unusable, ahead of probe', () => {
    const missing = run('m', { balance_ok: null, usable: false, is_probe: true })
    expect(compareSelection(['m'], [missing], true).excluded).toEqual([{ id: 'm', reason: 'unusable' }])
  })

  it('treats a missing balance flag on a usable run as drawable (only an explicit false fails)', () => {
    const unknownBalance = run('n', { balance_ok: null, usable: true })
    expect(compareSelection(['n'], [unknownBalance], false)).toEqual({ drawn: ['n'], excluded: [] })
  })

  it('leaves probes out unless includeProbes is set', () => {
    const probe = run('p', { is_probe: true })
    expect(compareSelection(['p'], [probe], false)).toEqual({ drawn: [], excluded: [{ id: 'p', reason: 'probe' }] })
    expect(compareSelection(['p'], [probe], true)).toEqual({ drawn: ['p'], excluded: [] })
  })

  it('includeProbes never lets an unusable probe through', () => {
    const probe = run('p', { is_probe: true, usable: false })
    expect(compareSelection(['p'], [probe], true).drawn).toEqual([])
  })

  it('lists every exclusion in basket order with its own reason', () => {
    const runs = [
      run('ok1'),
      run('probe', { is_probe: true }),
      run('unbalanced', { balance_ok: false, usable: false }),
      run('unreadable', { readable: false, usable: false }),
      run('unusable', { usable: false }),
      run('ok2'),
    ]
    const basket = ['unusable', 'ok2', 'ghost', 'probe', 'unreadable', 'ok1', 'unbalanced']
    expect(compareSelection(basket, runs, false)).toEqual({
      drawn: ['ok2', 'ok1'],
      excluded: [
        { id: 'unusable', reason: 'unusable' },
        { id: 'ghost', reason: 'unknown' },
        { id: 'probe', reason: 'probe' },
        { id: 'unreadable', reason: 'unreadable' },
        { id: 'unbalanced', reason: 'balance' },
      ],
    })
  })

  it('reads the served fixture runs: the unbalanced one is excluded as balance', () => {
    const served = RUNS.map((r) => r.run_id)
    const sel = compareSelection(served, RUNS, false)
    expect(sel.excluded).toEqual([{ id: 'nt_za_v0_fixture_unbalanced', reason: 'balance' }])
    expect(sel.drawn).toEqual(served.filter((id) => id !== 'nt_za_v0_fixture_unbalanced'))
  })

  it('does not change the inputs and accounts for every id exactly once', () => {
    const runs = [run('a'), run('b', { is_probe: true })]
    const basket = ['a', 'b', 'c']
    const snapshot = JSON.stringify([runs, basket])
    const sel = compareSelection(basket, runs, false)
    expect(JSON.stringify([runs, basket])).toBe(snapshot)
    expect([...sel.drawn, ...sel.excluded.map((e) => e.id)].sort()).toEqual(['a', 'b', 'c'])
  })
})
