import { describe, expect, it } from 'vitest'
import { mergeImport, mergeOnClash, same, stripCopies } from './remoteStore.merge'
import type { Recipe } from './workspaces'

function recipe(line: string): Recipe {
  return { version: 1, panels: [{ line, group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }
}
const ws = (list: Record<string, Recipe>, last: string | null = null) => ({ list, last })

describe('merge on a 412: workspaces (per name, newest wins, the loser kept as "<name> (conflict)")', () => {
  it('takes the other side\'s change to a name this page did not touch, and keeps this page\'s own', () => {
    const base = ws({ ONE: recipe('A'), TWO: recipe('B') })
    const local = ws({ ONE: recipe('A2'), TWO: recipe('B') })
    const server = ws({ ONE: recipe('A'), TWO: recipe('B2') })
    expect(mergeOnClash('workspaces', base, local, server)).toEqual(ws({ ONE: recipe('A2'), TWO: recipe('B2') }))
  })

  it('keeps this page\'s edit and the other side\'s as "<name> (conflict)" when both changed the same name', () => {
    const base = ws({ ONE: recipe('A') })
    const merged = mergeOnClash('workspaces', base, ws({ ONE: recipe('mine') }), ws({ ONE: recipe('theirs') })) as ReturnType<typeof ws>
    expect(merged.list['ONE']).toEqual(recipe('mine'))
    expect(merged.list['ONE (conflict)']).toEqual(recipe('theirs'))
  })

  it('adds a name saved on either side, and drops a name this page forgot when the other side left it alone', () => {
    const base = ws({ ONE: recipe('A'), TWO: recipe('B') })
    const local = ws({ ONE: recipe('A'), MINE: recipe('m') })
    const server = ws({ ONE: recipe('A'), TWO: recipe('B'), THEIRS: recipe('t') })
    const merged = mergeOnClash('workspaces', base, local, server) as ReturnType<typeof ws>
    expect(Object.keys(merged.list).sort()).toEqual(['MINE', 'ONE', 'THEIRS'])
  })

  it('keeps the other side\'s edit of a name this page forgot (no silent loss)', () => {
    const base = ws({ ONE: recipe('A') })
    const merged = mergeOnClash('workspaces', base, ws({}), ws({ ONE: recipe('edited') })) as ReturnType<typeof ws>
    expect(merged.list['ONE']).toEqual(recipe('edited'))
  })

  it('with no known base, this page wins a clash and the store\'s differing copy is kept', () => {
    const merged = mergeOnClash('workspaces', null, ws({ ONE: recipe('mine') }), ws({ ONE: recipe('theirs'), TWO: recipe('t') })) as ReturnType<typeof ws>
    expect(merged.list['ONE']).toEqual(recipe('mine'))
    expect(merged.list['ONE (conflict)']).toEqual(recipe('theirs'))
    expect(merged.list['TWO']).toEqual(recipe('t'))
  })

  it('never exceeds 12 workspaces and never makes a copy of a copy', () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`W${i}`, recipe(`s${i}`)]))
    const local = ws({ ...many, W0: recipe('mine') })
    const merged = mergeOnClash('workspaces', ws(many), local, ws(many)) as ReturnType<typeof ws>
    expect(Object.keys(merged.list)).toHaveLength(12)
    const twice = mergeOnClash('workspaces', null, ws({ 'ONE (conflict)': recipe('a') }), ws({ 'ONE (conflict)': recipe('b') })) as ReturnType<typeof ws>
    expect(Object.keys(twice.list)).toEqual(['ONE (conflict)'])
  })

  it('keeps this page\'s last workspace when it changed it, the store\'s otherwise, and never one that is gone', () => {
    const base = ws({ ONE: recipe('A'), TWO: recipe('B') }, 'ONE')
    expect((mergeOnClash('workspaces', base, ws(base.list, 'TWO'), ws(base.list, 'ONE')) as ReturnType<typeof ws>).last).toBe('TWO')
    expect((mergeOnClash('workspaces', base, ws(base.list, 'ONE'), ws(base.list, 'TWO')) as ReturnType<typeof ws>).last).toBe('TWO')
    expect((mergeOnClash('workspaces', base, ws({ ONE: recipe('A2'), TWO: recipe('B') }, 'ONE'), ws({}, null)) as ReturnType<typeof ws>).last).toBe('ONE')
  })
})

describe('merge on a 412: the other documents', () => {
  it('layouts: per mnemonic, this page\'s changed layouts win and the rest follow the store', () => {
    const base = { HOME: { a: 1 }, REG: { a: 1 } }
    const merged = mergeOnClash('layouts', base, { HOME: { a: 2 }, REG: { a: 1 } }, { HOME: { a: 9 }, REG: { a: 3 }, GP: { a: 1 } })
    expect(merged).toEqual({ HOME: { a: 2 }, REG: { a: 3 }, GP: { a: 1 } })
  })

  it('layouts: a layout this page reset is gone, and with no base the page\'s layouts lie over the store\'s', () => {
    expect(mergeOnClash('layouts', { HOME: { a: 1 } }, {}, { HOME: { a: 1 }, REG: { a: 1 } })).toEqual({ REG: { a: 1 } })
    expect(mergeOnClash('layouts', null, { HOME: { a: 2 } }, { HOME: { a: 9 }, REG: { a: 1 } })).toEqual({ HOME: { a: 2 }, REG: { a: 1 } })
  })

  it('linkGroups, watch: the whole document, this page\'s write is the newest', () => {
    const mine = { contexts: { A: { kind: 'instrument', value: 'NQ' }, B: null, C: null } }
    expect(mergeOnClash('linkGroups', null, mine, { contexts: { A: null, B: null, C: null } })).toEqual(mine)
    expect(mergeOnClash('watch', { x: 1 }, { x: 2 }, { x: 3 })).toEqual({ x: 2 })
  })

  it('history: the union, the store\'s lines first then this page\'s new ones, the last 100 kept', () => {
    expect(mergeOnClash('history', ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'x'])).toEqual(['a', 'b', 'x', 'c'])
    const server = Array.from({ length: 100 }, (_, i) => `s${i}`)
    const merged = mergeOnClash('history', ['s0'], ['s0', 'new1', 'new2'], server) as string[]
    expect(merged).toHaveLength(100)
    expect(merged.slice(-2)).toEqual(['new1', 'new2'])
    expect(merged).not.toContain('s0')
  })

  it('prefs: field by field, a field this page changed (or removed) wins, the others follow the store', () => {
    const base = { tape: true, theme: 'standard', cvd: 'deut' }
    const local = { tape: false, theme: 'standard' }
    const server = { tape: true, theme: 'amber-classic', cvd: 'deut', orientation: '1' }
    expect(mergeOnClash('prefs', base, local, server)).toEqual({ tape: false, theme: 'amber-classic', orientation: '1' })
  })

  it('meta: the union of imports by origin with the earliest time kept, the schema from the store', () => {
    const local = { schema: 1, imports: [{ origin: 'http://a', at: '2026-01-02' }, { origin: 'http://b', at: '2026-01-05' }] }
    const server = { schema: 1, imports: [{ origin: 'http://a', at: '2026-01-01' }, { origin: 'http://c', at: '2026-01-03' }] }
    expect(mergeOnClash('meta', null, local, server)).toEqual({
      schema: 1,
      imports: [{ origin: 'http://a', at: '2026-01-01' }, { origin: 'http://c', at: '2026-01-03' }, { origin: 'http://b', at: '2026-01-05' }],
    })
  })
})

describe('the import merge (03 section 10.4): the store\'s values stay, what it lacks is added', () => {
  it('workspaces: adds a missing name, skips an equal one, keeps a differing one as "<name> (imported)"', () => {
    const store = ws({ ONE: recipe('A'), TWO: recipe('B') }, 'ONE')
    const imported = ws({ ONE: recipe('A'), TWO: recipe('other'), NEW: recipe('n') }, 'NEW')
    const merged = mergeImport('workspaces', store, imported) as ReturnType<typeof ws>
    expect(merged.list).toEqual({ ONE: recipe('A'), TWO: recipe('B'), 'TWO (imported)': recipe('other'), NEW: recipe('n') })
    expect(merged.last).toBe('ONE')
  })

  it('workspaces: takes the imported last only when the store has none, and repeats safely', () => {
    const store = ws({}, null)
    const once = mergeImport('workspaces', store, ws({ ONE: recipe('A') }, 'ONE'))
    expect((once as ReturnType<typeof ws>).last).toBe('ONE')
    const stored = ws({ TWO: recipe('B') })
    const imported = ws({ TWO: recipe('other') })
    const first = mergeImport('workspaces', stored, imported)
    expect(mergeImport('workspaces', first, imported)).toEqual(first)
  })

  it('workspaces: stays inside 12 names', () => {
    const store = ws(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`W${i}`, recipe('s')])))
    const merged = mergeImport('workspaces', store, ws({ EXTRA: recipe('x'), W0: recipe('d') })) as ReturnType<typeof ws>
    expect(Object.keys(merged.list)).toHaveLength(12)
  })

  it('layouts: adds a missing screen, skips an equal layout, keeps a differing one as "<code> (imported)"', () => {
    const store = { HOME: { a: 1 }, REG: { a: 1 } }
    const merged = mergeImport('layouts', store, { HOME: { a: 1 }, REG: { a: 2 }, GP: { a: 3 } })
    expect(merged).toEqual({ HOME: { a: 1 }, REG: { a: 1 }, 'REG (imported)': { a: 2 }, GP: { a: 3 } })
    expect(mergeImport('layouts', merged, { HOME: { a: 1 }, REG: { a: 2 }, GP: { a: 3 } })).toEqual(merged)
  })

  it('linkGroups: a group the store has empty takes the imported context, a held one stays', () => {
    const store = { contexts: { A: { kind: 'instrument', value: 'NQ' }, B: null, C: null } }
    const imported = { contexts: { A: { kind: 'instrument', value: 'ES' }, B: { kind: 'run', value: 'r1' }, C: null } }
    expect(mergeImport('linkGroups', store, imported)).toEqual({ contexts: { A: { kind: 'instrument', value: 'NQ' }, B: { kind: 'run', value: 'r1' }, C: null } })
  })

  it('watch: the store\'s checkpoint stays, the imported one fills an empty store', () => {
    expect(mergeImport('watch', { version: 1 }, { version: 2 })).toEqual({ version: 1 })
    expect(mergeImport('watch', {}, { version: 2 })).toEqual({ version: 2 })
  })

  it('history: imported lines the store lacks come first, the last 100 kept, repeats add nothing', () => {
    const merged = mergeImport('history', ['b', 'c'], ['a', 'b'])
    expect(merged).toEqual(['a', 'b', 'c'])
    expect(mergeImport('history', merged, ['a', 'b'])).toEqual(merged)
    const long = Array.from({ length: 100 }, (_, i) => `s${i}`)
    expect(mergeImport('history', long, ['old'])).toEqual(long)
  })

  it('prefs: a field the store lacks is added, a held one stays', () => {
    expect(mergeImport('prefs', { theme: 'amber-classic' }, { theme: 'standard', tape: true })).toEqual({ theme: 'amber-classic', tape: true })
  })
})

describe('helpers', () => {
  it('same compares by value whatever the key order', () => {
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(same({ a: 1 }, { a: 2 })).toBe(false)
    expect(same(undefined, undefined)).toBe(true)
    expect(same(undefined, null)).toBe(false)
  })

  it('stripCopies drops the "(conflict)" and "(imported)" entries of workspaces and layouts', () => {
    expect(stripCopies('workspaces', ws({ ONE: recipe('A'), 'ONE (imported)': recipe('B') }, 'ONE'))).toEqual(ws({ ONE: recipe('A') }, 'ONE'))
    expect(stripCopies('layouts', { HOME: {}, 'HOME (imported)': {} })).toEqual({ HOME: {} })
    expect(stripCopies('prefs', { tape: true })).toEqual({ tape: true })
  })
})
