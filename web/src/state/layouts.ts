// User layouts per screen (UI_SPEC section 2): the dockview workspace saves its serialised layout here,
// keyed by the screen's mnemonic. Defaults live in src/chrome/WorkspaceLayouts.ts; a screen with no saved
// layout (or storage that fails) renders its default. Stored layouts are untrusted input: only plain JSON
// objects under a valid mnemonic are loaded, and the Workspace still validates them against dockview.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { isPlainObject, readJson, safeLocalStorage, writeJson, type SafeStorage } from './safeStorage'

/** A dockview `toJSON()` result, kept opaque here. */
export type SerialisedLayout = Readonly<Record<string, unknown>>

export interface LayoutsState {
  readonly layouts: Readonly<Record<string, SerialisedLayout>>
  /** Remember a screen's layout; false (and no change) when the screen code or layout is refused. */
  saveLayout(screen: string, layout: SerialisedLayout): boolean
  resetLayout(screen: string): void
  resetAll(): void
}

export const LAYOUTS_KEY = 'nqt.layouts'
/** Per-layout cap on the JSON text, well inside a browser's per-origin quota. */
export const MAX_LAYOUT_CHARS = 200_000
const STORE_VERSION = 1
const SCREEN_CODE = /^[A-Z][A-Z0-9]{1,7}$/

export function isScreenCode(value: unknown): value is string {
  return typeof value === 'string' && SCREEN_CODE.test(value)
}

/** A detached copy of the layout as JSON, or null when it is not a plain object, too big or not encodable. */
function toStoredCopy(layout: unknown): SerialisedLayout | null {
  if (!isPlainObject(layout)) return null
  try {
    const text = JSON.stringify(layout)
    if (text.length > MAX_LAYOUT_CHARS) return null
    return JSON.parse(text) as SerialisedLayout
  } catch {
    return null
  }
}

interface StoredLayouts {
  readonly version: number
  readonly layouts: Record<string, unknown>
}

function isStored(value: unknown): value is StoredLayouts {
  return isPlainObject(value) && value.version === STORE_VERSION && isPlainObject(value.layouts)
}

function loadLayouts(storage: SafeStorage): Record<string, SerialisedLayout> {
  const stored = readJson(storage, LAYOUTS_KEY, isStored)
  if (!stored) return {}
  const entries = Object.entries(stored.layouts).flatMap(([screen, layout]) => {
    const copy = isScreenCode(screen) ? toStoredCopy(layout) : null
    return copy ? [[screen, copy] as const] : []
  })
  return Object.fromEntries(entries)
}

function persist(storage: SafeStorage, layouts: Readonly<Record<string, SerialisedLayout>>): void {
  if (Object.keys(layouts).length === 0) {
    storage.remove(LAYOUTS_KEY)
    return
  }
  writeJson(storage, LAYOUTS_KEY, { version: STORE_VERSION, layouts })
}

export type LayoutsStore = UseBoundStore<StoreApi<LayoutsState>>

export function createLayoutsStore(storage: SafeStorage = safeLocalStorage): LayoutsStore {
  return create<LayoutsState>()((set, get) => ({
    layouts: loadLayouts(storage),
    saveLayout: (screen, layout) => {
      const copy = isScreenCode(screen) ? toStoredCopy(layout) : null
      if (!copy) return false
      const layouts = { ...get().layouts, [screen]: copy }
      set({ layouts })
      persist(storage, layouts)
      return true
    },
    resetLayout: (screen) => {
      if (!Object.hasOwn(get().layouts, screen)) return
      const layouts = Object.fromEntries(Object.entries(get().layouts).filter(([key]) => key !== screen))
      set({ layouts })
      persist(storage, layouts)
    },
    resetAll: () => {
      set({ layouts: {} })
      persist(storage, {})
    },
  }))
}

/** The app-wide layout store over window.localStorage. */
export const useLayouts: LayoutsStore = createLayoutsStore()

/** The saved layout for a screen, or null to render the screen's default layout. */
export function layoutFor(state: Pick<LayoutsState, 'layouts'>, screen: string): SerialisedLayout | null {
  return Object.hasOwn(state.layouts, screen) ? (state.layouts[screen] ?? null) : null
}
