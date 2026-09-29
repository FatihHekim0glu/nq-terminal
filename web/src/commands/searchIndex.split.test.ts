// The search index and its metric list must stay out of the shell: the index is its own lazy chunk,
// reached only through searchIndexLoader's dynamic import(). A source scan (?raw) holds the split, since
// a static import anywhere in the shell would pull the whole index into the first paint.
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const SHELL_PATTERNS = ['/src/chrome/', '/src/App.tsx', '/src/AppCommandBar.tsx']
const shellFiles = Object.keys(SOURCES).filter((file) => SHELL_PATTERNS.some((p) => file.startsWith(p)))

/** The code without comments, so a comment that names the index is not read as an import. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

interface Reference {
  readonly specifier: string
  readonly typeOnly: boolean
  readonly dynamic: boolean
}

/** Every module specifier a file names: static imports, re-exports and import(). */
function references(text: string): Reference[] {
  const code = withoutComments(text)
  const found: Reference[] = []
  for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?(?:[^'"();]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
    found.push({ specifier: m[3] ?? '', typeOnly: m[2] !== undefined, dynamic: false })
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push({ specifier: m[1] ?? '', typeOnly: false, dynamic: true })
  return found
}

const namesIndex = (specifier: string): boolean => /(^|\/)searchIndex(\.ts)?$/.test(specifier)
const namesMetrics = (specifier: string): boolean => /(^|\/)searchMetrics(\.ts)?$/.test(specifier)

describe('the search index stays out of the shell', () => {
  it('scans the shell files it means to (born failing if the globs match nothing)', () => {
    expect(shellFiles.length).toBeGreaterThan(20)
    expect(shellFiles).toContain('/src/chrome/CommandLine.menus.ts')
    expect(shellFiles).toContain('/src/chrome/CommandLine.live.tsx')
    expect(shellFiles).toContain('/src/App.tsx')
    expect(shellFiles).toContain('/src/AppCommandBar.tsx')
  })

  it('has no shell file that imports copy/searchMetrics or ./searchIndex at run time', () => {
    const offenders = shellFiles.flatMap((file) =>
      references(SOURCES[file] ?? '')
        .filter((r) => !r.typeOnly && (namesIndex(r.specifier) || namesMetrics(r.specifier)))
        .map((r) => `${file} -> ${r.specifier}`),
    )
    expect(offenders).toEqual([])
  })

  it('has the menus (in the shell) read only SEARCH and the loader', () => {
    const menus = references(SOURCES['/src/chrome/CommandLine.menus.ts'] ?? '').map((r) => r.specifier)
    expect(menus).toContain('../copy/search')
    expect(menus).toContain('../commands/searchIndexLoader')
    expect(menus.filter((s) => namesIndex(s) || namesMetrics(s))).toEqual([])
  })

  it('has copy/searchMetrics imported by commands/searchIndex.ts alone', () => {
    const importers = Object.keys(SOURCES).filter((file) => references(SOURCES[file] ?? '').some((r) => !r.typeOnly && namesMetrics(r.specifier)))
    expect(importers).toEqual(['/src/commands/searchIndex.ts'])
  })

  it('has copy/search hold only the SEARCH strings, with no metric list', () => {
    const text = SOURCES['/src/copy/search.ts'] ?? ''
    expect(text).toContain('export const SEARCH')
    expect(text).not.toContain('METRIC_ENTRIES')
    expect(references(text).filter((r) => namesMetrics(r.specifier))).toEqual([])
  })

  it('has the loader reach ./searchIndex through import() only, apart from types', () => {
    const refs = references(SOURCES['/src/commands/searchIndexLoader.ts'] ?? '').filter((r) => namesIndex(r.specifier))
    expect(refs.filter((r) => r.dynamic)).toHaveLength(1)
    expect(refs.filter((r) => !r.dynamic && !r.typeOnly)).toEqual([])
  })

  it('has no other file reach ./searchIndex at run time except through the loader', () => {
    const offenders = Object.keys(SOURCES)
      .filter((file) => file !== '/src/commands/searchIndexLoader.ts')
      .flatMap((file) => references(SOURCES[file] ?? '').filter((r) => !r.typeOnly && namesIndex(r.specifier)).map((r) => `${file} -> ${r.specifier}`))
    expect(offenders).toEqual([])
  })
})

describe('the reference reader (born failing: it must catch what it bans)', () => {
  it('flags a static import, a re-export and an import() of the index', () => {
    const refs = references(
      [
        "import { buildSearchIndex } from '../commands/searchIndex'",
        "export { searchEntries } from './searchIndex'",
        "const lazy = () => import('./searchIndex')",
        "import type { SearchHit } from './searchIndex'",
        "import { METRIC_ENTRIES } from '../copy/searchMetrics'",
        "// import { hidden } from './searchIndex'",
      ].join('\n'),
    )
    expect(refs.map((r) => [r.specifier, r.typeOnly, r.dynamic])).toEqual([
      ['../commands/searchIndex', false, false],
      ['./searchIndex', false, false],
      ['./searchIndex', true, false],
      ['../copy/searchMetrics', false, false],
      ['./searchIndex', false, true],
    ])
  })

  it('does not take searchIndexLoader for the index', () => {
    expect(namesIndex('./searchIndexLoader')).toBe(false)
    expect(namesIndex('../commands/searchIndex')).toBe(true)
    expect(namesMetrics('../copy/searchMetrics')).toBe(true)
  })
})
