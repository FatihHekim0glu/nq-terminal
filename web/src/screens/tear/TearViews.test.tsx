// @vitest-environment jsdom
// RET's SV7 card (ANALYTICS_CATALOG SV7): the Sharpe difference tests the screen file stores, drawn as a
// bar ladder with the ECharts set's real accessibility wrapper (name and table view), beside the RET
// statistics, and a note instead of a chart where the series records none. The library itself is mocked
// (jsdom has no canvas), as in charts/echarts/components.test.tsx.
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { createApiQueryClient } from '../../api/queries'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { activateNumbered, numberedItems, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext, type NumberedItem, type Registrar } from '../../chrome/PanelChrome.numbers'
import { TEAR_CONTEXT, TEAR_DD, TEAR_SV7 } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { describeBarLadder } from '../../charts/echarts/barLadderModel'
import { RUN_ANALYTICS } from './tear.fixtures'
import TearContextGallery, { contextExtended } from './TearContext.gallery'
import TearDdGallery from './TearDd.gallery'
import { contextLines, ddStack, drawdownLanes, eqStack, laneNotes, regimeRibbon, stressSpans } from './tearCharts'
import { HYP_ANALYTICS, HYP_EXTENDED } from './tearP1.fixtures'
import { readSv7, sv7Ladder } from './tearSv7Model'
import type { Analytics } from './tearKpis'
import TearSheet from './TearSheet'
import { TearView } from './TearViews'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

// LineStack draws on canvas through uPlot; here it records the props the views hand it.
const seen = vi.hoisted(() => ({ stacks: [] as Array<Record<string, unknown>> }))

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string }) => {
    seen.stacks.push(props as unknown as Record<string, unknown>)
    return <div data-chart="linestack">{props.title}</div>
  },
}))

vi.mock('../../charts/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

beforeEach(() => {
  seen.stacks.length = 0
  resetNumbered()
  resetMessage()
})
afterEach(cleanup)

async function showRet(data: Analytics, name: string) {
  const result = render(<TearView tab="RET" data={data} name={name} link="B" />)
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

const LADDER = sv7Ladder(readSv7(HYP_ANALYTICS.validity.sharpe_difference_tests), 'volmanaged_v0')
const card = () => screen.getByRole('group', { name: TEAR_SV7.regionLabel })

function valuesOf(table: HTMLElement, label: string, nth = 0): string[] {
  const row = within(table).getAllByRole('rowheader', { name: label })[nth]!.closest('tr')!
  return within(row).getAllByRole('cell').map((c) => c.textContent ?? '')
}

describe('RET: the Sharpe difference (m - BH) card (SV7)', () => {
  it('draws the Ledoit-Wolf points by cost as a chart named for the file label, beside the statistics', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const img = within(card()).getByRole('img', { name: /Sharpe difference \(m - BH\)/ })
    expect(img.getAttribute('aria-label')).toBe(describeBarLadder(LADDER))
    expect(img.getAttribute('aria-label')).toContain('Whiskers show the 90% interval (Ledoit-Wolf bootstrap).')
    expect(screen.getByRole('table', { name: 'Return statistics' })).toBeTruthy()
    const title = within(card()).getByRole('heading', { level: 3 })
    // G07: the card's numbers are read from the screen file, a registered result, so the header is
    // fixed [PRE-REG] even though HYP_ANALYTICS itself (the series) is tagged [POST HOC].
    expect(HYP_ANALYTICS.tag).toBe('[POST HOC]')
    expect(title.textContent).toBe(`Sharpe difference (m - BH)${TEAR_SV7.tag}`)
  })

  it('G07: the SV7 tag is fixed [PRE-REG] regardless of the series tag, which the validity rows still use', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    expect(TEAR_SV7.tag).toBe('[PRE-REG]')
    const title = within(card()).getByRole('heading', { level: 3 })
    expect(title.textContent).toContain('[PRE-REG]')
    expect(title.textContent).not.toContain('[POST HOC]')
    // Unaffected: the series tag itself, which the PSR/MinTRL validity rows and the KPI tiles read,
    // stays the terminal-computed [POST HOC] it always was.
    expect(HYP_ANALYTICS.tag).toBe('[POST HOC]')
  })

  it('has a table view listing each cost row with its point, interval and sample size', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    fireEvent.click(within(card()).getByRole('button', { name: 'Table' }))
    const table = within(card()).getByRole('table', { name: LADDER.name })
    // The first column is a row header (ChartA11y, D38), the rest are cells.
    const rows = within(table).getAllByRole('row').slice(1).map((r) => [
      ...within(r).getAllByRole('rowheader'), ...within(r).getAllByRole('cell'),
    ].map((c) => c.textContent))
    expect(rows).toEqual([
      ['1 tick', '-0.0032', '-0.2913', '+0.3409', '2686'],
      ['2 ticks', '-0.0061', '-0.2942', '+0.3380', '2686'],
    ])
  })

  it('lists every measure per cost at display precision, signed where the value has a sign', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const table = within(card()).getByRole('table', { name: 'Sharpe difference (m - BH) by cost, as the screen file records it' })
    const [head, ...bands] = within(table).getAllByRole('rowgroup')
    expect(within(head!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([TEAR_SV7.measure, '1 tick', '2 ticks'])
    expect(bands.flatMap((b) => within(b).queryAllByRole('columnheader').map((h) => h.textContent))).toEqual([
      TEAR_SV7.bands.lw, TEAR_SV7.bands.memmel, TEAR_SV7.bands.provenance,
    ])
    const rowheaderNames = within(table).getAllByRole('rowheader').map((h) => h.textContent)
    expect(new Set(rowheaderNames).size).toBe(rowheaderNames.length)
    expect(valuesOf(table, 'Screen headline')).toEqual(['-0.0032', '-0.0061'])
    expect(valuesOf(table, 'Difference')).toEqual(['-0.0032', '-0.0061'])
    expect(valuesOf(table, '90% low')).toEqual(['-0.29', '-0.29'])
    expect(valuesOf(table, '90% high')).toEqual(['+0.34', '+0.34'])
    expect(valuesOf(table, 'Ledoit-Wolf p')).toEqual(['0.4884', '0.4950'])
    expect(valuesOf(table, 'Memmel z')).toEqual(['-0.02', '-0.03'])
    expect(valuesOf(table, 'Memmel rho')).toEqual(['0.77', '0.77'])
    expect(valuesOf(table, 'Memmel p')).toEqual(['0.5061', '0.5116'])
    expect(valuesOf(table, 'Replications')).toEqual(['4,999', '4,999'])
    expect(valuesOf(table, 'Seed')).toEqual(['20260926', '20260926'])
    expect(valuesOf(table, 'Observations')).toEqual(['2,686', '2,686'])
    expect(card().textContent).toContain(TEAR_SV7.pNote)
  })

  it('RET keeps two columns: the histogram and one scroll box holding the statistics and the SV7 card', async () => {
    const { container } = await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const split = container.querySelector('.tear-split')!
    expect(split.children).toHaveLength(2)
    const stats = screen.getByRole('region', { name: 'Return statistics' })
    expect(within(stats).getByRole('group', { name: TEAR_SV7.regionLabel })).toBeTruthy()
    expect(screen.queryAllByRole('region', { name: TEAR_SV7.regionLabel })).toHaveLength(0)
  })

  it('RET has exactly one keyboard-reachable scroll box, holding the stats and the SV7 card', async () => {
    const { container } = await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const scrolls = container.querySelectorAll('[data-roving-scroll]')
    expect(scrolls).toHaveLength(1)
    const stats = scrolls[0] as HTMLElement
    expect(stats.getAttribute('aria-label')).toBe('Return statistics')
    expect(stats.tabIndex).toBe(0)
    expect(stats.hasAttribute('data-roving')).toBe(true)
    expect(within(stats).getByRole('group', { name: TEAR_SV7.regionLabel })).toBeTruthy()
    expect(within(stats).getByRole('img', { name: /Sharpe difference \(m - BH\)/ })).toBeTruthy()
  })

  it('says how many entries were left out when the file holds one in another shape', async () => {
    const tests = { ...HYP_ANALYTICS.validity.sharpe_difference_tests, gross: { label: 'Sharpe difference (m - BH)', ledoit_wolf: 'not a test' } }
    await showRet({ ...HYP_ANALYTICS, validity: { ...HYP_ANALYTICS.validity, sharpe_difference_tests: tests } }, 'volmanaged_v0')
    expect(card().textContent).toContain(TEAR_SV7.droppedOne)
  })

  it('shows the not recorded note and no chart for a series without the tests', async () => {
    await showRet(RUN_ANALYTICS, 'nt_volmanaged_v0_fixture_m1')
    expect(screen.queryByRole('group', { name: TEAR_SV7.regionLabel })).toBeNull()
    expect(screen.queryByRole('img', { name: /Sharpe difference/ })).toBeNull()
    const stats = screen.getByRole('region', { name: 'Return statistics' })
    expect(within(stats).getByText(TEAR_SV7.notRecorded)).toBeTruthy()
  })
})

describe('RET: the 21-session tails keep their own section, separate from the 1-session risk rows (G16)', () => {
  it('keeps Risk to VaR and CVaR, gives the tails rows their own titled section, and notes the 19-window overlap', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const stats = screen.getByRole('table', { name: 'Return statistics' })
    const groups = within(stats).getAllByRole('rowgroup')
    const riskGroup = groups.find((g) => g.textContent?.includes('Risk ('))
    expect(riskGroup).toBeTruthy()
    expect(riskGroup?.textContent).not.toContain('period tail')
    expect(stats.textContent).toContain('21-session loss')
    const tailsGroup = groups.find((g) => g.textContent?.includes('21-session loss'))
    expect(tailsGroup?.textContent).toContain('period tail')
    expect(screen.getByText(/cannot be told apart/)).toBeTruthy()
  })
})

describe('RET: the Validity rows name the benchmark Sharpe the PSR test uses (U24)', () => {
  it('shows a Benchmark Sharpe row before PSR (benchmark Sharpe)', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const stats = screen.getByRole('table', { name: 'Return statistics' })
    const rowheaders = within(stats).getAllByRole('rowheader').map((h) => h.textContent)
    expect(rowheaders.indexOf('Benchmark Sharpe')).toBeGreaterThanOrEqual(0)
    expect(rowheaders.indexOf('Benchmark Sharpe')).toBeLessThan(rowheaders.indexOf('PSR (benchmark Sharpe)'))
  })
})

// ---------------------------------------------------------------------------------------------
// Roadmap 12, part B: market context on EQ and DD

const NAME = 'volmanaged_v0'
const IN_VIEW = contextExtended()
interface RecordedStack {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: unknown
  readonly spans?: ReadonlyArray<{ readonly from: number; readonly to: number; readonly label: string }>
  readonly ribbon?: { readonly values: ReadonlyArray<string | null> }
}
const lastStack = () => seen.stacks.at(-1) as unknown as RecordedStack
const toggle = () => screen.getByRole('group', { name: TEAR_CONTEXT.toggle })
const pressed = (label: string) => within(toggle()).getByRole('button', { name: label }).getAttribute('aria-pressed')

function showStack(tab: 'EQ' | 'DD', extra: Partial<ComponentProps<typeof TearView>> = {}) {
  return render(<TearView tab={tab} data={HYP_ANALYTICS} name={NAME} link="B" {...extra} />)
}

for (const tab of ['EQ', 'DD'] as const) {
  const build = tab === 'EQ' ? eqStack : ddStack

  describe(`${tab}: the Market context toggle`, () => {
    it('is a Shown / Hidden group, Shown at first, with the state in aria-pressed (not colour alone)', () => {
      showStack(tab, { extended: IN_VIEW })
      expect(within(toggle()).getAllByRole('button').map((b) => b.textContent)).toEqual([TEAR_CONTEXT.shown, TEAR_CONTEXT.hidden])
      expect(pressed(TEAR_CONTEXT.shown)).toBe('true')
      expect(pressed(TEAR_CONTEXT.hidden)).toBe('false')
      expect(screen.getByText(TEAR_CONTEXT.toggle)).toBeTruthy()
    })

    it('passes the stress spans and the regime ribbon to the chart while Shown', () => {
      showStack(tab, { extended: IN_VIEW })
      const stack = lastStack()
      const expected = build(HYP_ANALYTICS, NAME, IN_VIEW)
      expect(stack.spans).toEqual(expected.spans)
      expect(stack.ribbon).toEqual(expected.ribbon)
      expect(stack.spans).toHaveLength(5)
      expect(stack.ribbon!.values).toHaveLength(HYP_ANALYTICS.equity.t.length)
      expect(stack.panes).toEqual(build(HYP_ANALYTICS, NAME).panes)
    })

    it('passes neither while Hidden, prints no context lines, and Shown brings both back', () => {
      showStack(tab, { extended: IN_VIEW })
      fireEvent.click(within(toggle()).getByRole('button', { name: TEAR_CONTEXT.hidden }))
      expect(pressed(TEAR_CONTEXT.hidden)).toBe('true')
      expect(pressed(TEAR_CONTEXT.shown)).toBe('false')
      expect(lastStack().spans).toBeUndefined()
      expect(lastStack().ribbon).toBeUndefined()
      expect(screen.queryByText(/frozen stress windows/)).toBeNull()
      expect(screen.queryByText(/sessions labelled/)).toBeNull()
      fireEvent.click(within(toggle()).getByRole('button', { name: TEAR_CONTEXT.shown }))
      expect(lastStack().spans).toEqual(build(HYP_ANALYTICS, NAME, IN_VIEW).spans)
      expect(lastStack().ribbon).toEqual(build(HYP_ANALYTICS, NAME, IN_VIEW).ribbon)
    })

    it('keeps the panes and their identity when the layers are switched, so the chart is not rebuilt', () => {
      showStack(tab, { extended: IN_VIEW })
      const panes = lastStack().panes
      fireEvent.click(within(toggle()).getByRole('button', { name: TEAR_CONTEXT.hidden }))
      expect(lastStack().panes).toBe(panes)
    })

    it('prints the context lines under the basis line, with the counts, the frozen list and the tags', () => {
      const { container } = showStack(tab, { extended: IN_VIEW })
      const lines = contextLines(IN_VIEW, HYP_ANALYTICS.equity.t)
      expect(lines[0]).toMatch(/^3 of 5 frozen stress windows \(RK5, /)
      expect(lines[1]).toMatch(/; 31 of 39 sessions labelled\. /)
      for (const line of lines) expect(screen.getByText(line).className).toBe('tear-note')
      const text = container.textContent ?? ''
      expect(text.indexOf('Basis A')).toBeLessThan(text.indexOf(lines[0]!))
      expect(lines[0]).toContain('[POST HOC]')
      expect(lines[1]).toContain('[POST HOC]')
    })

    it('says 0 of 5 windows and 0 of 39 sessions for the captured series, and still hands the chart all five windows', () => {
      showStack(tab, { extended: HYP_EXTENDED })
      expect(screen.getByText(/^0 of 5 frozen stress windows \(RK5, /)).toBeTruthy()
      expect(screen.getByText(/; 0 of 39 sessions labelled\. /)).toBeTruthy()
      expect(lastStack().spans).toEqual(stressSpans(HYP_EXTENDED))
      expect(lastStack().ribbon).toEqual(regimeRibbon(HYP_EXTENDED, HYP_ANALYTICS.equity.t))
      expect(lastStack().ribbon!.values.every((v) => v === null)).toBe(true)
    })

    it('draws the chart at once and says the context is loading until /extended answers', () => {
      showStack(tab, { extended: null, extendedError: null })
      expect(screen.getByText(NAME + (tab === 'EQ' ? ' equity' : ' drawdown'))).toBeTruthy()
      const note = screen.getByText(TEAR_CONTEXT.loading)
      expect(note.getAttribute('role')).toBe('status')
      expect(lastStack().spans).toBeUndefined()
      expect(lastStack().ribbon).toBeUndefined()
    })

    it('says loading when the props are left out altogether (a caller that never asks for the context)', () => {
      showStack(tab)
      expect(screen.getByText(TEAR_CONTEXT.loading)).toBeTruthy()
      expect(lastStack().spans).toBeUndefined()
    })

    it('says why the context is unavailable when /extended failed, as a status and never an alert', () => {
      const error = new ApiError({ kind: 'http', status: 500, path: '/x', detail: 'the analytics engine is down', body: null })
      showStack(tab, { extended: null, extendedError: error })
      expect(screen.getByText('Market context unavailable: the analytics engine is down').getAttribute('role')).toBe('status')
      expect(screen.queryByText(TEAR_CONTEXT.loading)).toBeNull()
      expect(screen.queryAllByRole('alert')).toHaveLength(0)
      expect(lastStack().spans).toBeUndefined()
    })

    it('does not print a loading or failed note while Hidden', () => {
      showStack(tab, { extended: null, extendedError: null })
      fireEvent.click(within(toggle()).getByRole('button', { name: TEAR_CONTEXT.hidden }))
      expect(screen.queryByText(TEAR_CONTEXT.loading)).toBeNull()
    })

    it('says a layer is not served instead of drawing an empty one', () => {
      showStack(tab, { extended: { ...HYP_EXTENDED, regimes: null, regimes_note: 'needs 252 earlier sessions' } })
      expect(screen.getByText('No volatility regime is served for this series: needs 252 earlier sessions')).toBeTruthy()
      expect(lastStack().ribbon).toBeUndefined()
      expect(lastStack().spans).toHaveLength(5)
    })
  })
}

describe('EQ and DD keep their other parts', () => {
  it('EQ keeps its basis line with the benchmark note', () => {
    showStack('EQ', { extended: IN_VIEW })
    expect(screen.getByText(/^Basis A: /)).toBeTruthy()
  })

  it('DD keeps the top drawdowns table as its one scroll box, below the chart', () => {
    const { container } = showStack('DD', { extended: IN_VIEW })
    expect(container.querySelectorAll('[data-roving-scroll]')).toHaveLength(1)
    expect(screen.getByRole('table', { name: /Top drawdowns/ })).toBeTruthy()
  })

  it('MRET, RET and RR ignore the extended body: no toggle', async () => {
    for (const tab of ['MRET', 'RR'] as const) {
      const { unmount } = render(<TearView tab={tab} data={HYP_ANALYTICS} name={NAME} link="B" extended={IN_VIEW} />)
      expect(screen.queryByRole('group', { name: TEAR_CONTEXT.toggle })).toBeNull()
      unmount()
    }
    await showRet(HYP_ANALYTICS, NAME)
    expect(screen.queryByRole('group', { name: TEAR_CONTEXT.toggle })).toBeNull()
  })
})

describe('the TearContext gallery entry', () => {
  it('draws the layers: windows the series lies inside, a recovered one, an open one, a spent one, and a labelled strip', () => {
    render(<TearContextGallery />)
    const stack = lastStack()
    const first = stack.t[0]!
    const last = stack.t[stack.t.length - 1]!
    const spans = stack.spans!
    const inView = spans.filter((s) => s.to >= first && s.from <= last)
    expect(spans).toHaveLength(5)
    expect(inView).toHaveLength(3)
    expect(inView.some((s) => s.label.endsWith('[SPENT]'))).toBe(true)
    expect(new Set(stack.ribbon!.values.filter((v) => v !== null))).toEqual(new Set(['low', 'mid', 'high']))
    expect(stack.ribbon!.values.filter((v) => v === null).length).toBeGreaterThan(0)
    expect(screen.getByText(/Gallery data only/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// Roadmap 10, phase 1: the DD episode lanes, cross-highlighted with the DD2 table

const PANEL = 'dd-lanes-test'
const ACTIONS: PanelActions = { panelId: PANEL, related: () => false, back: () => false, forward: () => false, open: () => false }

type DdRow = Analytics['drawdown_table'][number]
const DD_T = HYP_ANALYTICS.drawdown.t
const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)

/** The fixture with `count` served rows, deepest first, the last still open. */
function withRows(count: number, base: Analytics = HYP_ANALYTICS): Analytics {
  const first = base.drawdown_table[0]!
  const rows = Array.from({ length: count }, (_, i): DdRow => {
    const open = i === count - 1
    return {
      ...first,
      peak: isoOf(DD_T[i]!),
      trough: isoOf(DD_T[i + 2]!),
      recovery: open ? null : isoOf(DD_T[i + 5]!),
      depth: -0.1 + i * 0.005,
      trough_to_recovery: open ? null : 3,
      open,
    }
  })
  return { ...base, drawdown_table: rows }
}

interface LaneProps {
  readonly highlightLane?: number | null
  readonly onLaneHover?: (rank: number | null) => void
}
const laneProps = () => seen.stacks.at(-1) as unknown as LaneProps
const ddTable = () => screen.getByRole('table', { name: /Top drawdowns/ })
const bodyRows = () => within(ddTable()).getAllByRole('row').slice(1)
const highlighted = () => bodyRows().filter((r) => r.getAttribute('data-highlight') === 'true')
/** The rank is the row header (the Number <GO> hint '11)' is a plain cell). */
const rankOf = (row: HTMLElement) => within(row).getByRole('rowheader').textContent

function mountDd(data: Analytics = HYP_ANALYTICS, registrar: Registrar = registerNumbered) {
  const view = (d: Analytics) => (
    <NumberingContext value={registrar}>
      <PanelActionsContext value={ACTIONS}>
        <TearView tab="DD" data={d} name={NAME} link="B" extended={IN_VIEW} />
      </PanelActionsContext>
    </NumberingContext>
  )
  const result = render(view(data))
  return { ...result, show: (d: Analytics) => result.rerender(view(d)) }
}

describe('DD: the lanes pane is handed to the chart', () => {
  it('draws the lanes last, under the underwater pane, from the served rows', () => {
    mountDd()
    const panes = lastStack().panes as ReturnType<typeof ddStack>['panes']
    expect(panes.map((p) => p.id)).toEqual(['equity', 'underwater', 'lanes'])
    expect(panes[2]!.lanes).toEqual(drawdownLanes(HYP_ANALYTICS))
    expect(panes[2]!.lanes!.episodes).toHaveLength(1)
    expect(panes[2]!.lanes!.episodes[0]).toMatchObject({ rank: 1, open: true, depth: '-9.49%' })
  })

  it('starts with no lane outlined, and no reported hover', () => {
    mountDd()
    expect(laneProps().highlightLane).toBeNull()
    expect(typeof laneProps().onLaneHover).toBe('function')
    expect(highlighted()).toHaveLength(0)
  })

  it('leaves EQ without a highlight or hover: only DD carries lanes', () => {
    showStack('EQ', { extended: IN_VIEW })
    expect(laneProps().highlightLane).toBeUndefined()
    expect(laneProps().onLaneHover).toBeUndefined()
  })
})

describe('DD: the top drawdowns table with its No. column', () => {
  it('leads with No., then the existing columns', () => {
    mountDd()
    const heads = within(ddTable()).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['No.', '#', 'Peak', 'Trough', 'Recovery', 'Depth', 'To trough', 'To recovery', 'Length'])
  })

  it('names each row by its rank: the row headers are the ranks, and the 11) hints are plain cells', () => {
    mountDd(withRows(10))
    const rows = bodyRows()
    expect(rows).toHaveLength(10)
    // Assistive technology announces a cell's row header: that must be the rank, not the Number <GO> hint.
    expect(within(ddTable()).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)))
    expect(rows.map(rankOf)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)))
    for (const row of rows) expect(within(row).getByRole('rowheader').tagName).toBe('TH')
    const hints = rows.map((r) => within(r).getAllByRole('cell')[0]!)
    expect(hints.map((c) => c.textContent)).toEqual(Array.from({ length: 10 }, (_, i) => `${11 + i})`))
    for (const hint of hints) {
      expect(hint.tagName).toBe('TD')
      expect(hint.className).toContain('tear-no')
    }
  })

  it('keeps the rank as a right aligned, muted row header that looks as the rank cell did', () => {
    mountDd()
    const rank = within(bodyRows()[0]!).getByRole('rowheader')
    expect(rank.getAttribute('scope')).toBe('row')
    expect(rank.className.split(' ')).toEqual(expect.arrayContaining(['num', 'muted', 'tear-rank']))
  })

  it('keeps the data cells where they were: the No. hint, then the peak, the trough, the recovery and the depth', () => {
    mountDd()
    const cells = within(bodyRows()[0]!).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['11)', '2011-04-27', '2011-06-17', 'open', '-9.49%', '36', '--', '36'])
  })

  it('pins the e2e contract: in the first body row td 2 is the trough and td 4 the depth (e2e/tear.spec.ts)', () => {
    mountDd()
    const tds = bodyRows()[0]!.querySelectorAll('td')
    expect(tds[2]!.textContent).toBe(HYP_ANALYTICS.drawdown_table[0]!.trough)
    expect(tds[4]!.textContent).toBe('-9.49%')
    expect(tds).toHaveLength(8)
  })

  it('shows the empty-table line across every column and no lanes note', () => {
    mountDd({ ...HYP_ANALYTICS, drawdown_table: [] })
    expect(screen.getByText(TEAR_DD.tableEmpty).getAttribute('colspan')).toBe('9')
    expect(screen.queryByText(/DD3/)).toBeNull()
    expect((laneProps() as unknown as { panes: unknown[] }).panes).toHaveLength(2)
  })
})

describe('DD: Number <GO> 11 to 20 pins an episode', () => {
  it('registers one item per row from 11 up, named Episode n', () => {
    mountDd(withRows(10))
    const items = numberedItems(PANEL)
    expect(items.map((i) => i.n)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    expect(items.map((i) => i.label)).toEqual(Array.from({ length: 10 }, (_, i) => fillCopy(TEAR_DD.laneItem, { rank: i + 1 })))
    expect(items[0]!.label).toBe('Episode 1')
  })

  it('registers only the fixture\'s one episode, and drops it again on unmount', () => {
    const { unmount } = mountDd()
    expect(numberedItems(PANEL).map((i) => i.n)).toEqual([11])
    unmount()
    expect(numberedItems(PANEL)).toEqual([])
  })

  it('item 11 pins episode 1 (the chart outlines it and its row is marked) and toggles it off again', () => {
    mountDd()
    act(() => {
      expect(activateNumbered(PANEL, 11)).toBe(true)
    })
    expect(laneProps().highlightLane).toBe(1)
    expect(highlighted()).toHaveLength(1)
    expect(rankOf(highlighted()[0]!)).toBe('1')
    act(() => {
      activateNumbered(PANEL, 11)
    })
    expect(laneProps().highlightLane).toBeNull()
    expect(highlighted()).toHaveLength(0)
  })

  it('pinning another episode moves the pin', () => {
    mountDd(withRows(10))
    act(() => {
      activateNumbered(PANEL, 13)
    })
    expect(laneProps().highlightLane).toBe(3)
    act(() => {
      activateNumbered(PANEL, 15)
    })
    expect(laneProps().highlightLane).toBe(5)
    expect(highlighted().map(rankOf)).toEqual(['5'])
  })

  it('forgets a pin when the table it pinned in is replaced', () => {
    const view = mountDd(withRows(10))
    act(() => {
      activateNumbered(PANEL, 12)
    })
    expect(laneProps().highlightLane).toBe(2)
    view.show({ ...withRows(10), n: HYP_ANALYTICS.n })
    expect(laneProps().highlightLane).toBeNull()
    expect(highlighted()).toHaveLength(0)
  })
})

describe('DD: the lanes pane keeps a height its rows can be read and hovered at', () => {
  /** The wrapper the chart sits in (the mocked LineStack renders one box inside it). */
  const wrapper = () => document.querySelector('[data-chart="linestack"]')!.parentElement as HTMLElement
  const rowsVar = (el: HTMLElement) => el.style.getPropertyValue('--tear-lane-rows')

  it('marks the DD chart wrapper with tear-chart-lanes and the number of drawn lanes', () => {
    mountDd(withRows(10))
    expect(wrapper().className.split(' ')).toEqual(['tear-chart', 'tear-chart-lanes'])
    expect(rowsVar(wrapper())).toBe('10')
    cleanup()
    mountDd()
    expect(rowsVar(wrapper())).toBe('1')
  })

  it('counts the lanes drawn, not the rows served: a row with an unreadable date is not a lane', () => {
    const data = withRows(10)
    const rows = data.drawdown_table.map((r, i) => (i === 2 ? { ...r, peak: 'x' } : r))
    mountDd({ ...data, drawdown_table: rows })
    expect(drawdownLanes({ ...data, drawdown_table: rows })!.episodes).toHaveLength(9)
    expect(rowsVar(wrapper())).toBe('9')
  })

  it('leaves EQ without the class or the variable', () => {
    showStack('EQ', { extended: IN_VIEW })
    expect(wrapper().className).toBe('tear-chart')
    expect(wrapper().style.getPropertyValue('--tear-lane-rows')).toBe('')
    expect(wrapper().getAttribute('style')).toBeNull()
  })

  it('leaves DD without a drawable row (an empty table) without the class or the variable', () => {
    mountDd({ ...HYP_ANALYTICS, drawdown_table: [] })
    expect(wrapper().className).toBe('tear-chart')
    expect(wrapper().getAttribute('style')).toBeNull()
  })

  it('leaves DD without the class when every served row is unreadable', () => {
    mountDd({ ...HYP_ANALYTICS, drawdown_table: HYP_ANALYTICS.drawdown_table.map((r) => ({ ...r, peak: 'x' })) })
    expect(wrapper().className).toBe('tear-chart')
    expect(wrapper().getAttribute('style')).toBeNull()
  })
})

describe('DD: pinning an episode with Number <GO> says so on the message line', () => {
  const firstRow = () => bodyRows()[0]!

  it('item 11 posts that episode 1 is marked, and the first row is aria-current', () => {
    mountDd()
    expect(firstRow().getAttribute('aria-current')).toBeNull()
    act(() => {
      activateNumbered(PANEL, 11)
    })
    expect(useMessage.getState().text).toBe(fillCopy(TEAR_DD.lanePinned, { rank: 1 }))
    expect(useMessage.getState().text).toBe('Episode 1 is marked in the chart and the table.')
    expect(useMessage.getState().tone).toBe('info')
    expect(firstRow().getAttribute('aria-current')).toBe('true')
    expect(firstRow().getAttribute('data-highlight')).toBe('true')
  })

  it('item 11 again posts that episode 1 is no longer marked, and drops aria-current', () => {
    mountDd()
    act(() => {
      activateNumbered(PANEL, 11)
    })
    const pinnedId = useMessage.getState().id
    act(() => {
      activateNumbered(PANEL, 11)
    })
    expect(useMessage.getState().text).toBe(fillCopy(TEAR_DD.laneUnpinned, { rank: 1 }))
    expect(useMessage.getState().text).toBe('Episode 1 is no longer marked.')
    expect(useMessage.getState().id).toBeGreaterThan(pinnedId)
    expect(firstRow().getAttribute('aria-current')).toBeNull()
  })

  it('marks only the pinned row, and moving the pin says the new episode is marked', () => {
    mountDd(withRows(10))
    act(() => {
      activateNumbered(PANEL, 13)
    })
    expect(useMessage.getState().text).toBe(fillCopy(TEAR_DD.lanePinned, { rank: 3 }))
    expect(bodyRows().filter((r) => r.getAttribute('aria-current') === 'true').map(rankOf)).toEqual(['3'])
    act(() => {
      activateNumbered(PANEL, 15)
    })
    expect(useMessage.getState().text).toBe(fillCopy(TEAR_DD.lanePinned, { rank: 5 }))
    expect(bodyRows().filter((r) => r.getAttribute('aria-current') === 'true').map(rankOf)).toEqual(['5'])
  })

  it('unpinning names the episode whose pin was dropped, not the last one hovered', () => {
    mountDd(withRows(10))
    act(() => {
      activateNumbered(PANEL, 12)
    })
    fireEvent.mouseEnter(bodyRows()[6]!)
    act(() => {
      activateNumbered(PANEL, 12)
    })
    expect(useMessage.getState().text).toBe(fillCopy(TEAR_DD.laneUnpinned, { rank: 2 }))
  })

  it('hover alone never sets aria-current, and posts nothing', () => {
    mountDd(withRows(10))
    fireEvent.mouseEnter(bodyRows()[1]!)
    expect(bodyRows()[1]!.getAttribute('data-highlight')).toBe('true')
    expect(bodyRows().filter((r) => r.hasAttribute('aria-current'))).toEqual([])
    act(() => laneProps().onLaneHover!(4))
    expect(bodyRows().filter((r) => r.hasAttribute('aria-current'))).toEqual([])
    expect(useMessage.getState().text).toBe('')
  })

  it('hovering another row while one is pinned leaves aria-current on the pinned row alone', () => {
    mountDd(withRows(10))
    act(() => {
      activateNumbered(PANEL, 11)
    })
    fireEvent.mouseEnter(bodyRows()[3]!)
    expect(bodyRows().filter((r) => r.getAttribute('aria-current') === 'true').map(rankOf)).toEqual(['1'])
  })
})

describe('DD: hovering the lanes or the table marks the same episode', () => {
  it('a lane hover reported by the chart marks its table row, and null clears it', () => {
    mountDd(withRows(10))
    act(() => laneProps().onLaneHover!(4))
    expect(laneProps().highlightLane).toBe(4)
    expect(highlighted().map(rankOf)).toEqual(['4'])
    expect(highlighted()[0]!.getAttribute('data-highlight')).toBe('true')
    act(() => laneProps().onLaneHover!(null))
    expect(laneProps().highlightLane).toBeNull()
    expect(highlighted()).toHaveLength(0)
  })

  it('the pointer entering a table row outlines its lane, and leaving it clears the outline', () => {
    mountDd(withRows(10))
    fireEvent.mouseEnter(bodyRows()[2]!)
    expect(laneProps().highlightLane).toBe(3)
    expect(highlighted().map(rankOf)).toEqual(['3'])
    fireEvent.mouseLeave(bodyRows()[2]!)
    expect(laneProps().highlightLane).toBeNull()
    expect(highlighted()).toHaveLength(0)
  })

  it('a hover wins over the pin while it lasts, and the pin returns after it', () => {
    mountDd(withRows(10))
    act(() => {
      activateNumbered(PANEL, 11)
    })
    fireEvent.mouseEnter(bodyRows()[3]!)
    expect(laneProps().highlightLane).toBe(4)
    expect(highlighted().map(rankOf)).toEqual(['4'])
    fireEvent.mouseLeave(bodyRows()[3]!)
    expect(laneProps().highlightLane).toBe(1)
    expect(highlighted().map(rankOf)).toEqual(['1'])
  })

  it('sets state only when the rank changes: the same rank again draws nothing new', () => {
    mountDd(withRows(10))
    act(() => laneProps().onLaneHover!(2))
    const drawn = seen.stacks.length
    act(() => laneProps().onLaneHover!(2))
    act(() => laneProps().onLaneHover!(2))
    expect(seen.stacks.length).toBe(drawn)
    act(() => laneProps().onLaneHover!(3))
    expect(seen.stacks.length).toBe(drawn + 1)
  })

  it('does not rebuild the panes when the highlight changes, so only the lanes redraw', () => {
    mountDd(withRows(10))
    const panes = lastStack().panes
    act(() => laneProps().onLaneHover!(5))
    expect(lastStack().panes).toBe(panes)
    fireEvent.click(within(toggle()).getByRole('button', { name: TEAR_CONTEXT.hidden }))
    expect(lastStack().panes).toBe(panes)
    expect(laneProps().highlightLane).toBe(5)
  })
})

describe('DD: the lanes note under the table', () => {
  it('names the rows as the deepest the API lists, and says DD3 is not served, after the table', () => {
    const { container } = mountDd(withRows(10))
    const [text] = laneNotes(withRows(10))
    const note = screen.getByText(text!)
    expect(note.className).toBe('tear-note')
    expect(note.textContent).toContain('the 10 deepest drawdowns the API lists (DD2), deepest first')
    expect(note.textContent).toContain('DD3 (all episodes and time to recovery) is not served')
    const html = container.innerHTML
    expect(html.indexOf(text!)).toBeGreaterThan(html.indexOf('</table>'))
  })

  it('says it in the singular for the fixture\'s one row', () => {
    mountDd()
    expect(screen.getByText(TEAR_DD.lanesNoteOne).className).toBe('tear-note')
  })

  it('counts the rows it cannot draw', () => {
    const data = withRows(3)
    const bad: Analytics = { ...data, drawdown_table: data.drawdown_table.map((r, i) => (i === 1 ? { ...r, peak: '2011-02-30' } : r)) }
    mountDd(bad)
    expect(screen.getByText('1 row with an unreadable date is not drawn.')).toBeTruthy()
    const panes = lastStack().panes as ReturnType<typeof ddStack>['panes']
    expect(panes[2]!.lanes!.episodes.map((e) => e.rank)).toEqual([1, 3])
    // the table still lists every served row
    expect(bodyRows()).toHaveLength(3)
  })

  it('prints no lanes line at all for an empty table', () => {
    mountDd({ ...HYP_ANALYTICS, drawdown_table: [] })
    expect(laneNotes({ ...HYP_ANALYTICS, drawdown_table: [] })).toEqual([])
    expect(screen.queryByText(/deepest drawdown/)).toBeNull()
  })
})

describe('DD on the tear sheet: the episode numbers are free', () => {
  const HYP_DETAIL = { card: { name: 'volmanaged_v0', series_costs: [0, 1, 2] } }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined
  afterEach(() => fetchSpy?.mockRestore())

  it('no number is registered twice across the bar, the tabs and the lanes; the lanes take 11 to 20', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (/^\/api\/hypotheses\/volmanaged_v0$/.test(url)) return json(HYP_DETAIL)
      if (/^\/api\/analytics\/hypothesis\/volmanaged_v0\/extended\?/.test(url)) return json(HYP_EXTENDED)
      if (/^\/api\/analytics\/hypothesis\/volmanaged_v0\?/.test(url)) return json(withRows(10))
      return json({ detail: `no route ${url}` })
    })
    // The registrations alive now: a registration that re-registers first gives its numbers back.
    const active = new Set<readonly NumberedItem[]>()
    const capture: Registrar = (panelId, items) => {
      const mine = [...items]
      active.add(mine)
      const off = registerNumbered(panelId, items)
      return () => {
        active.delete(mine)
        off()
      }
    }
    const context = { kind: 'hypothesis', value: 'volmanaged_v0' } as const
    render(
      <QueryClientProvider client={createApiQueryClient()}>
        <NumberingContext value={capture}>
          <PanelActionsContext value={ACTIONS}>
            <TearSheet params={{ code: 'DD', context, args: {}, group: 'B' }} context={context} />
          </PanelActionsContext>
        </NumberingContext>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(numberedItems(PANEL).some((i) => i.n === 11)).toBe(true))
    const numbers = [...active].flatMap((items) => items.map((i) => i.n))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers.filter((n) => n >= 11 && n <= 20).sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    // Everything else on the sheet sits outside 11 to 20: the five tabs and the function bar.
    expect(numbers.filter((n) => n < 11 || n > 20).every((n) => n <= 5 || n >= 90)).toBe(true)
  })
})

describe('the TearDd gallery entry', () => {
  it('draws four disjoint lanes over the fixture: one from the start, two recovered and one open, deepest first', () => {
    render(<TearDdGallery />)
    const panes = lastStack().panes as ReturnType<typeof ddStack>['panes']
    expect(panes.map((p) => p.id)).toEqual(['equity', 'underwater', 'lanes'])
    const episodes = panes[2]!.lanes!.episodes
    expect(episodes.map((e) => e.rank)).toEqual([1, 2, 3, 4])
    expect(episodes.map((e) => e.open)).toEqual([true, false, false, false])
    expect(episodes[2]!.peak).toBe(HYP_ANALYTICS.drawdown.t[0])
    // The open lane has a recovery leg to hatch: its trough lies before the last session.
    expect(episodes[0]!.trough).toBeLessThan(episodes[0]!.end)
    expect(episodes[0]!.end).toBe(HYP_ANALYTICS.drawdown.t.at(-1))
    // Disjoint, as the API's episodes are: sorted by time, each ends where the next may start.
    const byTime = [...episodes].sort((a, b) => a.peak - b.peak)
    byTime.slice(1).forEach((e, i) => expect(e.peak).toBeGreaterThanOrEqual(byTime[i]!.end))
    expect(bodyRows()).toHaveLength(4)
    expect(screen.getByText(/Gallery data only: the fixture hypothesis with four drawdown episodes/)).toBeTruthy()
  })
})
