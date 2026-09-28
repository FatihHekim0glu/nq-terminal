// robustness.fixtures.ts is a verbatim copy of the backend's two robustness screen files; this pins it
// against the files themselves (byte for byte, minus placebo.offsets) and scans every source file so the
// raw fixture never leaks into a screen, gallery data path or anywhere but a test, a gallery entry or the
// demo dataset (its size and its unshaped field names make it a poor fit for anything else).
import { describe, expect, it } from 'vitest'
import overnightRaw from '../../../../backend/tests/fixtures/results/screens/overnight_v0.json?raw'
import volmanagedRaw from '../../../../backend/tests/fixtures/results/screens/volmanaged_v0.json?raw'
import { OVERNIGHT_SCREEN, VOLMANAGED_SCREEN } from './robustness.fixtures'

const SOURCES = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

/** Matches every specifier form (from, dynamic import, re-export; with or without a .ts suffix; any
 * directory depth) that reaches robustness.fixtures, but not robustnessModel or the fixture's own test. */
const IMPORTS_FIXTURES = /(?:from\s*|import\s*\(\s*)['"][^'"]*\/robustness\.fixtures(?:\.ts)?['"]/

function withoutOffsets(value: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(value)
  const placebo = clone['placebo']
  if (placebo !== null && typeof placebo === 'object') delete (placebo as Record<string, unknown>)['offsets']
  return clone
}

describe('VOLMANAGED_SCREEN and OVERNIGHT_SCREEN (verbatim backend fixtures)', () => {
  it('OVERNIGHT_SCREEN is byte for byte overnight_v0.json', () => {
    expect(OVERNIGHT_SCREEN).toEqual(withoutOffsets(JSON.parse(overnightRaw)))
  })

  it('VOLMANAGED_SCREEN is volmanaged_v0.json minus placebo.offsets', () => {
    const parsed = JSON.parse(volmanagedRaw) as Record<string, unknown>
    expect((parsed['placebo'] as Record<string, unknown>)['offsets']).toBeInstanceOf(Array)
    expect(VOLMANAGED_SCREEN).toEqual(withoutOffsets(parsed))
  })

  it('is not imported outside a test, a gallery entry or src/demo', () => {
    const offenders = Object.keys(SOURCES).filter((path) => {
      if (path.endsWith('/robustness.fixtures.ts')) return false
      const source = SOURCES[path]!
      if (!IMPORTS_FIXTURES.test(source)) return false
      if (/\.test\.tsx?$/.test(path)) return false
      if (path.endsWith('.gallery.tsx')) return false
      if (path.startsWith('/src/demo/')) return false
      return true
    })
    expect(offenders).toEqual([])
  })

  it('the import matcher catches every specifier form', () => {
    const trueCases = [
      "import { X } from './robustness.fixtures'",
      "from '../des/robustness.fixtures'",
      "from '../../screens/des/robustness.fixtures'",
      "from './robustness.fixtures.ts'",
      "import('../des/robustness.fixtures')",
      "export { X } from '../des/robustness.fixtures'",
    ]
    for (const source of trueCases) expect(IMPORTS_FIXTURES.test(source), source).toBe(true)

    const falseCases = ["from './robustnessModel'", "from './robustness.fixtures.test'"]
    for (const source of falseCases) expect(IMPORTS_FIXTURES.test(source), source).toBe(false)
  })

  it('finds at least this test importing the fixtures, so the scan is exercising real files', () => {
    const importers = Object.keys(SOURCES).filter((path) => SOURCES[path]!.includes('robustness.fixtures'))
    expect(importers.length).toBeGreaterThan(0)
  })
})
