// The queries shell rule (SHELL-DIET): queries.ts is part of the first-paint shell, so it holds only the hooks
// the shell reads (plus the ones REG, TEAR and LIVE import from it) and useApiQuery itself. The other
// screens' hooks live in queries.screens.ts, which loads with the Workspace chunk, and the live stream
// client (liveStream.ts, useLiveStream.ts) is reached only from LIVE and JRNL. This reads the sources as text;
// scripts/shellBudget.test.ts checks the same thing on a real build.
import { describe, expect, it } from 'vitest'
import * as screens from './queries.screens'
import * as shell from './queries'

const SOURCES = import.meta.glob<string>(['/src/api/*.ts', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** A run-time import or re-export of `name` (a sibling module): `import type` is erased and does not count. */
const importsOf = (source: string, name: string): boolean =>
  new RegExp(String.raw`\bfrom\s+['"]\./${name}['"]`).test(source.replace(/^(?:import|export) type \{[^}]*\} from '[^']*'$/gm, ''))

const SHELL_HOOKS = ['useHealth', 'useCommands', 'useRegistry', 'useHypotheses', 'useMultipleTesting', 'useDeflated', 'useConfirmations', 'useRuns', 'useRun', 'useLedger', 'useOosLog', 'useOpenings', 'useLiveStatus']

describe('queries.ts: the shell hooks', () => {
  it('holds useApiQuery, the shared live helpers and exactly the shell hooks', () => {
    const hooks = Object.keys(shell)
      .filter((name) => /^use[A-Z]/.test(name))
      .sort()
    expect(hooks).toEqual([...SHELL_HOOKS, 'useApiQuery', 'useLive'].sort())
  })

  it('imports neither the screens hooks nor the live stream client', () => {
    const text = SOURCES['/src/api/queries.ts'] ?? ''
    expect(text).not.toBe('')
    for (const name of ['queries.screens', 'useLiveStream', 'liveStream']) expect(importsOf(text, name), name).toBe(false)
  })

  it('reads the live stream mode from liveMode.ts, which the shell may load', () => {
    expect(importsOf(SOURCES['/src/api/queries.ts'] ?? '', 'liveMode')).toBe(true)
    expect(importsOf(SOURCES['/src/api/liveMode.ts'] ?? '', 'liveStream')).toBe(false)
  })
})

describe('queries.screens.ts: the screens hooks', () => {
  it('holds every screen hook the shell does not, and none of the shell ones', () => {
    const hooks = Object.keys(screens).filter((name) => /^use[A-Z]/.test(name))
    expect(hooks).toHaveLength(36)
    for (const name of SHELL_HOOKS) expect(hooks, name).not.toContain(name)
    expect(hooks).toEqual(expect.arrayContaining(['useBars', 'useRunEquity', 'useLiveJournal', 'useLivePerformance', 'useSeasonality', 'useDqGuards']))
  })

  it('imports the shell file, never the other way round', () => {
    expect(importsOf(SOURCES['/src/api/queries.screens.ts'] ?? '', 'queries')).toBe(true)
  })
})
