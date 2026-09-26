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
