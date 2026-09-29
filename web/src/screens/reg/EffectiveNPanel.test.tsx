// @vitest-environment jsdom
// MT 87) Effective trials, the panel and its series hook (ANALYTICS_CATALOG SV3b): the ok view over a synthetic
// (seeded, not research) SV3 view, [POST HOC], with the estimates, the correlation heatmap and the DSR table; the
// GETs it makes (the SV3 view, then one analytics GET per daily trial at cost 1 on the tear sheet's key); and every
// way it refuses, as a role=status line and never an alert.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../../charts/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient, apiQueryKey } from '../../api/queries'
import { resetConnection } from '../../api/connection'
import { describeHeatmap } from '../../charts/echarts/heatmapModel'
import { resetNumbered } from '../../chrome/NumberedActions'
import { DEFLATED } from '../../copy/deflated'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import { stubLayout } from '../../grids/testing'
import type { DeflatedView } from './deflatedModel'
import { SYNTHETIC_VIEW, seriesBody, syntheticPanel } from './effectiveN.fixtures'
import EffectiveNPanel, { EffectiveNBody } from './EffectiveNPanel'
import {
  basisText,
  clustersText,
  computeEffectiveN,
  dailyTrialNames,
  dsrHeaders,
  effectiveNHeatmap,
  refusalText,
  type EffectiveNOk,
  type TrialSeries,
} from './effectiveNModel'
import { useTrialSeries, type TrialSeriesResult } from './useTrialSeries'
import { mountScreen } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  fake.chart.setOption.mockClear()
})
afterEach(() => {
  cleanup()
  resetConnection()
  vi.restoreAllMocks()
})

const PANEL = syntheticPanel()
const NAMES = PANEL.map((s) => s.name)
const NONE: ReadonlyMap<string, string> = new Map()
const OK = computeEffectiveN({ view: SYNTHETIC_VIEW, series: PANEL, failed: NONE }) as EffectiveNOk

interface Seen {
  readonly url: string
  readonly method: string
}

interface Stub {
  readonly view?: DeflatedView
  readonly series?: readonly TrialSeries[]
  /** name -> HTTP status for that trial's series GET */
  readonly status?: Readonly<Record<string, number>>
  /** name -> body for that trial's series GET, replacing the real one */
  readonly bodies?: Readonly<Record<string, unknown>>
  /** the deflated view answers with this status instead */
  readonly deflatedStatus?: number
  /** series answers wait for this promise */
  readonly hold?: Promise<void>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Stubs fetch for the SV3 view and the per-trial analytics GETs; records every request. */
function stubGets(stub: Stub = {}): Seen[] {
  const seen: Seen[] = []
  const view = stub.view ?? SYNTHETIC_VIEW
  const byName = new Map((stub.series ?? PANEL).map((s) => [s.name, s] as const))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: init?.method ?? 'GET' })
    if (url === '/api/analytics/deflated') {
      return stub.deflatedStatus === undefined ? json(view) : json({ detail: `stub ${stub.deflatedStatus} for ${url}` }, stub.deflatedStatus)
    }
    const match = /^\/api\/analytics\/hypothesis\/([^?/]+)\?cost=1$/.exec(url)
    if (match === null) return json({ detail: 'not found' }, 404)
    await stub.hold
    const name = decodeURIComponent(match[1] as string)
    const status = stub.status?.[name]
    if (status !== undefined) return json({ detail: `stub ${status} for ${name}` }, status)
    if (stub.bodies !== undefined && name in stub.bodies) return json(stub.bodies[name])
    const series = byName.get(name)
    return series === undefined ? json({ detail: 'not found' }, 404) : json(seriesBody(series))
  })
  return seen
}

function region(): HTMLElement {
  return screen.getByRole('region', { name: EFFECTIVE_N.label })
}

describe('EffectiveNBody over a synthetic view (seeded, not research data)', () => {
  it('draws the band: the title, [POST HOC] and the basis with the daily and monthly counts', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    const band = within(region()).getByText(EFFECTIVE_N.title).closest('p') as HTMLElement
    expect(within(band).getByText(SPEC.postHoc)).toBeTruthy()
    expect(band.textContent).toContain(basisText(SYNTHETIC_VIEW))
    expect(basisText(SYNTHETIC_VIEW)).toBe(
      'Basis A at 1 tick per side, per session (SV3a): the 9 daily trials in the matrix; the 2 monthly books counted as independent trials.',
    )
  })

  it('says it is computed in the browser, pinned to the qa reference and not a served number', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    expect(within(region()).getByText(EFFECTIVE_N.computed)).toBeTruthy()
    expect(EFFECTIVE_N.computed).toContain('qa/crosscheck/p12_neff.py')
    expect(EFFECTIVE_N.computed).toContain('not a served number')
  })

  it('names the common window and the clusters at the cut', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    const text = region().textContent as string
    expect(text).toContain(`Common window ${OK.window.from} to ${OK.window.to}: 600 sessions that every daily trial records.`)
    expect(text).toContain(clustersText(OK))
    expect(clustersText(OK)).toContain('syn_a1, syn_a2, syn_a3, syn_a4; syn_b1, syn_b2, syn_b3; syn_c1; syn_d1')
  })

  it('lists the four estimators with the served row marked and the SR0 each N sets', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    const table = within(region()).getByRole('table', { name: EFFECTIVE_N.estimates.caption })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(5)
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Estimator', 'N daily', 'N total', 'SR0/session', 'SR0 (ann.)',
    ])
    const labels = rows.slice(1).map((r) => within(r).getByRole('rowheader').textContent)
    expect(labels[0]).toBe(`${EFFECTIVE_N.estimates.registered} (${EFFECTIVE_N.served})`)
    expect(labels[1]).toBe(EFFECTIVE_N.estimates.participation)
    expect(labels[2]).toBe(EFFECTIVE_N.estimates.liJi)
    expect(labels[3]).toBe('Clusters at 1 - rho 0.5, average linkage')
    expect((rows[1] as HTMLElement).getAttribute('data-served')).toBe('true')
    expect((rows[2] as HTMLElement).getAttribute('data-served')).toBeNull()
    const registered = within(rows[1] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)
    expect(registered.slice(0, 2)).toEqual(['9', '11'])
    const clusters = within(rows[4] as HTMLElement).getAllByRole('cell').map((c) => c.textContent)
    expect(clusters.slice(0, 2)).toEqual(['4', '6'])
  })

  it('draws the correlation as a heatmap image named by its data summary, with the diagonal note', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    const name = describeHeatmap(effectiveNHeatmap(OK))
    const img = within(region()).getByRole('img', { name })
    expect(img.getAttribute('aria-label')).toContain(EFFECTIVE_N.heatmapName)
    expect(within(region()).getAllByRole('img')).toHaveLength(1)
    expect(within(region()).getByText(EFFECTIVE_N.diagonalNote)).toBeTruthy()
  })

  it('lists the DSR of every registered trial under each N, [POST HOC], with the floor as text', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    const table = within(region()).getByRole('table', { name: EFFECTIVE_N.dsrCaption })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(12)
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Trial', 'P', 'DSR V0, N 11 (served)', 'N participation', 'N Li and Ji', 'N clusters',
    ])
    expect(dsrHeaders(SYNTHETIC_VIEW).served).toBe('DSR V0, N 11 (served)')
    const first = within(rows[1] as HTMLElement)
    expect(first.getByRole('rowheader').textContent).toBe('syn_a1')
    expect(first.getAllByRole('cell').map((c) => c.textContent)).toHaveLength(5)
    expect(within(rows[10] as HTMLElement).getAllByRole('cell')[0]?.textContent).toBe('12')
    expect(region().textContent).toContain(SPEC.postHoc)
  })

  it('adds no pass or fail, no alert and no p-value', () => {
    mountScreen(<EffectiveNBody result={OK} view={SYNTHETIC_VIEW} />)
    expect(region().textContent).not.toMatch(/\[(PASS|FAIL)\]/)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(region().textContent).not.toMatch(/\bp[- ]?value\b/i)
  })

  it('shows a refusal as a status line and nothing else of the view', () => {
    const refused = computeEffectiveN({ view: { ...SYNTHETIC_VIEW, sr0_null_session: 1 }, series: PANEL, failed: NONE })
    mountScreen(<EffectiveNBody result={refused} view={SYNTHETIC_VIEW} />)
    const status = within(region()).getByRole('status')
    expect(status.textContent).toBe(fillCopy(EFFECTIVE_N.refused.anchor, { n: 11, name: 'SR0' }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(within(region()).queryByRole('img')).toBeNull()
    expect(within(region()).queryAllByRole('table')).toHaveLength(0)
  })
})

describe('EffectiveNPanel: the GETs', () => {
  it('reads the SV3 view once, then each daily trial once at cost 1, and only with GET', async () => {
    const seen = stubGets()
    mountScreen(<EffectiveNPanel />)
    await within(await screen.findByRole('region', { name: EFFECTIVE_N.label })).findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
    expect(seen).toHaveLength(10)
    expect(new Set(seen.map((s) => `${s.method} ${s.url}`))).toEqual(
      new Set(['GET /api/analytics/deflated', ...NAMES.map((n) => `GET /api/analytics/hypothesis/${n}?cost=1`)]),
    )
  })

  it('keeps one region element from the first render to the finished view', async () => {
    stubGets()
    mountScreen(<EffectiveNPanel />)
    const first = region()
    await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(region()).toBe(first)
    expect(first.isConnected).toBe(true)
  })

  it('asks for no series until the view has named its daily trials: the SV3 view is the first request', async () => {
    const seen = stubGets()
    mountScreen(<EffectiveNPanel />)
    await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(seen[0]?.url).toBe('/api/analytics/deflated')
    expect(seen.slice(1).every((s) => s.url.startsWith('/api/analytics/hypothesis/'))).toBe(true)
  })

  it('draws the ok view from the served view and the served series', async () => {
    stubGets()
    mountScreen(<EffectiveNPanel />)
    const table = await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(await screen.findByRole('img', { name: describeHeatmap(effectiveNHeatmap(OK)) })).toBeTruthy()
    expect(screen.getByRole('table', { name: EFFECTIVE_N.dsrCaption })).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('reads the series with the tear sheet key, so a tear sheet already open shares the cache', async () => {
    stubGets()
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    function Probe() {
      useTrialSeries(['syn_a1'], true)
      return null
    }
    render(<ApiProvider client={client}><Probe /></ApiProvider>)
    const key = apiQueryKey('/api/analytics/hypothesis/{name}', { path: { name: 'syn_a1' }, query: { cost: 1 } })
    await waitFor(() => expect(client.getQueryData(key)).toBeDefined())
    expect(client.getQueryData(key)).toEqual(seriesBody(PANEL[0] as TrialSeries))
  })
})

describe('EffectiveNPanel: waiting and refusals, always a status', () => {
  it('says how many series are read while it waits, busy, and then replaces the line', async () => {
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    stubGets({ hold })
    mountScreen(<EffectiveNPanel />)
    const status = await screen.findByText(fillCopy(EFFECTIVE_N.reading, { done: 0, total: 9 }))
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    release()
    await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(screen.queryByText(/^Reading the daily trials series/)).toBeNull()
  })

  it('keeps one status element from reading to the refusal', async () => {
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    stubGets({ hold, status: { syn_a1: 404 } })
    mountScreen(<EffectiveNPanel />)
    const status = await screen.findByText(fillCopy(EFFECTIVE_N.reading, { done: 0, total: 9 }))
    release()
    await within(region()).findByText(fillCopy(EFFECTIVE_N.refused.unavailable, { n: 1, total: 9, name: 'syn_a1', detail: 'stub 404 for syn_a1' }))
    // one live region, the same node: the refusal is announced as a change of the line, not as a new region
    expect(screen.getByRole('status')).toBe(status)
    expect(status.getAttribute('aria-busy')).not.toBe('true')
  })

  it('refuses with a role=status line, and no alert, when one series answers 404', async () => {
    stubGets({ status: { syn_b2: 404 } })
    mountScreen(<EffectiveNPanel />)
    const line = fillCopy(EFFECTIVE_N.refused.unavailable, { n: 1, total: 9, name: 'syn_b2', detail: 'stub 404 for syn_b2' })
    const status = await within(region()).findByText(line)
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(within(region()).queryByRole('img')).toBeNull()
    expect(within(region()).queryAllByRole('table')).toHaveLength(0)
  })

  it('refuses when every series is missing, as the demo does for 14 of 15 trials', async () => {
    stubGets({ series: [] })
    mountScreen(<EffectiveNPanel />)
    const status = await within(region()).findByText(/^Not computed: 9 of 9 daily trials series could not be read \(first syn_a1: not found\)/)
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('refuses a series body with no session returns, naming the trial and why', async () => {
    stubGets({ bodies: { syn_a2: { distribution: {} } } })
    mountScreen(<EffectiveNPanel />)
    const status = await within(region()).findByText(
      fillCopy(EFFECTIVE_N.refused.unavailable, { n: 1, total: 9, name: 'syn_a2', detail: EFFECTIVE_N.malformed }),
    )
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('refuses a series whose dates and returns differ in length', async () => {
    const body = { distribution: { series: { date: ['2020-01-01', '2020-01-02'], r: [0.01], t: [0, 1], unit: 'x' } } }
    stubGets({ bodies: { syn_c1: body } })
    mountScreen(<EffectiveNPanel />)
    await within(region()).findByText(
      fillCopy(EFFECTIVE_N.refused.unavailable, { n: 1, total: 9, name: 'syn_c1', detail: EFFECTIVE_N.malformed }),
    )
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('refuses when the browser formula does not reproduce the served SR0, and draws no matrix', async () => {
    const view = { ...SYNTHETIC_VIEW, sr0_null_session: (SYNTHETIC_VIEW.sr0_null_session as number) + 1e-6 }
    stubGets({ view })
    mountScreen(<EffectiveNPanel />)
    const status = await within(region()).findByText(fillCopy(EFFECTIVE_N.refused.anchor, { n: 11, name: 'SR0' }))
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(within(region()).queryByRole('img')).toBeNull()
  })

  it('refuses a series that does not reproduce the served n, and names the numbers', async () => {
    const short = PANEL.map((s, i) => (i === 4 ? { ...s, date: s.date.slice(0, 590), r: s.r.slice(0, 590) } : s))
    stubGets({ series: short })
    mountScreen(<EffectiveNPanel />)
    const status = await within(region()).findByText('Not computed: syn_b1 serves 590 sessions but SV3 counts 600.')
    expect(status.getAttribute('role')).toBe('status')
  })

  it('says the view names no daily trial and reads no series', async () => {
    const view = { ...SYNTHETIC_VIEW, rows: SYNTHETIC_VIEW.rows.filter((r) => r.periods !== 252) }
    expect(dailyTrialNames(view)).toEqual([])
    const seen = stubGets({ view })
    mountScreen(<EffectiveNPanel />)
    const status = await within(region()).findByText(EFFECTIVE_N.refused.noDaily)
    expect(status.getAttribute('role')).toBe('status')
    expect(seen.map((s) => s.url)).toEqual(['/api/analytics/deflated'])
    expect(refusalText({ kind: 'noDaily' })).toBe(EFFECTIVE_N.refused.noDaily)
  })

  it('names a failure of the SV3 view itself in an alert inside its own block, and asks for no series', async () => {
    const seen = stubGets({ deflatedStatus: 503 })
    mountScreen(<EffectiveNPanel />)
    const alert = await within(region()).findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(DEFLATED.failed, { detail: 'stub 503 for /api/analytics/deflated' }))
    expect(seen.map((s) => s.url)).toEqual(['/api/analytics/deflated'])
  })

  it('says it is reading the SV3 view while that view is pending, busy', async () => {
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await hold
      return json(SYNTHETIC_VIEW)
    })
    mountScreen(<EffectiveNPanel />)
    const status = within(region()).getByRole('status')
    expect(status.textContent).toBe(DEFLATED.loading)
    expect(status.getAttribute('aria-busy')).toBe('true')
    release()
    // the stub answers every URL with the view, so each series body has no session returns
    await within(region()).findByText(/^Not computed: 9 of 9 daily trials series could not be read/)
  })
})

describe('useTrialSeries', () => {
  function Probe({ names, enabled }: { readonly names: readonly string[]; readonly enabled: boolean }) {
    const result: TrialSeriesResult = useTrialSeries(names, enabled)
    return (
      <output data-testid="probe">
        {JSON.stringify({
          series: result.series.map((s) => [s.name, s.r.length]),
          failed: [...result.failed],
          done: result.done,
          total: result.total,
        })}
      </output>
    )
  }

  function mountProbeWith(client: ReturnType<typeof createApiQueryClient>, names: readonly string[], enabled: boolean) {
    return render(<ApiProvider client={client}><Probe names={names} enabled={enabled} /></ApiProvider>)
  }

  function mountProbe(names: readonly string[], enabled: boolean) {
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    return mountProbeWith(client, names, enabled)
  }

  function state(): { series: [string, number][]; failed: [string, string][]; done: number; total: number } {
    return JSON.parse(screen.getByTestId('probe').textContent as string)
  }

  it('asks for nothing while disabled, and reports none done', async () => {
    const seen = stubGets()
    mountProbe(['syn_a1', 'syn_a2'], false)
    await Promise.resolve()
    expect(seen).toEqual([])
    expect(state()).toEqual({ series: [], failed: [], done: 0, total: 2 })
  })

  it('returns the series in the order asked for, and the failures with their detail', async () => {
    stubGets({ status: { syn_a2: 404 } })
    mountProbe(['syn_b1', 'syn_a2', 'syn_a1'], true)
    await waitFor(() => expect(state().done).toBe(3))
    expect(state().series).toEqual([['syn_b1', 600], ['syn_a1', 600]])
    expect(state().failed).toEqual([['syn_a2', 'stub 404 for syn_a2']])
    expect(state().total).toBe(3)
  })

  it('reports an empty list as done, with nothing asked', () => {
    const seen = stubGets()
    mountProbe([], true)
    expect(seen).toEqual([])
    expect(state()).toEqual({ series: [], failed: [], done: 0, total: 0 })
  })

  it('keeps a cached series when its refetch fails', async () => {
    const client = createApiQueryClient()
    client.setDefaultOptions({ queries: { retry: false } })
    const key = apiQueryKey('/api/analytics/hypothesis/{name}', { path: { name: 'syn_a1' }, query: { cost: 1 } })
    // updatedAt 1 is long past STALE_MS, so the mount refetches; the refetch then answers 500
    client.setQueryData(key, seriesBody(PANEL[0] as TrialSeries), { updatedAt: 1 })
    stubGets({ status: { syn_a1: 500 } })
    mountProbeWith(client, ['syn_a1'], true)
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('error'))
    expect(state().series).toEqual([['syn_a1', 600]])
    expect(state().failed).toEqual([])
  })
})
