// @vitest-environment jsdom
// The LIVE expectation card (ANALYTICS_CATALOG LV6 and LV6b, [POST HOC]): the paper book's cumulative P&L placed on
// a served cone, the hypothesis's SV6 cone (backtest start) or one resampled from the paper book's own sessions (live
// start), chosen with a toggle. What it asks for (the served view and the paper tracking LV5 already reads, GETs only),
// what it draws (the Cone with the paper and model overlays, the lines that name K and its run), how the toggle works
// by mouse and keyboard and how it refuses in words. The Cone is a stand-in that records its input. A role=alert only
// for a failed read that LV5 does not already announce (not the paper tracking).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { liveStreamHub } from '../../api/useLiveStream'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { EXPECTATION } from '../../copy/expectation'
import { fillCopy } from '../../copy/workspace'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import ExpectationPanel, { ExpectationCard, ServedExpectation } from './ExpectationPanel'
import { PAPER_EXPECTATION, PAPER_EXPECTATION_LIVE, TRACKING_LIVE_BOOK } from './expectationFixtures'
import type { PaperExpectation } from './expectationModel'
import { TRACKING_POPULATED } from './trackingFixtures'

const seen = vi.hoisted(() => ({ cones: [] as Array<{ data: ConeInput; chartId: string }> }))

function standIn(props: { data: ConeInput; chartId: string }) {
  seen.cones.push(props)
  return <div data-testid="cone" data-chart-id={props.chartId}>{props.data.name}</div>
}

vi.mock('../../charts/echarts/Cone', () => ({ Cone: standIn }))

const TRACKING_URL = '/api/analytics/paper-tracking'
const EXPECTATION_URL = '/api/analytics/paper-expectation'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Answer = () => Response | Promise<Response>
const DEFAULTS: Readonly<Record<string, Answer>> = {
  [TRACKING_URL]: () => json(TRACKING_POPULATED),
  [EXPECTATION_URL]: () => json(PAPER_EXPECTATION),
}

let calls: string[] = []
let methods: string[] = []

/** Stubs fetch with the two answers the card needs; `override` replaces some of them. */
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
const startButton = (name: string) => within(region()).getByRole('button', { name })

beforeEach(() => {
  seen.cones = []
})
afterEach(() => {
  cleanup()
  liveStreamHub.reset()
  vi.restoreAllMocks()
})

describe('the expectation card: what it asks for', () => {
  it('reads exactly the paper tracking and the served expectation, with GETs only', async () => {
    serve()
    mount()
    await drawn()
    expect([...new Set(calls)].sort()).toEqual([EXPECTATION_URL, TRACKING_URL].sort())
    expect(methods.every((m) => m === 'GET')).toBe(true)
  })

  it('asks for no bootstrap, run list, hypothesis or run analytics: the placement is served', async () => {
    serve()
    mount()
    await drawn()
    expect(calls.filter((u) => u.includes('/bootstrap') || u.startsWith('/api/runs') || u.startsWith('/api/hypotheses') || u.startsWith('/api/analytics/run/'))).toEqual([])
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
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(new Set(seen.cones.map((c) => c.data)).size).toBe(1)
  })

  it('names K and its run, the anchor, the before-costs basis, the latest placement, the cone label and that it is served', async () => {
    serve()
    mount()
    await drawn()
    const text = region().textContent ?? ''
    expect(text).toContain("K = 1,000,000 USD: the starting capital of nt_volmanaged_v0_fixture_m1, the linked Nautilus reproduction of volmanaged_v0 (the spec's K).")
    expect(text).toContain('counted from the first paper session (2026-12-08), on the SV6 cone of volmanaged_v0 at 1 tick per side.')
    expect(text).toContain('Session 2 (2026-12-09): paper +0.0006% (between the 50th and 75th); model +0.0007% (between the 50th and 75th).')
    expect(text).toContain(HYP_BOOTSTRAP.cone.label)
    expect(text).toContain(EXPECTATION.computed)
    expect(text).not.toMatch(/computed in the browser/i)
  })

  it('shows no alert on the way to a drawn cone, and no alarm or verdict word once it is drawn', async () => {
    serve()
    mount()
    expect(screen.queryAllByRole('alert')).toEqual([])
    await drawn()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(region().textContent).not.toMatch(/alarm|breach|verdict|\bfail|violat|warn|wrong/i)
  })

  it('says it is loading until the view is in, without an alert', async () => {
    serve({ [EXPECTATION_URL]: () => new Promise<Response>(() => {}) })
    mount()
    await waitFor(() => expect(calls).toContain(EXPECTATION_URL))
    expect(region().textContent).toContain(EXPECTATION.loading)
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(screen.queryByTestId('cone')).toBeNull()
  })
})

describe('the expectation card: the cone toggle', () => {
  it('offers both cones as a named group of pressed-state buttons, the backtest start pressed first', async () => {
    serve({ [TRACKING_URL]: () => json(TRACKING_LIVE_BOOK), [EXPECTATION_URL]: () => json(PAPER_EXPECTATION_LIVE) })
    mount()
    await drawn()
    const group = within(region()).getByRole('group', { name: EXPECTATION.start.label })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([EXPECTATION.start.backtest, EXPECTATION.start.live])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('draws the live-start cone when Live start is pressed, and back again, by mouse and by keyboard', async () => {
    serve({ [TRACKING_URL]: () => json(TRACKING_LIVE_BOOK), [EXPECTATION_URL]: () => json(PAPER_EXPECTATION_LIVE) })
    mount()
    await drawn()
    fireEvent.click(startButton(EXPECTATION.start.live))
    await waitFor(() => expect(seen.cones.at(-1)!.data.name).toBe(EXPECTATION.liveConeName))
    expect(startButton(EXPECTATION.start.live).getAttribute('aria-pressed')).toBe('true')
    expect(region().textContent).toContain(EXPECTATION.liveCostNote)
    expect(seen.cones.at(-1)!.data.steps).toHaveLength(40)
    const back = startButton(EXPECTATION.start.backtest)
    back.focus()
    expect(document.activeElement).toBe(back)
    fireEvent.click(back) // a native button: Enter and Space click it
    await waitFor(() => expect(seen.cones.at(-1)!.data.name).toBe(fillCopy(EXPECTATION.coneName, { hypothesis: 'volmanaged_v0' })))
    expect(document.activeElement).toBe(startButton(EXPECTATION.start.backtest))
  })

  it('says a short paper book has no live-start cone yet, in words and without an alert', async () => {
    serve()
    mount()
    await drawn()
    fireEvent.click(startButton(EXPECTATION.start.live))
    await untilText(fillCopy(EXPECTATION.liveShort, { n: 2, min: 30 }))
    expect(screen.queryByTestId('cone')).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
    expect(startButton(EXPECTATION.start.backtest)).toBeTruthy()
  })
})

describe('the expectation card: how it refuses', () => {
  const refused = (code: string, params: Record<string, string> = {}): PaperExpectation =>
    ({ ...PAPER_EXPECTATION, refusal: { code: code as never, params }, backtest: null, live: null })

  it('shows the served refusal in words, with no chart, no toggle and no alert', async () => {
    serve({ [EXPECTATION_URL]: () => json(refused('no_capital', { run: 'nt_volmanaged_v0_fixture_m1' })) })
    mount()
    await untilText(fillCopy(EXPECTATION.noCapital, { reason: fillCopy(EXPECTATION.noK, { run: 'nt_volmanaged_v0_fixture_m1' }) }))
    expect(screen.queryByTestId('cone')).toBeNull()
    expect(within(region()).queryByRole('group')).toBeNull()
    expect(screen.queryAllByRole('alert')).toEqual([])
  })

  it('shows the empty words when no paper session has a value', async () => {
    serve({ [EXPECTATION_URL]: () => json(refused('empty')) })
    mount()
    await untilText(EXPECTATION.empty)
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
})

describe('the expectation card: a failed read that only LV6 makes is the alert', () => {
  it('says a failed expectation read in an alert', async () => {
    serve({ [EXPECTATION_URL]: () => json({ detail: 'analytics is down' }, 503) })
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(EXPECTATION.failed, { detail: 'analytics is down' }))
    expect(screen.queryByTestId('cone')).toBeNull()
  })
})

describe('ExpectationCard and ServedExpectation: the pure cards the gallery shows', () => {
  it('draws a served view without any request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    render(<ServedExpectation served={PAPER_EXPECTATION_LIVE} />)
    expect(screen.getByTestId('cone').getAttribute('data-chart-id')).toBe('live-expectation')
    expect(region().textContent).toContain('K = 1,000,000 USD')
    expect(spy).not.toHaveBeenCalled()
  })

  it('opens on the start it is given', () => {
    render(<ServedExpectation served={PAPER_EXPECTATION_LIVE} initial="live" />)
    expect(screen.getByTestId('cone').textContent).toBe(EXPECTATION.liveConeName)
  })

  it('draws a refusal as words, a failure as an alert and a pending read as loading', () => {
    const { rerender } = render(<ExpectationCard state={{ kind: 'refused', text: EXPECTATION.empty, switchable: false }} />)
    expect(region().textContent).toContain(EXPECTATION.empty)
    expect(screen.queryAllByRole('alert')).toEqual([])
    rerender(<ExpectationCard state={{ kind: 'failed', detail: 'nope' }} />)
    expect(screen.getByRole('alert').textContent).toBe(fillCopy(EXPECTATION.failed, { detail: 'nope' }))
    rerender(<ExpectationCard state={{ kind: 'loading' }} />)
    expect(region().textContent).toContain(EXPECTATION.loading)
  })
})
