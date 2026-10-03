// Link groups (UI_SPEC section 2): setting a context in one A panel retargets every A panel and syncs the
// time crosshair across them. `[-]` panels are unlinked and never read this store.
// Contexts use the command parser's shape ({kind, value}, src/commands/types.ts ResolvedContext) so a
// parsed command can be stored as it is. Contexts persist per viewer; the crosshair never does.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { isPlainObject, readJson, safeLocalStorage, writeJson, type SafeStorage } from './safeStorage'

export const LINK_GROUPS = ['A', 'B', 'C'] as const
export type LinkGroup = (typeof LINK_GROUPS)[number]
/** A panel's link setting: one of the groups, or '-' for unlinked. */
export type PanelLink = LinkGroup | '-'

export const CONTEXT_KINDS = ['instrument', 'hypothesis', 'run', 'universe'] as const
export type LinkContextKind = (typeof CONTEXT_KINDS)[number]

export interface LinkContext {
  readonly kind: LinkContextKind
  readonly value: string
}

export type GroupRecord<T> = Readonly<Record<LinkGroup, T>>

export interface LinkGroupsState {
  readonly contexts: GroupRecord<LinkContext | null>
  /** Crosshair time per group, epoch seconds (the API's `t` convention); null when no chart is hovered. */
  readonly crosshair: GroupRecord<number | null>
  /** Retarget a group; false (and no change) when the context is malformed. null clears the group. */
  setContext(group: LinkGroup, context: LinkContext | null): boolean
  clearAll(): void
  setCrosshair(group: LinkGroup, t: number | null): void
}

export const LINK_GROUPS_KEY = 'nqt.linkGroups'
const STORE_VERSION = 1
// Instrument roots, hypothesis names, run ids and 27F: word characters, dots and dashes only.
const CONTEXT_VALUE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

const EMPTY_CONTEXTS: GroupRecord<LinkContext | null> = { A: null, B: null, C: null }
const EMPTY_CROSSHAIR: GroupRecord<number | null> = { A: null, B: null, C: null }

export function isLinkGroup(value: unknown): value is LinkGroup {
  return typeof value === 'string' && (LINK_GROUPS as ReadonlyArray<string>).includes(value)
}

export function isLinkContext(value: unknown): value is LinkContext {
  if (!isPlainObject(value)) return false
  const { kind, value: text } = value
  return (
    typeof kind === 'string' &&
    (CONTEXT_KINDS as ReadonlyArray<string>).includes(kind) &&
    typeof text === 'string' &&
    CONTEXT_VALUE.test(text)
  )
}

interface StoredLinkGroups {
  readonly version: number
  readonly contexts: Record<string, unknown>
}

function isStored(value: unknown): value is StoredLinkGroups {
  return isPlainObject(value) && value.version === STORE_VERSION && isPlainObject(value.contexts)
}

/** Also read by state/remoteStore.ts, which re-reads the key when the workspace store or another window changes it. */
export function loadContexts(storage: SafeStorage): GroupRecord<LinkContext | null> {
  const stored = readJson(storage, LINK_GROUPS_KEY, isStored)
  if (!stored) return EMPTY_CONTEXTS
  const pick = (group: LinkGroup): LinkContext | null => {
    const candidate = stored.contexts[group]
    return isLinkContext(candidate) ? { kind: candidate.kind, value: candidate.value } : null
  }
  return { A: pick('A'), B: pick('B'), C: pick('C') }
}

function saveContexts(storage: SafeStorage, contexts: GroupRecord<LinkContext | null>): void {
  writeJson(storage, LINK_GROUPS_KEY, { version: STORE_VERSION, contexts })
}

export type LinkGroupsStore = UseBoundStore<StoreApi<LinkGroupsState>>

export function createLinkGroupsStore(storage: SafeStorage = safeLocalStorage): LinkGroupsStore {
  return create<LinkGroupsState>()((set, get) => ({
    contexts: loadContexts(storage),
    crosshair: EMPTY_CROSSHAIR,
    setContext: (group, context) => {
      if (!isLinkGroup(group) || (context !== null && !isLinkContext(context))) return false
      const stored = context === null ? null : { kind: context.kind, value: context.value }
      const contexts = { ...get().contexts, [group]: stored }
      set({ contexts })
      saveContexts(storage, contexts)
      return true
    },
    clearAll: () => {
      set({ contexts: EMPTY_CONTEXTS, crosshair: EMPTY_CROSSHAIR })
      saveContexts(storage, EMPTY_CONTEXTS)
    },
    setCrosshair: (group, t) => {
      if (!isLinkGroup(group) || (t !== null && !Number.isFinite(t))) return
      if (get().crosshair[group] === t) return
      set({ crosshair: { ...get().crosshair, [group]: t } })
    },
  }))
}

/** The app-wide link-group store over window.localStorage. */
export const useLinkGroups: LinkGroupsStore = createLinkGroupsStore()

/** The context a panel should show: its group's context, or null for an unlinked ('-') panel. */
export function contextFor(state: Pick<LinkGroupsState, 'contexts'>, link: PanelLink): LinkContext | null {
  return link === '-' ? null : state.contexts[link]
}
