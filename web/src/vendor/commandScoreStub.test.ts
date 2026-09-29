// The command-score stub (roadmap wave 9, SHELL-DIET-3): cmdk scores every item against the search text with its own
// fuzzy matcher (about 0.4 kB gzip), but the terminal filters the command list itself (chrome/CommandLine.tsx passes
// shouldFilter={false}), so the score is never used. vite.config.ts (cmdkScoreStub) points cmdk's import of that one
// hashed chunk at src/vendor/commandScoreStub.ts, and only for cmdk's own entry file. The chunk is found by its
// hashed name, so these tests pin what that name means against the installed cmdk: an upgrade that renames it, or
// a change in CommandLine that lets cmdk use the score, fails here instead of quietly changing the command list.
import { describe, expect, it } from 'vitest'
import * as stub from './commandScoreStub'

// The app tsconfig carries browser types only, so the Node built-in is typed here by hand.
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (relative: string): string => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')

const CHUNK = './chunk-NZJY6EH4.mjs'
const commandScoreModule = read('../../node_modules/cmdk/dist/command-score.mjs')
const cmdkEntry = read('../../node_modules/cmdk/dist/index.mjs')
const commandLine = read('../chrome/CommandLine.tsx')

/** The plugin, loaded the way the build loads it (vite.config.ts is Node code, outside the app's type project). */
interface ScorePlugin {
  readonly name: string
  readonly enforce?: string
  resolveId(source: string, importer: string | undefined): string | null
}
const configUrl = new URL('../../vite.config.ts', import.meta.url).href
const { cmdkScoreStub } = (await import(/* @vite-ignore */ configUrl)) as { cmdkScoreStub: () => ScorePlugin }

describe('cmdk\'s hashed chunk is command-score', () => {
  it('is what cmdk\'s own command-score module re-exports as commandScore', () => {
    expect(commandScoreModule).toMatch(/import\s*\{\s*a\s*\}\s*from\s*"\.\/chunk-NZJY6EH4\.mjs"\s*;?\s*export\s*\{\s*a\s+as\s+commandScore\s*\}/)
  })

  it('is imported by cmdk\'s entry file, which uses its one export as the default filter', () => {
    expect(cmdkEntry).toMatch(/import\s*\{\s*a\s+as\s+(\w+)\s*\}\s*from\s*"\.\/chunk-NZJY6EH4\.mjs"/)
    const alias = /import\s*\{\s*a\s+as\s+(\w+)\s*\}\s*from\s*"\.\/chunk-NZJY6EH4\.mjs"/.exec(cmdkEntry)?.[1]
    expect(alias).toBeDefined()
    // The default filter is a thin wrapper: (value, search, keywords) => commandScore(value, search, keywords).
    expect(cmdkEntry).toMatch(new RegExp(String.raw`=\(\w+,\w+,\w+\)=>${alias}\(\w+,\w+,\w+\)`))
  })
})

describe('the stub', () => {
  it('exports exactly the one name cmdk reads from the chunk, as a score that never throws', () => {
    expect(Object.keys(stub)).toEqual(['a'])
    expect(() => stub.a('Open the tape', 'tape', ['events'])).not.toThrow()
    expect(() => stub.a('', '')).not.toThrow()
    expect(typeof stub.a('x', 'y')).toBe('number')
  })
})

describe('the terminal never lets cmdk use the score', () => {
  const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })

  it('turns cmdk\'s own filtering off in the command line', () => {
    expect(commandLine).toContain('shouldFilter={false}')
  })

  it('imports neither commandScore nor defaultFilter from cmdk, in any source file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    const offenders = Object.entries(SOURCES)
      .filter(([, text]) => /import\s+(?:type\s+)?\{[^}]*\b(?:commandScore|defaultFilter)\b[^}]*\}\s*from\s*['"]cmdk(?:\/[^'"]*)?['"]/.test(text))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it('passes no filter prop to <Command>, in any source file', () => {
    // `=>` is taken out first, so an arrow function inside a prop does not end the tag early for the search.
    const offenders = Object.entries(SOURCES)
      .filter(([, text]) => /<Command\b[^>]*\sfilter\s*=/.test(text.replace(/=>/g, ' ')))
      .map(([file]) => file)
    expect(offenders).toEqual([])
    expect(commandLine).toMatch(/<Command\b/)
  })
})

describe('the vite plugin that applies the stub (vite.config.ts cmdkScoreStub)', () => {
  const CMDK_ENTRY = '/repo/web/node_modules/.pnpm/cmdk@1.1.1_react@19.2.0/node_modules/cmdk/dist/index.mjs'

  it('runs before the other resolvers, so the alias cannot be beaten to it', () => {
    const plugin = cmdkScoreStub()
    expect(plugin.enforce).toBe('pre')
    expect(plugin.name).toMatch(/cmdk/)
  })

  it('maps the hashed chunk to the stub for cmdk\'s entry file only', () => {
    const resolved = cmdkScoreStub().resolveId(CHUNK, CMDK_ENTRY)
    expect(resolved).not.toBeNull()
    expect(resolved!.replace(/\\/g, '/')).toMatch(/\/src\/vendor\/commandScoreStub\.ts$/)
  })

  it('also recognises cmdk\'s entry file under a Windows path', () => {
    const importer = String.raw`C:\repo\web\node_modules\.pnpm\cmdk@1.1.1_react@19.2.0\node_modules\cmdk\dist\index.mjs`
    expect(cmdkScoreStub().resolveId(CHUNK, importer)).not.toBeNull()
  })

  it('leaves cmdk\'s own command-score module on the real chunk (the module that exports it as commandScore)', () => {
    const importer = CMDK_ENTRY.replace('index.mjs', 'command-score.mjs')
    expect(cmdkScoreStub().resolveId(CHUNK, importer)).toBeNull()
  })

  it('leaves any other importer alone, including app code and a look-alike path', () => {
    const plugin = cmdkScoreStub()
    expect(plugin.resolveId(CHUNK, '/repo/web/src/chrome/CommandLine.tsx')).toBeNull()
    expect(plugin.resolveId(CHUNK, '/repo/web/src/cmdk/dist/index.mjs')).toBeNull()
    expect(plugin.resolveId(CHUNK, '/repo/web/node_modules/other/dist/index.mjs')).toBeNull()
    expect(plugin.resolveId(CHUNK, undefined)).toBeNull()
  })

  it('leaves any other specifier alone, even from cmdk\'s entry file', () => {
    const plugin = cmdkScoreStub()
    expect(plugin.resolveId('./chunk-XJATAMEX.mjs', CMDK_ENTRY)).toBeNull()
    expect(plugin.resolveId('./chunk-NZJY6EH4.mjs?v=1', CMDK_ENTRY)).toBeNull()
    expect(plugin.resolveId('react', CMDK_ENTRY)).toBeNull()
    expect(plugin.resolveId('@radix-ui/react-dialog', CMDK_ENTRY)).toBeNull()
  })
})
