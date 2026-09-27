// @vitest-environment jsdom
// RUNS (TASKS 6.3, UI_SPEC section 7 "RUNS and RUN", look spec 7.4): every run from GET /api/runs
// with its badges, Sharpe and max drawdown from GET /api/runs/stats (Basis B, the tear sheet's own
// series, every readable run in one request), the sub-tabs 85) to 89), a strategy filter, and Enter opening RUN for the row.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { captureDownloads } from '../../chrome/download.testUtil'
import { useMessage } from '../../chrome/MessageLine.store'
import { activateNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import RunsScreen from './RunsScreen'
import { COMPARE_STATS, RUNS } from './runs.fixtures'
import { TEST_PANEL, mountScreen, stubApi } from './testing'

const PARAMS = { code: 'RUNS', context: null, args: {}, group: '-' } as const
const ROUTES = {
  '/api/runs': RUNS,
  '/api/runs/stats': COMPARE_STATS,
}

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
})

async function mountRuns() {
  const seen = stubApi(ROUTES)
  mountScreen(<RunsScreen params={PARAMS} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Nautilus runs/ })
  await waitFor(() => expect(within(grid).getByText('8.34')).toBeTruthy())
  return { seen, grid }
}

function rowOf(grid: HTMLElement, runId: string): HTMLElement {
  const cell = within(grid).getByText(runId)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${runId}`)
  return row
}

describe('RUNS: the Nautilus runs table', () => {
  it('lists every run from the API with its strategy, trades and net P&L', async () => {
    const { grid } = await mountRuns()
    for (const run of RUNS) expect(within(grid).getByText(run.run_id)).toBeTruthy()
    const dts = rowOf(grid, 'nt_dtsmom_v0_fixture_ts1')
    expect(within(dts).getByText('dtsmom')).toBeTruthy()
    expect(within(dts).getByText('+60,658.13')).toBeTruthy()
    expect(within(dts).getByText('881.25')).toBeTruthy()
  })

  it('shows Sharpe and max drawdown equal to the compare stats, and -- for an unusable run', async () => {
    const { grid } = await mountRuns()
    expect(within(rowOf(grid, 'nt_dtsmom_v0_fixture_ts1')).getByText('-0.01%')).toBeTruthy()
    expect(within(rowOf(grid, 'nt_volmanaged_v0_fixture_m1')).getByText('-5.82')).toBeTruthy()
    expect(within(rowOf(grid, 'nt_volmanaged_v0_fixture_m1')).getByText('-0.36%')).toBeTruthy()
    const unbalanced = rowOf(grid, 'nt_za_v0_fixture_unbalanced')
    expect(within(unbalanced).getAllByText('--').length).toBeGreaterThanOrEqual(2)
  })

  it('renders the badges: balance as text, [UNUSABLE: BALANCE], [LEDGERED], MTM and coverage', async () => {
    const { grid } = await mountRuns()
    const unbalanced = rowOf(grid, 'nt_za_v0_fixture_unbalanced')
    expect(within(unbalanced).getByText('[FAIL]')).toBeTruthy()
    expect(within(unbalanced).getByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    const overnight = rowOf(grid, 'nt_overnight_v0_fixture_open')
    expect(within(overnight).getByText('[LEDGERED]')).toBeTruthy()
    expect(within(overnight).getByText('[OK]')).toBeTruthy()
    const dts = rowOf(grid, 'nt_dtsmom_v0_fixture_ts1')
    expect(within(dts).getAllByText('ok')).toHaveLength(2)
  })

  it('exposes the sub-tabs as controlling one tabpanel that holds the grid (WCAG 1.3.1, 4.1.2)', async () => {
    const { grid } = await mountRuns()
    const tabs = screen.getAllByRole('tab')
    const ids = new Set(tabs.map((t) => t.getAttribute('aria-controls')))
    expect(ids.size).toBe(1)
    const panel = document.getElementById([...ids][0] ?? '')
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.contains(grid)).toBe(true)
    expect(panel?.getAttribute('aria-label')).toBe('85) All')
  })

  it('announces a failed load as an alert, not a polite status', async () => {
    stubApi({})
    mountScreen(<RunsScreen params={PARAMS} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/no route/)
  })

  it('shows max drawdown with the sign the tear sheet uses (a fall is negative), from the positive API depth', async () => {
    const { grid } = await mountRuns()
    // CompareStats.max_drawdown for the dtsmom run is 0.000103 (a depth); EQ, DD and RUN show -0.01%.
    expect(within(rowOf(grid, 'nt_dtsmom_v0_fixture_ts1')).getByText('-0.01%')).toBeTruthy()
  })

  it('states the basis of Sharpe and max drawdown', async () => {
    await mountRuns()
    expect(screen.getByText(/Sharpe and max drawdown: Basis B/)).toBeTruthy()
  })

  it('filters by sub-tab: 89) Unusable keeps only the unbalanced run', async () => {
    const { grid } = await mountRuns()
    fireEvent.click(screen.getByRole('tab', { name: '89) Unusable' }))
    await waitFor(() => expect(within(grid).queryByText('nt_dtsmom_v0_fixture_ts1')).toBeNull())
    expect(within(grid).getByText('nt_za_v0_fixture_unbalanced')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '86) Ledgered' }))
    await waitFor(() => expect(within(grid).getByText('nt_overnight_v0_fixture_open')).toBeTruthy())
    expect(within(grid).queryByText('nt_za_v0_fixture_unbalanced')).toBeNull()
  })

  it('filters by strategy through the amber filter field', async () => {
    const { grid } = await mountRuns()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter runs' }), { target: { value: 'volmanaged' } })
    await waitFor(() => expect(within(grid).queryByText('nt_dtsmom_v0_fixture_ts1')).toBeNull())
    expect(within(grid).getByText('nt_volmanaged_v0_fixture_m1')).toBeTruthy()
  })

  it('opens RUN for a row through the command line (Number <GO> 1 is the first row)', async () => {
    await mountRuns()
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    act(() => {
      expect(activateNumbered(TEST_PANEL, 1)).toBe(true)
    })
    off()
    expect(lines).toEqual([{ line: `${RUNS[0]?.run_id} RUN`, newPanel: false }])
  })

  it('only ever issues GETs, to /api/runs and /api/runs/stats', async () => {
    const { seen } = await mountRuns()
    expect(seen.every((r) => r.method === 'GET')).toBe(true)
    expect(new Set(seen.map((r) => r.url.split('?')[0]))).toEqual(new Set(['/api/runs', '/api/runs/stats']))
    const stats = seen.filter((r) => r.url.startsWith('/api/runs/stats'))
    expect(stats).toHaveLength(1)
    const ids = decodeURIComponent(stats[0]?.url.split('ids=')[1] ?? '').split(',')
    expect(ids).toEqual(RUNS.map((r) => r.run_id))
  })

  it('against a backend without /api/runs/stats (404), reads the same stats from /api/runs/compare', async () => {
    const seen = stubApi({
      '/api/runs': RUNS,
      '/api/runs/stats': { status: 404, body: { detail: 'unknown run id' } },
      '/api/runs/compare': { t: [], date: [], series: [], stats: COMPARE_STATS },
    })
    mountScreen(<RunsScreen params={PARAMS} context={null} />)
    const grid = await screen.findByRole('grid', { name: /Nautilus runs/ })
    await waitFor(() => expect(within(grid).getByText('8.34')).toBeTruthy())
    const compare = seen.filter((r) => r.url.startsWith('/api/runs/compare'))
    expect(compare.length).toBeGreaterThan(0)
    for (const r of compare) {
      const n = decodeURIComponent(r.url.split('ids=')[1] ?? '').split(',').length
      expect(n >= 2 && n <= 8).toBe(true)
    }
  })

  it('98) Export saves the shown rows as CSV, Sharpe and max drawdown included, with no request', async () => {
    const { seen } = await mountRuns()
    const before = seen.length
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const text = await saved.text('runs_all.csv')
      const lines = text.split('\r\n')
      expect(lines[0]).toContain('Run id,Strategy')
      expect(lines[0]).toContain('Sharpe (B)')
      const probes = RUNS
      expect(lines).toHaveLength(probes.length + 1)
      expect(lines.slice(1).map((l) => l.split(',')[0])).toEqual(probes.map((r) => r.run_id))
      expect(useMessage.getState().text).toBe(`Saved ${probes.length} ${probes.length === 1 ? 'row' : 'rows'} as runs_all.csv.`)
      expect(seen.length).toBe(before)
    } finally {
      saved.restore()
    }
  })

  it('says why when the runs cannot be read', async () => {
    stubApi({ '/api/runs': { status: 503, body: { detail: 'result.json is no longer on disk' } } })
    mountScreen(<RunsScreen params={PARAMS} context={null} />)
    expect(await screen.findByText(/result.json is no longer on disk/)).toBeTruthy()
  })
})
