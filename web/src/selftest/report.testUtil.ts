// A passing report for the judge's tests and for the desktop spec's own guard: every golden met, every probe passed, axe
// clean. Test support only: nothing in the page imports it.
import { AXE_TAGS, GOLDEN_NAMES, PROBE_NAMES, SELFTEST_SCHEMA, type GoldenReport, type ProbeReport, type SelfTestReport } from './report.ts'

export function passingGolden(name: GoldenReport['name']): GoldenReport {
  return { name, checks: 10, failed: 0, maxRelativeError: 1e-14, firstFailure: null, passed: true }
}

export function passingProbe(name: ProbeReport['name']): ProbeReport {
  return { name, status: 'pass', detail: 'ok', ms: 5 }
}

export function passingReport(): SelfTestReport {
  return {
    schema: SELFTEST_SCHEMA,
    state: 'done',
    startedAt: '2026-10-12T10:00:00.000Z',
    finishedAt: '2026-10-12T10:00:05.000Z',
    engine: { userAgent: 'planted', shell: 'windows', keys: 'pc', bridgeVersion: 3, webAssembly: true },
    axe: { version: '4.13.0', tags: [...AXE_TAGS], violations: [], passes: 40, incomplete: 0, incompleteRules: [] },
    goldens: GOLDEN_NAMES.map(passingGolden),
    probes: PROBE_NAMES.map(passingProbe),
    errors: [],
  }
}

/** The report with every readonly removed, so a test can plant one broken value in its own copy. */
export type Draft<T> = { -readonly [K in keyof T]: Draft<T[K]> }

/** A copy of `report` with `change` applied to a deep clone, so a test never edits the shared one. */
export function changed(report: SelfTestReport, change: (draft: Draft<SelfTestReport>) => void): SelfTestReport {
  const draft = JSON.parse(JSON.stringify(report)) as Draft<SelfTestReport>
  change(draft)
  return draft
}
