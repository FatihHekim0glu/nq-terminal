import { describe, expect, it } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { cleanRecipe } from '../state/workspaces'
import type { GroupRecord, LinkContext } from '../state/linkGroups'
import { layoutFromRecipe, recipeFromDock, recipeSignature, type DockLike, type Recipe } from './WorkspaceRecipe'
import { panelTitle, type LayoutPanel, type PanelParams } from './WorkspaceModel'

// A grid the way dockview serialises it: a root branch, branches alternating orientation at every level,
// and a leaf per group holding the ids of its panels.
type Node = { type: 'leaf'; data: { views: string[]; id: string } } | { type: 'branch'; data: Node[] }
const leaf = (id: string, views: string[] = [id]): Node => ({ type: 'leaf', data: { views, id: `group-${id}` } })
const branch = (...data: Node[]): Node => ({ type: 'branch', data })

function leaves(node: Node): string[] {
  return node.type === 'leaf' ? node.data.views : node.data.flatMap(leaves)
}

function dockOf(root: Node, orientation: 'HORIZONTAL' | 'VERTICAL' = 'HORIZONTAL'): DockLike {
  const panels = Object.fromEntries(leaves(root).map((id) => [id, { id, contentComponent: 'screen', params: {} }]))
  return { grid: { root, orientation }, panels }
}

const NQ: ResolvedContext = { kind: 'instrument', value: 'NQ' }
const ES: ResolvedContext = { kind: 'instrument', value: 'ES' }
const UNIVERSE: ResolvedContext = { kind: 'universe', value: '27F' }
const VOLMANAGED: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }

const PARAMS: Readonly<Record<string, PanelParams>> = {
  gp: { code: 'GP', context: NQ, args: { timeframe: '1d' }, group: 'A' },
  mon: { code: 'MON', context: UNIVERSE, args: {}, group: 'A' },
  eq: { code: 'EQ', context: VOLMANAGED, args: {}, group: 'B' },
  reg: { code: 'REG', context: null, args: {}, group: '-' },
  ledg: { code: 'LEDG', context: null, args: {}, group: '-' },
  runs: { code: 'RUNS', context: null, args: {}, group: '-' },
  help: { code: 'HELP', context: null, args: {}, group: '-' },
  es: { code: 'GP', context: ES, args: { timeframe: '1h' }, group: 'C' },
}

const GROUPS: GroupRecord<LinkContext | null> = { A: NQ, B: VOLMANAGED, C: null }
const paramsOf = (id: string): PanelParams | null => PARAMS[id] ?? null
const lineOf = (params: PanelParams): string => panelTitle(params)
const derive = (dock: DockLike, groups = GROUPS): Recipe | null => recipeFromDock(dock, paramsOf, lineOf, groups)

// HOME: GP and MON over EQ and REG. Dockview builds it left column first, then splits each row.
const HOME_TREE = branch(branch(leaf('gp'), leaf('mon')), branch(leaf('eq'), leaf('reg')))
const HOME_DOCK = dockOf(HOME_TREE, 'VERTICAL')

function command(line: string, context: ResolvedContext | null = null, args: ParsedCommand['args'] = {}): ParsedCommand {
  const code = line.split(' ').find((token) => findMnemonic(token))
  const mnemonic = code ? findMnemonic(code) : undefined
  if (!mnemonic) throw new Error(line)
  return { mnemonic, context, contextSource: context ? 'typed' : 'none', args, canonical: line }
}

function commandFor(params: PanelParams): ParsedCommand {
  const mnemonic = findMnemonic(params.code)
  if (!mnemonic) throw new Error(params.code)
  return { mnemonic, context: params.context, contextSource: params.context ? 'typed' : 'none', args: params.args, canonical: lineOf(params) }
}

const HOME_COMMANDS: ParsedCommand[] = [
  command('NQ GP 1d', NQ, { timeframe: '1d' }),
  command('volmanaged_v0 EQ', VOLMANAGED),
  command('27F MON', UNIVERSE),
  command('REG'),
]

// A small stand-in for dockview's split rule, to check that a recipe puts the panels back where they were:
// a panel added right of or below a reference joins the reference's row or column when that runs the same
// way, and otherwise the reference is replaced by a new row or column holding both.
type Sim = { orientation: 'HORIZONTAL' | 'VERTICAL'; children: (string | Sim)[] }

function simulate(panels: readonly LayoutPanel[]): Sim {
  const root: Sim = { orientation: 'HORIZONTAL', children: [] }
  const find = (node: Sim, id: string): { parent: Sim; index: number } | null => {
    for (const [index, child] of node.children.entries()) {
      if (child === id) return { parent: node, index }
      if (typeof child !== 'string') {
        const inner = find(child, id)
        if (inner) return inner
      }
    }
    return null
  }
  for (const panel of panels) {
    if (!panel.position) {
      root.children.push(panel.id)
      continue
    }
    const at = find(root, panel.position.ref)
    if (!at) throw new Error(`no reference ${panel.position.ref}`)
    const wanted = panel.position.direction === 'right' ? 'HORIZONTAL' : 'VERTICAL'
    if (at.parent.orientation === wanted) at.parent.children.splice(at.index + 1, 0, panel.id)
    else at.parent.children[at.index] = { orientation: wanted, children: [panel.position.ref, panel.id] }
  }
  return root
}

function readingOrder(node: Sim): string[] {
  return node.children.flatMap((child) => (typeof child === 'string' ? [child] : readingOrder(child)))
}

/** The simulated grid as serialised dockview JSON, so it can be walked again. */
function toDock(node: Sim, ids: (id: string) => string): DockLike {
  const convert = (n: Sim): Node => branch(...n.children.map((c): Node => (typeof c === 'string' ? leaf(ids(c)) : convert(c))))
  return dockOf(convert(node), node.orientation)
}

describe('recipeFromDock: the split tree as a sequence of command lines', () => {
  it('turns the HOME default into four panels in build order', () => {
    const recipe = derive(HOME_DOCK)
    expect(recipe).toEqual({
      version: 1,
      panels: [
        { line: 'NQ GP 1d', group: 'A', ref: null, direction: 'right' },
        { line: 'volmanaged_v0 EQ', group: 'B', ref: 0, direction: 'below' },
        { line: '27F MON', group: 'A', ref: 0, direction: 'right' },
        { line: 'REG', group: '-', ref: 1, direction: 'right' },
      ],
      groups: GROUPS,
    })
  })

  it('places three columns each to the right of the one before', () => {
    const recipe = derive(dockOf(branch(leaf('gp'), leaf('reg'), leaf('ledg'))))
    expect(recipe?.panels.map((p) => [p.line, p.ref, p.direction])).toEqual([
      ['NQ GP 1d', null, 'right'],
      ['REG', 0, 'right'],
      ['LEDG', 1, 'right'],
    ])
  })

  it('places stacked panels each below the one before', () => {
    const recipe = derive(dockOf(branch(leaf('gp'), leaf('reg'), leaf('ledg')), 'VERTICAL'))
    expect(recipe?.panels.map((p) => [p.line, p.ref, p.direction])).toEqual([
      ['NQ GP 1d', null, 'right'],
      ['REG', 0, 'below'],
      ['LEDG', 1, 'below'],
    ])
  })

  it('splits the first panel of each column before it splits the rest of that column', () => {
    // Two columns, the left one stacked: the columns are made first, then the left one is cut in two.
    const recipe = derive(dockOf(branch(branch(leaf('gp'), leaf('reg')), leaf('ledg'))))
    expect(recipe?.panels.map((p) => [p.line, p.ref, p.direction])).toEqual([
      ['NQ GP 1d', null, 'right'],
      ['LEDG', 0, 'right'],
      ['REG', 0, 'below'],
    ])
  })

  it('walks deeper trees the same way at every level', () => {
    // V[ H[ V[gp, reg], mon ], ledg ]
    const tree = branch(branch(branch(leaf('gp'), leaf('reg')), leaf('mon')), leaf('ledg'))
    const recipe = derive(dockOf(tree, 'VERTICAL'))
    expect(recipe?.panels.map((p) => [p.line, p.ref, p.direction])).toEqual([
      ['NQ GP 1d', null, 'right'],
      ['LEDG', 0, 'below'],
      ['27F MON', 0, 'right'],
      ['REG', 0, 'below'],
    ])
  })

  it('describes one panel as a recipe of one line with no reference', () => {
    const recipe = derive(dockOf(branch(leaf('reg'))))
    expect(recipe?.panels).toEqual([{ line: 'REG', group: '-', ref: null, direction: 'right' }])
  })

  it('reads a root that is only a leaf', () => {
    const recipe = derive(dockOf(leaf('reg')))
    expect(recipe?.panels).toEqual([{ line: 'REG', group: '-', ref: null, direction: 'right' }])
  })

  it('takes each line from lineOf, so the line carries the context the panel shows', () => {
    const shown = (params: PanelParams): string => panelTitle({ ...params, context: ES })
    const recipe = recipeFromDock(dockOf(branch(leaf('gp'))), paramsOf, shown, GROUPS)
    expect(recipe?.panels[0]?.line).toBe('ES GP 1d')
  })

  it('keeps the link group contexts, as a copy', () => {
    const groups = { A: NQ, B: null, C: ES }
    const recipe = derive(HOME_DOCK, groups)
    expect(recipe?.groups).toEqual({ A: NQ, B: null, C: ES })
    expect(recipe?.groups).not.toBe(groups)
    expect(recipe?.groups.A).not.toBe(NQ)
  })

  it('gives the same recipe for a root that wraps the tree in a single column', () => {
    // Dockview may keep a one child level at the root after a split; it changes nothing on screen.
    const wrapped = dockOf(branch(HOME_TREE), 'HORIZONTAL')
    expect(derive(wrapped)).toEqual(derive(HOME_DOCK))
  })

  it('gives null when a panel cannot be read back', () => {
    expect(recipeFromDock(HOME_DOCK, (id) => (id === 'eq' ? null : paramsOf(id)), lineOf, GROUPS)).toBeNull()
  })

  it('gives null when a group holds more than one panel, or none', () => {
    expect(derive(dockOf(branch(leaf('gp', ['gp', 'reg']), leaf('mon'))))).toBeNull()
    expect(derive(dockOf(branch(leaf('gp', []), leaf('mon'))))).toBeNull()
  })

  it('gives null for a grid it cannot walk', () => {
    const good = dockOf(branch(leaf('gp')))
    expect(derive({ ...good, grid: { ...good.grid, root: null } })).toBeNull()
    expect(derive({ ...good, grid: { ...good.grid, root: { type: 'branch', data: [] } } })).toBeNull()
    expect(derive({ ...good, grid: { ...good.grid, root: { type: 'twig', data: [] } } })).toBeNull()
    expect(derive({ ...good, grid: { ...good.grid, orientation: 'DIAGONAL' } })).toBeNull()
    expect(derive({ grid: undefined, panels: {} } as unknown as DockLike)).toBeNull()
  })

  it('gives null for a grid nested deeper than dockview ever writes', () => {
    let tree: Node = leaf('gp')
    for (let i = 0; i < 40; i += 1) tree = branch(tree)
    expect(derive(dockOf(tree))).toBeNull()
    let shallow: Node = leaf('gp')
    for (let i = 0; i < 8; i += 1) shallow = branch(shallow)
    expect(derive(dockOf(shallow))).not.toBeNull()
  })

  it('gives null when the dock holds a panel that is not in the grid', () => {
    const dock = dockOf(branch(leaf('gp'), leaf('reg')))
    expect(derive({ ...dock, panels: { ...dock.panels, mon: { id: 'mon' } } })).toBeNull()
  })

  it('gives null for a panel that stands twice in the grid', () => {
    expect(derive(dockOf(branch(leaf('gp'), leaf('gp'))))).toBeNull()
  })

  it('produces a recipe the store accepts', () => {
    const recipe = derive(HOME_DOCK)
    expect(cleanRecipe(recipe)).toEqual(recipe)
  })
})

describe('layoutFromRecipe: the recipe as panels to add', () => {
  const home = derive(HOME_DOCK) as Recipe

  it('names the panels ws-1 to ws-n and positions each against an earlier one', () => {
    const panels = layoutFromRecipe(home, HOME_COMMANDS)
    expect(panels?.map((p) => p.id)).toEqual(['ws-1', 'ws-2', 'ws-3', 'ws-4'])
    expect(panels?.map((p) => p.position)).toEqual([
      undefined,
      { ref: 'ws-1', direction: 'below' },
      { ref: 'ws-1', direction: 'right' },
      { ref: 'ws-2', direction: 'right' },
    ])
  })

  it('takes screen, context and arguments from the parsed commands and the link group from the recipe', () => {
    const panels = layoutFromRecipe(home, HOME_COMMANDS) ?? []
    expect(panels.map((p) => [p.code, p.context, p.args, p.group])).toEqual([
      ['GP', NQ, { timeframe: '1d' }, 'A'],
      ['EQ', VOLMANAGED, {}, 'B'],
      ['MON', UNIVERSE, {}, 'A'],
      ['REG', null, {}, '-'],
    ])
  })

  it('does not share the commands\' argument objects with the panels', () => {
    const panels = layoutFromRecipe(home, HOME_COMMANDS) ?? []
    expect(panels[0]?.args).not.toBe(HOME_COMMANDS[0]?.args)
  })

  it('rebuilds the HOME reading sequence 1-GP 2-MON 3-EQ 4-REG', () => {
    const panels = layoutFromRecipe(home, HOME_COMMANDS) ?? []
    const order = readingOrder(simulate(panels))
    expect(order.map((id) => panels.find((p) => p.id === id)?.code)).toEqual(['GP', 'MON', 'EQ', 'REG'])
  })

  it('gives null when the commands do not match the recipe panel for panel', () => {
    expect(layoutFromRecipe(home, HOME_COMMANDS.slice(0, 3))).toBeNull()
    expect(layoutFromRecipe(home, [...HOME_COMMANDS, command('LEDG')])).toBeNull()
    expect(layoutFromRecipe(home, [])).toBeNull()
  })

  it('gives null for a recipe whose references do not point at an earlier panel', () => {
    const bad = { ...home, panels: home.panels.map((p, i) => (i === 2 ? { ...p, ref: 3 } : p)) }
    expect(layoutFromRecipe(bad, HOME_COMMANDS)).toBeNull()
    const first = { ...home, panels: home.panels.map((p, i) => (i === 0 ? { ...p, ref: 0 } : p)) }
    expect(layoutFromRecipe(first, HOME_COMMANDS)).toBeNull()
    const none = { ...home, panels: home.panels.map((p, i) => (i === 1 ? { ...p, ref: null } : p)) }
    expect(layoutFromRecipe(none, HOME_COMMANDS)).toBeNull()
  })

  const TREES: ReadonlyArray<readonly [string, Node, 'HORIZONTAL' | 'VERTICAL']> = [
    ['HOME', HOME_TREE, 'VERTICAL'],
    ['three columns', branch(leaf('gp'), leaf('reg'), leaf('ledg')), 'HORIZONTAL'],
    ['a stack of three', branch(leaf('gp'), leaf('reg'), leaf('ledg')), 'VERTICAL'],
    ['a stacked column beside a panel', branch(branch(leaf('gp'), leaf('reg')), leaf('ledg')), 'HORIZONTAL'],
    ['three levels', branch(branch(branch(leaf('gp'), leaf('reg')), leaf('mon')), leaf('ledg')), 'VERTICAL'],
    ['a wide row over a split row', branch(leaf('gp'), branch(leaf('mon'), leaf('reg'), leaf('ledg'))), 'VERTICAL'],
    ['columns with unequal stacks', branch(branch(leaf('gp'), leaf('reg'), leaf('help')), branch(leaf('mon'), leaf('eq')), leaf('ledg')), 'HORIZONTAL'],
  ]

  const ID_OF_LINE = new Map(Object.entries(PARAMS).map(([id, params]) => [lineOf(params), id]))

  it.each(TREES)('%s: the rebuilt grid reads in the same order and yields the same recipe again', (_name, tree, orientation) => {
    const recipe = derive(dockOf(tree, orientation)) as Recipe
    const paramsAt = (i: number): PanelParams => PARAMS[ID_OF_LINE.get(recipe.panels[i]?.line ?? '') ?? ''] as PanelParams
    const commands = recipe.panels.map((_p, i) => commandFor(paramsAt(i)))
    const panels = layoutFromRecipe(recipe, commands) ?? []
    expect(panels).toHaveLength(recipe.panels.length)
    const grid = simulate(panels)
    // A rebuilt panel 'ws-n' stands for the n-th panel of the recipe, which came from one leaf of the tree.
    const originalId = (wsId: string): string => ID_OF_LINE.get(recipe.panels[Number(wsId.slice(3)) - 1]?.line ?? '') ?? wsId
    expect(readingOrder(grid).map(originalId)).toEqual(leaves(tree))
    expect(derive(toDock(grid, originalId))).toEqual(recipe)
  })
})

describe('recipeSignature', () => {
  const home = derive(HOME_DOCK) as Recipe

  it('is 8 hex digits and the same for the same recipe', () => {
    expect(recipeSignature(home)).toMatch(/^[0-9a-f]{8}$/)
    expect(recipeSignature(home)).toBe(recipeSignature(structuredClone(home)))
    expect(recipeSignature(home)).toBe(recipeSignature(derive(HOME_DOCK) as Recipe))
  })

  it('does not depend on the order of keys', () => {
    const shuffled = {
      groups: { C: null, B: home.groups.B, A: home.groups.A },
      panels: home.panels.map((p) => ({ direction: p.direction, ref: p.ref, group: p.group, line: p.line })),
      version: 1,
    } as Recipe
    expect(recipeSignature(shuffled)).toBe(recipeSignature(home))
  })

  it('changes with a line, a link group, a split, an order or a group context', () => {
    const base = recipeSignature(home)
    const withPanel = (i: number, change: Partial<Recipe['panels'][number]>): Recipe => ({
      ...home,
      panels: home.panels.map((p, j) => (j === i ? { ...p, ...change } : p)),
    })
    const signatures = [
      recipeSignature(withPanel(3, { line: 'LEDG' })),
      recipeSignature(withPanel(3, { group: 'C' })),
      recipeSignature(withPanel(3, { direction: 'below' })),
      recipeSignature(withPanel(3, { ref: 0 })),
      recipeSignature({ ...home, panels: [...home.panels].reverse() }),
      recipeSignature({ ...home, groups: { ...home.groups, A: ES } }),
      recipeSignature({ ...home, groups: { ...home.groups, C: ES } }),
    ]
    expect(new Set([base, ...signatures]).size).toBe(signatures.length + 1)
  })
})
