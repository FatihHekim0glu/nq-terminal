// @vitest-environment jsdom
// U07: from a hypothesis's DES, 'Gate reads (OOS) for this hypothesis' opens OOS on that caller's reads, and says
// how many reads the gate log holds under that exact caller name ('3 reads logged as caller volmanaged_v0'). A
// hypothesis's screens may log their reads under other caller names (za_v0 reads as za_screen), and a caller is
// recorded, never inferred from a name stem, so the words are scoped to what was asked and the unscoped 'no reads
// recorded' appears nowhere. The count is the gate log's own `matched` for the caller (one GET with limit 1); a
// failed or pending read shows the link alone, never a made-up zero. The link opens OOS on this caller in this
// panel only (oosCaller), and the count is tied to the link button for assistive technology (aria-describedby).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { resetPanelSources } from '../../chrome/panelSources'
import { OOS_LINK } from '../../copy/oos'
import { requestOosCaller, resetOosCaller, useOosCallerRequest } from '../oos/oosCaller'
import type { HypothesisDetail } from './desModel'
import { VOLMANAGED } from './desTestData'
import HypothesisDes from './HypothesisDes'

vi.mock('../../charts/LineStack', async () => {
  const { createElement: h } = await import('react')
  return { default: () => h('div') }
})
vi.mock('../../charts/echarts/BarLadder', async () => {
  const { createElement: h } = await import('react')
  return { BarLadder: () => h('div') }
})

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const actions: PanelActions = { panelId: 'p-des', related: () => false, back: () => false, forward: () => false, open: () => false }

/** What the gate log answers for one caller with limit 1: the counts describe the whole log, `matched` this caller. */
function oosLog(matched: number): Schemas['OosLog'] {
  return {
    counts_by_caller: { volmanaged_v0: matched }, entries: [], fence_end: '2022-01-01', filters: { caller: 'volmanaged_v0', since: null, limit: 1, offset: 0 },
    key_sets: {}, log_present: true, matched, parse_errors: [], partial_tail: false, returned: 0, sealed_reads: 0, terminal_reads: 0, total: 40,
    severity_levels: [], severity_counts: {},
  }
}

let oosStatus = 200
let matched = 3
let oosRequests: URL[] = []
/** While set, the gate log's answer waits for it, so a test can look at the pending state. */
let holdOos: Promise<void> | null = null

function show(detail: HypothesisDetail = VOLMANAGED) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    if (url.pathname === `/api/hypotheses/${detail.card.name}`) return json(detail)
    if (url.pathname === '/api/audit/oos-log') {
      oosRequests.push(url)
      if (holdOos) await holdOos
      return oosStatus === 200 ? json(oosLog(matched)) : json({ detail: 'down' }, oosStatus)
    }
    return json({ detail: 'not in this test' }, 404)
  })
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  render(createElement(ApiProvider, { client, children: createElement(PanelActionsContext, { value: actions }, createElement(HypothesisDes, { name: detail.card.name, link: '-' })) }))
}

const link = () => screen.findByRole('button', { name: OOS_LINK.link })

beforeEach(() => {
  oosStatus = 200
  matched = 3
  oosRequests = []
  holdOos = null
  resetOosCaller()
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})
afterEach(() => {
  cleanup()
  resetPanelSources()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('U07: DES links a hypothesis to its gate reads', () => {
  it('shows the link with the caller\'s recorded reads, from one small GET for that caller', async () => {
    show()
    const button = await link()
    expect(button.textContent).toBe(OOS_LINK.link)
    expect(OOS_LINK.link).toBe('Gate reads (OOS) for this hypothesis')
    expect(await screen.findByText('3 reads logged as caller volmanaged_v0')).toBeTruthy()
    expect(oosRequests).toHaveLength(1)
    expect(oosRequests[0]!.searchParams.get('caller')).toBe('volmanaged_v0')
    expect(oosRequests[0]!.searchParams.get('limit')).toBe('1')
  })

  it('says one read, not one reads', async () => {
    matched = 1
    show()
    expect(await screen.findByText('1 read logged as caller volmanaged_v0')).toBeTruthy()
  })

  it('says no reads were logged as this caller, not that there are none, and keeps the link', async () => {
    matched = 0
    show()
    expect(await screen.findByText('no reads logged as caller volmanaged_v0 (a screen may log its reads under its own caller name)')).toBeTruthy()
    expect((await link()).textContent).toBe(OOS_LINK.link)
  })

  it('never says the unscoped \'no reads recorded\': a hypothesis may be read under another caller name', async () => {
    matched = 0
    show()
    await screen.findByText(/no reads logged as caller/)
    expect(screen.queryByText(/no reads recorded/)).toBeNull()
    expect(document.body.textContent).not.toContain('no reads recorded')
    for (const text of Object.values(OOS_LINK)) expect(text).not.toMatch(/recorded/)
    // and the count only ever names the caller it asked for, never one inferred from the hypothesis name
    expect(oosRequests.every((u) => u.searchParams.get('caller') === 'volmanaged_v0')).toBe(true)
  })

  it('shows the link alone, with no count, when the gate log cannot be read', async () => {
    oosStatus = 503
    show()
    await link()
    await vi.waitFor(() => expect(oosRequests.length).toBeGreaterThan(0))
    expect(screen.queryByText(/logged as caller/)).toBeNull()
    expect(screen.queryByText(/no reads/)).toBeNull()
  })

  it('opens OOS on this caller: it asks OOS for the caller, then runs the OOS command', async () => {
    show()
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    const taken: string[] = []
    // An OOS screen that is open takes the caller the moment it is asked for.
    const { renderHook } = await import('@testing-library/react')
    renderHook(() => useOosCallerRequest('p-des', (c) => taken.push(c)))
    fireEvent.click(await link())
    stop()
    expect(taken).toEqual(['volmanaged_v0'])
    expect(lines).toEqual([{ line: 'OOS', newPanel: false }])
  })

  it('does not hand the caller to an OOS that is open in another panel', async () => {
    show()
    const taken: string[] = []
    const { renderHook } = await import('@testing-library/react')
    renderHook(() => useOosCallerRequest('p-other', (c) => taken.push(c)))
    fireEvent.click(await link())
    expect(taken).toEqual([])
  })

  it('leaves the caller waiting for an OOS that is not open yet', async () => {
    show()
    fireEvent.click(await link())
    const taken: string[] = []
    const { renderHook } = await import('@testing-library/react')
    renderHook(() => useOosCallerRequest('p-des', (c) => taken.push(c)))
    expect(taken).toEqual(['volmanaged_v0'])
  })

  it('has not asked OOS for anything before the link is used', async () => {
    show()
    await link()
    const taken: string[] = []
    const { renderHook } = await import('@testing-library/react')
    renderHook(() => useOosCallerRequest('p-des', (c) => taken.push(c)))
    expect(taken).toEqual([])
    requestOosCaller('', 'p-des')
    expect(taken).toEqual([])
  })
})

describe('U07: the gate-read count is tied to the link for assistive technology', () => {
  it('points the link button at the element holding the count once it shows', async () => {
    show()
    const button = await link()
    const count = await screen.findByText('3 reads logged as caller volmanaged_v0')
    const id = button.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)).toBe(count)
  })

  it('has no aria-describedby while the count is pending', async () => {
    let release: () => void = () => {}
    holdOos = new Promise<void>((resolve) => { release = resolve })
    show()
    const button = await link()
    await vi.waitFor(() => expect(oosRequests.length).toBeGreaterThan(0))
    expect(button.hasAttribute('aria-describedby')).toBe(false)
    release()
    await screen.findByText('3 reads logged as caller volmanaged_v0')
    expect(button.hasAttribute('aria-describedby')).toBe(true)
  })

  it('has no aria-describedby when the gate log cannot be read', async () => {
    oosStatus = 503
    show()
    const button = await link()
    await vi.waitFor(() => expect(oosRequests.length).toBeGreaterThan(0))
    expect(screen.queryByText(/logged as caller/)).toBeNull()
    expect(button.hasAttribute('aria-describedby')).toBe(false)
  })
})
