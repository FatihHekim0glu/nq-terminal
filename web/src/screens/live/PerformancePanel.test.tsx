// @vitest-environment jsdom
// D26 regression: the target-vs-actual chart compares /api/live/performance against a separate
// /api/live/journal?type=close query. The stream hub refreshes both together, but they resolve
// independently: for one render their lengths can differ even though nothing is actually wrong. The
// chart must not flash a false guard-mismatch alert (or unmount) while either query is still fetching;
// only a mismatch that survives both settling is real.
import { QueryClient, type Query } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { BOOK_CLOSE_ROWS, page, performance } from './liveFixtures'
import PerformancePanel from './PerformancePanel'

vi.mock('../../charts/LineStack', () => ({
  default: (props: { t: readonly number[] }) => <div data-testid="linestack" data-points={props.t.length} />,
}))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// The book journal's own non-plumbing close rows (line_no 2, 4, 5), matching performance()'s 3 rows.
const MATCHED_CLOSES = BOOK_CLOSE_ROWS.filter((r) => !r.plumbing)
const PERF_3 = performance()
// A fourth close row lands: performance moves to 4 rows before the journal page has caught up.
const PERF_4 = performance({
  t: [...PERF_3.t, 1790899200],
  line_no: [...(PERF_3.line_no ?? []), 7],
  date: [...PERF_3.date, '2026-10-03'],
  contract: [...PERF_3.contract, 'MNQZ6.CME'],
  target: [...PERF_3.target, 6],
  expected: [...PERF_3.expected, 6],
  actual: [...PERF_3.actual, 6],
  reconciled_ok: [...PERF_3.reconciled_ok, true],
  exposure: [...PERF_3.exposure, 0.3],
  slippage_ticks: [...PERF_3.slippage_ticks, 1],
  sent: [...PERF_3.sent, true],
  refused: [...PERF_3.refused, null],
  error: [...PERF_3.error, null],
  halted: [...PERF_3.halted, false],
})
const CLOSE_4 = { ...MATCHED_CLOSES[0]!, line_no: 7, data: { ...MATCHED_CLOSES[0]!.data, date: '2026-10-03' } }

let perfBody: unknown = PERF_3
let journalBody: unknown = page(MATCHED_CLOSES, MATCHED_CLOSES.length)
let journalGate: Promise<void> | null = null

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://127.0.0.1')
  if (url.pathname === '/api/live/performance') return json(perfBody)
  if (url.pathname === '/api/live/journal') {
    if (journalGate) await journalGate
    return json(journalBody)
  }
  return json({ detail: 'not in this test' }, 404)
})

beforeEach(() => {
  perfBody = PERF_3
  journalBody = page(MATCHED_CLOSES, MATCHED_CLOSES.length)
  journalGate = null
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const isPath = (path: string) => (q: Query) => q.queryKey[1] === path
const refetch = (client: QueryClient, path: string) => client.refetchQueries({ predicate: isPath(path) })

describe('PerformancePanel target-vs-actual guard (D26)', () => {
  it('never shows a false guard-mismatch alert while the journal refetch is in flight', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ApiProvider client={client}><PerformancePanel /></ApiProvider>)
    await screen.findByTestId('linestack')
    expect(screen.getByTestId('linestack').getAttribute('data-points')).toBe('3')
    expect(screen.queryByRole('alert')).toBeNull()

    // A new close row lands: the stream hub refreshes both journal-derived queries together
    // (useLiveStream refreshNow), but performance resolves first; the journal page is held back.
    let releaseJournal: () => void = () => {}
    journalGate = new Promise((resolve) => { releaseJournal = resolve })
    perfBody = PERF_4
    const journalDone = refetch(client, '/api/live/journal')
    await act(async () => {
      await refetch(client, '/api/live/performance')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // performance now has 4 rows (committed by the act() flush above); the journal query is still
    // fetching (isFetching true) and its data is still the old 3-row page. The naive guard would see a
    // mismatch here and flash the alert.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('linestack')).toBeTruthy()

    // The journal page catches up to the new row: now both agree at 4, and the chart updates quietly.
    journalBody = page([...MATCHED_CLOSES, CLOSE_4], 4)
    releaseJournal()
    await journalDone
    await vi.waitFor(() => expect(screen.getByTestId('linestack').getAttribute('data-points')).toBe('4'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does raise the guard once a real, persistent mismatch settles', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ApiProvider client={client}><PerformancePanel /></ApiProvider>)
    await screen.findByTestId('linestack')

    // Performance moves to 4 rows and the journal settles on a genuinely different close (line_no 8,
    // not 7): the mismatch survives both queries settling, so it must be shown.
    perfBody = PERF_4
    journalBody = page([...MATCHED_CLOSES, { ...CLOSE_4, line_no: 8 }], 4)
    await refetch(client, '/api/live/performance')
    await refetch(client, '/api/live/journal')
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').className).toContain('live-guard')
  })

  it('keeps the guard alert up through a further refetch of a persistent mismatch, instead of flipping back to the stale chart (D26)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<ApiProvider client={client}><PerformancePanel /></ApiProvider>)
    await screen.findByTestId('linestack')

    // Settle on a real, persistent mismatch first (as the previous test does).
    perfBody = PERF_4
    journalBody = page([...MATCHED_CLOSES, { ...CLOSE_4, line_no: 8 }], 4)
    await refetch(client, '/api/live/performance')
    await refetch(client, '/api/live/journal')
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').className).toContain('live-guard')

    // Another poll (or a manual refetch) comes in; the journal response is held pending. The mismatch
    // is still real, so the alert must stay up: it must not remount the old, matched chart just because
    // a refetch is in flight (D26's fix must not resurrect a stale "last good" result forever).
    let releaseJournal: () => void = () => {}
    journalGate = new Promise((resolve) => { releaseJournal = resolve })
    const journalDone = refetch(client, '/api/live/journal')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').className).toContain('live-guard')
    expect(screen.queryByTestId('linestack')).toBeNull()
    expect(document.querySelector('.live-chart')).toBeNull()

    releaseJournal()
    await journalDone
  })
})
