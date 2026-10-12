// @vitest-environment jsdom
// The power table under SV3 on MT (ANALYTICS_CATALOG SV9): a sibling section after the Deflated Sharpe section, one
// row per registered trial, tagged [POST HOC] with its basis, its approximation and a "served by the terminal" line.
// A plain table: no MonitorGrid, no numbered item, no verdict, no alert. Reads GET /api/analytics/deflated and the
// served GET /api/analytics/power, once each. The served figures equal the browser reference (quant/power.ts, a test
// reference now) to 1e-12.
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
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
import { POWER_SERVED } from '../../copy/plan'
import { POWER } from '../../copy/power'
import { stubLayout } from '../../grids/testing'
import { POWER_TABLE_REAL } from '../plan/powerTable.fixtures'
import { DEFLATED_REAL } from './deflatedFixtures'
import DeflatedPanel from './DeflatedPanel'
import MtScreen from './MtScreen'
import { powerView } from '../../quant/powerReference'
import { powerSummary } from './powerModel'
import { PowerTable } from './PowerPanel'
import { MULTIPLE_TESTING } from './regFixtures'
import { PANEL_ID, mountScreen, panelParams, stubApi } from './testHarness'
import { powerViewFromServed } from './usePowerTable'

// The flake of run 37691474042: the first case of this file pays the cold start (lazy chart stand-in, the first
// accessible-name queries on a large table) and took 1.4 s on a loaded runner, past testing-library's default
// one-second wait for a region. Every wait here is as generous as the other lazy screens' (App.lazy.test.tsx).
configure({ asyncUtilTimeout: 5000 })

const POWER_URL = '/api/analytics/power'

/** The REG and MT stub plus the served power table, which the shared harness does not answer yet. */
function stubPower(override: Readonly<Record<string, number>> = {}, bodies: Readonly<Record<string, unknown>> = {}) {
  return stubApi(override, { [POWER_URL]: POWER_TABLE_REAL, ...bodies })
}

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
    stubPower()
    mountScreen(<DeflatedPanel />)
    const power = await powerRegion()
    const deflated = await screen.findByRole('region', { name: DEFLATED.label })
    expect(deflated.compareDocumentPosition(power) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(deflated.contains(power)).toBe(false)
    expect(power.contains(deflated)).toBe(false)
  })

  it('draws one row per registered trial: 21 rows and a header', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(22)
    const names = rows.slice(1).map((r) => within(r).getByRole('rowheader').textContent)
    expect(names).toEqual(DEFLATED_REAL.rows.map((r) => r.name))
  })

  it('heads the columns from the copy, naming the reference Sharpe 0.50 in the power columns', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Trial', 'P', 'n', 'Years', 'Sharpe (ann.)', 'MDE alpha', 'MDE alpha/k', 'Sharpe/MDE alpha/k',
      'Power at 0.50, alpha', 'Power at 0.50, alpha/k',
    ])
  })

  it('shows the volmanaged_v0 row: years 10.66, Sharpe +0.99, MDE 0.76 and 1.12, ratio 0.88', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const row = within(table).getByRole('rowheader', { name: 'volmanaged_v0' }).closest('tr')!
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '252', '2,686', '10.66', '+0.99', '0.76', '1.12', '0.88', '0.50', '0.12',
    ])
  })

  it('colours the Sharpe by sign: up for a positive, down for a negative', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const table = await powerTable()
    const sharpeCell = (name: string) => within(within(table).getByRole('rowheader', { name }).closest('tr')!).getAllByRole('cell')[3]!
    expect(sharpeCell('volmanaged_v0').className).toContain('up')
    expect(sharpeCell('mim_v0').className).toContain('down')
    expect(sharpeCell('mim_v0').textContent).toBe('-11.49')
  })

  it('carries [POST HOC], the basis, the approximation and the computed in the browser line', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await within(region).findByRole('table')
    expect(region.textContent).toContain(POWER.title)
    expect(within(region).getByText('[POST HOC]')).toBeTruthy()
    expect(region.textContent).toContain(POWER.basis)
    expect(region.textContent).toContain(POWER.approx)
    expect(region.textContent).toContain(POWER_SERVED.computed)
    expect(POWER_SERVED.computed).toMatch(/Served by the terminal/)
    expect(region.textContent).not.toMatch(/computed in the browser/i)
  })

  it('states the summary ranges of the captured view', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await within(region).findByRole('table')
    expect(region.textContent).toContain(powerSummary(powerView(DEFLATED_REAL, FAMILY)))
    expect(region.textContent).toContain('1.09 to 1.16 at alpha/k 0.00238 (k 21)')
  })

  it('gives no verdict and no alert', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await within(region).findByRole('table')
    expect(region.textContent).not.toMatch(/\[(PASS|FAIL)\]/)
    expect(region.textContent).not.toMatch(/\b(passes|passed|fails|failed|significant|underpowered|adequate)\b/i)
    expect(region.querySelector('[role=alert]')).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('adds no numbered item and no grid', async () => {
    stubPower()
    mountScreen(<DeflatedPanel />)
    await powerTable()
    expect(numberedItems(PANEL_ID)).toEqual([])
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('reads only /api/analytics/deflated and /api/analytics/power, once each, with GET only', async () => {
    const seen = stubPower()
    mountScreen(<DeflatedPanel />)
    await powerTable()
    expect(seen.map((s) => `${s.method} ${s.url}`).sort()).toEqual(['GET /api/analytics/deflated', 'GET /api/analytics/power'])
  })

  it('draws nothing while the served table is still loading', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === POWER_URL) return new Promise<Response>(() => undefined)
      return Promise.resolve(new Response(JSON.stringify(DEFLATED_REAL), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    mountScreen(<DeflatedPanel />)
    await screen.findByRole('region', { name: DEFLATED.label })
    await waitFor(() => expect(screen.getByText(/N 21 registered trials/)).toBeTruthy())
    expect(screen.queryByRole('region', { name: POWER.label })).toBeNull()
    expect(screen.queryByRole('table', { name: POWER.caption })).toBeNull()
  })

  it('shows the unavailable line, without an alert, when the served table cannot be read', async () => {
    stubPower({ [POWER_URL]: 503 })
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await waitFor(() => expect(region.textContent).toContain('The power table is not available, so it is not drawn: stub 503 for /api/analytics/power'))
    expect(within(region).queryByRole('table')).toBeNull()
    expect(region.querySelector('[role=alert]')).toBeNull()
    expect(within(region).queryByRole('alert')).toBeNull()
  })

  it('treats a body that is not a power table as unavailable, without an alert', async () => {
    stubPower({}, { [POWER_URL]: { rows: 'none' } })
    mountScreen(<DeflatedPanel />)
    const region = await powerRegion()
    await waitFor(() => expect(region.textContent).toContain(`The power table is not available, so it is not drawn: ${POWER_SERVED.malformed}`))
    expect(within(region).queryByRole('table')).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('draws no power section when the Deflated Sharpe view cannot be read (SV3 keeps its own alert)', async () => {
    stubPower({ '/api/analytics/deflated': 503 })
    mountScreen(<DeflatedPanel />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/analytics/deflated')
    expect(screen.queryByRole('region', { name: POWER.label })).toBeNull()
  })

  it('finds the region when the served table arrives after the one second default wait (the flake of run 37691474042)', async () => {
    const slow = 1200
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url === POWER_URL ? POWER_TABLE_REAL : DEFLATED_REAL
      const reply = () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      return url === POWER_URL ? new Promise<Response>((resolve) => setTimeout(() => resolve(reply()), slow)) : Promise.resolve(reply())
    })
    mountScreen(<DeflatedPanel />)
    const started = Date.now()
    const region = await powerRegion()
    expect(Date.now() - started).toBeGreaterThanOrEqual(slow - 100)
    expect(within(region).getByRole('table', { name: POWER.caption })).toBeTruthy()
  })
})

describe('the served table equals the browser reference', () => {
  it('carries the same 21 trials and figures as powerView over the captured Deflated Sharpe view, to 1e-12', () => {
    const served = powerViewFromServed(POWER_TABLE_REAL)
    const reference = powerView(DEFLATED_REAL, FAMILY)
    expect(served.family).toEqual(reference.family)
    expect(served.alphaFamily).toBeCloseTo(reference.alphaFamily ?? Number.NaN, 15)
    expect(served.rows.map((r) => r.name)).toEqual(reference.rows.map((r) => r.name))
    const fields = ['years', 'sharpe', 'mdeNominal', 'mdeFamily', 'ratio', 'powerNominal', 'powerFamily'] as const
    for (const [index, row] of served.rows.entries()) {
      const want = reference.rows[index]!
      expect([row.kind, row.periods, row.n]).toEqual([want.kind, want.periods, want.n])
      for (const field of fields) {
        const got = row[field]
        const wanted = want[field]
        expect(got === null, `${row.name} ${field}`).toBe(wanted === null)
        if (got !== null && wanted !== null) expect(Math.abs(got - wanted), `${row.name} ${field}`).toBeLessThanOrEqual(1e-12 * Math.max(Math.abs(wanted), 1e-300) + 1e-15)
      }
    }
  })

  it('maps a missing figure to null and keeps the order of the served rows', () => {
    const row = { ...POWER_TABLE_REAL.rows[7]!, name: 'last', mde_family: null, ratio: null, power_family: null }
    const view = powerViewFromServed({ ...POWER_TABLE_REAL, alpha_family: null, rows: [row, POWER_TABLE_REAL.rows[0]!] })
    expect(view.alphaFamily).toBeNull()
    expect(view.rows.map((r) => r.name)).toEqual(['last', POWER_TABLE_REAL.rows[0]!.name])
    expect([view.rows[0]!.mdeFamily, view.rows[0]!.ratio, view.rows[0]!.powerFamily]).toEqual([null, null, null])
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
    stubPower()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    await powerTable()
    const numbers = numberedItems(PANEL_ID).map((i) => i.n)
    expect(numbers.filter((n) => n < MT_FIRST_CHROME_NUMBER)).toEqual(Array.from({ length: MULTIPLE_TESTING.k }, (_, i) => i + 1))
  })

  it('puts the power region under SV3 in the MT panel and raises no alert', async () => {
    stubPower()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const power = await powerRegion()
    const deflated = await screen.findByRole('region', { name: DEFLATED.label })
    expect(deflated.compareDocumentPosition(power) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})
