// @vitest-environment jsdom
// MT 87) Effective trials, the panel (ANALYTICS_CATALOG SV3b): the view over the served `effective_n` of the SV3 view
// (a synthetic, seeded view, not research data), [POST HOC], with the estimates, the correlation heatmap and the DSR
// table; the one GET it makes (the SV3 view, which now carries the numbers: no per-trial series is read); and every
// way it says nothing, as a role=status line and never an alert.
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../../charts/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { resetConnection } from '../../api/connection'
import { describeHeatmap } from '../../charts/echarts/heatmapModel'
import { resetNumbered } from '../../chrome/NumberedActions'
import { DEFLATED } from '../../copy/deflated'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { SPEC } from '../../copy/tiles'
import { fillCopy } from '../../copy/workspace'
import { stubLayout } from '../../grids/testing'
import { SYNTHETIC_VIEW } from './effectiveN.fixtures'
import { basisText, clustersText, dsrHeaders, effectiveNHeatmap, refusalText, windowText } from './effectiveNModel'
import type { DeflatedWithEffective, EffectiveNServed } from './effectiveNTypes'
import EffectiveNPanel, { EffectiveNBody } from './EffectiveNPanel'
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

const SERVED = SYNTHETIC_VIEW.effective_n

function withServed(served: Partial<EffectiveNServed>): DeflatedWithEffective {
  return { ...SYNTHETIC_VIEW, effective_n: { ...SERVED, ...served } }
}

const EMPTY: Partial<EffectiveNServed> = {
  window: null, correlation: [], eigenvalues: [], clusters: [], sequence: [], estimates: [], dsr: [],
}

interface Seen {
  readonly url: string
  readonly method: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Stubs fetch for the SV3 view only; every other URL is a 404, so a stray series GET would show. Records the requests. */
function stubGets(view: unknown = SYNTHETIC_VIEW, status = 200, hold?: Promise<void>): Seen[] {
  const seen: Seen[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, method: init?.method ?? 'GET' })
    if (url !== '/api/analytics/deflated') return json({ detail: 'not found' }, 404)
    await hold
    return status === 200 ? json(view) : json({ detail: `stub ${status} for ${url}` }, status)
  })
  return seen
}

function region(): HTMLElement {
  return screen.getByRole('region', { name: EFFECTIVE_N.label })
}

describe('EffectiveNBody over the served synthetic view (seeded, not research data)', () => {
  it('draws the band: the title, [POST HOC] and the basis with the daily and monthly counts', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
    const band = within(region()).getByText(EFFECTIVE_N.title).closest('p') as HTMLElement
    expect(within(band).getByText(SPEC.postHoc)).toBeTruthy()
    expect(band.textContent).toContain(basisText(SERVED))
    expect(basisText(SERVED)).toBe(
      'Basis A at 1 tick per side, per session (SV3a): the 9 daily trials in the matrix; the 2 monthly books counted as independent trials.',
    )
  })

  it('says the numbers are served by the backend, not computed in the browser', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
    expect(within(region()).getByText(EFFECTIVE_N.source)).toBeTruthy()
    expect(region().textContent).not.toMatch(/computed in the browser/i)
    expect(region().textContent).not.toContain('not a served number')
  })

  it('names the common window and the clusters at the cut', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
    const text = region().textContent as string
    expect(text).toContain(windowText(SERVED.window!))
    expect(windowText(SERVED.window!)).toContain('400 sessions that every daily trial records.')
    expect(text).toContain(clustersText(SERVED))
  })

  it('lists the four estimators with the served row marked and the SR0 each N sets', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
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
    expect(within(rows[1] as HTMLElement).getAllByRole('cell').map((c) => c.textContent).slice(0, 2)).toEqual(['9', '11'])
    expect(within(rows[4] as HTMLElement).getAllByRole('cell').map((c) => c.textContent).slice(0, 2)).toEqual(['7', '9'])
  })

  it('draws the correlation as a heatmap image named by its data summary, with the diagonal note', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
    const img = within(region()).getByRole('img', { name: describeHeatmap(effectiveNHeatmap(SERVED)) })
    expect(img.getAttribute('aria-label')).toContain(EFFECTIVE_N.heatmapName)
    expect(within(region()).getAllByRole('img')).toHaveLength(1)
    expect(within(region()).getByText(EFFECTIVE_N.diagonalNote)).toBeTruthy()
  })

  it('lists the DSR of every registered trial under each N, [POST HOC], with the floor as text', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
    const table = within(region()).getByRole('table', { name: EFFECTIVE_N.dsrCaption })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(12)
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Trial', 'P', 'DSR V0, N 11 (served)', 'N participation', 'N Li and Ji', 'N clusters',
    ])
    expect(dsrHeaders(SYNTHETIC_VIEW).served).toBe('DSR V0, N 11 (served)')
    const first = within(rows[1] as HTMLElement)
    expect(first.getByRole('rowheader').textContent).toBe(SERVED.daily[0])
    expect(first.getAllByRole('cell').map((c) => c.textContent)).toHaveLength(5)
    expect(within(rows[10] as HTMLElement).getAllByRole('cell')[0]?.textContent).toBe('12')
    expect(region().textContent).toContain(SPEC.postHoc)
  })

  it('adds no pass or fail, no alert and no p-value', () => {
    mountScreen(<EffectiveNBody view={SYNTHETIC_VIEW} />)
    expect(region().textContent).not.toMatch(/\[(PASS|FAIL)\]/)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(region().textContent).not.toMatch(/\bp[- ]?value\b/i)
  })

  it.each([
    ['no_daily', { kind: 'no_daily', name: null, sessions: null } as const],
    ['too_few', { kind: 'too_few', name: null, sessions: 120 } as const],
    ['degenerate', { kind: 'degenerate', name: 'syn_a1', sessions: null } as const],
  ])('shows the %s refusal as a status line and nothing else of the view', (_kind, refusal) => {
    mountScreen(<EffectiveNBody view={withServed({ ...EMPTY, refusal })} />)
    const status = within(region()).getByRole('status')
    expect(status.textContent).toBe(refusalText(refusal))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(within(region()).queryByRole('img')).toBeNull()
    expect(within(region()).queryAllByRole('table')).toHaveLength(0)
  })

  it('says it was not served, as a status, when the backend sent no effective_n, and draws nothing of its own', () => {
    const { effective_n: _dropped, ...older } = SYNTHETIC_VIEW
    mountScreen(<EffectiveNBody view={older as unknown as DeflatedWithEffective} />)
    expect(within(region()).getByRole('status').textContent).toBe(EFFECTIVE_N.notServed)
    expect(within(region()).queryAllByRole('table')).toHaveLength(0)
    expect(within(region()).queryByRole('img')).toBeNull()
  })
})

describe('EffectiveNPanel: the GET', () => {
  it('reads the SV3 view once, with GET, and no series per trial', async () => {
    const seen = stubGets()
    mountScreen(<EffectiveNPanel />)
    await within(await screen.findByRole('region', { name: EFFECTIVE_N.label })).findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(seen).toEqual([{ url: '/api/analytics/deflated', method: 'GET' }])
  })

  it('keeps one region element from the first render to the finished view', async () => {
    stubGets()
    mountScreen(<EffectiveNPanel />)
    const first = region()
    await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(region()).toBe(first)
    expect(first.isConnected).toBe(true)
  })

  it('draws the ok view from the served numbers', async () => {
    stubGets()
    mountScreen(<EffectiveNPanel />)
    const table = await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(await screen.findByRole('img', { name: describeHeatmap(effectiveNHeatmap(SERVED)) })).toBeTruthy()
    expect(screen.getByRole('table', { name: EFFECTIVE_N.dsrCaption })).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('says it is reading the SV3 view while that view is pending, busy, then replaces the line', async () => {
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    stubGets(SYNTHETIC_VIEW, 200, hold)
    mountScreen(<EffectiveNPanel />)
    const status = within(region()).getByRole('status')
    expect(status.textContent).toBe(DEFLATED.loading)
    expect(status.getAttribute('aria-busy')).toBe('true')
    release()
    await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(screen.queryByText(DEFLATED.loading)).toBeNull()
  })

  it('names a failure of the SV3 view itself in an alert inside its own block', async () => {
    stubGets(SYNTHETIC_VIEW, 503)
    mountScreen(<EffectiveNPanel />)
    const alert = await within(region()).findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(DEFLATED.failed, { detail: 'stub 503 for /api/analytics/deflated' }))
  })

  it('shows a data refusal the backend served as a status line, with no alert and no chart', async () => {
    stubGets(withServed({ ...EMPTY, refusal: { kind: 'too_few', name: null, sessions: 120 } }))
    mountScreen(<EffectiveNPanel />)
    const status = await within(region()).findByText(
      'Not computed: only 120 sessions are common to every daily trial (at least 252 are needed).',
    )
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(within(region()).queryByRole('img')).toBeNull()
  })

  it('says the effective number was not served when the answer has none', async () => {
    const { effective_n: _dropped, ...older } = SYNTHETIC_VIEW
    stubGets(older)
    mountScreen(<EffectiveNPanel />)
    expect((await within(region()).findByText(EFFECTIVE_N.notServed)).getAttribute('role')).toBe('status')
  })
})
