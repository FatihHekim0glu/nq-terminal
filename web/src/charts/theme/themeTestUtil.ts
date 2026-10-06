// Test helper for the chart theme tests: every colour-like string inside an option object, with its
// path, so a test can prove each one is a token value (no stray hex).
const COLOUR = /^(#[0-9A-Fa-f]{3,8}|rgba?\(.*\)|hsla?\(.*\)|oklch\(.*\))$/

export interface FoundColour {
  readonly path: string
  readonly value: string
}

export function collectColours(value: unknown, path = ''): FoundColour[] {
  if (typeof value === 'string') return COLOUR.test(value.trim()) ? [{ path, value }] : []
  if (Array.isArray(value)) return value.flatMap((v, i) => collectColours(v, `${path}[${i}]`))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectColours(v, path ? `${path}.${k}` : k))
  }
  return []
}

// Vitest stubs CSS imports (even with ?raw) outside src/theme/tokens.css, so CSS files are read from
// disk. The app tsconfig carries browser types only, so the Node built-ins are typed here by hand.
interface NodeFs {
  readFileSync(path: string, encoding: 'utf-8'): string
}
interface NodeUrl {
  fileURLToPath(url: string | URL): string
}
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as NodeFs
const url = builtins.getBuiltinModule('node:url') as NodeUrl

/** A text file by path relative to this folder (src/charts/theme). */
export function readText(relative: string): string {
  return fs.readFileSync(url.fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** A controllable stand-in for window.matchMedia: `set` changes a query and fires its change listeners. */
export interface FakeMedia {
  readonly match: (query: string) => {
    readonly matches: boolean
    addEventListener(type: 'change', listener: () => void): void
    removeEventListener(type: 'change', listener: () => void): void
  }
  set(query: string, matches: boolean): void
  /** How many change listeners are attached across every query. */
  listeners(): number
  /** Puts `match` on window.matchMedia (jsdom has none); returns the undo. */
  install(): () => void
}

export function fakeMedia(initial: Readonly<Record<string, boolean>> = {}): FakeMedia {
  const state = new Map<string, boolean>(Object.entries(initial))
  const listeners = new Map<string, Set<() => void>>()
  const of = (q: string) => {
    const set = listeners.get(q) ?? new Set<() => void>()
    listeners.set(q, set)
    return set
  }
  const match: FakeMedia['match'] = (query) => ({
    get matches() {
      return state.get(query) === true
    },
    addEventListener: (_type, l) => void of(query).add(l),
    removeEventListener: (_type, l) => void of(query).delete(l),
  })
  return {
    match,
    set(query, matches) {
      state.set(query, matches)
      for (const l of [...of(query)]) l()
    },
    listeners: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    install() {
      const w = window as unknown as { matchMedia?: unknown }
      const before = w.matchMedia
      w.matchMedia = match
      return () => {
        if (before === undefined) delete w.matchMedia
        else w.matchMedia = before
      }
    },
  }
}
