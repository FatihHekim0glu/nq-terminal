// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CHROME_WORDS, PARSE_MESSAGES, SECTOR_TITLES } from '../copy/commands'
import { findCopyViolations } from '../copy/copyRules'
import { WORKSPACES } from '../copy/workspaces'
import { MNEMONICS } from '../commands/registry'
import {
  MAX_RECIPE_CHARS,
  MAX_WORKSPACES,
  WORKSPACES_KEY,
  cleanRecipe,
  createWorkspacesStore,
  isWorkspaceName,
  type Recipe,
} from './workspaces'
import { createSafeStorage, memoryStorage } from './safeStorage'

const HOME: Recipe = {
  version: 1,
  panels: [
    { line: 'NQ GP 1d', group: 'A', ref: null, direction: 'right' },
    { line: 'volmanaged_v0 EQ', group: 'B', ref: 0, direction: 'below' },
    { line: '27F MON', group: 'A', ref: 0, direction: 'right' },
    { line: 'REG', group: '-', ref: 1, direction: 'right' },
  ],
  groups: { A: { kind: 'instrument', value: 'NQ' }, B: { kind: 'hypothesis', value: 'volmanaged_v0' }, C: null },
}

function setup(initial?: string) {
  const backing = memoryStorage()
  if (initial !== undefined) backing.setItem(WORKSPACES_KEY, initial)
  const store = createWorkspacesStore(createSafeStorage(() => backing))
  return { backing, store }
}

/** A recipe of `n` single panel lines, each `width` characters long, in the command alphabet. */
function wide(n: number, width: number): Recipe {
  const panels = Array.from({ length: n }, (_, i) => ({
    line: 'A'.repeat(width),
    group: '-' as const,
    ref: i === 0 ? null : i - 1,
    direction: 'right' as const,
  }))
  return { ...HOME, panels }
}

describe('workspace names', () => {
  it.each(['MINE', 'AB', 'A1', 'MY_DESK', 'DESK_2', 'A'.repeat(16), 'X_'])('accepts %s', (name) => {
    expect(isWorkspaceName(name)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['one character', 'A'],
    ['seventeen characters', 'A'.repeat(17)],
    ['starts with a digit', '1AB'],
    ['starts with an underscore', '_AB'],
    ['lower case', 'mine'],
    ['mixed case', 'Mine'],
    ['a hyphen', 'MY-DESK'],
    ['a space', 'MY DESK'],
    ['a dot', 'MY.DESK'],
    ['a non ASCII letter', 'CAFÉ'],
    ['an emoji', 'AB😀'],
    ['a newline', 'AB\n'],
    ['an object key hazard', '__proto__'],
  ])('refuses a name with %s', (_why, name) => {
    expect(isWorkspaceName(name)).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    for (const value of [null, undefined, 42, {}, [], ['MINE'], true]) expect(isWorkspaceName(value)).toBe(false)
  })

  it('refuses every mnemonic, chrome word and sector word, which the command line would read first', () => {
    for (const m of MNEMONICS) expect(isWorkspaceName(m.code), m.code).toBe(false)
    for (const word of Object.keys(CHROME_WORDS)) expect(isWorkspaceName(word), word).toBe(false)
    for (const word of [...Object.keys(SECTOR_TITLES), 'CMDTY', 'CRNCY']) expect(isWorkspaceName(word), word).toBe(false)
  })

  it.each(['BUY', 'SELL', 'ORDER', 'ORDERS', 'SUBMIT', 'CANCEL', 'MODIFY', 'TRANSMIT', 'MY_ORDER', 'SELL_PLAN'])(
    'refuses %s: an order ticket word would put an order control in the frame strip',
    (name) => {
      expect(isWorkspaceName(name)).toBe(false)
    },
  )

  it.each(['REVIEW', 'VMREVIEW', 'BORDER'])('still accepts %s, which only holds those letters inside a longer word', (name) => {
    expect(isWorkspaceName(name)).toBe(true)
  })

  it('says in both refusal texts that a trading word is not a name, in the copy rules', () => {
    expect(PARSE_MESSAGES['bad-name']).toContain('not a function, command or trading word')
    expect(WORKSPACES.badName).toContain('not a function, command or trading word')
    expect(findCopyViolations({ parse: PARSE_MESSAGES['bad-name'], badName: WORKSPACES.badName })).toEqual([])
  })

  it('refuses the words SAVE, LOAD and FORGET, so "LOAD LOAD" never has two readings', () => {
    for (const word of ['SAVE', 'LOAD', 'FORGET']) expect(isWorkspaceName(word), word).toBe(false)
  })
})

describe('recipe checks: a recipe is untrusted input', () => {
  it('returns a clean copy of a valid recipe', () => {
    const copy = cleanRecipe(HOME)
    expect(copy).toEqual(HOME)
    expect(copy).not.toBe(HOME)
  })

  it('drops fields it does not know, at every depth', () => {
    const noisy = {
      ...HOME,
      extra: 1,
      panels: HOME.panels.map((p) => ({ ...p, sneaky: '<b>' })),
      groups: { ...HOME.groups, D: { kind: 'run', value: 'x' } },
    }
    expect(cleanRecipe(noisy)).toEqual(HOME)
  })

  it('refuses a value that is not a recipe object', () => {
    for (const value of [null, undefined, 3, 'x', [], [HOME]]) expect(cleanRecipe(value)).toBeNull()
  })

  it('refuses another version, or a missing or empty panel list', () => {
    expect(cleanRecipe({ ...HOME, version: 2 })).toBeNull()
    expect(cleanRecipe({ ...HOME, version: undefined })).toBeNull()
    expect(cleanRecipe({ ...HOME, panels: [] })).toBeNull()
    expect(cleanRecipe({ ...HOME, panels: 'NQ GP' })).toBeNull()
    expect(cleanRecipe({ ...HOME, panels: undefined })).toBeNull()
  })

  it('refuses a line longer than a command line, or outside the command alphabet, or blank', () => {
    const one = (line: unknown): unknown => ({ ...HOME, panels: [{ ...HOME.panels[0], line }] })
    expect(cleanRecipe(one('A'.repeat(200)))).not.toBeNull()
    expect(cleanRecipe(one('A'.repeat(201)))).toBeNull()
    for (const line of ['NQ; GP', 'NQ/GP', 'NQ\tGP', 'NQ\nGP', 'NQ GP <b>', 'NQ GP é', '', '   ', 'NQ+GP', "NQ' OR 1", 'GP%20', 5, null, undefined, ['GP']]) {
      expect(cleanRecipe(one(line)), JSON.stringify(line)).toBeNull()
    }
  })

  it('checks the link group of each panel', () => {
    const one = (group: unknown): unknown => ({ ...HOME, panels: [{ ...HOME.panels[0], group }] })
    for (const group of ['-', 'A', 'B', 'C']) expect(cleanRecipe(one(group))).not.toBeNull()
    for (const group of ['D', 'a', '', null, 1, undefined]) expect(cleanRecipe(one(group))).toBeNull()
  })

  it('checks where each panel sits: the first has no reference, the others point at an earlier panel', () => {
    const at = (panels: unknown): unknown => ({ ...HOME, panels })
    const p = HOME.panels
    expect(cleanRecipe(at([{ ...p[0], ref: 0 }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: null }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: 1 }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: 2 }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: -1 }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: 0.5 }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: '0' }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], direction: 'left' }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], direction: undefined }]))).toBeNull()
    expect(cleanRecipe(at([p[0], { ...p[1], ref: 0 }]))).not.toBeNull()
  })

  it('checks the link group contexts with the link group rules', () => {
    const groups = (g: unknown): unknown => ({ ...HOME, groups: g })
    expect(cleanRecipe(groups({ A: null, B: null, C: null }))).not.toBeNull()
    expect(cleanRecipe(groups({ A: { kind: 'run', value: 'nt_dtsmom_v0_ts1' }, B: null, C: null }))).not.toBeNull()
    expect(cleanRecipe(groups({ A: { kind: 'planet', value: 'NQ' }, B: null, C: null }))).toBeNull()
    expect(cleanRecipe(groups({ A: { kind: 'instrument', value: 'N Q' }, B: null, C: null }))).toBeNull()
    expect(cleanRecipe(groups({ A: { kind: 'instrument', value: '' }, B: null, C: null }))).toBeNull()
    expect(cleanRecipe(groups({ A: null, B: null }))).toBeNull()
    expect(cleanRecipe(groups(null))).toBeNull()
    expect(cleanRecipe(groups([null, null, null]))).toBeNull()
  })

  it('caps a recipe at 20,000 characters of JSON: exactly 20,000 is kept, one more is refused', () => {
    const size = (r: Recipe): number => JSON.stringify(r).length
    let n = 1
    while (size(wide(n + 1, 200)) <= MAX_RECIPE_CHARS) n += 1
    const over = wide(n + 1, 200)
    expect(size(over)).toBeGreaterThan(MAX_RECIPE_CHARS)
    // Shorten lines from the end until the recipe is exactly `total` characters long.
    const shrunk = (total: number): Recipe => {
      let excess = size(over) - total
      const panels = [...over.panels].reverse().map((p) => {
        const cut = Math.min(excess, p.line.length - 1)
        excess -= cut
        return { ...p, line: p.line.slice(0, p.line.length - cut) }
      })
      return { ...over, panels: panels.reverse() }
    }
    expect(size(shrunk(MAX_RECIPE_CHARS))).toBe(MAX_RECIPE_CHARS)
    expect(cleanRecipe(shrunk(MAX_RECIPE_CHARS))).not.toBeNull()
    expect(size(shrunk(MAX_RECIPE_CHARS + 1))).toBe(MAX_RECIPE_CHARS + 1)
    expect(cleanRecipe(shrunk(MAX_RECIPE_CHARS + 1))).toBeNull()
    expect(cleanRecipe(wide(n, 200))).not.toBeNull()
    expect(cleanRecipe(over)).toBeNull()
  })
})

describe('the workspaces store', () => {
  it('starts empty, with no last workspace', () => {
    const { store } = setup()
    expect(store.getState().list).toEqual({})
    expect(store.getState().last).toBeNull()
  })

  it('keeps a saved recipe under nqt.workspaces and restores it in a new store', () => {
    const { store, backing } = setup()
    expect(store.getState().save('MINE', HOME)).toBe(true)
    expect(store.getState().list.MINE).toEqual(HOME)
    expect(JSON.parse(backing.getItem(WORKSPACES_KEY) ?? 'null')).toEqual({ version: 1, list: { MINE: HOME }, last: null })
    const restored = createWorkspacesStore(createSafeStorage(() => backing))
    expect(restored.getState().list).toEqual({ MINE: HOME })
  })

  it('stores a copy, so a later change to the caller object does not leak in', () => {
    const { store } = setup()
    const mine = structuredClone(HOME) as unknown as { panels: { line: string }[] }
    store.getState().save('MINE', mine as unknown as Recipe)
    mine.panels[0]!.line = 'CHANGED'
    expect(store.getState().list.MINE?.panels[0]?.line).toBe('NQ GP 1d')
  })

  it('saving under an existing name replaces that recipe', () => {
    const { store } = setup()
    store.getState().save('MINE', HOME)
    const smaller: Recipe = { ...HOME, panels: [HOME.panels[0]!] }
    expect(store.getState().save('MINE', smaller)).toBe(true)
    expect(store.getState().list.MINE?.panels).toHaveLength(1)
    expect(Object.keys(store.getState().list)).toEqual(['MINE'])
  })

  it('refuses a bad name or a bad recipe and changes nothing', () => {
    const { store, backing } = setup()
    expect(store.getState().save('home', HOME)).toBe(false)
    expect(store.getState().save('HOME', HOME)).toBe(false)
    expect(store.getState().save('RESET', HOME)).toBe(false)
    expect(store.getState().save('MINE', { ...HOME, version: 2 } as unknown as Recipe)).toBe(false)
    expect(store.getState().save('MINE', wide(90, 200))).toBe(false)
    expect(store.getState().list).toEqual({})
    expect(backing.getItem(WORKSPACES_KEY)).toBeNull()
  })

  it('holds at most 12 workspaces: a 13th name is refused, an existing one can still be replaced', () => {
    const { store } = setup()
    for (let i = 0; i < MAX_WORKSPACES; i += 1) expect(store.getState().save(`WS_${i}`, HOME)).toBe(true)
    expect(Object.keys(store.getState().list)).toHaveLength(12)
    expect(store.getState().save('ONE_TOO_MANY', HOME)).toBe(false)
    expect(Object.keys(store.getState().list)).toHaveLength(12)
    expect(store.getState().save('WS_3', { ...HOME, panels: [HOME.panels[0]!] })).toBe(true)
    expect(store.getState().list.WS_3?.panels).toHaveLength(1)
    expect(store.getState().forget('WS_0')).toBe(true)
    expect(store.getState().save('ONE_TOO_MANY', HOME)).toBe(true)
  })

  it('forgets one workspace, and says whether there was one', () => {
    const { store, backing } = setup()
    store.getState().save('AAA', HOME)
    store.getState().save('BBB', HOME)
    expect(store.getState().forget('AAA')).toBe(true)
    expect(Object.keys(store.getState().list)).toEqual(['BBB'])
    expect(store.getState().forget('AAA')).toBe(false)
    expect(store.getState().forget('NEVER')).toBe(false)
    expect(store.getState().forget('__proto__')).toBe(false)
    expect(store.getState().forget('BBB')).toBe(true)
    expect(backing.getItem(WORKSPACES_KEY)).toBeNull()
  })

  it('remembers the last workspace across a restart', () => {
    const { store, backing } = setup()
    store.getState().save('AAA', HOME)
    store.getState().save('BBB', HOME)
    store.getState().setLast('BBB')
    expect(store.getState().last).toBe('BBB')
    const restored = createWorkspacesStore(createSafeStorage(() => backing))
    expect(restored.getState().last).toBe('BBB')
    expect(Object.keys(restored.getState().list)).toEqual(['AAA', 'BBB'])
  })

  it('only points last at a saved workspace, and null clears it', () => {
    const { store } = setup()
    store.getState().save('AAA', HOME)
    store.getState().setLast('AAA')
    store.getState().setLast('NEVER')
    expect(store.getState().last).toBe('AAA')
    store.getState().setLast(null)
    expect(store.getState().last).toBeNull()
  })

  it('forgetting the last workspace clears last', () => {
    const { store, backing } = setup()
    store.getState().save('AAA', HOME)
    store.getState().save('BBB', HOME)
    store.getState().setLast('AAA')
    store.getState().forget('BBB')
    expect(store.getState().last).toBe('AAA')
    store.getState().forget('AAA')
    expect(store.getState().last).toBeNull()
    expect(createWorkspacesStore(createSafeStorage(() => backing)).getState().last).toBeNull()
  })
})

describe('corrupt or tampered storage is ignored', () => {
  it.each([
    ['not JSON', 'not json'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['another version', JSON.stringify({ version: 2, list: { MINE: HOME }, last: 'MINE' })],
    ['a list that is an array', JSON.stringify({ version: 1, list: [HOME], last: null })],
    ['no list', JSON.stringify({ version: 1, last: null })],
  ])('starts empty for %s', (_why, text) => {
    const { store } = setup(text)
    expect(store.getState().list).toEqual({})
    expect(store.getState().last).toBeNull()
  })

  it('drops a tampered entry and keeps the valid ones', () => {
    const stored = JSON.stringify({
      version: 1,
      list: {
        MINE: HOME,
        home: HOME,
        RESET: HOME,
        BROKEN: { ...HOME, panels: [{ line: 'NQ; DROP', group: '-', ref: null, direction: 'right' }] },
        TEXT: 'NQ GP',
      },
      last: 'MINE',
    })
    const { store } = setup(stored)
    expect(Object.keys(store.getState().list)).toEqual(['MINE'])
    expect(store.getState().last).toBe('MINE')
  })

  it('ignores a last that names no saved workspace', () => {
    const { store } = setup(JSON.stringify({ version: 1, list: { MINE: HOME }, last: 'GONE' }))
    expect(store.getState().last).toBeNull()
    const { store: other } = setup(JSON.stringify({ version: 1, list: { MINE: HOME }, last: 7 }))
    expect(other.getState().last).toBeNull()
  })

  it('reads at most 12 entries from storage', () => {
    const list = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`WS_${i}`, HOME]))
    const { store } = setup(JSON.stringify({ version: 1, list, last: null }))
    expect(Object.keys(store.getState().list)).toHaveLength(12)
  })

  it('does not let a __proto__ key from storage reach the list', () => {
    const { store } = setup('{"version":1,"list":{"__proto__":{"polluted":true},"MINE":' + JSON.stringify(HOME) + '},"last":null}')
    expect(Object.keys(store.getState().list)).toEqual(['MINE'])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('keeps working in memory when storage throws', () => {
    const store = createWorkspacesStore(
      createSafeStorage(() => {
        throw new DOMException('denied', 'SecurityError')
      }),
    )
    expect(store.getState().save('MINE', HOME)).toBe(true)
    expect(store.getState().save('OTHER', HOME)).toBe(true)
    store.getState().setLast('MINE')
    expect(Object.keys(store.getState().list).sort()).toEqual(['MINE', 'OTHER'])
    expect(store.getState().last).toBe('MINE')
    expect(store.getState().forget('MINE')).toBe(true)
    expect(Object.keys(store.getState().list)).toEqual(['OTHER'])
  })
})

describe('whether the last write reached storage (persisted)', () => {
  /** A Storage that reads and lists fine but refuses every write, as a full quota or blocked site data does. */
  function refusing(): Storage {
    const backing = memoryStorage()
    backing.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    return backing
  }

  it('starts true, and stays true while writes reach storage', () => {
    const { store } = setup()
    expect(store.getState().persisted).toBe(true)
    expect(store.getState().save('MINE', HOME)).toBe(true)
    expect(store.getState().persisted).toBe(true)
    store.getState().setLast('MINE')
    expect(store.getState().persisted).toBe(true)
    expect(store.getState().forget('MINE')).toBe(true)
    expect(store.getState().persisted).toBe(true)
  })

  it('save still answers true when the write failed: the workspace is kept for this window, and persisted is false', () => {
    const store = createWorkspacesStore(createSafeStorage(() => refusing()))
    expect(store.getState().save('MINE', HOME)).toBe(true)
    expect(store.getState().list.MINE).toEqual(HOME)
    expect(store.getState().persisted).toBe(false)
  })

  it('setLast and forget report a failed write too, and a later write that works clears it', () => {
    const backing = memoryStorage()
    let blocked = true
    const real = backing.setItem.bind(backing)
    backing.setItem = (key, value) => {
      if (blocked) throw new DOMException('full', 'QuotaExceededError')
      real(key, value)
    }
    const store = createWorkspacesStore(createSafeStorage(() => backing))
    store.getState().save('MINE', HOME)
    store.getState().save('OTHER', HOME)
    expect(store.getState().persisted).toBe(false)
    store.getState().setLast('MINE')
    expect(store.getState().persisted).toBe(false)
    blocked = false
    store.getState().setLast('OTHER')
    expect(store.getState().persisted).toBe(true)
    expect(JSON.parse(backing.getItem(WORKSPACES_KEY) ?? 'null')).toMatchObject({ last: 'OTHER' })
    blocked = true
    expect(store.getState().forget('MINE')).toBe(true)
    expect(store.getState().persisted).toBe(false)
  })

  it('forgetting the last workspace reports a failed removal', () => {
    const backing = memoryStorage()
    const store = createWorkspacesStore(createSafeStorage(() => backing))
    store.getState().save('MINE', HOME)
    expect(store.getState().persisted).toBe(true)
    backing.removeItem = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    expect(store.getState().forget('MINE')).toBe(true)
    expect(store.getState().persisted).toBe(false)
  })

  it('a refused save leaves persisted as it was', () => {
    const { store } = setup()
    expect(store.getState().save('not a name', HOME)).toBe(false)
    expect(store.getState().persisted).toBe(true)
  })
})

describe('two windows', () => {
  it('a save in one window does not drop the other window\'s workspace (no lost update)', () => {
    const backing = memoryStorage()
    const a = createWorkspacesStore(createSafeStorage(() => backing))
    const b = createWorkspacesStore(createSafeStorage(() => backing))
    expect(a.getState().save('AAA', HOME)).toBe(true)
    expect(b.getState().save('BBB', HOME)).toBe(true)
    const fresh = createWorkspacesStore(createSafeStorage(() => backing))
    expect(Object.keys(fresh.getState().list).sort()).toEqual(['AAA', 'BBB'])
  })

  it('a window still open refreshes from a storage event fired by another window', () => {
    const backing = memoryStorage()
    const a = createWorkspacesStore(createSafeStorage(() => backing))
    const b = createWorkspacesStore(createSafeStorage(() => backing))
    a.getState().save('AAA', HOME)
    const raw = backing.getItem(WORKSPACES_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: WORKSPACES_KEY, newValue: raw, storageArea: window.localStorage }))
    expect(Object.keys(b.getState().list)).toEqual(['AAA'])
  })

  it('the 12 workspace cap counts what the other window saved too', () => {
    const backing = memoryStorage()
    const a = createWorkspacesStore(createSafeStorage(() => backing))
    const b = createWorkspacesStore(createSafeStorage(() => backing))
    for (let i = 0; i < 12; i += 1) a.getState().save(`WS_${i}`, HOME)
    expect(b.getState().save('EXTRA', HOME)).toBe(false)
  })
})
