// @vitest-environment jsdom
// The LIVE expectation card (ROADMAP 17 step 1, ANALYTICS_CATALOG LV6, [POST HOC]): the paper book's cumulative P&L
// placed on the SV6 cone of its hypothesis. What it asks for (the same request shapes as the tear sheet's own
// bootstrap and run analytics, and only once the tracking has a value), what it draws (the Cone with the paper and
// model overlays, the lines that name K and its run) and how it refuses in words. The Cone is a stand-in that records
// its input. GETs only; a role=alert only for a failed read that LV5 does not already announce (not the paper tracking).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { liveStreamHub } from '../../api/useLiveStream'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { VOLMANAGED } from '../des/desTestData'
import { RUNS } from '../runs/runs.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import ExpectationPanel, { ExpectationCard } from './ExpectationPanel'
import { expectationView } from './expectationModel'
import { TRACKING_POPULATED } from './trackingFixtures'

const seen = vi.hoisted(() => ({ cones: [] as Array<{ data: ConeInput; chartId: string }> }))

function standIn(props: { data: ConeInput; chartId: string }) {
  seen.cones.push(props)
  return <div data-testid="cone" data-chart-id={props.chartId}>{props.data.name}</div>
}

vi.mock('../../charts/echarts/Cone', () => ({ Cone: standIn }))

const RUN = 'nt_volmanaged_v0_fixture_m1'
const TRACKING_URL = '/api/analytics/paper-tracking'
const DETAIL_URL = '/api/hypotheses/volmanaged_v0'
const RUNS_URL = '/api/runs'
const BOOT_URL = '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1'
const RUN_URL = `/api/analytics/run/${RUN}?freq=D`

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Answer = () => Response | Promise<Response>
const DEFAULTS: Readonly<Record<string, Answer>> = {
  [TRACKING_URL]: () => json(TRACKING_POPULATED),
  [DETAIL_URL]: () => json(VOLMANAGED),
  [RUNS_URL]: () => json(RUNS),
  [BOOT_URL]: () => json(HYP_BOOTSTRAP),
  [RUN_URL]: () => json(RUN_ANALYTICS),
}

let calls: string[] = []
let methods: string[] = []

/** Stubs fetch with the five answers the card needs; `override` replaces some of them. */
function serve(override: Readonly<Record<string, Answer>> = {}) {
  calls = []
  methods = []
  const table = { ...DEFAULTS, ...override }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push(url)
    methods.push(init?.method ?? 'GET')
    const answer = table[url]
    return answer ? answer() : json({ detail: `not in this test: ${url}` }, 404)
  })
}

function mount() {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <ApiProvider client={client}>
      <ExpectationPanel />
    </ApiProvider>,
  )
}

const region = () => screen.getByRole('region', { name: EXPECTATION.label })
const drawn = () => screen.findByTestId('cone')
const untilText = (text: string) => waitFor(() => expect(region().textContent).toContain(text))

beforeEach(() => {
  seen.cones = []
})
afterEach(() => {
  cleanup()
  liveStreamHub.reset()
  vi.restoreAllMocks()
})

describe('the expectation card: what it asks for', () => {
  it('reads exactly the tracking, the hypothesis, the runs, the bootstrap at its cost and the run analytics at D', async () => {
    serve()
    mount()
    await drawn()
    expect([...calls].sort()).toEqual([TRACKING_URL, DETAIL_URL, RUNS_URL, BOOT_URL, RUN_URL].sort())
    expect(methods.every((m) => m === 'GET')).toBe(true)
  })

  it('asks for neither the bootstrap nor the run analytics while the tracking has no value', async () => {
    const empty = { ...TRACKING_POPULATED, paper_cumulative: [null, null, null, null, null], model_cumulative: [null, null, null, null, null] }
    serve({ [TRACKING_URL]: () => json(empty) })
    mount()
    await untilText(EXPECTATION.empty)
    await waitFor(() => expect(calls).toContain(RUNS_URL))
    expect(calls.filter((u) => u.includes('/bootstrap') || u.includes('/api/analytics/run/'))).toEqual([])
  })

  it('asks for neither before the tracking has answered', async () => {
    serve({ [TRACKING_URL]: () => new Promise<Response>(() => {}) })
    mount()
    await waitFor(() => expect(calls).toContain(TRACKING_URL))
    expect(calls.filter((u) => u.includes('/bootstrap') || u.includes('/api/analytics/run/'))).toEqual([])
  })

  it('does not ask for the run analytics of a run the list marks as a probe', async () => {
    const probes = RUNS.map((r) => (r.run_id === RUN ? { ...r, is_probe: true } : r))
    serve({ [RUNS_URL]: () => json(probes) })
    mount()
    await untilText(fillCopy(EXPECTATION.noCapital, { reason: EXPECTATION.noRun }))
    expect(calls).not.toContain(RUN_URL)
  })

  it('does not ask for a bootstrap of a hypothesis that records no cost', async () => {
    const bare = { ...VOLMANAGED, card: { ...VOLMANAGED.card, series_costs: [] } }
    serve({ [DETAIL_URL]: () => json(bare) })
    mount()
    await untilText(fillCopy(EXPECTATION.noCost, { hypothesis: 'volmanaged_v0' }))
    expect(calls.filter((u) => u.includes('/bootstrap'))).toEqual([])
  })

  it('reads no hypothesis for a journal no registered hypothesis owns, and says so', async () => {
    serve({ [TRACKING_URL]: () => json({ ...TRACKING_POPULATED, journal: 'other_paper_journal.jsonl' }) })
    mount()
    await untilText(fillCopy(EXPECTATION.noBook, { journal: 'other_paper_journal.jsonl' }))
    expect(calls.filter((u) => u.startsWith('/api/hypotheses'))).toEqual([])
    expect(calls.filter((u) => u.includes('/bootstrap') || u.includes('/api/analytics/run/'))).toEqual([])
  })
})

describe('the expectation card: what it draws', () => {
  it('is a region named for the SV6 cone, headed by its title and the [POST HOC] tag', async () => {
    serve()
    mount()
    await drawn()
    const heading = within(region()).getByRole('heading', { level: 3 })
    expect(heading.textContent).toContain(EXPECTATION.title)
    expect(heading.textContent).toContain('[POST HOC]')
  })

  it('gives the Cone the SV6 cone with the realised line blanked and Paper and Model over it', async () => {
    serve()
    mount()
    await drawn()
    const { data, chartId } = seen.cones.at(-1)!
    expect(chartId).toBe('live-expectation')
    expect(data.name).toBe(fillCopy(EXPECTATION.coneName, { hypothesis: 'volmanaged_v0' }))
    expect(data.label).toBe(HYP_BOOTSTRAP.cone.label)
    expect(data.realised.every((v) => v === null)).toBe(true)
    expect(data.overlays!.map((o) => [o.id, o.label])).toEqual([['paper', EXPECTATION.paper], ['model', EXPECTATION.model]])
    expect(data.overlays![0]!.values.slice(0, 3)).toEqual([(12 / 1_000_000) * 100, (6 / 1_000_000) * 100, null])
    expect(data.overlays![1]!.values.slice(0, 3)).toEqual([(12 / 1_000_000) * 100, (7 / 1_000_000) * 100, null])
  })

  it('does not hand the Cone a new input on every render', async () => {
    serve()
    mount()
    await drawn()
    await waitFor(() => expect(calls).toHaveLength(5))
    const inputs = new Set(seen.cones.map((c) => c.data))
    expect(inputs.size).toBe(1)
  })

  it('names K and its run, the anchor, the before-costs basis, the latest placement and the cone label', async () => {
    serve()
    mount()
    await drawn()
    const text = region().textContent ?? ''
    expect(text).toContain("K = 1,000,000 USD: the starting capital of nt_volmanaged_v0_fixture_m1, the linked Nautilus reproduction of volmanaged_v0 (the spec's K).")
    expect(text).toContain('counted from the first paper session (2026-12-08), on the SV6 cone of volmanaged_v0 at 1 tick per side.')
    expect(text).toContain('before costs; the cone is the backtest net of 1 tick per side.')
    expect(text).toContain('Session 2 (2026-12-09): paper +0.0006% (between the 50th and 75th); model +0.0007% (between the 50th and 75th).')
    expect(text).toContain(HYP_BOOTSTRAP.cone.label)
    expect(text).toContain(EXPECTATION.computed)
  })

  it('shows no alert on the way to a drawn cone, and no alarm or verdict word once it is drawn', async () => {
    serve()
    mount()
    expect(screen.queryAllByRole('alert')).toEqual([])
    await drawn()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(region().textContent).not.toMatch(/alarm|breach|verdict|\bfail|violat|warn|wrong/i)
  })

  it('says it is loading until the reads are in, without an alert', async () => {
    serve({ [BOOT_URL]: () => new Promise<Response>(() => {}) })
    mount()
    await waitFor(() => expect(calls).toContain(BOOT_URL))
    expect(region().textContent).toContain(EXPECTATION.loading)
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(screen.queryByTestId('cone')).toBeNull()
  })
})

describe('the expectation card: how it refuses', () => {
  it('shows noCapital and no chart when the run analytics answers 422, without an alert', async () => {
    serve({ [RUN_URL]: () => json({ detail: 'the balance check of this run failed' }, 422) })
    mount()
    await untilText(fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: RUN }) }))
    expect(screen.queryByTestId('cone')).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
  })

  it('shows noCapital when the run serves no capital', async () => {
    serve({ [RUN_URL]: () => json({ ...RUN_ANALYTICS, capital: null }) })
    mount()
    await untilText(fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: RUN }) }))
    expect(screen.queryByTestId('cone')).toBeNull()
  })

  it('says a failed tracking read in words, without an alert: LV5 above already announces it', async () => {
    serve({ [TRACKING_URL]: () => json({ detail: 'live folder unreadable' }, 503) })
    mount()
    await untilText(EXPECTATION.noTracking)
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(region().textContent).not.toContain('live folder unreadable')
    expect(screen.queryByTestId('cone')).toBeNull()
  })

  it('shows the empty words when no paper session has a value, and no chart', async () => {
    const empty = { ...TRACKING_POPULATED, paper_cumulative: [null, null, null, null, null], model_cumulative: [null, null, null, null, null] }
    serve({ [TRACKING_URL]: () => json(empty) })
    mount()
    await untilText(EXPECTATION.empty)
    expect(screen.queryByTestId('cone')).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
  })

  it('shows the unit words for a cone that is not a summed fraction of K', async () => {
    const usd = { ...HYP_BOOTSTRAP, cone: { ...HYP_BOOTSTRAP.cone, unit: 'USD' } }
    serve({ [BOOT_URL]: () => json(usd) })
    mount()
    await untilText(fillCopy(EXPECTATION.unitRefused, { unit: 'USD', how: 'summed' }))
    expect(screen.queryByTestId('cone')).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
  })
})

describe('the expectation card: a failed read that only LV6 makes is the alert', () => {
  it('says a failed bootstrap read in an alert', async () => {
    serve({ [BOOT_URL]: () => json({ detail: 'no bootstrap for this series: too short' }, 422) })
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(EXPECTATION.failed, { detail: 'no bootstrap for this series: too short' }))
    expect(screen.queryByTestId('cone')).toBeNull()
  })

  it('says a failed run analytics read that is not a refusal in an alert', async () => {
    serve({ [RUN_URL]: () => json({ detail: 'analytics is down' }, 503) })
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(EXPECTATION.failed, { detail: 'analytics is down' }))
  })

  it('says a failed hypothesis read and a failed run list read in an alert', async () => {
    serve({ [DETAIL_URL]: () => json({ detail: 'card unreadable' }, 503) })
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain('card unreadable')
    cleanup()
    serve({ [RUNS_URL]: () => json({ detail: 'runs unreadable' }, 503) })
    mount()
    expect((await screen.findByRole('alert')).textContent).toContain('runs unreadable')
  })
})

describe('ExpectationCard: the pure card the gallery shows', () => {
  const view = expectationView({
    tracking: TRACKING_POPULATED, boot: HYP_BOOTSTRAP, capital: RUN_ANALYTICS.capital, runId: RUN, hypothesis: 'volmanaged_v0', cost: 1,
  })

  it('draws an ok view without any request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<ExpectationCard state={view} />)
    expect(screen.getByTestId('cone').getAttribute('data-chart-id')).toBe('live-expectation')
    expect(region().textContent).toContain('K = 1,000,000 USD')
    expect(spy).not.toHaveBeenCalled()
  })

  it('draws a refusal as words, a failure as an alert and a pending read as loading', () => {
    const { rerender } = render(<ExpectationCard state={{ kind: 'refused', text: EXPECTATION.empty }} />)
    expect(region().textContent).toContain(EXPECTATION.empty)
    expect(screen.queryAllByRole('alert')).toEqual([])
    rerender(<ExpectationCard state={{ kind: 'failed', detail: 'nope' }} />)
    expect(screen.getByRole('alert').textContent).toBe(fillCopy(EXPECTATION.failed, { detail: 'nope' }))
    rerender(<ExpectationCard state={{ kind: 'loading' }} />)
    expect(region().textContent).toContain(EXPECTATION.loading)
    expect(screen.queryAllByRole('alert')).toEqual([])
  })
})
