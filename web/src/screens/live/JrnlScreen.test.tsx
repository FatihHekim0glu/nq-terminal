// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { Schemas } from '../../api/types'
import { createApiQueryClient } from '../../api/queries'
import { liveStreamHub } from '../../api/useLiveStream'
import { JRNL } from '../../copy/live'
import { STREAM } from '../../copy/liveStream'
import { stubLayout } from '../../grids/testing'
import { ALL_ROWS, BANNER, BOOK, BOOK_CLOSE_ROWS, PREFLIGHT, emptyStatus, page, status } from './liveFixtures'
import JrnlScreen, { Rows } from './JrnlScreen'

function json(body: unknown, code = 200): Response {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } })
}

function routes(statusBody: unknown = status()) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/live/status') return json(statusBody)
    if (url.pathname === '/api/live/journal') {
      const file = url.searchParams.get('file')
      const type = url.searchParams.get('type')
      const rows = ALL_ROWS.filter((r) => (file === null || r.file === file) && (type === null || r.data.type === type))
      return json(page(rows))
    }
    return json({ detail: 'unexpected' }, 404)
  })
}

function mount() {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <ApiProvider client={client}>
      <JrnlScreen params={{ code: 'JRNL', context: null, args: {}, group: '-' }} context={null} />
    </ApiProvider>,
  )
}

async function gridRows(): Promise<HTMLElement[]> {
  const grid = await screen.findByRole('grid', { name: /Journal rows/ })
  await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(1))
  return within(grid).getAllByRole('row').slice(1)
}

beforeEach(() => stubLayout(600))
afterEach(() => {
  cleanup()
  liveStreamHub.reset()
  vi.unstubAllGlobals()
})

/** A stand-in EventSource the test drives, as the browser would deliver server events. */
class FakeSource {
  static made: FakeSource[] = []
  readyState = 0
  onerror: ((event: Event) => void) | null = null
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSource.made.push(this)
  }
  addEventListener(type: string, fn: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close(): void {
    this.readyState = 2
  }
  emit(kind: string, data: unknown): void {
    this.readyState = 1
    for (const fn of this.listeners.get(kind) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

describe('JRNL on the live stream (TASKS 9.2)', () => {
  it('opens the stream, stops polling once it is open and refetches the rows when a row is streamed', async () => {
    FakeSource.made = []
    vi.stubGlobal('EventSource', FakeSource)
    const spy = routes()
    mount()
    await gridRows()
    expect(FakeSource.made.map((f) => f.url)).toEqual(['/api/live/stream'])
    const journalCalls = () => spy.mock.calls.filter(([u]) => String(u).startsWith('/api/live/journal')).length
    FakeSource.made[0]!.emit('hello', {
      kind: 'hello', schema_version: 1, resumed: true, resume_note: null, poll_s: 1, heartbeat_s: 10, lifetime_s: 120,
      retry_ms: 2000, banner: BANNER, basis: 'rows', read_only: true, order_path: 'none',
    })
    const line = screen.getByRole('group', { name: STREAM.label })
    await waitFor(() => expect(within(line).getByRole('status').textContent).toBe(STREAM.modes.open))
    const before = journalCalls()
    await new Promise((r) => setTimeout(r, 2500))
    expect(journalCalls()).toBe(before)
    FakeSource.made[0]!.emit('journal_row', { kind: 'journal_row', row: ALL_ROWS[0] })
    await waitFor(() => expect(journalCalls()).toBe(before + 1))
  })
})

describe('JRNL screen', () => {
  it('lists every journal row newest first, plumbing rows hatched with the exact banner', async () => {
    routes()
    mount()
    await waitFor(async () => expect((await gridRows()).length).toBe(ALL_ROWS.length))
    const rows = await gridRows()
    const plumbing = rows.filter((r) => r.classList.contains('plumbing-row'))
    expect(plumbing).toHaveLength(ALL_ROWS.filter((r) => r.plumbing).length)
    for (const r of plumbing) expect(r.textContent).toContain(BANNER)
    const performance = rows.filter((r) => !r.classList.contains('plumbing-row'))
    for (const r of performance) expect(r.textContent).not.toContain(BANNER)
    expect(rows[0]!.textContent).toContain('2026-10-02')
  })

  it('filters by file and by type through the API', async () => {
    const spy = routes()
    mount()
    await gridRows()
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.fileField }))
    fireEvent.click(await screen.findByRole('option', { name: BOOK }))
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes(`file=${encodeURIComponent(BOOK)}`))).toBe(true))
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.typeField }))
    fireEvent.click(await screen.findByRole('option', { name: 'close' }))
    await waitFor(async () => expect((await gridRows()).length).toBe(BOOK_CLOSE_ROWS.length))
    for (const [, init] of spy.mock.calls) expect(init?.method).toBe('GET')
  })

  it('marks a plumbing journal with its tag', async () => {
    routes()
    mount()
    await gridRows()
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.fileField }))
    fireEvent.click(await screen.findByRole('option', { name: `${PREFLIGHT} [PLUMBING]` }))
    expect(await screen.findByText('[PLUMBING]', { selector: '.jrnl-tag' })).toBeTruthy()
  })

  it('names the expected files when no journal is written yet, and asks for none of them', async () => {
    const spy = routes(emptyStatus())
    mount()
    expect(await screen.findByText(
      'no journal yet: live/logs/volmanaged_paper_journal.jsonl; no journal yet: live/logs/volmanaged_paper_journal.PLUMBING_DELAYED.jsonl',
    )).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox', { name: JRNL.fileField }))
    fireEvent.click(await screen.findByRole('option', { name: `${BOOK} (not yet written)` }))
    expect(await screen.findByText(`no journal yet: live/logs/${BOOK}`)).toBeTruthy()
    expect(spy.mock.calls.some(([u]) => String(u).includes(`file=${encodeURIComponent(BOOK)}`))).toBe(false)
  })

  it('shows the journal error detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).startsWith('/api/live/status') ? json(status()) : json({ detail: 'no journal by that name in live/logs' }, 404))
    mount()
    expect(await screen.findByText('The journal could not be read: no journal by that name in live/logs')).toBeTruthy()
  })
})

// D28 regression: a journal over 5,000 rows keys its query on offset: newestOffset(total, PAGE), where
// total is state copied from the previous response. Every time that key changes (cold open, or one new
// row growing total past the page boundary), the grid unmounts to "Loading" (a keyboard user's focus
// falls to <body>, scroll and the active row reset) and a fresh 5,000-row GET is sent. Fix: keep the
// previous page's data (and the grid mounted) while the corrected-offset page loads.
describe('JRNL over 5,000 rows keeps the grid mounted (D28)', () => {
  const PAGE = 5000
  const TOTAL_START = 6000
  const STATUS = status()
  // A 5,000-row page takes a while to reach the DOM in jsdom, so these waits allow for it instead of
  // the 1 s default (which made the second case fail at random, before the corrected GET was even sent).
  const SLOW = { timeout: 10_000 }
  const TEST_MS = 20_000

  let total = TOTAL_START
  const calls: string[] = []

  /** `n` minimal, cheap-to-render journal rows, numbered from `offset + 1`. */
  function makeRows(n: number, offset: number): Schemas['JournalRowOut'][] {
    return Array.from({ length: n }, (_, i) => ({
      file: BOOK, line_no: offset + i + 1, plumbing: false, banner: null,
      data: { type: 'warmup', date: '2026-01-01' },
    }))
  }

  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    calls.push(`${url.pathname}${url.search}`)
    if (url.pathname !== '/api/live/journal') return json({ detail: 'not in this test' }, 404)
    const offset = Number(url.searchParams.get('offset') ?? '0')
    const limit = Number(url.searchParams.get('limit') ?? String(PAGE))
    const n = Math.max(0, Math.min(limit, total - offset))
    return json({ items: makeRows(n, offset), total, offset, limit })
  })

  beforeEach(() => {
    total = TOTAL_START
    calls.length = 0
    vi.stubGlobal('fetch', fetchSpy)
  })

  function showRows() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <ApiProvider client={client}>
        <Rows status={STATUS} file="" type="" panelId="" />
      </ApiProvider>,
    )
    return { client, ...view }
  }

  it('keeps the same grid element (keyboard focus survives) once the offset corrects to the newest page', async () => {
    showRows()
    // The first page (offset 0, the oldest rows) arrives and the grid mounts; focus it, as a keyboard
    // user reading the journal would have.
    const grid = await screen.findByRole('grid', undefined, SLOW)
    grid.focus()
    expect(document.activeElement).toBe(grid)
    // The effect then corrects the offset to 1000 (the newest page) and a second GET is sent.
    await waitFor(() => expect(calls.some((c) => c.includes('offset=1000'))).toBe(true), SLOW)
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull(), SLOW)
    // The grid must never have unmounted while the offset corrected: focus would else have fallen to
    // <body>, and the "Loading" placeholder (no data) would have replaced it.
    expect(document.activeElement).toBe(grid)
    expect(screen.getByRole('grid')).toBe(grid)
  }, TEST_MS)

  it('keeps the grid mounted, with the previous page still shown, when a new row grows the total', async () => {
    const { client } = showRows()
    await waitFor(() => expect(calls.some((c) => c.includes('offset=1000'))).toBe(true), SLOW)
    const grid = await screen.findByRole('grid', undefined, SLOW)
    grid.focus()

    // One journal row streams in: total grows from 6000 to 6001, and offset now corrects to 1001. A
    // live refresh (or the P0 poll) refetches the journal query, as useLiveStream's refreshNow would.
    calls.length = 0
    total = TOTAL_START + 1
    await client.refetchQueries({ predicate: (q) => q.queryKey[1] === '/api/live/journal' })
    await waitFor(() => expect(calls.some((c) => c.includes('offset=1001'))).toBe(true), SLOW)
    await waitFor(() => expect(screen.getByText(/6,001|6001/)).toBeTruthy(), SLOW)
    // The grid element itself never unmounted (same node, and it kept keyboard focus) while the
    // offset-correcting refetch was in flight.
    expect(screen.getByRole('grid')).toBe(grid)
    expect(document.activeElement).toBe(grid)
  }, TEST_MS)
})
