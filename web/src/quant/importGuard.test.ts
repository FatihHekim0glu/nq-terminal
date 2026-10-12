// The browser estimators of the effective number of trials and members (linalg, cluster, trials), the reference
// built on them (neffReference) and SV9's power maths (normal, power) with its table (powerReference) are test
// references since the backend serves those numbers (analytics/neff.py, analytics/power.py, ANALYTICS_CATALOG C8): no
// production file may import them, or the screens would compute again what the backend serves. Only tests, fixtures
// of tests and the quant folder itself may.
import { describe, expect, it } from 'vitest'

interface DirEntry {
  readonly name: string
  isDirectory(): boolean
  isFile(): boolean
}
interface NodeFs {
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[]
  readFileSync(path: string, encoding: 'utf8'): string
}
interface NodePath {
  join(...parts: string[]): string
  relative(from: string, to: string): string
  dirname(path: string): string
}
interface NodeUrl {
  fileURLToPath(url: string | URL): string
}

const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as NodeFs
const path = builtins.getBuiltinModule('node:path') as NodePath
const url = builtins.getBuiltinModule('node:url') as NodeUrl

const SRC = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const QUANT = path.join(SRC, 'quant')
/** The modules that are test references: an import path ending in one of these names. power and normal are named
 *  by their folder (or by `./` inside it), because copy/power.ts is a different module. */
const REFERENCE = /from\s+['"](?:[^'"]*\/(?:quant\/)?(?:linalg|cluster|trials|neffReference)|[^'"]*\/quant\/(?:power|normal|powerReference)|\.\/(?:power|normal|powerReference))['"]/
const TEST_FILE = /\.test\.tsx?$/
const CATALOG = path.join(SRC, '..', '..', 'docs', 'ANALYTICS_CATALOG.md')

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

function importersOutsideTests(): string[] {
  return sources(SRC)
    .filter((file) => !TEST_FILE.test(file) && !file.startsWith(QUANT))
    .filter((file) => REFERENCE.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file).split('\\').join('/'))
}

describe('the browser estimators are test references only', () => {
  it('no production file imports linalg, cluster, trials or neffReference', () => {
    expect(importersOutsideTests()).toEqual([])
  })

  it('inside the quant folder only the references import each other', () => {
    const inside = sources(QUANT)
      .filter((file) => !TEST_FILE.test(file))
      .filter((file) => REFERENCE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(QUANT, file))
    expect(inside.sort()).toEqual(['cluster.ts', 'neffReference.ts', 'power.ts', 'powerReference.ts', 'trials.ts'])
  })

  it('born failing: the pattern catches the import styles a screen would use', () => {
    for (const line of [
      "import { pearsonMatrix } from '../../quant/linalg'",
      "import { averageLinkage } from '../../quant/cluster'",
      'import { participationRatio } from "../../quant/trials"',
      "import { referenceEffectiveN } from '../../quant/neffReference'",
      "import { x } from './linalg'",
      "import { normalCdf } from '../../quant/normal'",
      "import { minimumDetectableSharpe } from '../../quant/power'",
      "import { powerView } from '../../quant/powerReference'",
      "import { trackYears } from './power'",
    ]) {
      expect(REFERENCE.test(line), line).toBe(true)
    }
    // The copy folder has its own power module: it is not SV9's maths.
    expect(REFERENCE.test("import { POWER } from '../../copy/power'")).toBe(false)
    expect(REFERENCE.test("import { powerSummary } from './powerModel'")).toBe(false)
  })

  it('finds the real importers: the test files do import the references (the scan sees imports at all)', () => {
    const testImporters = sources(SRC)
      .filter((file) => TEST_FILE.test(file))
      .filter((file) => REFERENCE.test(fs.readFileSync(file, 'utf8')))
    expect(testImporters.length).toBeGreaterThanOrEqual(4)
  })

  it('C8 calls SV9 closed: no production file imports the browser power copy, and the catalogue says so', () => {
    const c8 = fs.readFileSync(CATALOG, 'utf8').split('\n').find((line) => line.startsWith('**C8.')) ?? ''
    expect(c8).toContain('SV9 is closed')
    expect(c8).toContain('REG 92 Evidence')
    expect(c8).not.toContain('partly closed')
    expect(c8).not.toContain('The one client-phase exception left')
    const sv9 = fs.readFileSync(CATALOG, 'utf8').split('\n').find((line) => line.startsWith('| SV9 |')) ?? ''
    expect(sv9).not.toContain('still backs REG 92')
    expect(sv9).not.toContain('Client phase')
  })

  it('the SV9 row does not quote a stale family size as the Bonferroni example (the registry has moved past k = 21)', () => {
    const sv9 = fs.readFileSync(CATALOG, 'utf8').split('\n').find((line) => line.startsWith('| SV9 |')) ?? ''
    expect(sv9).not.toBe('')
    expect(sv9).not.toContain('k = 21')
    expect(sv9).not.toContain('0.05/21')
  })
})
