// @vitest-environment jsdom
// REG 95) Compare (roadmap #9 phase B, W6-R9b): the served Basis A screen series of the marked hypotheses,
// one GET each at the chosen cost, drawn by LineStack (a stand-in here) one pane per unit; a hypothesis
// the API cannot answer is listed, never drawn. GET only, and no test, verdict or p value of its own.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Schemas } from '../../api/types'
import type { LineStackProps } from '../../charts/LineStack.types'
import { REG } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'
import RegCompare from './RegCompare'
import { mountScreen } from './testHarness'

const charts = vi.hoisted(() => ({ props: [] as LineStackProps[] }))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => {
    charts.props.push(props)
    return <div data-testid="linestack" />
  },
}))

type Body = Schemas['HypothesisSeries']

const POINTS = 'points per trade (NQ)'
const VM = 'volmanaged_v0'
const ON = 'overnight_v0'

function body(name: string, unit: string, cost: number, t: number[], equity: number[]): Body {
  return { basis: 'A', bench_label: null, cost, equity, kind: 'trades', name, r: equity.map(() => 0), r_bench: null, source: 'fixture', t, unit }
}

const url = (name: string, cost: number) => `/api/hypotheses/${name}/series?cost=${cost}`

const ROUTES: Readonly<Record<string, Body>> = {
  [url(VM, 1)]: body(VM, POINTS, 1, [100, 200, 300], [0.5, 1.5, 1]),
  [url(ON, 1)]: body(ON, POINTS, 1, [200, 300, 400], [1, 2, 3]),
  [url(VM, 0)]: body(VM, POINTS, 0, [100, 200, 300], [0.75, 1.75, 1.25]),
  [url(ON, 0)]: body(ON, POINTS, 0, [200, 300, 400], [1.25, 2.25, 3.25]),
  [url('usd_v0', 1)]: body('usd_v0', 'USD', 1, [100, 300], [1000, 2500]),
}

interface Seen {
  readonly url: string
  readonly method: string
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** Answers the series GETs from ROUTES; any other URL is a 404 with the demo's own detail. */
function stubSeries(routes: Readonly<Record<string, Body>> = ROUTES): Seen[] {
  const seen: Seen[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const requested = String(input)
    seen.push({ url: requested, method: init?.method ?? 'GET' })
    const found = routes[requested]
    return Promise.resolve(found ? json(found) : json({ detail: 'not in the demo dataset' }, 404))
  })
  return seen
}

function lastChart(): LineStackProps {
  const props = charts.props.at(-1)
  if (!props) throw new Error('no chart drawn')
  return props
}

function mount(names: readonly string[], onBack: () => void = () => undefined, link: 'A' | '-' = 'A') {
  charts.props = []
  return mountScreen(<RegCompare names={names} link={link} onBack={onBack} />)
}

async function chosen(label: string): Promise<void> {
  fireEvent.click(screen.getByRole('combobox', { name: REG.compare.costLabel }))
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

afterEach(() => cleanup())

describe('RegCompare: the requests', () => {
  it('reads GET /api/hypotheses/{name}/series at 1 tick for each marked name, and only that', async () => {
    const seen = stubSeries()
    mount([VM, ON])
    await waitFor(() => expect(charts.props.length).toBeGreaterThan(0))
    expect(new Set(seen.map((s) => s.url))).toEqual(new Set([url(VM, 1), url(ON, 1)]))
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('offers 0, 1 and 2 ticks per side, defaulting to 1 tick', async () => {
    stubSeries()
    mount([VM])
    const field = screen.getByRole('combobox', { name: REG.compare.costLabel })
    expect(field.textContent).toContain(REG.compare.costs['1'])
    fireEvent.click(field)
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['0 ticks', '1 tick', '2 ticks'])
  })

  it('refetches at the new cost when the dropdown changes, and names the series with it', async () => {
    const seen = stubSeries()
    mount([VM, ON])
    await waitFor(() => expect(lastChart().panes[0]?.series).toHaveLength(2))
    await chosen(REG.compare.costs['0'])
    await waitFor(() => expect(seen.map((s) => s.url)).toEqual(expect.arrayContaining([url(VM, 0), url(ON, 0)])))
    await waitFor(() => expect(lastChart().panes[0]?.series[0]?.name).toBe('volmanaged_v0 (0 ticks)'))
    expect(lastChart().panes[0]!.series[0]!.values).toEqual([0.75, 1.75, 1.25, null])
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('asks for nothing when the basket is empty', async () => {
    const seen = stubSeries()
    mount([])
    await new Promise((r) => setTimeout(r, 20))
    expect(seen).toEqual([])
    expect(screen.queryByTestId('linestack')).toBeNull()
  })
})

describe('RegCompare: the chart', () => {
  it('draws the served values on the union of the times, one series per hypothesis, in the basket sequence', async () => {
    stubSeries()
    mount([VM, ON], undefined, 'A')
    await waitFor(() => expect(lastChart().panes).toHaveLength(1))
    const chart = lastChart()
    expect(chart.t).toEqual([100, 200, 300, 400])
    expect(chart.panes[0]!.series.map((s) => [s.name, s.style, s.values])).toEqual([
      ['volmanaged_v0 (1 tick)', 'compare1', [0.5, 1.5, 1, null]],
      ['overnight_v0 (1 tick)', 'compare2', [null, 1, 2, 3]],
    ])
    expect(chart.title).toBe(fillCopy(REG.compare.chartTitle, { n: 2 }))
    expect(chart.link).toBe('A')
  })

  it('titles a single series in the singular', async () => {
    stubSeries()
    mount([VM])
    await waitFor(() => expect(lastChart().panes).toHaveLength(1))
    expect(lastChart().title).toBe(REG.compare.chartTitleOne)
  })

  it('forwards an unlinked panel as the unlinked group', async () => {
    stubSeries()
    mount([VM], undefined, '-')
    await waitFor(() => expect(lastChart().panes).toHaveLength(1))
    expect(lastChart().link).toBe('-')
  })

  it('gives a second unit its own pane and says which unit each pane is in', async () => {
    stubSeries()
    mount([VM, 'usd_v0', ON])
    await waitFor(() => expect(lastChart().panes).toHaveLength(2))
    const units = screen.getByRole('list', { name: REG.compare.unitsLabel })
    const lines = within(units).getAllByRole('listitem').map((li) => li.textContent)
    expect(lines).toEqual([
      fillCopy(REG.compare.unitLine, { n: 1, unit: POINTS, names: `${VM}, ${ON}` }),
      fillCopy(REG.compare.unitLine, { n: 2, unit: 'USD', names: 'usd_v0' }),
    ])
    expect(lastChart().panes[1]!.series.map((s) => s.style)).toEqual(['compare2'])
  })

  it('shows the note with the cost, the tag, the basis and that nothing is tested', async () => {
    stubSeries()
    mount([VM])
    const note = fillCopy(REG.compare.note, { cost: REG.compare.costs['1'] })
    expect(screen.getByText(note)).toBeTruthy()
    expect(note).toContain('[POST HOC]')
    expect(note).toContain('Basis A')
    expect(note).toContain('1 tick per side')
    await chosen(REG.compare.costs['2'])
    expect(screen.getByText(fillCopy(REG.compare.note, { cost: REG.compare.costs['2'] }))).toBeTruthy()
  })

  it('is busy while a series is on its way and settles afterwards', async () => {
    stubSeries()
    mount([VM, ON])
    const region = screen.getByRole('region')
    expect(region.getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(region.getAttribute('aria-busy')).toBe('false'))
  })

  it('carries no verdict, pass mark, p value or computed statistic beyond the served series', async () => {
    stubSeries()
    mount([VM, ON])
    await waitFor(() => expect(lastChart().panes).toHaveLength(1))
    const region = screen.getByRole('region')
    const withoutNote = (region.textContent ?? '').replace(fillCopy(REG.compare.note, { cost: REG.compare.costs['1'] }), '')
    expect(withoutNote).not.toMatch(/\[(PASS|FAIL|CHECK)\]|\bp\s*[=<]|\bt\s*=|Sharpe|DSR|Holm|q\s*=/i)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})

describe('RegCompare: hypotheses the API cannot answer', () => {
  it('lists a 404 with the API detail and draws only the others', async () => {
    stubSeries()
    mount([VM, 'ghost_v0', ON])
    await screen.findByText(fillCopy(REG.compare.failed, { name: 'ghost_v0', detail: 'not in the demo dataset' }))
    await waitFor(() => expect(lastChart().panes).toHaveLength(1))
    expect(lastChart().panes[0]!.series.map((s) => s.name)).toEqual(['volmanaged_v0 (1 tick)', 'overnight_v0 (1 tick)'])
    // The overnight series keeps the third compare style: its place in the basket did not move up.
    expect(lastChart().panes[0]!.series[1]!.style).toBe('compare3')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('lists every marked name and draws no chart when none can be answered (the demo case)', async () => {
    stubSeries({})
    mount([VM, ON])
    for (const name of [VM, ON]) await screen.findByText(fillCopy(REG.compare.failed, { name, detail: 'not in the demo dataset' }))
    expect(screen.queryByTestId('linestack')).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(screen.getByRole('combobox', { name: REG.compare.costLabel })).toBeTruthy()
    expect(screen.getByText(fillCopy(REG.compare.note, { cost: REG.compare.costs['1'] }))).toBeTruthy()
  })

  it('names a server fault by the detail it sent', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json({ detail: 'a frozen table no longer fits its file' }, 500)))
    mount([VM])
    await screen.findByText(fillCopy(REG.compare.failed, { name: VM, detail: 'a frozen table no longer fits its file' }))
    expect(screen.queryByTestId('linestack')).toBeNull()
  })
})

describe('RegCompare: Back', () => {
  it('has a Back button that hands control to the board', () => {
    stubSeries()
    const onBack = vi.fn()
    mount([VM], onBack)
    fireEvent.click(screen.getByRole('button', { name: REG.compare.back }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('makes Back one of the panel roving items, so the keyboard reaches it', () => {
    stubSeries()
    mount([VM])
    expect(screen.getByRole('button', { name: REG.compare.back }).hasAttribute('data-roving')).toBe(true)
  })
})
