// The self-test's orchestrator: goldens and the probes that need no gesture first, then a wait for the person's click (the
// clipboard and the save want one), then the gesture probes, then axe over the finished page. Run here with stand-ins, so
// the order, the publishing and the failure handling are tested without a browser.
import { describe, expect, it } from 'vitest'
import { GOLDEN_NAMES, PROBE_NAMES, judgeReport, type AxeReport, type GoldenReport, type ProbeName, type ProbeReport, type SelfTestReport } from './report.ts'
import { passingGolden } from './report.testUtil.ts'
import { createPublisher, runSelfTest, type Probe, type ProbeOutcome, type SelfTestDeps } from './run.ts'

const CLEAN_AXE: AxeReport = { version: '4.13.0', tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], violations: [], passes: 40, incomplete: 0, incompleteRules: [] }
const ENGINE = { userAgent: 'test', shell: 'browser', keys: 'pc', bridgeVersion: 0, webAssembly: true } as const

const GESTURE: readonly ProbeName[] = ['text_copy', 'blob_export']

interface Harness {
  readonly deps: SelfTestDeps
  readonly log: string[]
  readonly published: SelfTestReport[]
  release(): void
}

function harness(over: Partial<SelfTestDeps> = {}, outcomes: Partial<Record<ProbeName, () => Promise<ProbeOutcome>>> = {}): Harness {
  const log: string[] = []
  const published: SelfTestReport[] = []
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const probes: Probe[] = PROBE_NAMES.map((name) => ({
    name,
    needsGesture: GESTURE.includes(name),
    run: async () => {
      log.push(`probe:${name}`)
      return outcomes[name] !== undefined ? outcomes[name]() : { status: 'pass', detail: 'fine' }
    },
  }))
  const deps: SelfTestDeps = {
    goldens: async (): Promise<GoldenReport[]> => { log.push('goldens'); return GOLDEN_NAMES.map(passingGolden) },
    axe: async () => { log.push('axe'); return CLEAN_AXE },
    probes,
    waitForGesture: async () => { log.push('waiting'); await gate; log.push('gesture') },
    engine: () => ENGINE,
    now: () => new Date('2026-10-12T10:00:00.000Z'),
    publish: (report) => { published.push(report) },
    probeTimeoutMs: 200,
    ...over,
  }
  return { deps, log, published, release: () => release() }
}

describe('runSelfTest', () => {
  it('runs goldens and the plain probes, waits for the gesture, runs the gesture probes, then axe', async () => {
    const h = harness()
    const done = runSelfTest(h.deps)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.log).toEqual(['goldens', 'probe:perspective_wasm32', 'probe:dockview_layout_restore', 'probe:stream_mode', 'waiting'])
    expect(h.published.at(-1)?.state).toBe('awaiting-gesture')
    h.release()
    const report = await done
    expect(h.log.slice(5)).toEqual(['gesture', 'probe:text_copy', 'probe:blob_export', 'axe'])
    expect(report.state).toBe('done')
    expect(judgeReport(report)).toEqual([])
  })

  it('publishes running first, then each stage, and the last published is the returned report', async () => {
    const h = harness()
    h.release()
    const report = await runSelfTest(h.deps)
    expect(h.published[0]?.state).toBe('running')
    expect(h.published.map((r) => r.state)).toEqual(expect.arrayContaining(['running', 'awaiting-gesture', 'done']))
    expect(h.published.at(-1)).toEqual(report)
    expect(h.published[0]?.probes).toEqual([])
  })

  it('publishes snapshots that share nothing with later ones', async () => {
    const h = harness()
    h.release()
    await runSelfTest(h.deps)
    const first = h.published[0]!
    ;(first.probes as ProbeReport[]).push({ name: 'stream_mode', status: 'fail', detail: 'x', ms: 1 })
    expect(h.published.at(-1)!.probes.filter((p) => p.status === 'fail')).toEqual([])
    expect(JSON.parse(JSON.stringify(h.published.at(-1)))).toEqual(h.published.at(-1))
  })

  it('born failing: a probe that throws is a failure with its message, and the rest still run', async () => {
    const h = harness({}, { stream_mode: async () => { throw new Error('socket refused') } })
    h.release()
    const report = await runSelfTest(h.deps)
    const stream = report.probes.find((p) => p.name === 'stream_mode')!
    expect(stream.status).toBe('fail')
    expect(stream.detail).toContain('socket refused')
    expect(report.probes).toHaveLength(PROBE_NAMES.length)
    expect(judgeReport(report).join('\n')).toContain('stream_mode')
  })

  it('born failing: a probe that never answers fails after its time', async () => {
    const h = harness({}, { perspective_wasm32: () => new Promise<ProbeOutcome>(() => undefined) })
    h.release()
    const report = await runSelfTest(h.deps)
    const probe = report.probes.find((p) => p.name === 'perspective_wasm32')!
    expect(probe.status).toBe('fail')
    expect(probe.detail).toMatch(/timed out after 200 ms/)
  })

  it('born failing: a crashed golden run fails all four goldens instead of passing quietly', async () => {
    const h = harness({ goldens: async () => { throw new Error('quant chunk missing') } })
    h.release()
    const report = await runSelfTest(h.deps)
    expect(report.goldens.map((g) => g.name)).toEqual([...GOLDEN_NAMES])
    expect(report.goldens.every((g) => !g.passed && g.failed === 1)).toBe(true)
    expect(report.goldens[0]?.firstFailure).toContain('quant chunk missing')
    expect(judgeReport(report).length).toBeGreaterThanOrEqual(4)
  })

  it('born failing: a crashed axe run leaves axe empty and the error on the report', async () => {
    const h = harness({ axe: async () => { throw new Error('axe blocked') } })
    h.release()
    const report = await runSelfTest(h.deps)
    expect(report.axe).toBeNull()
    expect(report.errors.join('\n')).toContain('axe blocked')
    expect(judgeReport(report).join('\n')).toMatch(/axe did not run/)
  })

  it('keeps a skip as a skip, with the probe\'s reason', async () => {
    const h = harness({}, { stream_mode: async () => ({ status: 'skip', detail: 'no backend here' }) })
    h.release()
    const report = await runSelfTest(h.deps)
    expect(report.probes.find((p) => p.name === 'stream_mode')).toMatchObject({ status: 'skip', detail: 'no backend here' })
  })

  it('reports the engine and a start and finish time', async () => {
    const h = harness()
    h.release()
    const report = await runSelfTest(h.deps)
    expect(report.engine).toEqual(ENGINE)
    expect(report.startedAt).toBe('2026-10-12T10:00:00.000Z')
    expect(report.finishedAt).toBe('2026-10-12T10:00:00.000Z')
  })
})

describe('createPublisher', () => {
  it('puts a copy of each report on the page object as __selftest', () => {
    const target: { __selftest?: SelfTestReport } = {}
    const publish = createPublisher(target)
    const report: SelfTestReport = { schema: 1, state: 'running', startedAt: 'a', finishedAt: null, engine: ENGINE, axe: null, goldens: [], probes: [], errors: [] }
    publish(report)
    expect(target.__selftest).toEqual(report)
    expect(target.__selftest).not.toBe(report)
  })
})
