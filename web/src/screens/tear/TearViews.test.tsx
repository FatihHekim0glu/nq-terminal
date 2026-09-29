// @vitest-environment jsdom
// RET's SV7 card (ANALYTICS_CATALOG SV7): the Sharpe difference tests the screen file stores, drawn as a
// bar ladder with the ECharts set's real accessibility wrapper (name and table view), beside the RET
// statistics, and a note instead of a chart where the series records none. The library itself is mocked
// (jsdom has no canvas), as in charts/echarts/components.test.tsx.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { TEAR_CONTEXT, TEAR_SV7 } from '../../copy/tear'
import { describeBarLadder } from '../../charts/echarts/barLadderModel'
import { RUN_ANALYTICS } from './tear.fixtures'
import TearContextGallery, { contextExtended } from './TearContext.gallery'
import { contextLines, ddStack, eqStack, regimeRibbon, stressSpans } from './tearCharts'
import { HYP_ANALYTICS, HYP_EXTENDED } from './tearP1.fixtures'
import { readSv7, sv7Ladder } from './tearSv7Model'
import type { Analytics } from './tearKpis'
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
