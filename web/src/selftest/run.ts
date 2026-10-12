// The self-test run (D7.2). Order: the four goldens, the probes that need no gesture, then a wait for the person's click (the
// clipboard and the save want one), the gesture probes, and axe last, over the finished page with every probe's host still
// mounted. After every stage the report is published, so a reader over the debugging protocol sees where the run is.
// A stage that throws or never answers is a failure on the report, never a silent pass. No DOM here: the page wires the stages.
import { GOLDEN_NAMES, SELFTEST_SCHEMA, type AxeReport, type EngineInfo, type GoldenReport, type ProbeName, type ProbeReport, type ProbeStatus, type ReportState, type SelfTestReport } from './report.ts'

export interface ProbeOutcome {
  readonly status: ProbeStatus
  readonly detail: string
}

export interface Probe {
  readonly name: ProbeName
  /** True when the browser wants a user gesture for it (the clipboard, a save). */
  readonly needsGesture: boolean
  run(): Promise<ProbeOutcome>
}

export interface SelfTestDeps {
  goldens(): Promise<GoldenReport[]>
  axe(): Promise<AxeReport>
  readonly probes: readonly Probe[]
  /** Resolves when the person has clicked (or at once, when the page was told to go on without one). */
  waitForGesture(): Promise<void>
  engine(): EngineInfo
  now(): Date
  publish(report: SelfTestReport): void
  /** Longest a probe may take; the default is generous for a cold WebAssembly compile. */
  readonly probeTimeoutMs?: number
}

export const DEFAULT_PROBE_TIMEOUT_MS = 30_000

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** `promise`, or a rejection after `ms`; the timer never outlives the race. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

async function runProbe(probe: Probe, timeoutMs: number): Promise<ProbeReport> {
  const began = performance.now()
  const ms = (): number => Math.round(performance.now() - began)
  try {
    const outcome = await within(probe.run(), timeoutMs)
    return { name: probe.name, status: outcome.status, detail: outcome.detail, ms: ms() }
  } catch (error) {
    return { name: probe.name, status: 'fail', detail: messageOf(error), ms: ms() }
  }
}

/** A golden run that crashed fails all four goldens, each with the reason. */
function crashedGoldens(error: unknown): GoldenReport[] {
  const why = `the golden run did not finish: ${messageOf(error)}`
  return GOLDEN_NAMES.map((name) => ({ name, checks: 0, failed: 1, maxRelativeError: Number.POSITIVE_INFINITY, firstFailure: why, passed: false }))
}

/** Puts a copy of every published report on `target.__selftest`; the copy shares nothing with the runner's own. */
export function createPublisher(target: { __selftest?: SelfTestReport }): (report: SelfTestReport) => void {
  return (report) => {
    target.__selftest = JSON.parse(JSON.stringify(report)) as SelfTestReport
  }
}

/** Runs the whole self-test and returns the final report (also published as it goes). */
export async function runSelfTest(deps: SelfTestDeps): Promise<SelfTestReport> {
  const startedAt = deps.now().toISOString()
  const timeoutMs = deps.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const state = { goldens: [] as GoldenReport[], probes: [] as ProbeReport[], axe: null as AxeReport | null, errors: [] as string[] }
  const snapshot = (stage: ReportState): SelfTestReport => ({
    schema: SELFTEST_SCHEMA,
    state: stage,
    startedAt,
    finishedAt: stage === 'done' ? deps.now().toISOString() : null,
    engine: deps.engine(),
    axe: state.axe,
    goldens: [...state.goldens],
    probes: [...state.probes],
    errors: [...state.errors],
  })
  const publish = (stage: ReportState): SelfTestReport => {
    const report = snapshot(stage)
    deps.publish(JSON.parse(JSON.stringify(report)) as SelfTestReport)
    return report
  }

  publish('running')
  state.goldens = await deps.goldens().catch(crashedGoldens)
  publish('running')
  for (const probe of deps.probes.filter((p) => !p.needsGesture)) {
    state.probes.push(await runProbe(probe, timeoutMs))
    publish('running')
  }
  publish('awaiting-gesture')
  await deps.waitForGesture()
  for (const probe of deps.probes.filter((p) => p.needsGesture)) {
    state.probes.push(await runProbe(probe, timeoutMs))
    publish('running')
  }
  state.axe = await deps.axe().catch((error: unknown) => {
    state.errors.push(`axe did not finish: ${messageOf(error)}`)
    return null
  })
  return publish('done')
}
