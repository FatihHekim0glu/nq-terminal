// The infinite-query stub (v2.1 polish, SHELL-DIET-4): query-core's query.js imports infiniteQueryBehavior by a plain
// import, and vite.config.ts (infiniteStub) sends that one import, from that one importer, to the stub, so TanStack's
// paging code is in no build. The terminal has no infinite query. These tests pin the specifier and the importer against
// the installed query-core, so an upgrade that renames either fails here instead of quietly putting the code back, and
// pin the stub's contract: it exports the one name query.js reads and fails loudly if a query ever starts one.
import { describe, expect, it } from 'vitest'
import * as stub from './infiniteQueryBehaviorStub'

// The app tsconfig carries browser types only, so the Node built-ins are typed here by hand.
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[]; realpathSync(path: string): string }
const url = builtins.getBuiltinModule('node:url') as { fileURLToPath(url: URL): string }
const path = builtins.getBuiltinModule('node:path') as { join(...parts: string[]): string }

const webDir = url.fileURLToPath(new URL('../../', import.meta.url))
// pnpm keeps a package's dependencies beside it: react-query's real folder has query-core as a sibling.
const queryCoreDir = (() => {
  const reactQuery = fs.realpathSync(path.join(webDir, 'node_modules', '@tanstack', 'react-query'))
  const queryCore = fs.realpathSync(path.join(reactQuery, '..', 'query-core'))
  return path.join(queryCore, 'build', 'modern')
})()
const read = (file: string): string => fs.readFileSync(path.join(queryCoreDir, file), 'utf8')

interface InfinitePlugin {
  readonly name: string
  readonly enforce?: string
  resolveId(source: string, importer: string | undefined): string | null
}
const configUrl = new URL('../../vite.config.ts', import.meta.url).href
const { infiniteStub } = (await import(/* @vite-ignore */ configUrl)) as { infiniteStub: () => InfinitePlugin }

describe('query-core against the stub', () => {
  it('has query.js import infiniteQueryBehavior from "./infiniteQueryBehavior.js" and call it for an infinite query', () => {
    expect(read('query.js')).toMatch(/import\s*\{\s*infiniteQueryBehavior\s*\}\s*from\s*"\.\/infiniteQueryBehavior\.js"/)
    expect(read('query.js')).toMatch(/infiniteQueryBehavior\(this\.options\.pages\)/)
  })

  it('has only query.js and infiniteQueryObserver.js import it (the observer is never imported by the terminal)', () => {
    const importers = fs.readdirSync(queryCoreDir).filter((f) => f.endsWith('.js') && read(f).includes('./infiniteQueryBehavior.js'))
    expect(importers.sort()).toEqual(['infiniteQueryObserver.js', 'query.js'])
  })

  it('is never asked for by the terminal\'s own code: no infinite query anywhere in src/', () => {
    const modules = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.*', '!../vendor/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const holders = Object.entries(modules)
      .filter(([, text]) => /useInfiniteQuery|useSuspenseInfiniteQuery|fetchInfiniteQuery|prefetchInfiniteQuery|ensureInfiniteQueryData|infiniteQueryOptions|InfiniteQueryObserver|getInfiniteQueryData/.test(text))
      .map(([file]) => file)
    expect(holders).toEqual([])
  })
})

describe('the plugin', () => {
  const plugin = infiniteStub()
  const QUERY = 'C:/app/node_modules/.pnpm/@tanstack+query-core@5.103.2/node_modules/@tanstack/query-core/build/modern/query.js'
  const QUERY_WINDOWS = 'C:\\app\\node_modules\\.pnpm\\@tanstack+query-core@5.103.2\\node_modules\\@tanstack\\query-core\\build\\modern\\query.js'

  it('runs before the other resolvers and sends the one import, from query-core\'s query.js, to the stub', () => {
    expect(plugin.enforce).toBe('pre')
    expect(plugin.resolveId('./infiniteQueryBehavior.js', QUERY)).toMatch(/src[\\/]vendor[\\/]infiniteQueryBehaviorStub\.ts$/)
    expect(plugin.resolveId('./infiniteQueryBehavior.js', QUERY_WINDOWS)).toMatch(/src[\\/]vendor[\\/]infiniteQueryBehaviorStub\.ts$/)
  })

  it('leaves every other importer and every other specifier alone', () => {
    const others: Array<readonly [string, string | undefined]> = [
      ['./infiniteQueryBehavior.js', 'C:/app/node_modules/.pnpm/@tanstack+query-core@5.103.2/node_modules/@tanstack/query-core/build/modern/infiniteQueryObserver.js'],
      ['./infiniteQueryBehavior.js', 'C:/app/src/api/queries.ts'],
      ['./infiniteQueryBehavior.js', undefined],
      ['./infiniteQueryBehavior', QUERY],
      ['./retryer.js', QUERY],
    ]
    for (const [source, importer] of others) expect(plugin.resolveId(source, importer), `${source} from ${importer}`).toBeNull()
  })
})

describe('the stub', () => {
  it('exports exactly the one name query.js reads, which throws if a query ever starts an infinite fetch', () => {
    expect(Object.keys(stub)).toEqual(['infiniteQueryBehavior'])
    expect(() => stub.infiniteQueryBehavior(3)).toThrow(/infiniteQueryBehaviorStub/)
  })
})
