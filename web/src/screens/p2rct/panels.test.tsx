// @vitest-environment jsdom
// The RG2, EX5 and MV6 cards (TASKS Phase 12): what each prints from the captured responses, what the charts are
// handed (LineStack records the props it receives: jsdom has no canvas), and the read states of the hosts.
// Born failing: no card shows a p-value, no date on or after the fence reaches a chart, a monthly book gets no chart.
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import { RCT } from '../../copy/regimesCapacityTerm'
import { fillCopy } from '../../copy/workspace'
import CapacityPanel from './CapacityPanel'
import { CapacityHost, TermStructureHost, TrendRegimeHost } from './hosts'
import { RUN_CAPACITY, TERM_CL, TREND_MONTHLY, TREND_VIEW } from './p2rct.fixtures'
import TermStructurePanel from './TermStructurePanel'
import TrendRegimePanel from './TrendRegimePanel'
import type { TrendRegimeView } from './types'

interface StackProps {
  readonly title: string
  readonly t: readonly number[]
  readonly panes: ReadonlyArray<{ readonly id: string; readonly series: ReadonlyArray<{ readonly values: readonly unknown[] }> }>
  readonly ribbon?: { readonly values: readonly unknown[] }
  readonly link?: string
}

const seen = vi.hoisted(() => ({ stacks: [] as unknown[] }))

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string }) => {
    seen.stacks.push(props)
    return <div data-chart="linestack">{props.title}</div>
  },
}))

beforeEach(() => {
  seen.stacks.length = 0
})
afterEach(cleanup)

const stacks = () => seen.stacks as StackProps[]
const FAILED = new ApiError({ kind: 'http', status: 503, path: '/api/x', detail: 'no price source' })

describe('TrendRegimePanel (RG2)', () => {
  it('draws NQ against its mean with the regime strip through LineStack, on the served arrays', () => {
    render(<TrendRegimePanel view={TREND_VIEW} />)
    expect(stacks()).toHaveLength(1)
    const [stack] = stacks()
    expect(stack!.title).toBe(RCT.trend.chart.title)
    expect(stack!.t).toEqual(TREND_VIEW.t)
    expect(stack!.ribbon?.values).toHaveLength(TREND_VIEW.t.length)
    expect(stack!.link).toBe('-')
  })

  it('prints the regime table, Welch t and the notes, and never a p-value', () => {
    const { container } = render(<TrendRegimePanel view={TREND_VIEW} />)
    const table = screen.getByRole('table', { name: RCT.trend.caption })
    const above = within(table).getByRole('rowheader', { name: RCT.trend.names.above }).closest('tr')!
    expect(within(above).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2,478', expect.any(String), '1.26', '56.86%'])
    expect(screen.getByText(/Welch t, above against below: 2\.63 \(df 235\.4\)/)).toBeTruthy()
    expect(screen.getByText(RCT.trend.noP)).toBeTruthy()
    expect(container.textContent).not.toMatch(/\bp\s*[=<>]|p-value\s*[=<:]\s*\d|significan/i)
  })

  it('states how the prices were served and the unit of the mean', () => {
    render(<TrendRegimePanel view={TREND_VIEW} />)
    expect(screen.getByText(/Prices through the OOS gate, caller terminal/)).toBeTruthy()
    expect(screen.getByText('Mean in fraction of K; Sharpe annualised over 252 sessions.')).toBeTruthy()
  })

  it('born failing: a monthly book gets the API reason and no chart, no table', () => {
    render(<TrendRegimePanel view={TREND_MONTHLY} />)
    expect(stacks()).toHaveLength(0)
    expect(screen.getByText(fillCopy(RCT.notShown, { note: TREND_MONTHLY.note ?? '' }))).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says so when no session has a regime, instead of drawing an empty chart', () => {
    const none: TrendRegimeView = { ...TREND_VIEW, t: [], date: [], regime: [], close: [], mean_close: [] }
    render(<TrendRegimePanel view={none} />)
    expect(stacks()).toHaveLength(0)
    expect(screen.getByText(RCT.trend.chart.empty)).toBeTruthy()
  })

  it('passes the link group to the chart', () => {
    render(<TrendRegimePanel view={TREND_VIEW} link="B" />)
    expect(stacks()[0]!.link).toBe('B')
  })
})

describe('CapacityPanel (EX5)', () => {
  it('prints one row per series with participation as a percentage of the volume', () => {
    render(<CapacityPanel capacity={RUN_CAPACITY} />)
    const table = screen.getByRole('table', { name: RCT.capacity.rowsCaption })
    const first = RUN_CAPACITY.rows[0]!
    const row = within(table).getByRole('rowheader', { name: first.symbol }).closest('tr')!
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent ?? '')
    expect(cells).toContain(first.ratio_max_date)
    expect(cells.filter((c) => c.endsWith('%')).length).toBe(4)
  })

  it('names the largest participation and keeps the void note and the source of the contracts', () => {
    render(<CapacityPanel capacity={RUN_CAPACITY} />)
    expect(screen.getByText(new RegExp(`Largest participation: .*% of ${RUN_CAPACITY.max_symbol} volume`))).toBeTruthy()
    expect(screen.getByText(RCT.capacity.voidNote)).toBeTruthy()
    expect(screen.getByText("Contracts counted from the run's fills.")).toBeTruthy()
  })

  it('lists the traded instruments and the sessions of largest participation as named regions', () => {
    render(<CapacityPanel capacity={RUN_CAPACITY} />)
    expect(screen.getByRole('region', { name: RCT.capacity.rowsRegion })).toBeTruthy()
    expect(screen.getByRole('region', { name: RCT.capacity.worstRegion })).toBeTruthy()
    const instruments = screen.getByRole('table', { name: RCT.capacity.instrumentsCaption })
    expect(within(instruments).getAllByRole('row').length).toBe(RUN_CAPACITY.instruments.length + 1)
  })

  it('leaves out the largest-sessions table when no session has a volume, and says so', () => {
    render(<CapacityPanel capacity={{ ...RUN_CAPACITY, rows: [], worst: [], max_ratio: null, max_symbol: null }} />)
    expect(screen.queryByRole('region', { name: RCT.capacity.worstRegion })).toBeNull()
    expect(screen.getByText(RCT.capacity.none)).toBeTruthy()
  })

  it('shows an instrument outside the universe without a series', () => {
    const outside = { instrument: 'RTY.XCME', symbol: null, factor: 1, note: 'not in the futures universe: no volume series' }
    render(<CapacityPanel capacity={{ ...RUN_CAPACITY, instruments: [...RUN_CAPACITY.instruments, outside] }} />)
    expect(screen.getByText(outside.note)).toBeTruthy()
  })

  it('never shows a p-value', () => {
    const { container } = render(<CapacityPanel capacity={RUN_CAPACITY} />)
    expect(container.textContent).not.toMatch(/p-value|\bp\s*=/i)
  })
})

describe('TermStructurePanel (MV6)', () => {
  it('draws the carry over the spread through LineStack, from the served arrays', () => {
    render(<TermStructurePanel term={TERM_CL} link="A" />)
    expect(stacks()).toHaveLength(1)
    const [stack] = stacks()
    expect(stack!.title).toBe('CL calendar-chain carry and spread')
    expect(stack!.t).toEqual(TERM_CL.t)
    expect(stack!.panes.map((p) => p.id)).toEqual(['carry', 'spread'])
    expect(stack!.ribbon).toBeUndefined()
    expect(stack!.link).toBe('A')
  })

  it('prints the summary, the void sessions, the units and the expiry source', () => {
    render(<TermStructurePanel term={TERM_CL} />)
    expect(screen.getByText(/2956 sessions from the calendar chain/)).toBeTruthy()
    expect(screen.getByText(new RegExp(`${TERM_CL.void.thin} thin`))).toBeTruthy()
    expect(screen.getByText(RCT.term.unit)).toBeTruthy()
    expect(screen.getByText(fillCopy(RCT.term.expirySource, { source: TERM_CL.expiry_source }))).toBeTruthy()
  })

  it('lists the latest curve rank by rank under its own caption', () => {
    render(<TermStructurePanel term={TERM_CL} />)
    const table = screen.getByRole('table', { name: fillCopy(RCT.term.curveCaption, { date: TERM_CL.curve.date ?? '' }) })
    expect(within(table).getAllByRole('row')).toHaveLength(TERM_CL.curve.points.length + 1)
    expect(within(table).getByRole('rowheader', { name: 'CLG2022' })).toBeTruthy()
  })

  it('says why there is no curve, and which ranks had no bar that day', () => {
    const term = { ...TERM_CL, curve: { date: null, points: [], missing_ranks: [4, 5] } }
    render(<TermStructurePanel term={term} />)
    expect(screen.queryByRole('table', { name: /Latest curve/ })).toBeNull()
    expect(screen.getByText(RCT.term.curveNone)).toBeTruthy()
    expect(screen.getByText('Ranks without a bar that day: 4, 5.')).toBeTruthy()
  })

  it('says when rows past the fence were dropped, and not otherwise', () => {
    const { unmount } = render(<TermStructurePanel term={TERM_CL} />)
    expect(screen.queryByText(/dropped:/)).toBeNull()
    unmount()
    render(<TermStructurePanel term={{ ...TERM_CL, fenced: 3 }} />)
    expect(screen.getByText('Rows dated on or after 2022-01-01 dropped: 3.')).toBeTruthy()
  })

  it('an empty series has no chart and names the root', () => {
    const empty = { ...TERM_CL, t: [], date: [], front: [], next: [], spread: [], carry: [], f1: [], f2: [], expiry_front: [], expiry_next: [] }
    render(<TermStructurePanel term={empty} />)
    expect(stacks()).toHaveLength(0)
    expect(screen.getByText('CL: no session with both the front and the next contract priced.')).toBeTruthy()
  })
})

describe('hosts', () => {
  it('say loading while a read is on its way, in a status line', () => {
    render(<TrendRegimeHost query={{ data: undefined, error: null }} />)
    expect(screen.getByRole('status').textContent).toBe(RCT.loading)
  })

  it('say why a read failed, in an alert, with the card title kept', () => {
    render(<CapacityHost query={{ data: undefined, error: FAILED }} />)
    expect(screen.getByRole('alert').textContent).toBe('Could not be read: no price source')
    expect(screen.getByText(RCT.capacity.title)).toBeTruthy()
  })

  it('name the root on the term structure card before it arrives', () => {
    render(<TermStructureHost root="CL" query={{ data: undefined, error: null }} />)
    expect(screen.getByText('CL term structure (MV6)')).toBeTruthy()
  })

  it('hand the response to the panel once it arrives', () => {
    render(<TrendRegimeHost query={{ data: TREND_VIEW, error: null }} link="C" />)
    expect(stacks()[0]!.link).toBe('C')
    cleanup()
    render(<TermStructureHost root="CL" query={{ data: TERM_CL, error: null }} />)
    expect(screen.getByText(/2956 sessions/)).toBeTruthy()
  })
})
