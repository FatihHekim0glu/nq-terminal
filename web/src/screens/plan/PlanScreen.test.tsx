// @vitest-environment jsdom
// PLAN (research_ux.md item 2): a screen with no context and no data read. One GET on /api/analytics/plan per settled
// design, the two tables of the served plan, the typed fields and their bounds, and nothing else asked. The request is
// stood in with the captured round 17 design (powerTable.fixtures.ts); the maths is pinned in the backend tests.
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { PLAN } from '../../copy/plan'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { PANEL_ID, mountScreen } from '../reg/testHarness'
import PlanScreen from './PlanScreen'
import { PLAN_EXAMPLE } from './powerTable.fixtures'

configure({ asyncUtilTimeout: 5000 })

const PROPS: ScreenProps = { params: { code: 'PLAN' as never, context: null, args: {}, group: '-' }, context: null }
const DEFAULT_URL = '/api/analytics/plan?periods=252&n=2520&alpha=0.05'

interface Seen {
  readonly url: string
  readonly method: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubPlan(answer: () => Response = () => json(PLAN_EXAMPLE)): Seen[] {
  const seen: Seen[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? 'GET' })
    return Promise.resolve(answer())
  })
  return seen
}

function mount() {
  return mountScreen(<PlanScreen {...PROPS} />)
}

const barsTable = () => screen.findByRole('table', { name: PLAN.barsCaption })
const designTable = () => screen.findByRole('table', { name: PLAN.designCaption })
const field = (name: string) => screen.getByRole('textbox', { name })

beforeEach(() => resetNumbered())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PLAN: the page', () => {
  it('asks the default design once and draws the book line and both tables', async () => {
    const seen = stubPlan()
    mount()
    const bars = await barsTable()
    expect(within(bars).getAllByRole('row')).toHaveLength(3)
    const design = await designTable()
    expect(within(design).getAllByRole('row')).toHaveLength(4)
    expect(screen.getByText('787 observations at 252 a year span 3.12 years, one sided, alpha 0.05.')).toBeTruthy()
    expect(seen).toEqual([{ url: DEFAULT_URL, method: 'GET' }])
  })

  it('is a labelled group whose sections and tables have names a screen reader can read', async () => {
    stubPlan()
    mount()
    await barsTable()
    expect(screen.getByRole('group', { name: PLAN.label })).toBeTruthy()
    expect(screen.getByRole('region', { name: PLAN.barsLabel })).toBeTruthy()
    expect(screen.getByRole('region', { name: PLAN.designLabel })).toBeTruthy()
    expect(screen.getByRole('group', { name: PLAN.inputsLabel })).toBeTruthy()
    for (const table of screen.getAllByRole('table')) {
      expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(3)
      expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(0)
    }
  })

  it('names every field, and offers the four periods and never 365', async () => {
    stubPlan()
    mount()
    await barsTable()
    for (const name of [PLAN.fields.size, PLAN.fields.alpha, PLAN.fields.k, PLAN.fields.sharpe, PLAN.fields.eventSd]) {
      expect(field(name)).toBeTruthy()
    }
    const periods = screen.getByRole('combobox', { name: PLAN.fields.periods })
    fireEvent.click(periods)
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['252 sessions', '52 weeks', '12 months', '4 quarters'])
    expect(document.body.textContent).not.toContain('365')
  })

  it('shows the registry family size beside the typed one and the bars at the next slot', async () => {
    stubPlan()
    mount()
    const bars = await barsTable()
    expect(screen.getByText('59')).toBeTruthy()
    const rows = within(bars).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
    expect(rows[0]!.slice(0, 3)).toEqual(['60', '0.000833', '3.144'])
    expect(rows[1]!.slice(0, 3)).toEqual(['81', '0.000617', '3.231'])
  })

  it('draws the typed Sharpe and event columns when the served plan carries them', async () => {
    stubPlan()
    mount()
    const design = await designTable()
    const headers = within(design).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toContain('Power at typed Sharpe')
    expect(headers).toContain('Mean per event')
    expect(screen.getByText(PLAN.eventNote)).toBeTruthy()
  })

  it('drops those columns when the served plan has no typed Sharpe and no event sd', async () => {
    stubPlan(() => json({ ...PLAN_EXAMPLE, typed_sharpe: null, event_sd: null }))
    mount()
    const design = await designTable()
    const headers = within(design).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).not.toContain('Power at typed Sharpe')
    expect(headers).not.toContain('Mean per event')
    expect(screen.queryByText(PLAN.eventNote)).toBeNull()
  })

  it('says the wording of SV9, gives no verdict and raises no alert', async () => {
    stubPlan()
    mount()
    await barsTable()
    const page = screen.getByRole('group', { name: PLAN.label })
    expect(page.textContent).toContain(PLAN_EXAMPLE.note)
    expect(page.textContent).toContain(PLAN.descriptive)
    expect(page.textContent).not.toMatch(/\[(PASS|FAIL)\]/)
    expect(page.textContent).not.toMatch(/\b(passes|passed|fails|failed|significant|underpowered|adequate)\b/i)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('adds no numbered item of its own and no grid', async () => {
    stubPlan()
    mount()
    await barsTable()
    expect(numberedItems(PANEL_ID).filter((i) => i.n < 85)).toEqual([])
    expect(screen.queryByRole('grid')).toBeNull()
  })
})

describe('PLAN: the typed design is the request', () => {
  it('asks once for a number typed in several keystrokes, after it settles', async () => {
    const seen = stubPlan()
    mount()
    await barsTable()
    for (const text of ['7', '78', '787']) fireEvent.change(field(PLAN.fields.size), { target: { value: text } })
    await waitFor(() => expect(seen.map((s) => s.url)).toContain('/api/analytics/plan?periods=252&n=787&alpha=0.05'))
    expect(seen.map((s) => s.url)).toEqual([DEFAULT_URL, '/api/analytics/plan?periods=252&n=787&alpha=0.05'])
  })

  it('sends the typed family size, Sharpe and event standard deviation', async () => {
    const seen = stubPlan()
    mount()
    await barsTable()
    fireEvent.change(field(PLAN.fields.k), { target: { value: '80' } })
    fireEvent.change(field(PLAN.fields.sharpe), { target: { value: '1' } })
    fireEvent.change(field(PLAN.fields.eventSd), { target: { value: '14.8' } })
    const want = '/api/analytics/plan?periods=252&n=2520&k=80&alpha=0.05&sharpe=1&event_sd=14.8'
    await waitFor(() => expect(seen.map((s) => s.url)).toContain(want))
  })

  it('asks by years when the book is given in years', async () => {
    const seen = stubPlan()
    mount()
    await barsTable()
    fireEvent.click(screen.getByRole('combobox', { name: PLAN.fields.by }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: PLAN.byOptions.years }))
    fireEvent.change(field(PLAN.fields.size), { target: { value: '10' } })
    await waitFor(() => expect(seen.map((s) => s.url)).toContain('/api/analytics/plan?periods=252&years=10&alpha=0.05'))
  })

  it('asks nothing for a value outside a bound, names the field, and hides the stale answer', async () => {
    const seen = stubPlan()
    mount()
    await barsTable()
    fireEvent.change(field(PLAN.fields.size), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByText(/Not asked yet: Size must be from 2 to 100000\./)).toBeTruthy())
    expect(screen.queryByRole('table')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(seen).toHaveLength(1)
    fireEvent.change(field(PLAN.fields.size), { target: { value: '100001' } })
    await waitFor(() => expect(screen.getByText(/Size must be from 2 to 100000\./)).toBeTruthy())
    fireEvent.change(field(PLAN.fields.size), { target: { value: '100000' } })
    await waitFor(() => expect(seen.map((s) => s.url)).toContain('/api/analytics/plan?periods=252&n=100000&alpha=0.05'))
  })

  it('reads GET only on /api/analytics/plan, and no price, result file or registry', async () => {
    const seen = stubPlan()
    mount()
    await barsTable()
    fireEvent.change(field(PLAN.fields.k), { target: { value: '80' } })
    await waitFor(() => expect(seen).toHaveLength(2))
    expect(seen.every((s) => s.method === 'GET' && s.url.startsWith('/api/analytics/plan?'))).toBe(true)
  })

  it('says the plan could not be worked out when the server refuses, with its detail', async () => {
    stubPlan(() => json({ detail: 'a family size is needed' }, 422))
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('The plan could not be worked out: a family size is needed')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says the plan could not be worked out when the body is not a plan', async () => {
    stubPlan(() => json({ slots: 'none' }))
    mount()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`The plan could not be worked out: ${PLAN.malformed}`)
  })

  it('says why the registry family size is missing, and still draws the typed one', async () => {
    const typedOnly = { ...PLAN_EXAMPLE, family_k_registry: null, registry_note: 'the registry could not be read', slots: [PLAN_EXAMPLE.slots[1]!] }
    stubPlan(() => json(typedOnly))
    mount()
    await barsTable()
    expect(screen.getByText('the registry could not be read')).toBeTruthy()
    expect(screen.getAllByText(PLAN.registryUnknown).length).toBeGreaterThan(0)
    expect(within(await barsTable()).getAllByRole('row')).toHaveLength(2)
  })
})

describe('PLAN: the results are announced (WCAG 4.1.3)', () => {
  const liveStatus = () => within(screen.getByRole('group', { name: PLAN.label })).getByRole('status')
  const sansTyped = { ...PLAN_EXAMPLE, slots: [PLAN_EXAMPLE.slots[0]!] }

  it('keeps one polite status region mounted from the first render, before any plan arrives', () => {
    stubPlan()
    mount()
    const status = liveStatus()
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe(PLAN.loading)
  })

  it('rewrites the same region, not a new one, when only the typed family size changes', async () => {
    stubPlan((() => {
      let calls = 0
      return () => json((calls += 1) === 1 ? sansTyped : PLAN_EXAMPLE)
    })())
    mount()
    await barsTable()
    const status = liveStatus()
    await waitFor(() => expect(status.textContent).toContain('Registry 59'))
    expect(status.textContent).not.toContain('Typed 80')
    fireEvent.change(field(PLAN.fields.k), { target: { value: '80' } })
    await waitFor(() => expect(status.textContent).toContain('Typed 80'))
    expect(liveStatus()).toBe(status)
    expect(status.textContent).toContain('next slot 81')
    expect(status.textContent).toContain('Bonferroni bar 0.000617')
  })

  it('says the problem in the same region when the draft is invalid, and keeps the region mounted', async () => {
    stubPlan()
    mount()
    await barsTable()
    const status = liveStatus()
    fireEvent.change(field(PLAN.fields.size), { target: { value: '1' } })
    await waitFor(() => expect(status.textContent).toContain('Size must be from 2 to 100000.'))
    expect(liveStatus()).toBe(status)
    fireEvent.change(field(PLAN.fields.size), { target: { value: '787' } })
    await waitFor(() => expect(status.textContent).toContain('Registry 59'))
  })

  it('marks both answer sections busy while the next answer is awaited, and clears the mark after', async () => {
    let release: (() => void) | undefined
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1
      if (calls === 1) return Promise.resolve(json(PLAN_EXAMPLE))
      return new Promise<Response>((resolve) => { release = () => resolve(json(PLAN_EXAMPLE)) })
    })
    mount()
    await barsTable()
    const sections = () => [PLAN.barsLabel, PLAN.designLabel].map((name) => screen.getByRole('region', { name }))
    expect(sections().map((s) => s.getAttribute('aria-busy'))).toEqual([null, null])
    fireEvent.change(field(PLAN.fields.k), { target: { value: '80' } })
    await waitFor(() => expect(sections().map((s) => s.getAttribute('aria-busy'))).toEqual(['true', 'true']))
    await waitFor(() => expect(release).toBeDefined())
    expect(sections().map((s) => s.getAttribute('aria-busy'))).toEqual(['true', 'true'])
    release?.()
    await waitFor(() => expect(sections().map((s) => s.getAttribute('aria-busy'))).toEqual([null, null]))
  })
})

