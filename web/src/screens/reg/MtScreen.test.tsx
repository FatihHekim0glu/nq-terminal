// @vitest-environment jsdom
// MT, the multiple-testing view (TASKS 6.1; UI_SPEC 7; ANALYTICS_CATALOG SV4): sorted p against rank
// with the Bonferroni, Holm and BH lines, a check that those lines are the API's, the table of stored
// adjusted values, and sealed confirmations listed apart with their own alpha.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { describePScatter } from '../../charts/echarts/pScatterModel'
import { stubLayout } from '../../grids/testing'
import { mtScatterInput } from './mtModel'
import { DEFLATED } from '../../copy/deflated'
import { MT } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'
import { DEFLATED_REAL } from './deflatedFixtures'
import MtScreen from './MtScreen'
import { MULTIPLE_TESTING } from './regFixtures'
import { PANEL_ID, backendDown, mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  fake.chart.setOption.mockClear()
})
afterEach(() => {
  cleanup()
  resetConnection()
})

function table(): HTMLElement {
  return screen.getByRole('grid', { name: /Adjusted p-values/ })
}

function bodyRows(): HTMLElement[] {
  return within(table()).getAllByRole('row').filter((r) => r.closest('tbody'))
}

async function ready() {
  mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
  await waitFor(() => expect(bodyRows()).toHaveLength(MULTIPLE_TESTING.k))
  await act(async () => {
    await Promise.resolve()
  })
}

/** The last option the p-value scatter drew (MT also draws SV3's DSR ladder, which has no BH line). */
function lastOption(): { yAxis: { type: string } } {
  const scatter = fake.chart.setOption.mock.calls
    .map((c) => c[0] as { yAxis: { type: string }; series?: Array<{ id?: string }> })
    .filter((o) => o.series?.some((s) => s.id === 'bh'))
  return scatter[scatter.length - 1]!
}

describe('MT: multiple-testing view', () => {
  it('draws every family p-value against rank, named by the chart summary', async () => {
    stubApi()
    await ready()
    const img = screen.getByRole('img', { name: describePScatter(mtScatterInput(MULTIPLE_TESTING, 'log')) })
    expect(img.getAttribute('aria-label')).toBe(describePScatter(mtScatterInput(MULTIPLE_TESTING, 'log')))
    expect(lastOption().yAxis.type).toBe('log')
  })

  it('says the drawn boundary lines match the API lines, and the family and alpha', async () => {
    stubApi()
    await ready()
    const head = screen.getByRole('region', { name: 'Multiple-testing family' })
    expect(within(head).getByText(/Family k 21, alpha 0.05/)).toBeTruthy()
    expect(within(head).getByText(/Boundary lines match the API at every rank/)).toBeTruthy()
    expect(within(head).getByText('[PRE-REG]')).toBeTruthy()
    expect(within(head).getByText('[POST HOC]')).toBeTruthy()
  })

  it('lists stored adjusted values and the boundaries to four decimals, in rank order', async () => {
    stubApi()
    await ready()
    const first = within(bodyRows()[0]!).getAllByRole('gridcell').map((c) => c.textContent)
    expect(first).toEqual(['1)', '1', 'vt_har_v0', '[OVERLAY]', '0.0002', '0.0024', '0.0024', '0.0024', '0.0042', '0.0042', '0.0042', 'Bonferroni, Holm, BH'])
    const second = within(bodyRows()[1]!).getAllByRole('gridcell').map((c) => c.textContent)
    expect(second).toEqual(['2)', '2', 'eomtsy_v0', 'edge', '0.0010', '0.0024', '0.0025', '0.0048', '0.0203', '0.0194', '0.0102', 'Bonferroni, Holm, BH'])
  })

  it('lists sealed confirmations apart, with their own alpha and the spent label', async () => {
    stubApi()
    await ready()
    const block = screen.getByRole('region', { name: /Sealed confirmations/ })
    expect(within(block).getByText('rebal_v1_confirm')).toBeTruthy()
    expect(within(block).getByText(/own alpha 0.05/)).toBeTruthy()
    expect(within(block).getByText('[SPENT]')).toBeTruthy()
    expect(within(table()).queryByText('rebal_v1_confirm')).toBeNull()
  })

  it('switches the p axis to linear from 97) Settings', async () => {
    stubApi()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Linear p axis' }))
    await waitFor(() => expect(lastOption().yAxis.type).toBe('value'))
  })

  it('opens DES for a row on Enter', async () => {
    stubApi()
    await ready()
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    try {
      act(() => table().focus())
      fireEvent.keyDown(table(), { key: 'ArrowDown' })
      fireEvent.keyDown(table(), { key: 'Enter' })
      expect(lines.at(-1)).toEqual({ line: 'eomtsy_v0 DES', newPanel: false })
    } finally {
      stop()
    }
    expect(numberedItems(PANEL_ID).map((i) => i.n)).toEqual(expect.arrayContaining([96, 97]))
  })

  it('reads /api/multiple-testing and the SV3 view /api/analytics/deflated, with GET only', async () => {
    const seen = stubApi()
    await ready()
    await screen.findByRole('region', { name: DEFLATED.label })
    expect(new Set(seen.map((s) => `${s.method} ${s.url}`))).toEqual(new Set(['GET /api/multiple-testing', 'GET /api/analytics/deflated']))
  })

  it('shows the Deflated Sharpe over the registered trials, [POST HOC], with the trial that dominates V and no verdict', async () => {
    stubApi()
    await ready()
    const section = await screen.findByRole('region', { name: DEFLATED.label })
    await waitFor(() => expect(section.textContent).toContain('N 21 registered trials'))
    expect(section.textContent).toContain('[POST HOC]')
    expect(section.textContent).toContain(DEFLATED.extra)
    expect(section.textContent).toContain(DEFLATED_REAL.dominant!)
    const table = within(section).getByRole('table', { name: DEFLATED.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(22)
    const vm = DEFLATED_REAL.rows.find((r) => r.name === 'volmanaged_v0')!
    const row = within(table).getByRole('rowheader', { name: 'volmanaged_v0' }).closest('tr')!
    expect(row.textContent).toContain(vm.dsr!.toFixed(3))
    expect(section.textContent).not.toMatch(/\[(PASS|FAIL)\]/)
  })

  it('names the failure when the family cannot be read', async () => {
    stubApi({ '/api/multiple-testing': 503 })
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/multiple-testing')
    expect(alert.textContent).toBe(fillCopy(MT.failed, { detail: 'stub 503 for /api/multiple-testing' }))
    expect(screen.queryByRole('img')).toBeNull()
  })

  // Backend-down acceptance (roadmap #7): a waiting status while the strip owns the outage alert.
  it('waits for the backend, with no alert, when the family answers 502 while the connection is down', async () => {
    backendDown()
    stubApi({ '/api/multiple-testing': 502 })
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Waiting for the backend: GET /api/multiple-testing answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says the panel is waiting to load, not busy, while the backend is down and the family is pending', () => {
    backendDown()
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Waiting for the backend before loading.')
    expect(status.hasAttribute('aria-busy')).toBe(false)
  })

  it('keeps the loading line busy while the backend is up and the family is pending', () => {
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(MT.loading)
    expect(status.getAttribute('aria-busy')).toBe('true')
  })

  it('names the Deflated Sharpe failure in an alert inside its own block while the backend is up', async () => {
    stubApi({ '/api/analytics/deflated': 503 })
    await ready()
    const section = screen.getByRole('region', { name: DEFLATED.label })
    const alert = await within(section).findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(DEFLATED.failed, { detail: 'stub 503 for /api/analytics/deflated' }))
  })

  it('waits for the backend in the Deflated Sharpe block, with no alert, while the connection is down', async () => {
    backendDown()
    stubApi({ '/api/analytics/deflated': 502 })
    await ready()
    const section = screen.getByRole('region', { name: DEFLATED.label })
    await waitFor(() =>
      expect(within(section).getByRole('status').textContent).toBe('Waiting for the backend: GET /api/analytics/deflated answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
