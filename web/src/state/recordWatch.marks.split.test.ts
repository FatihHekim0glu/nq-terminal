// The lazy screens (RUNS, REG, LEDG) read the watch's marks through the leaf chrome/RecordWatch.marks.ts, never
// through chrome/RecordWatch.live.tsx: importing the live module from a lazy chunk splits its shared
// dependencies (the API client, safe storage) out of the shell into two extra static chunks. This reads the
// sources as text, like recordWatch.split.test.ts.
import { describe, expect, it } from 'vitest'
import marksSource from '../chrome/RecordWatch.marks.ts?raw'
import watchColumnSource from '../grids/watchColumn.ts?raw'
import ledgScreenSource from '../screens/ledg/LedgScreen.tsx?raw'
import regColumnsSource from '../screens/reg/regColumns.tsx?raw'
import regScreenSource from '../screens/reg/RegScreen.tsx?raw'
import runsScreenSource from '../screens/runs/RunsScreen.tsx?raw'

const LIVE_IMPORT = /from\s+['"][^'"]*RecordWatch\.live['"]/

/** The module names a file imports or re-exports with a static statement (type imports included), comments skipped. */
function staticSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
}

describe('the lazy screens do not import the live watch module', () => {
  const FILES = [
    ['RunsScreen.tsx', runsScreenSource],
    ['RegScreen.tsx', regScreenSource],
    ['regColumns.tsx', regColumnsSource],
    ['LedgScreen.tsx', ledgScreenSource],
    ['watchColumn.ts', watchColumnSource],
  ] as const

  it.each(FILES)('%s has no import from RecordWatch.live', (_name, text) => {
    expect(text).not.toMatch(LIVE_IMPORT)
  })

  it('the pattern catches a plain, a type-only and a multi line import from the live module', () => {
    expect("import { useWatchMarks } from '../../chrome/RecordWatch.live'").toMatch(LIVE_IMPORT)
    expect("import type { WatchMark } from '../chrome/RecordWatch.live'").toMatch(LIVE_IMPORT)
    expect("import {\n  useWatchMarks,\n} from \"../../chrome/RecordWatch.live\"").toMatch(LIVE_IMPORT)
    expect("import { useWatchMarks } from '../../chrome/RecordWatch.marks'").not.toMatch(LIVE_IMPORT)
  })
})

describe('the marks leaf', () => {
  it('imports only zustand and the watch schema types', () => {
    expect(staticSpecifiers(marksSource).sort()).toEqual(['../state/recordWatch.schema', 'zustand'])
  })

  it('takes zustand as a value import and the schema as a type only import', () => {
    expect(marksSource).toMatch(/^import \{ create \} from 'zustand'$/m)
    expect(marksSource).toMatch(/^import type \{ WatchSource \} from '\.\.\/state\/recordWatch\.schema'$/m)
  })
})
