// The record watch's shell rule: the diff (state/recordWatch.ts), the WATCH <GO> list
// (chrome/RecordWatch.menu.ts), their entry (chrome/RecordWatch.lazy.ts) and the long copy
// (copy/watchDetail.ts) are reachable only through the one dynamic import in chrome/RecordWatch.live.tsx.
// This reads the sources as text; W4-INT adds the proof from the build manifest.
import { describe, expect, it } from 'vitest'
import liveSource from '../chrome/RecordWatch.live.tsx?raw'
import storeSource from './recordWatch.store.ts?raw'

const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const LIVE = '/src/chrome/RecordWatch.live.tsx'
const LAZY = {
  diff: '/src/state/recordWatch',
  menu: '/src/chrome/RecordWatch.menu',
  entry: '/src/chrome/RecordWatch.lazy',
  detail: '/src/copy/watchDetail',
} as const
/** Who may import each lazy module statically. Nobody imports the entry statically. */
const ALLOWED_IMPORTERS: Readonly<Record<string, readonly string[]>> = {
  [LAZY.diff]: ['/src/chrome/RecordWatch.lazy.ts'],
  [LAZY.menu]: ['/src/chrome/RecordWatch.lazy.ts'],
  [LAZY.entry]: [],
  [LAZY.detail]: ['/src/chrome/RecordWatch.menu.ts'],
}
/** Where a dynamic import of the entry may sit. */
const ALLOWED_DYNAMIC: Readonly<Record<string, readonly string[]>> = { [LAZY.entry]: [LIVE] }

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The module names a file imports or re-exports with a static statement (type imports included). */
export function staticSpecifiers(source: string): string[] {
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  return [...withoutComments(source).matchAll(pattern)].map((m) => m[1] ?? '')
}

/** The module names a file loads with import('...'). */
export function dynamicSpecifiers(source: string): string[] {
  return [...withoutComments(source).matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? '')
}

/** `spec` as an absolute /src path without its .ts or .tsx ending; null for a package name. */
export function resolveSpec(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const parts = file.split('/').slice(0, -1)
  for (const segment of spec.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/').replace(/\.tsx?$/, '')
}

/** Every import of a lazy module that the rule does not allow, as text. */
export function findViolations(files: Readonly<Record<string, string>>): string[] {
  const lazyTargets = new Set<string>(Object.values(LAZY))
  return Object.entries(files).flatMap(([file, source]) => {
    const statics = staticSpecifiers(source)
      .map((spec) => ({ spec, path: resolveSpec(file, spec) }))
      .filter(({ path }) => path !== null && lazyTargets.has(path))
      .filter(({ path }) => !(ALLOWED_IMPORTERS[path ?? ''] ?? []).includes(file))
      .map(({ spec }) => `${file}: static import of ${spec}`)
    const dynamics = dynamicSpecifiers(source)
      .map((spec) => ({ spec, path: resolveSpec(file, spec) }))
      .filter(({ path }) => path !== null && lazyTargets.has(path))
      .filter(({ path }) => !(ALLOWED_DYNAMIC[path ?? ''] ?? []).includes(file))
      .map(({ spec }) => `${file}: dynamic import of ${spec}`)
    return [...statics, ...dynamics]
  })
}

describe('the specifier scan (born failing: it must catch what it bans)', () => {
  it('reads single and multi line imports, re-exports, side effect imports and type imports', () => {
    const source = [
      "import { a } from './one'",
      'import {',
      '  b,',
      "} from '../two'",
      "import type { C } from './three'",
      "export { d } from './four'",
      "export * from './five'",
      "import './six'",
      "import x, { y } from 'pkg'",
      "const e = 'import z from ./not-real'",
      "export const f = 'x'",
    ].join('\n')
    expect(staticSpecifiers(source)).toEqual(['./one', '../two', './three', './four', './five', './six', 'pkg'])
  })

  it('separates dynamic imports from static ones and skips comments', () => {
    const source = ["// import a from './commented'", "/* import b from './block' */", "const m = import('./lazy')", "import c from './real'"].join('\n')
    expect(staticSpecifiers(source)).toEqual(['./real'])
    expect(dynamicSpecifiers(source)).toEqual(['./lazy'])
  })

  it('resolves relative names against the importing file', () => {
    expect(resolveSpec('/src/chrome/RecordWatch.live.tsx', '../state/recordWatch')).toBe('/src/state/recordWatch')
    expect(resolveSpec('/src/chrome/RecordWatch.live.tsx', './RecordWatch.menu')).toBe('/src/chrome/RecordWatch.menu')
    expect(resolveSpec('/src/chrome/A.tsx', './RecordWatch.lazy.ts')).toBe('/src/chrome/RecordWatch.lazy')
    expect(resolveSpec('/src/chrome/A.tsx', 'zustand')).toBeNull()
  })

  it('flags each way a shell file could pull a lazy module in', () => {
    const planted = {
      '/src/chrome/StatusBar.tsx': "import { snapshotOf } from '../state/recordWatch'",
      '/src/chrome/Other.tsx': "import type { X } from './RecordWatch.menu'\nimport { WATCH_DETAIL } from '../copy/watchDetail'",
      '/src/App.tsx': "export { itemText } from './chrome/RecordWatch.lazy'",
      '/src/chrome/Third.tsx': "const lazy = import('./RecordWatch.lazy')",
    }
    expect(findViolations(planted)).toEqual([
      '/src/chrome/StatusBar.tsx: static import of ../state/recordWatch',
      '/src/chrome/Other.tsx: static import of ./RecordWatch.menu',
      '/src/chrome/Other.tsx: static import of ../copy/watchDetail',
      '/src/App.tsx: static import of ./chrome/RecordWatch.lazy',
      '/src/chrome/Third.tsx: dynamic import of ./RecordWatch.lazy',
    ])
  })

  it('lets the lazy modules import each other and the shell import the entry dynamically', () => {
    const allowed = {
      '/src/chrome/RecordWatch.lazy.ts': "export { a } from '../state/recordWatch'\nexport { b } from './RecordWatch.menu'",
      '/src/chrome/RecordWatch.menu.ts': "import { W } from '../copy/watchDetail'",
      [LIVE]: "const load = () => import('./RecordWatch.lazy')",
    }
    expect(findViolations(allowed)).toEqual([])
  })
})

describe('the record watch shell modules', () => {
  it('scans the real files, and the lazy ones exist', () => {
    expect(Object.keys(SOURCES)).toEqual(
      expect.arrayContaining([
        LIVE,
        '/src/state/recordWatch.store.ts',
        '/src/state/recordWatch.ts',
        '/src/chrome/RecordWatch.menu.ts',
        '/src/chrome/RecordWatch.lazy.ts',
        '/src/copy/watchDetail.ts',
      ]),
    )
  })

  it('RecordWatch.live.tsx and recordWatch.store.ts have no static import of the lazy modules', () => {
    const banned = ['../state/recordWatch', './RecordWatch.menu', './RecordWatch.lazy', '../copy/watchDetail']
    for (const [source, text] of [['RecordWatch.live.tsx', liveSource], ['recordWatch.store.ts', storeSource]] as const) {
      const specifiers = staticSpecifiers(text).flatMap((spec) => [spec, spec.replace(/\.tsx?$/, '')])
      for (const name of banned) expect(specifiers, `${source} imports ${name}`).not.toContain(name)
    }
  })

  it('RecordWatch.live.tsx loads the entry with import(./RecordWatch.lazy)', () => {
    expect(liveSource).toContain("import('./RecordWatch.lazy')")
    expect(dynamicSpecifiers(liveSource)).toEqual(['./RecordWatch.lazy'])
  })

  it('the other shell modules of the watch do not import the lazy ones either', () => {
    for (const file of ['/src/state/recordWatch.schema.ts', '/src/state/fnv1a.ts', '/src/copy/watch.ts', '/src/state/recordWatch.store.ts', LIVE]) {
      expect(findViolations({ [file]: SOURCES[file] ?? '' }), file).toEqual([])
    }
  })

  it('no file in the app reaches a lazy module except through the one dynamic import', () => {
    expect(findViolations(SOURCES)).toEqual([])
  })

  it('the lazy diff imports only the fnv1a helper and the schema', () => {
    const specifiers = staticSpecifiers(SOURCES['/src/state/recordWatch.ts'] ?? '')
    expect(specifiers.sort()).toEqual(['./fnv1a', './recordWatch.schema'])
  })
})
