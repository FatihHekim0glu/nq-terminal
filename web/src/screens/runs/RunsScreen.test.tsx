// @vitest-environment jsdom
// RUNS (TASKS 6.3, UI_SPEC section 7 "RUNS and RUN", look spec 7.4): every run from GET /api/runs
// with its badges, Sharpe and max drawdown from GET /api/runs/stats (Basis B, the tear sheet's own
// series, every readable run in one request), the sub-tabs 85) to 89), a strategy filter, and Enter opening RUN for the row.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/types'
import type { LineStackProps } from '../../charts/LineStack.types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { captureDownloads } from '../../chrome/download.testUtil'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { activateNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import RunsScreen from './RunsScreen'
import { COMPARE_STATS, RUNS } from './runs.fixtures'
import { TEST_PANEL, mountScreen, stubApi } from './testing'

const charts = vi.hoisted(() => ({ props: [] as LineStackProps[] }))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => {
    charts.props.push(props)
    return <div data-testid="linestack" />
  },
}))

const PARAMS = { code: 'RUNS', context: null, args: {}, group: '-' } as const
const ROUTES = {
  '/api/runs': RUNS,
  '/api/runs/stats': COMPARE_STATS,
}

beforeAll(() => stubLayout(600))
beforeEach(() => {
  charts.props = []
})
afterEach(() => {
  cleanup()
  resetNumbered()
  resetMessage()
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

// The compare basket (roadmap 9): Space marks up to eight rows, 95) Compare opens 90) Compare n, 97) Settings
// includes probes or clears the basket. Marking only changes what the screen keeps; the compare view is the
// one GET on /api/runs/compare.
const DTS = 'nt_dtsmom_v0_fixture_ts1'
const VOL = 'nt_volmanaged_v0_fixture_m1'
const UNBALANCED = 'nt_za_v0_fixture_unbalanced'
const PROBE = 'nt_probe_v0_fixture_p1'
const PROBE_RUN: Schemas['RunSummary'] = { ...(RUNS[0] as Schemas['RunSummary']), run_id: PROBE, is_probe: true }

function comparison(ids: string[]): Schemas['RunComparison'] {
  return {
    t: [1_000_000, 1_086_400],
    date: ['2020-01-01', '2020-01-02'],
    series: ids.map((id, i) => ({ run_id: id, is_probe: id === PROBE, usable: true, source: 'mtm_snapshots' as const, rebased: [1, 1 + 0.001 * (i + 1)] })),
    stats: ids.map((id) => COMPARE_STATS.find((s) => s.run_id === id) ?? { ...(COMPARE_STATS[0] as Schemas['CompareStats']), run_id: id }),
  }
}

/** Answers /api/runs/compare for whatever ids are asked, so a test can change the basket freely. */
function compareRoutes(runs: Schemas['RunSummary'][] = RUNS) {
  const stats = runs.map((r) => COMPARE_STATS.find((s) => s.run_id === r.run_id) ?? { ...(COMPARE_STATS[0] as Schemas['CompareStats']), run_id: r.run_id })
  return { '/api/runs': runs, '/api/runs/stats': stats, '/api/runs/compare': comparison([DTS, VOL]) }
}

async function mountWith(runs: Schemas['RunSummary'][] = RUNS, group: 'A' | '-' = '-') {
  const routes = compareRoutes(runs)
  const seen = stubApi(routes)
  mountScreen(<RunsScreen params={{ ...PARAMS, group }} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Nautilus runs/ })
  await waitFor(() => expect(within(grid).getByText(runs[0]?.run_id ?? '')).toBeTruthy())
  return { seen, grid }
}

/** Space on a row, as the keyboard does it: the row becomes the active one, then the grid hears the key. */
function mark(grid: HTMLElement, runId: string) {
  fireEvent.mouseDown(within(grid).getByText(runId))
  fireEvent.keyDown(grid, { key: ' ' })
}

const bar = (name: RegExp) => screen.getByRole('button', { name })
const compareTab = () => screen.queryByRole('tab', { name: /^90\) Compare/ })
const compareAsks = (seen: Array<{ url: string }>) => seen.filter((r) => r.url.startsWith('/api/runs/compare')).map((r) => r.url)

async function openSettings(entry: string) {
  fireEvent.click(bar(/^97\) Settings/))
  fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: entry }))
}

describe('RUNS: the compare basket', () => {
  it('shows 95) Compare disabled and no compare tab until something is marked', async () => {
    await mountWith()
    expect(bar(/^95\) Compare$/).getAttribute('aria-disabled')).toBe('true')
    expect(compareTab()).toBeNull()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['85) All', '86) Ledgered', '87) Anchors', '88) Probes', '89) Unusable'])
  })

  it('Space on two rows enables 95) Compare 2 and adds the 90) Compare 2 tab; one row is not enough', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    expect(bar(/^95\) Compare 1$/).getAttribute('aria-disabled')).toBe('true')
    expect(compareTab()?.textContent).toBe('90) Compare 1')
    mark(grid, VOL)
    expect(bar(/^95\) Compare 2$/).getAttribute('aria-disabled')).toBeNull()
    expect(compareTab()?.textContent).toBe('90) Compare 2')
    expect(within(grid).getAllByText('marked')).toHaveLength(2)
  })

  it('Space on a marked row unmarks it', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, DTS)
    expect(compareTab()).toBeNull()
    expect(within(grid).queryByText('marked')).toBeNull()
  })

  it('makes no request for marking', async () => {
    const { seen, grid } = await mountWith()
    const before = seen.length
    mark(grid, DTS)
    mark(grid, VOL)
    expect(seen.length).toBe(before)
  })

  it('95 selects 90) Compare 2, asks GET /api/runs/compare?ids=a%2Cb in marking order, and draws compare1 and compare2', async () => {
    const { seen, grid } = await mountWith()
    mark(grid, VOL)
    mark(grid, DTS)
    fireEvent.click(bar(/^95\) Compare 2$/))
    await screen.findByTestId('linestack')
    expect(screen.getByRole('tab', { name: '90) Compare 2' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-label')).toBe('90) Compare 2')
    expect(compareAsks(seen)).toEqual([`/api/runs/compare?ids=${VOL}%2C${DTS}`])
    expect(seen.filter((r) => r.url.startsWith('/api/runs/compare')).every((r) => r.method === 'GET')).toBe(true)
    const props = charts.props.at(-1) as LineStackProps
    expect(props.panes[0]?.series.map((s) => s.style)).toEqual(['compare1', 'compare2'])
    expect(props.title).toBe('Rebased equity of 2 runs')
  })

  it('Number <GO> 95 opens the compare view too', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, VOL)
    act(() => {
      expect(activateNumbered(TEST_PANEL, 95)).toBe(true)
    })
    await screen.findByTestId('linestack')
    expect(screen.getByRole('tab', { name: '90) Compare 2' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens the compare view from its tab as well, and the sub-tabs return to the table', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, VOL)
    fireEvent.click(screen.getByRole('tab', { name: '90) Compare 2' }))
    await screen.findByTestId('linestack')
    fireEvent.click(screen.getByRole('tab', { name: '85) All' }))
    expect(await screen.findByRole('grid', { name: /Nautilus runs/ })).toBeTruthy()
    // The basket survives leaving the compare view.
    expect(compareTab()?.textContent).toBe('90) Compare 2')
  })

  it('keeps the marked rows marked when the reader comes back to the table', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 2$/))
    await screen.findByTestId('linestack')
    fireEvent.click(screen.getByRole('tab', { name: '85) All' }))
    const back = await screen.findByRole('grid', { name: /Nautilus runs/ })
    expect(within(back).getAllByText('marked')).toHaveLength(2)
  })

  it('leaves the unbalanced run out of the request and lists it under Not drawn', async () => {
    const { seen, grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, UNBALANCED)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 3$/))
    await screen.findByTestId('linestack')
    expect(compareAsks(seen)).toEqual([`/api/runs/compare?ids=${DTS}%2C${VOL}`])
    expect(within(screen.getByRole('list', { name: 'Not drawn' })).getByText(`${UNBALANCED}: [UNUSABLE: BALANCE]`)).toBeTruthy()
  })

  it('leaves a probe out until 97) Settings includes probes, then asks again with it', async () => {
    const { seen, grid } = await mountWith([...RUNS, PROBE_RUN])
    mark(grid, DTS)
    mark(grid, PROBE)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 3$/))
    await screen.findByTestId('linestack')
    expect(compareAsks(seen)).toEqual([`/api/runs/compare?ids=${DTS}%2C${VOL}`])
    expect(within(screen.getByRole('list', { name: 'Not drawn' })).getByText(`${PROBE}: [PROBE: never a result]`)).toBeTruthy()
    await openSettings('Include probes')
    await waitFor(() => expect(compareAsks(seen)).toEqual([`/api/runs/compare?ids=${DTS}%2C${VOL}`, `/api/runs/compare?ids=${DTS}%2C${PROBE}%2C${VOL}`]))
    expect(screen.queryByRole('list', { name: 'Not drawn' })).toBeNull()
    // The same entry now takes them out again.
    fireEvent.click(bar(/^97\) Settings/))
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Leave probes out' })).toBeTruthy()
  })

  it('97) Settings, Clear the basket, empties it and returns from the compare view to 85) All', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 2$/))
    await screen.findByTestId('linestack')
    await openSettings('Clear the basket')
    expect(await screen.findByRole('grid', { name: /Nautilus runs/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '85) All' }).getAttribute('aria-selected')).toBe('true')
    expect(compareTab()).toBeNull()
    expect(bar(/^95\) Compare$/).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('tabpanel').getAttribute('aria-label')).toBe('85) All')
    expect(screen.queryByText('marked')).toBeNull()
  })

  it('unmarking the last runs while the compare view is open also returns to 85) All', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 2$/))
    await screen.findByTestId('linestack')
    fireEvent.click(screen.getByRole('tab', { name: '85) All' }))
    const back = await screen.findByRole('grid', { name: /Nautilus runs/ })
    mark(back, DTS)
    mark(back, VOL)
    expect(compareTab()).toBeNull()
    expect(screen.getByRole('tab', { name: '85) All' }).getAttribute('aria-selected')).toBe('true')
  })

  it('refuses a ninth run with a message and keeps the eight', async () => {
    const many: Schemas['RunSummary'][] = Array.from({ length: 9 }, (_, i) => ({ ...(RUNS[0] as Schemas['RunSummary']), run_id: `nt_many_${i + 1}` }))
    const { grid } = await mountWith(many)
    for (const run of many) mark(grid, run.run_id)
    expect(useMessage.getState().text).toBe('The basket holds 8 runs at most: unmark one first.')
    expect(useMessage.getState().tone).toBe('error')
    expect(bar(/^95\) Compare 8$/)).toBeTruthy()
    expect(within(grid).getAllByText('marked')).toHaveLength(8)
  })

  it('shows the note with its tag and no alert for a good comparison', async () => {
    const { grid } = await mountWith()
    mark(grid, DTS)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 2$/))
    await screen.findByTestId('linestack')
    expect(screen.getByText(/^\[POST HOC\] Basis B: account equity over the starting balance K/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('passes the panel link group to the compare chart', async () => {
    const { grid } = await mountWith(RUNS, 'A')
    mark(grid, DTS)
    mark(grid, VOL)
    fireEvent.click(bar(/^95\) Compare 2$/))
    await screen.findByTestId('linestack')
    expect((charts.props.at(-1) as LineStackProps).link).toBe('A')
  })
})
