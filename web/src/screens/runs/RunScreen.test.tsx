// @vitest-environment jsdom
// RUN (TASKS 6.3, UI_SPEC section 7 "RUNS and RUN", look spec 7.4): the run inspector. Header strip
// (BalanceCheck, MTM, coverage, anchor), the exact ledger copy command, equity and underwater on
// Basis B from the API with no line at all for an unusable run, and the tabs over trades, fills and
// the strategy log sections.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureDownloads } from '../../chrome/download.testUtil'
import { useMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import type { LineStackProps } from '../../charts/LineStack.types'
import { stubLayout } from '../../grids/testing'
import RunScreen from './RunScreen'
import { RUN } from '../../copy/runs'
import {
  DECISIONS_DTSMOM,
  DETAIL_DTSMOM,
  DETAIL_OVERNIGHT,
  DETAIL_UNBALANCED,
  FILLS_DTSMOM,
  NOTES_DTSMOM,
  PANEL_DTSMOM,
  ROLLS_DTSMOM,
  TRADES_DTSMOM,
} from './runs.fixtures'
import { mountScreen, stubApi, type Routes } from './testing'

const charts = vi.hoisted(() => ({ props: [] as LineStackProps[] }))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => {
    charts.props.push(props)
    return <div data-testid="linestack" />
  },
}))

const DTS = 'nt_dtsmom_v0_fixture_ts1'
const UNBALANCED = 'nt_za_v0_fixture_unbalanced'
const OVERNIGHT = 'nt_overnight_v0_fixture_open'

const DTS_ROUTES: Routes = {
  [`/api/runs/${DTS}`]: DETAIL_DTSMOM,
  [`/api/analytics/run/${DTS}/panel`]: PANEL_DTSMOM,
  [`/api/runs/${DTS}/trades`]: TRADES_DTSMOM,
  [`/api/runs/${DTS}/fills`]: FILLS_DTSMOM,
  [`/api/runs/${DTS}/log/rolls`]: ROLLS_DTSMOM,
  [`/api/runs/${DTS}/log/decisions`]: DECISIONS_DTSMOM,
  [`/api/runs/${DTS}/log/notes`]: NOTES_DTSMOM,
}

function mountRun(runId: string, routes: Routes) {
  const seen = stubApi(routes)
  const context = { kind: 'run', value: runId } as const
  mountScreen(<RunScreen params={{ code: 'RUN', context, args: {}, group: 'B' }} context={context} />)
  return seen
}

beforeAll(() => stubLayout(600))
beforeEach(() => {
  charts.props = []
})
afterEach(() => {
  cleanup()
  resetNumbered()
})

describe('RUN: an unusable run', () => {
  it('shows [UNUSABLE: BALANCE] and draws no equity line, without asking for the series', async () => {
    const seen = mountRun(UNBALANCED, { [`/api/runs/${UNBALANCED}`]: DETAIL_UNBALANCED })
    await waitFor(() => expect(screen.getAllByText('[UNUSABLE: BALANCE]').length).toBeGreaterThan(0))
    expect(screen.getByText(/equity is not drawn/i)).toBeTruthy()
    expect(screen.queryByTestId('linestack')).toBeNull()
    expect(charts.props).toEqual([])
    expect(seen.some((r) => r.url.includes('/panel') || r.url.includes('/equity'))).toBe(false)
    expect(screen.getByTestId('balance-summary').textContent).toContain('[FAIL]')
    expect(screen.getByTestId('balance-summary').textContent).toContain('diff 12.34 USD')
  })

  it('lists why the ledger command is not offered', async () => {
    mountRun(UNBALANCED, { [`/api/runs/${UNBALANCED}`]: DETAIL_UNBALANCED })
    expect(await screen.findByText(/balance check failed: the run is unusable \(rule 4\)/)).toBeTruthy()
    expect(screen.queryByTestId('ledger-command')).toBeNull()
  })
})

describe('RUN: tabs and failures for assistive technology', () => {
  it('exposes every tab as controlling the tabpanel that holds the selected tab body (WCAG 1.3.1, 4.1.2)', async () => {
    mountRun(DTS, DTS_ROUTES)
    await waitFor(() => expect(charts.props.length).toBeGreaterThan(0))
    const tabs = screen.getAllByRole('tab')
    const ids = new Set(tabs.map((t) => t.getAttribute('aria-controls')))
    expect(ids.size).toBe(1)
    const panel = document.getElementById([...ids][0] ?? '')
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-label')).toBe('1) Chart')
    expect(panel?.querySelector('[data-testid="linestack"]')).not.toBeNull()
  })

  it('announces a failed load as an alert, not a polite status', async () => {
    mountRun('nt_missing', {})
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/nt_missing/)
  })
})

describe('RUN: a usable run', () => {
  it('draws equity and underwater from the API values on Basis B, in the panel link group', async () => {
    mountRun(DTS, DTS_ROUTES)
    await waitFor(() => expect(charts.props.length).toBeGreaterThan(0))
    const props = charts.props.at(-1) as LineStackProps
    expect(props.t).toEqual(PANEL_DTSMOM.t)
    expect(props.link).toBe('B')
    const [equity, underwater] = props.panes
    expect(equity?.series[0]?.values).toEqual(PANEL_DTSMOM.equity)
    expect(equity?.summaryDrawdown).toEqual({ value: '-0.01%', basis: 'Basis B' })
    expect(underwater?.summaryDrawdown).toBeUndefined()
    // Max drawdown at the tear sheet's precision (2 decimals), not 3.
    const side = screen.getByRole('region', { name: RUN.stats.label })
    const row = within(side).getByText(RUN.stats.maxDd).closest('tr')!
    expect(within(row).getByText('-0.01%')).toBeTruthy()
    expect(underwater?.unit).toBe('%')
    expect(underwater?.series[0]?.values).toEqual(PANEL_DTSMOM.underwater.map((v) => (v === null ? null : v * 100)))
    expect(screen.getByText(/Basis B, account \(compounded from K\)/)).toBeTruthy()
    expect(screen.getAllByText('[POST HOC]').length).toBeGreaterThan(0)
  })

  it('shows the header strip: balance, MTM, coverage and the anchor', async () => {
    mountRun(DTS, DTS_ROUTES)
    const summary = await screen.findByTestId('balance-summary')
    expect(summary.textContent).toContain('[OK]')
    expect(summary.textContent).toContain('diff 0.00 USD')
    expect(summary.textContent).toContain('Coverage 15/15')
    expect(screen.getByTestId('run-anchor').textContent).toBe('Anchor --')
  })

  it('shows the side statistics equal to the API values', async () => {
    mountRun(DTS, DTS_ROUTES)
    const stats = await screen.findByRole('table', { name: /Statistics/ })
    await waitFor(() => expect(within(stats).getByText('8.34')).toBeTruthy())
    expect(within(stats).getByText('+60,658.13')).toBeTruthy()
    expect(within(stats).getByText('881.25')).toBeTruthy()
    expect(within(stats).getByText('80.0%')).toBeTruthy()
    expect(within(stats).getByText('-0.01%')).toBeTruthy()
  })

  it('shows the ledger copy command exactly as the API gives it', async () => {
    mountRun(DTS, DTS_ROUTES)
    const box = await screen.findByTestId('ledger-command')
    expect(box.textContent).toBe(DETAIL_DTSMOM.ledger_command.command)
    expect(screen.getByText(/<exp> is a placeholder/)).toBeTruthy()
  })

  it('says a ledgered run is already in the ledger', async () => {
    mountRun(OVERNIGHT, { [`/api/runs/${OVERNIGHT}`]: DETAIL_OVERNIGHT })
    expect(await screen.findByText(/already in the ledger/)).toBeTruthy()
    expect(screen.queryByTestId('ledger-command')).toBeNull()
  })

  it('shows IDENTICAL for an anchor run whose base matches', async () => {
    const anchor = {
      anchor: DTS, base: 'nt_dtsmom_v0_fixture_base', base_source: 'regress_check' as const, base_found: true,
      n_trades_equal: true, pnl_total_equal: true, fees_total_equal: true,
      sharpe_anchor: 8.34493200549961, sharpe_base: 8.34493200549961, sharpe_equal: true,
      verdict: 'IDENTICAL' as const, regress_check_identical: true,
    }
    const detail = { ...DETAIL_DTSMOM, anchor, summary: { ...DETAIL_DTSMOM.summary, is_anchor: true, anchor_of: anchor.base } }
    mountRun(DTS, { ...DTS_ROUTES, [`/api/runs/${DTS}`]: detail })
    await waitFor(() => expect(screen.getByTestId('run-anchor').textContent).toBe('Anchor IDENTICAL'))
    expect(screen.getAllByText('[ANCHOR]').length).toBeGreaterThan(0)
  })
})

describe('RUN: the tabs', () => {
  it('lists the trades with P&L in USD', async () => {
    mountRun(DTS, DTS_ROUTES)
    fireEvent.click(await screen.findByRole('tab', { name: '2) Trades' }))
    const grid = await screen.findByRole('grid', { name: new RegExp(`Trades of ${DTS}`) })
    await waitFor(() => expect(within(grid).getByText('+20,010.00')).toBeTruthy())
    expect(within(grid).getAllByRole('row')).toHaveLength(TRADES_DTSMOM.total + 1)
  })

  it('lists the fills', async () => {
    mountRun(DTS, DTS_ROUTES)
    fireEvent.click(await screen.findByRole('tab', { name: '3) Fills' }))
    const grid = await screen.findByRole('grid', { name: new RegExp(`Fills of ${DTS}`) })
    await waitFor(() => expect(within(grid).getAllByText('ES.XCME').length).toBeGreaterThan(0))
  })

  it('lists a strategy log section, and names an absent one without asking the API', async () => {
    const seen = mountRun(DTS, DTS_ROUTES)
    fireEvent.click(await screen.findByRole('tab', { name: '6) Rolls' }))
    const grid = await screen.findByRole('grid', { name: /Rolls log/ })
    await waitFor(() => expect(within(grid).getByText('RB')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: '5) Closes' }))
    expect(await screen.findByText('This run has no closes log.')).toBeTruthy()
    expect(seen.some((r) => r.url.includes('/log/closes'))).toBe(false)
  })

  it('shows the configuration read only', async () => {
    mountRun(DTS, DTS_ROUTES)
    fireEvent.click(await screen.findByRole('tab', { name: '7) Config' }))
    const config = await screen.findByRole('region', { name: /Configuration/ })
    expect(within(config).getAllByText('dtsmom').length).toBeGreaterThan(0)
    expect(within(config).queryAllByRole('textbox')).toHaveLength(0)
  })
})

describe('RUN: no run chosen', () => {
  it('says how to choose one and asks the API for nothing', () => {
    const seen = stubApi({})
    mountScreen(<RunScreen params={{ code: 'RUN', context: null, args: {}, group: '-' }} context={null} />)
    expect(screen.getByText(/Type a run id, then RUN/)).toBeTruthy()
    expect(seen).toEqual([])
  })
})

describe('RUN: 98) Export', () => {
  it('saves the tab on screen: the chart series, then the trades page, with no request', async () => {
    const seen = mountRun(DTS, DTS_ROUTES)
    await waitFor(() => expect(screen.getByTestId('linestack')).toBeTruthy())
    const saved = captureDownloads()
    try {
      const before = seen.length
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const chart = (await saved.text(`${DTS}_chart.csv`)).split('\r\n')
      expect(chart[0]).toBe('date,equity,bench_equity,underwater,bench_underwater')
      expect(chart).toHaveLength(PANEL_DTSMOM.t.length + 1)
      expect(chart[1]).toBe([PANEL_DTSMOM.date[0], PANEL_DTSMOM.equity[0], PANEL_DTSMOM.bench_equity?.[0] ?? '', PANEL_DTSMOM.underwater[0], PANEL_DTSMOM.bench_underwater?.[0] ?? ''].join(','))
      expect(seen.length).toBe(before)
      fireEvent.click(screen.getByRole('tab', { name: /Trades/ }))
      await screen.findByRole('grid', { name: /trades/i })
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const trades = (await saved.text(`${DTS}_trades.csv`)).split('\r\n')
      expect(trades).toHaveLength(TRADES_DTSMOM.items.length + 1)
      expect(useMessage.getState().text).toContain(`${DTS}_trades.csv`)
    } finally {
      saved.restore()
    }
  })

  it('saves the configuration as section, key and value', async () => {
    mountRun(DTS, DTS_ROUTES)
    await waitFor(() => expect(screen.getByRole('tab', { name: /Config/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: /Config/ }))
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text(`${DTS}_config.csv`)).split('\r\n')
      expect(lines[0]).toBe('section,key,value')
      expect(lines.length).toBeGreaterThan(2)
    } finally {
      saved.restore()
    }
  })
})
