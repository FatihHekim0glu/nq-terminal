// @vitest-environment jsdom
// The exposure card's composition toggle (roadmap #13 slice 2; ANALYTICS_CATALOG EX1 by instrument): Totals
// stays today's gross, net and turnover stack; By instrument and By sector draw the per-instrument series
// through Composition (mocked here: jsdom has no canvas) in a taller box, with the absolute values note,
// the unit line and the sampling sentence. The toggle exists only where the API sent by_instrument. The
// instrument index comes from GET /api/commands unless a caller (the gallery) passes one; every request
// is a GET, and every value handed to the chart is the served value at its sampled index.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { CompositionInput, CompositionMode } from '../../charts/echarts/compositionModel'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { COMPOSITION } from '../../copy/composition'
import { TEAR_BOOKS as B } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'
import { ROOTS } from '../mon/testUniverse'
import { compositionInput, compositionView, sampleIndexes } from './bookComposition'
import { COMPOSITION_EXPOSURE, COMPOSITION_INDEX, COMPOSITION_RUN } from './composition.fixtures'
import css from './tearComposition.css?raw'
import { ExposureCard } from './RunBooks'
import { NO_EXPOSURE, RUN_EXPOSURE } from './tear.fixtures'

interface Drawn {
  readonly mode: CompositionMode
  readonly data: CompositionInput
  readonly chartId?: string
}

const drawn = vi.hoisted(() => ({ list: [] as unknown[] }))
const compositions = () => drawn.list as Drawn[]
const lastDrawn = () => compositions().at(-1)!

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string }) => <div data-testid="linestack" data-title={props.title} />,
}))

vi.mock('../../charts/echarts/Composition', () => ({
  Composition: (props: { mode: string; chartId?: string }) => {
    drawn.list.push(props)
    return <div data-testid="composition" data-mode={props.mode} data-chart-id={props.chartId} />
  },
}))

const RUN = 'nt_volmanaged_v0_fixture_m1'
const SERVED_INDEX = { instruments: ROOTS.map(([root, sector]) => ({ root, symbol: `${root}.V.0`, sector })) }
const EMPTY = { ...RUN_EXPOSURE, exposure: { ...RUN_EXPOSURE.exposure!, by_instrument: {} } }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let calls: Array<{ path: string; method: string }> = []
let commandsStatus = 200

beforeEach(() => {
  calls = []
  commandsStatus = 200
  drawn.list = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const path = decodeURIComponent(url.pathname)
    calls.push({ path, method: init?.method ?? 'GET' })
    if (path === '/api/commands') return commandsStatus === 200 ? json(SERVED_INDEX) : json({ detail: 'down' }, commandsStatus)
    return json({ detail: 'not in this test' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Props = Partial<ComponentProps<typeof ExposureCard>>

function show(exposure = RUN_EXPOSURE, props: Props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const card = (e: typeof exposure, p: Props) => (
    <ApiProvider client={client}>
      <ExposureCard exposure={e} runId={RUN} link="-" {...p} />
    </ApiProvider>
  )
  const view = render(card(exposure, props))
  return { ...view, again: (e: typeof exposure, p: Props = props) => view.rerender(card(e, p)) }
}

const toggle = () => screen.queryByRole('group', { name: COMPOSITION.toggle })
const press = (label: string) => fireEvent.click(within(toggle()!).getByRole('button', { name: label }))
const text = (needle: string) => screen.queryByText((_, node) => node?.tagName === 'P' && (node.textContent ?? '') === needle)

describe('Totals (the default)', () => {
  it('keeps the gross, net and turnover stack, its unit line and its notes, and draws no composition', () => {
    show(RUN_EXPOSURE, { index: null })
    expect(screen.getByTestId('linestack')).toBeTruthy()
    expect(screen.queryByTestId('composition')).toBeNull()
    const e = RUN_EXPOSURE.exposure!
    const t = RUN_EXPOSURE.turnover!
    expect(text(fillCopy(B.exposureUnitTurnover, { label: e.label, unit: e.unit, turnover: t.unit }))).toBeTruthy()
    expect(text(fillCopy(B.priceBasis, { text: e.price_basis }))).toBeTruthy()
    expect(text(B.reconcile)).toBeTruthy()
    expect(text(COMPOSITION.absolute)).toBeNull()
    expect(text(COMPOSITION.sampling.every)).toBeNull()
  })

  it('is what a run without per-instrument values shows, with no toggle', () => {
    show(EMPTY, { index: null })
    expect(toggle()).toBeNull()
    expect(screen.getByTestId('linestack')).toBeTruthy()
    expect(screen.queryByRole('button', { name: COMPOSITION.views.heat })).toBeNull()
  })

  it('shows the served refusal, and no toggle, for a run without snapshots', () => {
    show(NO_EXPOSURE, { index: null })
    expect(toggle()).toBeNull()
    expect(screen.queryByTestId('linestack')).toBeNull()
    expect(screen.getByText(fillCopy(B.unavailable, { note: NO_EXPOSURE.note ?? '' }))).toBeTruthy()
  })
})

describe('the Totals, By instrument and By sector toggle', () => {
  it('appears when by_instrument holds an instrument, with Totals pressed', () => {
    show(RUN_EXPOSURE, { index: null })
    const buttons = within(toggle()!).getAllByRole('button')
    expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      [COMPOSITION.views.totals, 'true'],
      [COMPOSITION.views.heat, 'false'],
      [COMPOSITION.views.stack, 'false'],
    ])
    expect(COMPOSITION.views).toEqual({ totals: 'Totals', heat: 'By instrument', stack: 'By sector' })
  })

  it('makes its buttons roving items, so arrows and Tab move through them like every toggle', () => {
    show(RUN_EXPOSURE, { index: null })
    for (const b of within(toggle()!).getAllByRole('button')) expect(b.hasAttribute(ROVING_ATTR)).toBe(true)
  })

  it('By instrument draws Composition in heat mode, in the composition box, and Totals leaves', () => {
    const { container } = show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.heat)
    expect(screen.queryByTestId('linestack')).toBeNull()
    const chart = screen.getByTestId('composition')
    expect(chart.getAttribute('data-mode')).toBe('heat')
    expect(chart.closest('.tear-chart-composition')).not.toBeNull()
    expect(container.querySelector('.tear-chart-short')).toBeNull()
    expect(within(toggle()!).getByRole('button', { name: COMPOSITION.views.heat }).getAttribute('aria-pressed')).toBe('true')
    expect(within(toggle()!).getByRole('button', { name: COMPOSITION.views.totals }).getAttribute('aria-pressed')).toBe('false')
  })

  it('By sector draws Composition in stack mode', () => {
    show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.stack)
    expect(screen.getByTestId('composition').getAttribute('data-mode')).toBe('stack')
    expect(screen.queryByTestId('linestack')).toBeNull()
  })

  it('goes back to Totals with the same stack', () => {
    show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.heat)
    press(COMPOSITION.views.totals)
    expect(screen.getByTestId('linestack')).toBeTruthy()
    expect(screen.queryByTestId('composition')).toBeNull()
  })

  it('names each chart on its own, so two cards on a page never share a draw measure', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <ApiProvider client={client}>
        <ExposureCard exposure={RUN_EXPOSURE} runId={RUN} link="-" index={SERVED_INDEX} />
        <ExposureCard exposure={RUN_EXPOSURE} runId={RUN} link="-" index={SERVED_INDEX} />
      </ApiProvider>,
    )
    for (const group of screen.getAllByRole('group', { name: COMPOSITION.toggle })) {
      fireEvent.click(within(group).getByRole('button', { name: COMPOSITION.views.heat }))
    }
    const ids = screen.getAllByTestId('composition').map((c) => c.getAttribute('data-chart-id'))
    expect(ids).toHaveLength(2)
    expect(ids[0]).toMatch(/^tear-composition-[A-Za-z0-9_-]+$/)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('falls back to Totals when a new read holds no instrument, and to the refusal when it holds no snapshot', () => {
    const card = show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.heat)
    card.again(EMPTY)
    expect(toggle()).toBeNull()
    expect(screen.getByTestId('linestack')).toBeTruthy()
    card.again(RUN_EXPOSURE)
    press(COMPOSITION.views.stack)
    card.again(NO_EXPOSURE)
    expect(toggle()).toBeNull()
    expect(screen.getByText(fillCopy(B.unavailable, { note: NO_EXPOSURE.note ?? '' }))).toBeTruthy()
    card.again(RUN_EXPOSURE)
    expect(toggle()).not.toBeNull()
  })
})

describe('the notes under a composition view', () => {
  it('prints the absolute values note, the unit line without turnover, and the sampling sentence', () => {
    show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.heat)
    const e = RUN_EXPOSURE.exposure!
    expect(text(COMPOSITION.absolute)).toBeTruthy()
    expect(text(COMPOSITION.sampling.every)).toBeTruthy()
    expect(text(fillCopy(B.exposureUnit, { label: e.label, unit: e.unit }))).toBeTruthy()
    expect(text(fillCopy(B.exposureUnitTurnover, { label: e.label, unit: e.unit, turnover: RUN_EXPOSURE.turnover!.unit }))).toBeNull()
    press(COMPOSITION.views.stack)
    expect(text(COMPOSITION.absolute)).toBeTruthy()
    expect(text(COMPOSITION.sampling.every)).toBeTruthy()
  })

  it('says weekly when 1,300 sessions are sampled by week, and nothing about weeks under Totals', () => {
    show(COMPOSITION_EXPOSURE, { index: COMPOSITION_INDEX })
    expect(text(COMPOSITION.sampling.week)).toBeNull()
    press(COMPOSITION.views.heat)
    expect(text(COMPOSITION.sampling.week)).toBeTruthy()
    expect(text(COMPOSITION.sampling.every)).toBeNull()
    press(COMPOSITION.views.totals)
    expect(text(COMPOSITION.sampling.week)).toBeNull()
  })

  it('keeps the price basis, reconcile line and means under every view', () => {
    show(RUN_EXPOSURE, { index: SERVED_INDEX })
    const e = RUN_EXPOSURE.exposure!
    for (const view of [COMPOSITION.views.heat, COMPOSITION.views.stack, COMPOSITION.views.totals]) {
      press(view)
      expect(text(fillCopy(B.priceBasis, { text: e.price_basis }))).toBeTruthy()
      expect(text(B.reconcile)).toBeTruthy()
      expect(screen.getByText(/^Mean gross /)).toBeTruthy()
    }
  })
})

describe('what the chart is given', () => {
  it('is the composition of the served exposure and the index, named for the run', () => {
    show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.heat)
    const view = compositionView(RUN_EXPOSURE.exposure, SERVED_INDEX)!
    expect(lastDrawn().mode).toBe('heat')
    expect(lastDrawn().data).toEqual(compositionInput(view, RUN, 'heat'))
    expect(lastDrawn().data.name).toBe(fillCopy(COMPOSITION.heatName, { run: RUN }))
    press(COMPOSITION.views.stack)
    expect(lastDrawn().mode).toBe('stack')
    expect(lastDrawn().data).toEqual(compositionInput(view, RUN, 'stack'))
    expect(lastDrawn().data.name).toBe(fillCopy(COMPOSITION.stackName, { run: RUN }))
  })

  it('shows every value as served at its sampled index: 27 instruments under seven sector bands', () => {
    show(COMPOSITION_EXPOSURE, { index: COMPOSITION_INDEX })
    press(COMPOSITION.views.heat)
    const { data } = lastDrawn()
    const e = COMPOSITION_EXPOSURE.exposure!
    const { idx, sampling } = sampleIndexes(e.date, 260)
    expect(sampling).toBe('week')
    expect(data.columns).toEqual(idx.map((i) => e.date[i]))
    expect(data.note).toBe(COMPOSITION.sampling.week)
    expect(data.rows.filter((r) => r.kind === 'band')).toHaveLength(7)
    const instruments = data.rows.filter((r) => r.kind === 'instrument')
    expect(instruments).toHaveLength(27)
    for (const row of instruments) {
      const key = `${row.label}.XCME`
      expect(row.values).toEqual(idx.map((i) => e.by_instrument[key]![i]))
    }
    expect(data.gross).toEqual(idx.map((i) => e.gross[i]))
    expect(data.net).toEqual(idx.map((i) => e.net[i]))
    expect(COMPOSITION_EXPOSURE.run_id).toBe(COMPOSITION_RUN)
  })

  it('puts the instruments of a null index under the not-in-the-index band', () => {
    show(RUN_EXPOSURE, { index: null })
    press(COMPOSITION.views.heat)
    expect(lastDrawn().data.rows.filter((r) => r.kind === 'band').map((r) => r.label)).toEqual([COMPOSITION.other])
  })
})

describe('the instrument index', () => {
  it('is read from GET /api/commands when the caller gives none, and the bands follow it', async () => {
    show(RUN_EXPOSURE)
    press(COMPOSITION.views.heat)
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/commands'))
    await waitFor(() => expect(lastDrawn().data.rows.filter((r) => r.kind === 'band').map((r) => r.label)).not.toEqual([COMPOSITION.other]))
    expect(lastDrawn().data).toEqual(compositionInput(compositionView(RUN_EXPOSURE.exposure, SERVED_INDEX)!, RUN, 'heat'))
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })

  it('is not asked for when the caller passes one, even an empty one', async () => {
    show(RUN_EXPOSURE, { index: SERVED_INDEX })
    press(COMPOSITION.views.heat)
    await Promise.resolve()
    expect(calls.filter((c) => c.path === '/api/commands')).toEqual([])
    cleanup()
    show(RUN_EXPOSURE, { index: null })
    expect(calls.filter((c) => c.path === '/api/commands')).toEqual([])
  })

  it('leaves the instruments in the not-in-the-index band while the index is unavailable, and still draws', async () => {
    commandsStatus = 503
    show(RUN_EXPOSURE)
    press(COMPOSITION.views.stack)
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/commands'))
    expect(screen.getByTestId('composition').getAttribute('data-mode')).toBe('stack')
    expect(lastDrawn().data.rows.filter((r) => r.kind === 'band').map((r) => r.label)).toEqual([COMPOSITION.other])
  })

  it('sends only GET requests', async () => {
    show(RUN_EXPOSURE)
    press(COMPOSITION.views.heat)
    press(COMPOSITION.views.stack)
    press(COMPOSITION.views.totals)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    expect(calls.map((c) => c.path)).toEqual(['/api/commands'])
  })
})

describe('tearComposition.css', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = [...stripped.matchAll(/\{([^{}]*)\}/g)].flatMap((m) => (m[1] ?? '').split(';').map((d) => d.trim()).filter(Boolean))

  it('sizes the composition box and nothing else: no colour, background or border', () => {
    expect(stripped).toMatch(/\.tear-chart-composition\s*[,{]/)
    expect(declarations.length).toBeGreaterThan(0)
    for (const d of declarations) expect(d).not.toMatch(/colou?r|background|border|fill|stroke|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    expect(stripped).toMatch(/height\s*:/)
  })
})
