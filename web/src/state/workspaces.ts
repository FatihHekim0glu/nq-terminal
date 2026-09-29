// Named workspaces (roadmap #14): SAVE NAME keeps the panels on screen as a recipe, a sequence of command
// lines with the link group and the split each panel sits in; LOAD NAME rebuilds them by running the lines
// again. Stored under 'nqt.workspaces' as { version, list, last }, at most 12 workspaces and 20,000
// characters of JSON per recipe.
// A stored recipe is untrusted input, so it is rebuilt field by field on the way in (cleanRecipe) and its
// lines are parsed again by the command parser before anything runs; a storage failure or a tampered value
// means "no workspaces", never an error on screen. This file is part of the first-paint shell: it imports
// only types from the chrome (the recipe walker itself lives in chrome/WorkspaceRecipe.ts, in the
// Workspace chunk).
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { MAX_LINE } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { sectorWord } from '../commands/sectors'
import { CHROME_WORDS } from '../copy/commands'
import { LINK_GROUPS, isLinkContext, type GroupRecord, type LinkContext } from './linkGroups'
import { isPlainObject, readJson, safeLocalStorage, writeJson, type SafeStorage } from './safeStorage'

export const WORKSPACES_KEY = 'nqt.workspaces'
export const MAX_WORKSPACES = 12
/** Per-recipe cap on its JSON text, so a workspace cannot fill the browser's quota. */
export const MAX_RECIPE_CHARS = 20_000
const STORE_VERSION = 1
const RECIPE_VERSION = 1

/** A panel's link setting in a recipe: one of the groups, or '-' for unlinked. */
export type RecipeGroup = '-' | 'A' | 'B' | 'C'
export type RecipeDirection = 'right' | 'below'

/**
 * One panel: the command line that opens it, its link group, and where it goes. `ref` is the index of an
 * earlier panel of the same recipe (null for the first panel), `direction` the side of that panel it is
 * split off on.
 */
export interface RecipePanel {
  readonly line: string
  readonly group: RecipeGroup
  readonly ref: number | null
  readonly direction: RecipeDirection
}

export interface Recipe {
  readonly version: 1
  readonly panels: readonly RecipePanel[]
  /** The context each link group held when the recipe was made. */
  readonly groups: GroupRecord<LinkContext | null>
}

const NAME = /^[A-Z][A-Z0-9_]{1,15}$/
/** An order ticket word at the start of a name or of a part after an underscore: the name becomes a tab in the frame
 * strip, and BUY, SELL, ORDER, SUBMIT, CANCEL, MODIFY or TRANSMIT there would read as an order control on a terminal
 * that has no order path. The same pattern is in commands/line.ts (isSavableName); a test keeps the two in step. */
const TICKET_NAME = /(^|_)(ORDER|SUBMIT|CANCEL|MODIF|TRANSMIT|BUY|SELL)/
/** Letters, digits, underscore, dot, hyphen and space: the command alphabet (chrome/deepLink.ts). */
const LINE_ALPHABET = /^[A-Za-z0-9_. -]+$/
/** Words of the workspace commands themselves: SAVE, LOAD and FORGET are chrome words from the command
 * line slice on; reserved here as well so a name never has two readings. */
const COMMAND_WORDS: readonly string[] = ['SAVE', 'LOAD', 'FORGET']
const RECIPE_GROUPS: readonly string[] = ['-', ...LINK_GROUPS]

/**
 * A workspace name: 2 to 16 characters of A-Z, 0-9 and underscore, starting with a letter, that is not a
 * mnemonic, a chrome word or a sector word (the command line would read those first) and not an order ticket word.
 */
export function isWorkspaceName(value: unknown): value is string {
  if (typeof value !== 'string' || !NAME.test(value) || TICKET_NAME.test(value)) return false
  return !findMnemonic(value) && !Object.hasOwn(CHROME_WORDS, value) && sectorWord(value) === null && !COMMAND_WORDS.includes(value)
}

function cleanPanel(raw: unknown, index: number): RecipePanel | null {
  if (!isPlainObject(raw)) return null
  const { line, group, ref, direction } = raw
  if (typeof line !== 'string' || line.length > MAX_LINE || line.trim() === '' || !LINE_ALPHABET.test(line)) return null
  if (typeof group !== 'string' || !RECIPE_GROUPS.includes(group)) return null
  if (direction !== 'right' && direction !== 'below') return null
  // The first panel is the root of the split tree; every other one hangs off a panel before it.
  if (index === 0 ? ref !== null : typeof ref !== 'number' || !Number.isInteger(ref) || ref < 0 || ref >= index) return null
  return { line, group: group as RecipeGroup, ref: ref as number | null, direction }
}

function cleanGroups(raw: unknown): GroupRecord<LinkContext | null> | null {
  if (!isPlainObject(raw)) return null
  const picked: Partial<Record<(typeof LINK_GROUPS)[number], LinkContext | null>> = {}
  for (const group of LINK_GROUPS) {
    const context = raw[group]
    if (context === null) picked[group] = null
    else if (isLinkContext(context)) picked[group] = { kind: context.kind, value: context.value }
    else return null
  }
  return picked as GroupRecord<LinkContext | null>
}

/**
 * A detached, rebuilt copy of a recipe, or null when it is not one: another version, no panels, a line
 * over MAX_LINE or outside the command alphabet, a group or direction that does not exist, a reference
 * that does not point at an earlier panel, a group context the link groups would refuse, or more than
 * MAX_RECIPE_CHARS of JSON. Unknown fields are dropped.
 */
export function cleanRecipe(value: unknown): Recipe | null {
  if (!isPlainObject(value) || value.version !== RECIPE_VERSION || !Array.isArray(value.panels) || value.panels.length === 0) return null
  const panels: RecipePanel[] = []
  for (const [index, raw] of value.panels.entries()) {
    const panel = cleanPanel(raw, index)
    if (!panel) return null
    panels.push(panel)
  }
  const groups = cleanGroups(value.groups)
  if (!groups) return null
  const recipe: Recipe = { version: RECIPE_VERSION, panels, groups }
  try {
    return JSON.stringify(recipe).length <= MAX_RECIPE_CHARS ? recipe : null
  } catch {
    return null
  }
}

export interface WorkspacesState {
  /** Saved recipes by name, in the order they were first saved. */
  readonly list: Readonly<Record<string, Recipe>>
  /** The workspace saved or loaded last, when it still exists. */
  readonly last: string | null
  /** False when the last write to storage failed (site data blocked, storage full): the list is then kept in
   * this window only and is gone after a reload. True at the start and after any write that worked. */
  readonly persisted: boolean
  /** Keep a recipe under a name; false (and no change) when the name or recipe is refused or the 13th name is new.
   * True also when storage refused the write: the recipe is kept for this window and `persisted` says so. */
  save(name: string, recipe: Recipe): boolean
  /** Drop a workspace; false when there was none of that name. */
  forget(name: string): boolean
  /** Point `last` at a saved workspace, or clear it with null; a name that is not saved is ignored. */
  setLast(name: string | null): void
}

interface StoredWorkspaces {
  readonly version: number
  readonly list: Record<string, unknown>
  readonly last?: unknown
}

function isStored(value: unknown): value is StoredWorkspaces {
  return isPlainObject(value) && value.version === STORE_VERSION && isPlainObject(value.list)
}

interface Snapshot {
  readonly list: Readonly<Record<string, Recipe>>
  readonly last: string | null
}

function pickLast(last: unknown, list: Readonly<Record<string, Recipe>>): string | null {
  return typeof last === 'string' && Object.hasOwn(list, last) ? last : null
}

function loadSnapshot(storage: SafeStorage): Snapshot {
  const stored = readJson(storage, WORKSPACES_KEY, isStored)
  if (!stored) return { list: {}, last: null }
  const entries = Object.entries(stored.list).flatMap(([name, raw]) => {
    const recipe = isWorkspaceName(name) ? cleanRecipe(raw) : null
    return recipe ? [[name, recipe] as const] : []
  })
  const list = Object.fromEntries(entries.slice(0, MAX_WORKSPACES))
  return { list, last: pickLast(stored.last, list) }
}

/** Writes the snapshot; true when storage took it (an empty list removes the key). */
function persist(storage: SafeStorage, snapshot: Snapshot): boolean {
  if (Object.keys(snapshot.list).length === 0) return storage.remove(WORKSPACES_KEY)
  return writeJson(storage, WORKSPACES_KEY, { version: STORE_VERSION, list: snapshot.list, last: snapshot.last })
}

export type WorkspacesStore = UseBoundStore<StoreApi<WorkspacesState>>

export function createWorkspacesStore(storage: SafeStorage = safeLocalStorage): WorkspacesStore {
  /** Storage overrides memory (another window's newer save wins), but memory is the base: with storage
   * blocked, or a write that failed, reading it back comes up empty and must not drop what this window
   * already holds (the lost update that state/layouts.ts also guards against). */
  const current = (state: Pick<WorkspacesState, 'list' | 'last'>): Snapshot => {
    const stored = loadSnapshot(storage)
    const list = { ...state.list, ...stored.list }
    return { list, last: pickLast(stored.last ?? state.last, list) }
  }
  const store = create<WorkspacesState>()((set, get) => ({
    ...loadSnapshot(storage),
    persisted: true,
    save: (name, recipe) => {
      const clean = isWorkspaceName(name) ? cleanRecipe(recipe) : null
      if (!clean) return false
      const now = current(get())
      if (!Object.hasOwn(now.list, name) && Object.keys(now.list).length >= MAX_WORKSPACES) return false
      const next = { list: { ...now.list, [name]: clean }, last: now.last }
      const persisted = persist(storage, next)
      set({ ...next, persisted })
      return true
    },
    forget: (name) => {
      const now = current(get())
      if (!Object.hasOwn(now.list, name)) return false
      const next = {
        list: Object.fromEntries(Object.entries(now.list).filter(([key]) => key !== name)),
        last: now.last === name ? null : now.last,
      }
      const persisted = persist(storage, next)
      set({ ...next, persisted })
      return true
    },
    setLast: (name) => {
      const now = current(get())
      const last = name === null ? null : pickLast(name, now.list)
      if (name !== null && last === null) return
      const next = { list: now.list, last }
      const persisted = persist(storage, next)
      set({ ...next, persisted })
    },
  }))
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== WORKSPACES_KEY) return
      store.setState(loadSnapshot(storage))
    })
  }
  return store
}

/** The app-wide workspaces store over window.localStorage. */
export const useWorkspaces: WorkspacesStore = createWorkspacesStore()
