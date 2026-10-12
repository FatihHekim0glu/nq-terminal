// The self-test page's report (D7.2): the one JSON object the page publishes as `window.__selftest`, and the judge that says
// whether it passes. Pure TypeScript with no DOM, so the page, the vitest cases and the desktop spec (which reads the object
// over the debugging protocol) all use these definitions. Relative imports carry their `.ts`, which the e2e project needs.

export const SELFTEST_SCHEMA = 1

/** The four quant goldens of qa/golden, by file name. */
export const GOLDEN_NAMES = ['p12_expectation', 'p12_neff', 'p12_power', 'p2_neff_served'] as const
export type GoldenName = (typeof GOLDEN_NAMES)[number]

/** One part in 1e9: what the page's engine may differ from numpy and scipy by. */
export const GOLDEN_TOLERANCE = 1e-9

/** The feature probes, in the order they run (the last two need a click: the clipboard and the save want a gesture). */
export const PROBE_NAMES = ['perspective_wasm32', 'dockview_layout_restore', 'stream_mode', 'text_copy', 'blob_export'] as const
export type ProbeName = (typeof PROBE_NAMES)[number]

/** The axe rule sets of every accessibility run in this project: WCAG 2.0 to 2.2, A and AA. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

/**
 * The fewest rules axe must have passed for a run to count (20 on the recorded Windows run). A run in an engine where axe
 * evaluated almost nothing (0 passes) is not "0 violations"; lower this only with a reason, never to let a run through.
 */
export const MIN_AXE_PASSES = 20

/**
 * Rule ids whose "could not decide" result is accepted, each with the reason. Empty on purpose: the first report that
 * carries the ids (`incompleteRules`) names what the two undecided checks of the recorded run were; add an id here only
 * after reading its targets and deciding they cannot hide a failure.
 */
export const AXE_INCOMPLETE_ALLOWED: Readonly<Record<string, string>> = {}

export type ReportState = 'running' | 'awaiting-gesture' | 'done'

export interface GoldenReport {
  readonly name: GoldenName
  /** Numbers, strings and structures compared. */
  readonly checks: number
  readonly failed: number
  /** The largest relative error among the numbers compared (Infinity is written as null by JSON, which the judge fails). */
  readonly maxRelativeError: number
  readonly firstFailure: string | null
  readonly passed: boolean
}

export type ProbeStatus = 'pass' | 'fail' | 'skip'

export interface ProbeReport {
  readonly name: ProbeName
  readonly status: ProbeStatus
  readonly detail: string
  readonly ms: number
}

export interface AxeViolation {
  readonly id: string
  readonly impact: string | null
  readonly help: string
  /** Elements that broke the rule. */
  readonly nodes: number
  /** CSS selectors of the first few elements that broke the rule (for the person fixing it). */
  readonly targets?: readonly string[]
}

export interface AxeReport {
  readonly version: string
  readonly tags: readonly string[]
  readonly violations: readonly AxeViolation[]
  readonly passes: number
  /** How many rules axe could not decide (the length of `incompleteRules`). */
  readonly incomplete: number
  /** The rules axe could not decide, with their elements; the judge fails any that is not on the allowlist. */
  readonly incompleteRules: readonly AxeViolation[]
}

export interface EngineInfo {
  readonly userAgent: string
  /** The shell the page found itself in (bridge/detect.ts). */
  readonly shell: 'browser' | 'windows' | 'macos'
  readonly keys: 'pc' | 'mac'
  readonly bridgeVersion: number
  readonly webAssembly: boolean
}

export interface SelfTestReport {
  readonly schema: typeof SELFTEST_SCHEMA
  readonly state: ReportState
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly engine: EngineInfo
  readonly axe: AxeReport | null
  readonly goldens: readonly GoldenReport[]
  readonly probes: readonly ProbeReport[]
  /** Errors of the runner itself (a crashed stage); a clean run has none. */
  readonly errors: readonly string[]
}

export interface JudgeOptions {
  /** Probes allowed to be skipped (a run in a place that has no such thing, such as the stream with no backend). */
  readonly allowSkipped?: readonly ProbeName[]
  /** Axe rule ids whose undecided result is accepted for this run, besides AXE_INCOMPLETE_ALLOWED. */
  readonly allowIncomplete?: readonly string[]
}

type Loose = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function judgeGoldens(goldens: unknown): string[] {
  const rows = Array.isArray(goldens) ? goldens.filter(isRecord) : []
  const failures: string[] = []
  for (const name of GOLDEN_NAMES) {
    const named = rows.filter((g) => g.name === name)
    if (named.length === 0) failures.push(`golden ${name} is missing`)
    else if (named.length > 1) failures.push(`golden ${name} is in the report more than once`)
    else failures.push(...judgeGolden(name, named[0] as Loose))
  }
  return failures
}

function judgeGolden(name: string, golden: Loose): string[] {
  const { checks, failed, maxRelativeError, firstFailure } = golden
  if (!isFiniteNumber(checks) || checks <= 0) return [`golden ${name} compared nothing`]
  if (!isFiniteNumber(maxRelativeError)) return [`golden ${name} has no finite error to judge (${String(maxRelativeError)})`]
  // The numbers decide, never the report's own `passed`.
  if (failed !== 0 || maxRelativeError > GOLDEN_TOLERANCE) {
    const first = typeof firstFailure === 'string' ? `: ${firstFailure}` : ''
    return [`golden ${name} is off by ${maxRelativeError} relative (${String(failed)} failed, limit ${GOLDEN_TOLERANCE})${first}`]
  }
  return []
}

const describeRule = (v: Loose): string => `${String(v.id)} (${String(v.impact)}) on ${String(v.nodes)} element(s)${Array.isArray(v.targets) ? ` (${v.targets.join(' ; ')})` : ''}: ${String(v.help)}`

function judgeAxeCoverage(axe: Loose, allowIncomplete: readonly string[]): string[] {
  const failures: string[] = []
  if (!isFiniteNumber(axe.passes) || axe.passes < MIN_AXE_PASSES) {
    failures.push(`axe has ${String(axe.passes)} rules passed, at least ${MIN_AXE_PASSES} are needed for "no violations" to mean anything`)
  }
  const undecided = Array.isArray(axe.incompleteRules) ? axe.incompleteRules.filter(isRecord) : null
  if (undecided === null) return [...failures, 'axe reported no list of undecided rules']
  if (axe.incomplete !== undecided.length) failures.push(`axe counts ${String(axe.incomplete)} undecided rules but lists ${undecided.length}`)
  for (const v of undecided) {
    if (typeof v.id !== 'string' || !(v.id in AXE_INCOMPLETE_ALLOWED || allowIncomplete.includes(v.id))) failures.push(`axe could not decide rule ${describeRule(v)} (undecided, not on the allowlist)`)
  }
  return failures
}

function judgeAxe(axe: unknown, allowIncomplete: readonly string[]): string[] {
  if (!isRecord(axe)) return ['axe did not run']
  const failures: string[] = []
  const tags = Array.isArray(axe.tags) ? axe.tags : []
  if (tags.length !== AXE_TAGS.length || !AXE_TAGS.every((tag, i) => tags[i] === tag)) {
    failures.push(`axe ran with the tags ${JSON.stringify(tags)}, not ${AXE_TAGS.join(', ')}`)
  }
  failures.push(...judgeAxeCoverage(axe, allowIncomplete))
  const violations = Array.isArray(axe.violations) ? axe.violations.filter(isRecord) : null
  if (violations === null) return [...failures, 'axe reported no violations list']
  for (const v of violations) failures.push(`axe violation ${describeRule(v)}`)
  return failures
}

function judgeProbes(probes: unknown, allowSkipped: readonly ProbeName[]): string[] {
  const rows = Array.isArray(probes) ? probes.filter(isRecord) : []
  const failures: string[] = []
  for (const name of PROBE_NAMES) {
    const row = rows.find((p) => p.name === name)
    if (row === undefined) failures.push(`probe ${name} is missing`)
    else if (row.status === 'skip' && allowSkipped.includes(name)) continue
    else if (row.status !== 'pass') failures.push(`probe ${name} ${String(row.status)}: ${String(row.detail)}`)
  }
  return failures
}

/** Every reason the report does not pass, named; an empty list is a pass. Fails closed on anything it does not recognise. */
export function judgeReport(report: unknown, options: JudgeOptions = {}): string[] {
  if (!isRecord(report)) return ['the page published no report object']
  const failures: string[] = []
  if (report.schema !== SELFTEST_SCHEMA) failures.push(`report schema is ${String(report.schema)}, not ${SELFTEST_SCHEMA}`)
  if (report.state !== 'done') failures.push(`report state is ${String(report.state)}, not done`)
  if (Array.isArray(report.errors)) for (const e of report.errors) failures.push(`runner error: ${String(e)}`)
  else failures.push('report has no errors list')
  failures.push(...judgeGoldens(report.goldens), ...judgeProbes(report.probes, options.allowSkipped ?? []), ...judgeAxe(report.axe, options.allowIncomplete ?? []))
  return failures
}

/** What the clipboard and save probes put out, so a reader outside the page (the desktop spec) can check the other end. */
export const COPY_PROBE_TEXT = 'nqt-selftest clipboard probe'
export const EXPORT_PROBE_NAME = 'nqt-selftest-export.csv'
export const EXPORT_PROBE_TEXT = 'probe,value\r\nnqt-selftest,1\r\n'
