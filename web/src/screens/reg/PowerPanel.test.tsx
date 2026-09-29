// @vitest-environment jsdom
// The power table under SV3 on MT (ANALYTICS_CATALOG SV9): a sibling section after the Deflated Sharpe section, one
// row per registered trial, tagged [POST HOC] with its basis, its approximation and a "computed in the browser" line.
// A plain table: no MonitorGrid, no numbered item, no verdict, no alert. Reads only the two GETs MT already makes.
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

import { numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { DEFLATED } from '../../copy/deflated'
import { POWER } from '../../copy/power'
import { stubLayout } from '../../grids/testing'
import { DEFLATED_REAL } from './deflatedFixtures'
import DeflatedPanel from './DeflatedPanel'
import MtScreen from './MtScreen'
import { powerSummary, powerView } from './powerModel'
import { PowerTable } from './PowerPanel'
import { MULTIPLE_TESTING } from './regFixtures'
import { PANEL_ID, mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => resetNumbered())
afterEach(() => cleanup())

/** MT's grid rows are numbered 1 to k; every number from 85 up belongs to MT's tab strip and function bar. */
const MT_FIRST_CHROME_NUMBER = 85
const FAMILY = { alpha: MULTIPLE_TESTING.alpha, k: MULTIPLE_TESTING.k }

async function powerRegion(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: POWER.label })
}

async function powerTable(): Promise<HTMLElement> {
  return within(await powerRegion()).findByRole('table', { name: POWER.caption })
}

describe('the power section on MT', () => {
  it('is a region after the Deflated Sharpe region, not inside it', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const power = await powerRegion()
    const deflated = await screen.findByRole('region', { name: DEFLATED.label })
    expect(deflated.compareDocumentPosition(power) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(deflated.contains(power)).toBe(false)
    expect(power.contains(deflated)).toBe(false)
  })

  it('draws one row per registered trial: 21 rows and a header', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(22)
    const names = rows.slice(1).map((r) => within(r).getByRole('rowheader').textContent)
    expect(names).toEqual(DEFLATED_REAL.rows.map((r) => r.name))
  })

  it('heads the columns from the copy, naming the reference Sharpe 0.50 in the power columns', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Trial', 'P', 'n', 'Years', 'Sharpe (ann.)', 'MDE alpha', 'MDE alpha/k', 'Sharpe/MDE alpha/k',
      'Power at 0.50, alpha', 'Power at 0.50, alpha/k',
    ])
  })

  it('shows the volmanaged_v0 row: years 10.66, Sharpe +0.99, MDE 0.76 and 1.12, ratio 0.88', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const row = within(table).getByRole('rowheader', { name: 'volmanaged_v0' }).closest('tr')!
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '252', '2,686', '10.66', '+0.99', '0.76', '1.12', '0.88', '0.50', '0.12',
    ])
  })

  it('colours the Sharpe by sign: up for a positive, down for a negative', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const sharpeCell = (name: string) => within(within(table).getByRole('rowheader', { name }).closest('tr')!).getAllByRole('cell')[3]!
    expect(sharpeCell('volmanaged_v0').className).toContain('up')
    expect(sharpeCell('mim_v0').className).toContain('down')
    expect(sharpeCell('mim_v0').textContent).toBe('-11.49')
  })

  it('carries [POST HOC], the basis, the approximation and the computed in the browser line', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await within(region).findByRole('table')
    expect(region.textContent).toContain(POWER.title)
    expect(within(region).getByText('[POST HOC]')).toBeTruthy()
    expect(region.textContent).toContain(POWER.basis)
    expect(region.textContent).toContain(POWER.approx)
    expect(region.textContent).toContain(POWER.computed)
    expect(POWER.computed).toMatch(/Computed in the browser/)
  })

  it('states the summary ranges of the captured view', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await within(region).findByRole('table')
    expect(region.textContent).toContain(powerSummary(powerView(DEFLATED_REAL, FAMILY)))
    expect(region.textContent).toContain('1.09 to 1.16 at alpha/k 0.00238 (k 21)')
  })

  it('gives no verdict and no alert', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await within(region).findByRole('table')
    expect(region.textContent).not.toMatch(/\[(PASS|FAIL)\]/)
    expect(region.textContent).not.toMatch(/\b(passes|passed|fails|failed|significant|underpowered|adequate)\b/i)
    expect(region.querySelector('[role=alert]')).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('adds no numbered item and no grid', async () => {
    stubApi()
    mountScreen(<DeflatedPanel />)
    await powerTable()
    expect(numberedItems(PANEL_ID)).toEqual([])
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('reads only /api/analytics/deflated and /api/multiple-testing, once each, with GET only', async () => {
    const seen = stubApi()
    mountScreen(<DeflatedPanel />)
    await powerTable()
    expect(seen.map((s) => `${s.method} ${s.url}`).sort()).toEqual(['GET /api/analytics/deflated', 'GET /api/multiple-testing'])
  })

  it('draws nothing while the family is still loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === '/api/multiple-testing') return new Promise<Response>(() => undefined)
      return Promise.resolve(new Response(JSON.stringify(DEFLATED_REAL), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    mountScreen(<DeflatedPanel />)
    await screen.findByRole('region', { name: DEFLATED.label })
    await waitFor(() => expect(screen.getByText(/N 21 registered trials/)).toBeTruthy())
    expect(screen.queryByRole('region', { name: POWER.label })).toBeNull()
    expect(screen.queryByRole('table', { name: POWER.caption })).toBeNull()
  })

  it('shows the unavailable line, without an alert, when the family cannot be read', async () => {
    stubApi({ '/api/multiple-testing': 503 })
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await waitFor(() => expect(region.textContent).toContain('Alpha and k are not available, so the power table is not drawn: stub 503 for /api/multiple-testing'))
    expect(within(region).queryByRole('table')).toBeNull()
    expect(region.querySelector('[role=alert]')).toBeNull()
    expect(within(region).queryByRole('alert')).toBeNull()
  })

  it('draws no power section when the Deflated Sharpe view cannot be read (SV3 keeps its own alert)', async () => {
    stubApi({ '/api/analytics/deflated': 503 })
    mountScreen(<DeflatedPanel />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/analytics/deflated')
    expect(screen.queryByRole('region', { name: POWER.label })).toBeNull()
  })
})

describe('PowerTable: the pure table', () => {
  it('draws the rows of a power view without a query', () => {
    render(<PowerTable power={powerView(DEFLATED_REAL, FAMILY)} />)
    const table = screen.getByRole('table', { name: POWER.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(22)
    expect(table.className).toContain('nqt-grid')
  })

  it('prints -- for a trial whose figures do not exist', () => {
    const view = { ...DEFLATED_REAL, rows: [{ ...DEFLATED_REAL.rows[7]!, n: 1, annual_sharpe: null }] }
    render(<PowerTable power={powerView(view, FAMILY)} />)
    const row = screen.getByRole('rowheader', { name: 'volmanaged_v0' }).closest('tr')!
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(cells.slice(3)).toEqual(['--', '--', '--', '--', '--', '--'])
  })
})

describe('MT with the power section', () => {
  it('adds no numbered item of its own: the numbers below the tab strip stay the MT grid rows 1 to k', async () => {
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    await powerTable()
    const numbers = numberedItems(PANEL_ID).map((i) => i.n)
    expect(numbers.filter((n) => n < MT_FIRST_CHROME_NUMBER)).toEqual(Array.from({ length: MULTIPLE_TESTING.k }, (_, i) => i + 1))
  })

  it('puts the power region under SV3 in the MT panel and raises no alert', async () => {
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const power = await powerRegion()
    const deflated = await screen.findByRole('region', { name: DEFLATED.label })
    expect(deflated.compareDocumentPosition(power) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})
