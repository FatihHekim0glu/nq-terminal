// @vitest-environment jsdom
// The RUNS compare view (roadmap 9, phase A): the marked runs on one axis, rebased on Basis B, from
// GET /api/runs/compare, with the served stats beside the chart. Probes, unbalanced, unusable and unknown
// runs are listed as not drawn. The chart is a stand-in here (its own tests are in charts/).
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/types'
import { connectionStore, DOWN_AFTER, INITIAL_CONNECTION, resetConnection } from '../../api/connection'
import type { LineStackProps } from '../../charts/LineStack.types'
import { resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import RunsCompare from './RunsCompare'
import { COMPARE_STATS, RUNS } from './runs.fixtures'
import { mountScreen, stubApi } from './testing'

const charts = vi.hoisted(() => ({ props: [] as LineStackProps[] }))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => {
    charts.props.push(props)
    return <div data-testid="linestack" />
  },
}))

type Comparison = Schemas['RunComparison']

const DTS = 'nt_dtsmom_v0_fixture_ts1'
const VOL = 'nt_volmanaged_v0_fixture_m1'
const OVERNIGHT = 'nt_overnight_v0_fixture_open'
const UNBALANCED = 'nt_za_v0_fixture_unbalanced'
const PROBE = 'nt_probe_v0_fixture_p1'

const PROBE_RUN: Schemas['RunSummary'] = { ...(RUNS[0] as Schemas['RunSummary']), run_id: PROBE, is_probe: true }
const ALL_RUNS = [...RUNS, PROBE_RUN]

function bodyOf(ids: string[], patch: Partial<Comparison> = {}): Comparison {
  return {
    t: [1_000_000, 1_086_400, 1_172_800],
    date: ['2020-01-01', '2020-01-02', '2020-01-03'],
    series: ids.map((id, i) => ({
      run_id: id, is_probe: id === PROBE, usable: true,
      source: i === 0 ? 'mtm_snapshots' : 'realised_trades', rebased: [1, 1 + 0.001 * (i + 1), null],
    })),
    stats: ids.map((id) => COMPARE_STATS.find((s) => s.run_id === id) ?? { ...(COMPARE_STATS[0] as Schemas['CompareStats']), run_id: id }),
    ...patch,
  }
}

function mount(ids: string[], options: { includeProbes?: boolean; routes?: Record<string, unknown> } = {}) {
  const seen = stubApi(options.routes ?? { '/api/runs/compare': bodyOf(ids.filter((id) => id !== UNBALANCED && id !== PROBE)) })
  mountScreen(<RunsCompare ids={ids} runs={ALL_RUNS} includeProbes={options.includeProbes ?? false} link="B" />)
  return seen
}

const compareRequests = (seen: Array<{ url: string }>) => seen.filter((r) => r.url.startsWith('/api/runs/compare'))

beforeAll(() => stubLayout(600))
beforeEach(() => {
  charts.props = []
})
afterEach(() => {
  cleanup()
  resetNumbered()
  resetConnection()
})

/** The connection store down, as chrome/PanelFault.test.tsx puts it. */
function goDown(): void {
  connectionStore.setState({ ...INITIAL_CONNECTION, status: 'down', failures: DOWN_AFTER, downSince: Date.now(), lastCheckAt: Date.now() }, true)
}

describe('RunsCompare: the chart', () => {
  it('asks for the drawn ids in basket order with one GET, and draws them as compare lines', async () => {
    const seen = mount([VOL, DTS])
    await screen.findByTestId('linestack')
    const asked = compareRequests(seen)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toEqual({ url: `/api/runs/compare?ids=${VOL}%2C${DTS}`, method: 'GET' })
    const props = charts.props.at(-1) as LineStackProps
    expect(props.title).toBe('Rebased equity of 2 runs')
    expect(props.link).toBe('B')
    expect(props.t).toEqual([1_000_000, 1_086_400, 1_172_800])
    expect(props.panes).toHaveLength(1)
    expect(props.panes[0]?.series.map((s) => [s.name, s.style])).toEqual([
      [`${VOL} (marked to market)`, 'compare1'],
      [`${DTS} (realised trades)`, 'compare2'],
    ])
  })

  it('states the basis and the tag, and that no test is run on runs the reader picked', async () => {
    mount([VOL, DTS])
    await screen.findByTestId('linestack')
    const note = screen.getByText(/Basis B: account equity over the starting balance K, rebased to 1.0/)
    expect(note.textContent).toMatch(/^\[POST HOC\]/)
    expect(note.textContent).toMatch(/no test and no p value/)
  })

  it('shows a pending status with aria-busy until the comparison arrives, and no alert', async () => {
    mount([VOL, DTS])
    const pending = screen.getByRole('status')
    expect(pending.getAttribute('aria-busy')).toBe('true')
    expect(pending.textContent).toBe('Reading the comparison.')
    await screen.findByTestId('linestack')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('announces a failed read as an alert with the reason, and a Retry that asks again', async () => {
    const seen = mount([VOL, DTS], { routes: { '/api/runs/compare': { status: 503, body: { detail: 'result.json is no longer on disk' } } } })
    const alert = await screen.findByRole('alert')
    // The wording is the alert's own text; the Retry button sits inside it.
    expect(alert.firstChild?.textContent).toBe('The comparison could not be read: result.json is no longer on disk')
    expect(screen.queryByTestId('linestack')).toBeNull()
    expect(compareRequests(seen)).toHaveLength(1)
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry this request' }))
    await waitFor(() => expect(compareRequests(seen)).toHaveLength(2))
    expect(compareRequests(seen)[1]).toEqual({ url: `/api/runs/compare?ids=${VOL}%2C${DTS}`, method: 'GET' })
  })

  // Backend-down acceptance (roadmap #7): the connection strip owns the outage alert, so the view
  // shows a waiting status and never stacks a second role=alert under it.
  it('waits for the backend, with no alert and no chart, when the comparison answers 502 while the connection is down', async () => {
    goDown()
    mount([VOL, DTS], { routes: { '/api/runs/compare': { status: 502, body: { detail: 'Bad Gateway' } } } })
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Waiting for the backend: GET /api/runs/compare answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('linestack')).toBeNull()
  })

  it('says it is waiting to load, not busy, while the connection is down and the comparison is pending', () => {
    goDown()
    mount([VOL, DTS])
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Waiting for the backend before loading.')
    expect(status.hasAttribute('aria-busy')).toBe(false)
  })

  it('says why a run the API marks unusable is not drawn, and draws the rest', async () => {
    const body = bodyOf([VOL, DTS])
    const series = body.series.map((s) => (s.run_id === DTS ? { ...s, usable: false, rebased: [null, null, null] } : s))
    mount([VOL, DTS], { routes: { '/api/runs/compare': { ...body, series } } })
    await screen.findByTestId('linestack')
    const props = charts.props.at(-1) as LineStackProps
    expect(props.panes[0]?.series.map((s) => s.name)).toEqual([`${VOL} (marked to market)`])
    expect(props.title).toBe('Rebased equity of 1 run')
    const list = screen.getByRole('list', { name: 'Not drawn' })
    expect(within(list).getByText(`${DTS}: [UNUSABLE]`)).toBeTruthy()
  })
})

describe('RunsCompare: a body with nothing to draw', () => {
  it('says to mark two usable runs when the API marks every series unusable, and lists them all', async () => {
    const body = bodyOf([VOL, DTS])
    const series = body.series.map((s) => ({ ...s, usable: false, rebased: [null, null, null] }))
    mount([VOL, DTS], { routes: { '/api/runs/compare': { ...body, series } } })
    expect((await screen.findByText(/^Mark at least two usable runs/)).getAttribute('role')).toBe('status')
    expect(screen.queryByTestId('linestack')).toBeNull()
    const list = screen.getByRole('list', { name: 'Not drawn' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([`${VOL}: [UNUSABLE]`, `${DTS}: [UNUSABLE]`])
  })
})

describe('RunsCompare: fewer than two runs to draw', () => {
  it('asks for nothing and says to mark two usable runs when the basket holds one', () => {
    const seen = mount([DTS])
    expect(screen.getByRole('status').textContent).toBe('Mark at least two usable runs with Space to compare them.')
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBeNull()
    expect(compareRequests(seen)).toEqual([])
    expect(screen.queryByTestId('linestack')).toBeNull()
  })

  it('needs two after the unbalanced run is set aside, lists it, and still asks for nothing', () => {
    const seen = mount([DTS, UNBALANCED])
    expect(screen.getByRole('status').textContent).toMatch(/^Mark at least two usable runs/)
    expect(within(screen.getByRole('list', { name: 'Not drawn' })).getByText(`${UNBALANCED}: [UNUSABLE: BALANCE]`)).toBeTruthy()
    expect(compareRequests(seen)).toEqual([])
  })

  it('reads an empty basket the same way', () => {
    const seen = mount([])
    expect(screen.getByRole('status').textContent).toMatch(/^Mark at least two usable runs/)
    expect(screen.queryByRole('list', { name: 'Not drawn' })).toBeNull()
    expect(compareRequests(seen)).toEqual([])
  })
})

describe('RunsCompare: what is left out of the drawing', () => {
  it('leaves the unbalanced run out of the request and lists it with its tag', async () => {
    const seen = mount([DTS, UNBALANCED, VOL])
    await screen.findByTestId('linestack')
    expect(compareRequests(seen)[0]?.url).toBe(`/api/runs/compare?ids=${DTS}%2C${VOL}`)
    expect(within(screen.getByRole('list', { name: 'Not drawn' })).getByText(`${UNBALANCED}: [UNUSABLE: BALANCE]`)).toBeTruthy()
  })

  it('leaves a probe out by default, tagged, and draws it once probes are included', async () => {
    const seen = mount([DTS, PROBE, VOL])
    await screen.findByTestId('linestack')
    expect(compareRequests(seen)[0]?.url).toBe(`/api/runs/compare?ids=${DTS}%2C${VOL}`)
    expect(within(screen.getByRole('list', { name: 'Not drawn' })).getByText(`${PROBE}: [PROBE: never a result]`)).toBeTruthy()
    cleanup()
    charts.props = []
    const withProbe = mount([DTS, PROBE, VOL], { includeProbes: true, routes: { '/api/runs/compare': bodyOf([DTS, PROBE, VOL]) } })
    await screen.findByTestId('linestack')
    expect(compareRequests(withProbe)[0]?.url).toBe(`/api/runs/compare?ids=${DTS}%2C${PROBE}%2C${VOL}`)
    expect(screen.queryByRole('list', { name: 'Not drawn' })).toBeNull()
  })

  it('lists an id the run list does not hold as unknown', () => {
    mount([DTS, 'nt_gone'])
    expect(within(screen.getByRole('list', { name: 'Not drawn' })).getByText('nt_gone: not in the run list')).toBeTruthy()
  })
})

describe('RunsCompare: the served statistics', () => {
  it('shows the served numbers formatted as RUNS shows them, in a grid without row numbers', async () => {
    mount([DTS, VOL])
    const grid = await screen.findByRole('grid', { name: 'Served statistics of the compared runs' })
    const columns = within(grid).getAllByRole('columnheader').map((h) => h.textContent)
    expect(columns).toEqual(['Run', 'Source', 'Total return', 'Sharpe', 'Max DD', 'Trades', 'Fees', 'Note'])
    const row = (id: string) => within(grid).getByText(id).closest('tr') as HTMLElement
    const dts = within(row(DTS)).getAllByRole('gridcell').map((c) => c.textContent)
    expect(dts).toEqual([DTS, 'marked to market', '0.06%', '8.34', '-0.01%', '5', '881.25', '--'])
    const vol = within(row(VOL)).getAllByRole('gridcell').map((c) => c.textContent)
    expect(vol).toEqual([VOL, 'realised trades', '-0.36%', '-5.82', '-0.36%', '4', '108.78', '--'])
  })

  it('marks Sharpe by sign in text and tone, not by colour alone', async () => {
    mount([DTS, VOL])
    const grid = await screen.findByRole('grid', { name: 'Served statistics of the compared runs' })
    expect(within(grid).getByText('8.34').className).toContain('up')
    expect(within(grid).getByText('-5.82').className).toContain('down')
  })

  it('shows the served note of a run with no numbers, and dashes for its missing values', async () => {
    const body = bodyOf([DTS, OVERNIGHT])
    const note = 'balance check failed: the run is unusable (rule 4)'
    const stats = [body.stats[0] as Schemas['CompareStats'], { ...(body.stats[1] as Schemas['CompareStats']), total_return: null, sharpe: null, max_drawdown: null, stats_note: note }]
    mount([DTS, OVERNIGHT], { routes: { '/api/runs/compare': { ...body, stats } } })
    const grid = await screen.findByRole('grid', { name: 'Served statistics of the compared runs' })
    const cells = within(within(grid).getByText(OVERNIGHT).closest('tr') as HTMLElement).getAllByRole('gridcell').map((c) => c.textContent)
    expect(cells).toEqual([OVERNIGHT, 'realised trades', '--', '--', '--', '4', '17.92', note])
  })

  it('adds no pass or fail and no p value of its own', async () => {
    mount([DTS, VOL])
    await screen.findByRole('grid', { name: 'Served statistics of the compared runs' })
    expect(document.body.textContent).not.toMatch(/\[PASS\]|\[FAIL\]|significan|\bp\s*[<=]/i)
  })
})
