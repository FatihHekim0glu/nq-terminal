// The browser estimators of the effective number of trials and members (linalg, cluster, trials) and the reference
// built on them (neffReference) are test references since the backend serves those numbers (analytics/neff.py,
// ANALYTICS_CATALOG C8): no production file may import them, or the screens would compute again what the backend
// serves. Only tests, fixtures of tests and the quant folder itself may.
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
/** The modules that are test references: an import path ending in one of these names. */
const REFERENCE = /from\s+['"][^'"]*\/(?:quant\/)?(?:linalg|cluster|trials|neffReference)['"]/
const TEST_FILE = /\.test\.tsx?$/

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

  it('inside the quant folder only the references import each other (power and normal are SV9, still client side)', () => {
    const inside = sources(QUANT)
      .filter((file) => !TEST_FILE.test(file))
      .filter((file) => REFERENCE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(QUANT, file))
    expect(inside.sort()).toEqual(['cluster.ts', 'neffReference.ts'])
  })

  it('born failing: the pattern catches the import styles a screen would use', () => {
    for (const line of [
      "import { pearsonMatrix } from '../../quant/linalg'",
      "import { averageLinkage } from '../../quant/cluster'",
      'import { participationRatio } from "../../quant/trials"',
      "import { referenceEffectiveN } from '../../quant/neffReference'",
      "import { x } from './linalg'",
    ]) {
      expect(REFERENCE.test(line), line).toBe(true)
    }
    expect(REFERENCE.test("import { normalCdf } from '../../quant/normal'")).toBe(false)
    expect(REFERENCE.test("import { powerView } from '../../quant/power'")).toBe(false)
  })

  it('finds the real importers: the test files do import the references (the scan sees imports at all)', () => {
    const testImporters = sources(SRC)
      .filter((file) => TEST_FILE.test(file))
      .filter((file) => REFERENCE.test(fs.readFileSync(file, 'utf8')))
    expect(testImporters.length).toBeGreaterThanOrEqual(4)
  })
})
