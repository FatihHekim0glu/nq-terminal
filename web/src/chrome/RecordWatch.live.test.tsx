// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { createApiQueryClient } from '../api/queries'
import { WATCH } from '../copy/watch'
import { CONFIRMATIONS, REGISTRY } from '../screens/reg/regFixtures'
import { LEDGER, RUNS } from '../screens/runs/runs.fixtures'
import type { WatchDiff, WatchSnapshot, WatchSource } from '../state/recordWatch.schema'
import { WATCH_KEY, useRecordWatchStore } from '../state/recordWatch.store'
import { resetMessage, useMessage } from './MessageLine.store'
import {
  RecordWatchReader,
  WatchSegment,
  formatEt,
  resetRecordWatchBoot,
  resetRecordWatchView,
  useIdleReady,
  useRecordWatch,
  useWatchMarks,
  type RecordWatchView,
} from './RecordWatch.live'

const OPENINGS = { label: 'openings', openings: [{ opened_utc: '2026-09-26T10:00:00Z', by: 'user' }], openings_closed: true }
const OOS = { entries: [{ line_no: 1, caller: 'terminal' }, { line_no: 2, caller: 'terminal' }, { line_no: 3, caller: 'sealed' }], total: 3 }
const URLS = ['/api/registry', '/api/confirmations', '/api/audit/openings', '/api/ledger', '/api/audit/oos-log?limit=5000', '/api/runs']
const BODIES: Readonly<Record<string, unknown>> = {
  '/api/registry': REGISTRY,
  '/api/confirmations': CONFIRMATIONS,
  '/api/audit/openings': OPENINGS,
  '/api/ledger': LEDGER,
  '/api/audit/oos-log?limit=5000': OOS,
  '/api/runs': RUNS,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Override = number | Promise<unknown>

/** Answers the six watch GETs; `over` sends one URL to a status code or to a promise the test settles. */
function stubFetch(over: Readonly<Record<string, Override>> = {}): MockInstance<typeof fetch> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const special = over[url]
    if (typeof special === 'number') return json({ detail: 'down' }, special)
    if (special) return json(await special)
    const body = BODIES[url]
    return body === undefined ? json({ detail: 'unknown' }, 404) : json(body)
  })
}

let latest: RecordWatchView
let client: QueryClient

function Probe() {
  latest = useRecordWatch()
  return <WatchSegment view={latest} />
}

function Marks({ source, onMarks }: { readonly source: WatchSource; readonly onMarks: (m: ReadonlyMap<string, 'new' | 'changed'>) => void }) {
  onMarks(useWatchMarks(source))
  return null
}

function Harness({ delayMs = 0, onMarks }: { readonly delayMs?: number; readonly onMarks?: (m: ReadonlyMap<string, 'new' | 'changed'>) => void }) {
  const idle = useIdleReady(delayMs)
  return (
    <>
      {idle ? <RecordWatchReader /> : null}
      <Probe />
      {onMarks ? <Marks source="runs" onMarks={onMarks} /> : null}
    </>
  )
}

function mount(node = <Harness />) {
  client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(<ApiProvider client={client}>{node}</ApiProvider>)
}

const segment = (container: HTMLElement): HTMLElement | null => container.querySelector('.seg')

/** The snapshot the reader would take of the fixtures, through the real lazy module. */
async function fixtureSnapshot(takenAt = Date.UTC(2026, 8, 20, 14, 0)): Promise<WatchSnapshot> {
  const lazy = await import('./RecordWatch.lazy')
  return lazy.snapshotOf({ registry: REGISTRY, confirmations: CONFIRMATIONS, openings: OPENINGS, ledger: LEDGER, oos: OOS, runs: RUNS }, takenAt)
}

type Loose = { sources: Record<string, { count: number; records: Record<string, Record<string, unknown>> }> }
function edited(snapshot: WatchSnapshot, change: (s: Loose) => void): WatchSnapshot {
  const copy = JSON.parse(JSON.stringify(snapshot)) as Loose
  change(copy)
  return copy as unknown as WatchSnapshot
}

function seed(snapshot: WatchSnapshot): void {
  expect(useRecordWatchStore.getState().setCheckpoint(snapshot)).toBe(true)
}

beforeEach(() => {
  localStorage.clear()
  useRecordWatchStore.setState({ checkpoint: null })
  resetRecordWatchView()
  resetRecordWatchBoot()
  resetMessage()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'requestIdleCallback')
  Reflect.deleteProperty(window, 'cancelIdleCallback')
})

describe('useIdleReady', () => {
  it('turns true after 2000 ms by default when the browser has no idle callback', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useIdleReady())
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(1999))
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('takes the delay it is given', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useIdleReady(50))
    act(() => void vi.advanceTimersByTime(49))
    expect(result.current).toBe(false)
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('uses requestIdleCallback with a 4000 ms timeout when the browser has one', () => {
    let fire: () => void = () => undefined
    const request = vi.fn((callback: () => void, _options?: { timeout: number }) => {
      fire = callback
      return 7
    })
    const cancel = vi.fn()
    Object.assign(window, { requestIdleCallback: request, cancelIdleCallback: cancel })
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useIdleReady())
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[1]).toEqual({ timeout: 4000 })
    act(() => void vi.advanceTimersByTime(10_000))
    expect(result.current).toBe(false)
    act(() => fire())
    expect(result.current).toBe(true)
    unmount()
    expect(cancel).toHaveBeenCalledWith(7)
  })

  it('cleans up on unmount: the timer never fires afterwards', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useIdleReady())
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('formatEt', () => {
  it('writes Eastern time, with daylight saving', () => {
    expect(formatEt(Date.UTC(2026, 0, 15, 15, 5))).toMatch(/^15 Jan,? 10:05$/)
    expect(formatEt(Date.UTC(2026, 6, 15, 15, 5))).toMatch(/^15 Jul,? 11:05$/)
  })
})

describe('WatchSegment', () => {
  const diff: WatchDiff = { since: 0, appended: [], updated: [], changed: [] }
  const view = (state: RecordWatchView['state'], over: Partial<RecordWatchView> = {}): RecordWatchView => ({
    state, diff, since: '20 Sept, 10:00', menu: () => null, accept: () => null, ...over,
  })

  it('renders nothing while the six reads are pending', () => {
    const { container } = render(<WatchSegment view={view('waiting')} />)
    expect(container.innerHTML).toBe('')
  })

  it('says from now on the first visit and no change when nothing differs', () => {
    const first = render(<WatchSegment view={view('baseline')} />)
    expect(segment(first.container)?.textContent).toBe('WATCH from now')
    first.unmount()
    const second = render(<WatchSegment view={view('clean')} />)
    expect(segment(second.container)?.textContent).toBe('WATCH no change')
    expect(segment(second.container)?.className).toBe('seg keep')
  })

  it('counts the new items, with no warning class', () => {
    const item = { source: 'runs', key: 'r1', kind: 'appended', field: '', before: null, after: null, line: 'r1 RUN' } as const
    const { container } = render(<WatchSegment view={view('news', { diff: { ...diff, appended: [item, item], updated: [item] } })} />)
    expect(segment(container)?.textContent).toBe('WATCH 3 new')
    expect(segment(container)?.className).toBe('seg keep')
  })

  it('warns when a record that should not change was rewritten, in words as well as class', () => {
    const item = { source: 'registry', key: 'a', kind: 'changed', field: 'p', before: 1, after: 2, line: 'a DES' } as const
    const { container } = render(
      <WatchSegment view={view('changed', { diff: { ...diff, changed: [item] }, title: 'registry a: p was 1, now 2' })} />,
    )
    const seg = segment(container)
    expect(seg?.className).toBe('seg keep warn')
    expect(seg?.querySelector('b')?.textContent).toBe('WATCH')
    expect(seg?.textContent).toContain('WATCH 1 changed')
    expect(seg?.querySelector('.sr-only')?.textContent).toContain(WATCH.changedNote)
    expect(seg?.getAttribute('title')).toBe('registry a: p was 1, now 2')
  })

  it('has no title until the text of the first changed item is known', () => {
    const { container } = render(<WatchSegment view={view('clean')} />)
    expect(segment(container)?.hasAttribute('title')).toBe(false)
  })
})

describe('useRecordWatch before anything is read', () => {
  it('is waiting, has no list and cannot accept', () => {
    const { result } = renderHook(() => useRecordWatch())
    expect(result.current.state).toBe('waiting')
    expect(result.current.since).toBeNull()
    expect(result.current.menu()).toBeNull()
    expect(result.current.accept()).toBeNull()
    expect(result.current.diff).toEqual({ since: 0, appended: [], updated: [], changed: [] })
  })
})

describe('RecordWatchReader', () => {
  it('requests nothing before the idle start, then the six GETs', async () => {
    const fetchSpy = stubFetch()
    const { container } = mount(<Harness delayMs={60} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(latest.state).toBe('waiting')
    expect(segment(container)).toBeNull()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(6))
    const urls = fetchSpy.mock.calls.map(([url]) => String(url)).sort()
    expect(urls).toEqual([...URLS].sort())
  })

  it('sends GET requests only', async () => {
    const fetchSpy = stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('baseline'))
    expect(fetchSpy.mock.calls.length).toBe(6)
    expect(fetchSpy.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })

  it('shares the gate log query key with the OOS screen (limit 5000, no other filter)', async () => {
    stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('baseline'))
    const screenKey = ['api', '/api/audit/oos-log', { query: { caller: undefined, since: undefined, limit: 5000 } }] as const
    expect(client.getQueryData(screenKey)).toBeDefined()
  })

  it('stays waiting, with no segment and no list, until all six reads have settled', async () => {
    let release: (value: unknown) => void = () => undefined
    const slow = new Promise<unknown>((resolve) => {
      release = resolve
    })
    const fetchSpy = stubFetch({ '/api/audit/oos-log?limit=5000': slow })
    const { container } = mount()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(6))
    await waitFor(() => expect(client.getQueryData(['api', '/api/runs', {}])).toBeDefined())
    await waitFor(() => expect(client.getQueryData(['api', '/api/ledger', {}])).toBeDefined())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(latest.state).toBe('waiting')
    expect(latest.menu()).toBeNull()
    expect(segment(container)).toBeNull()
    expect(useRecordWatchStore.getState().checkpoint).toBeNull()
    release(OOS)
    await waitFor(() => expect(latest.state).toBe('baseline'))
    expect(segment(container)?.textContent).toBe('WATCH from now')
  })

  it('takes the first visit as the baseline: saved, quiet, and the list says nothing to compare yet', async () => {
    stubFetch()
    const { container } = mount()
    await waitFor(() => expect(latest.state).toBe('baseline'))
    expect(segment(container)?.textContent).toBe('WATCH from now')
    const saved = useRecordWatchStore.getState().checkpoint
    expect(Object.keys(saved?.sources ?? {}).sort()).toEqual(['confirmations', 'ledger', 'oos', 'openings', 'registry', 'runs'])
    expect(localStorage.getItem(WATCH_KEY)).toBe(JSON.stringify(saved))
    expect(useMessage.getState().text).toBe('')
    const menu = latest.menu()
    expect(menu?.key).toBe('watch')
    expect(menu?.items).toEqual([])
    expect(menu?.intro[0]).toMatch(/^Watching from .+ ET: nothing to compare yet\.$/)
    expect(latest.since).toMatch(/\d{2}:\d{2}$/)
  })

  it('does not claim a baseline when this browser cannot keep the first checkpoint', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    stubFetch()
    const { container } = mount()
    await waitFor(() => expect(useMessage.getState().text).toBe(WATCH.unkept))
    expect(useMessage.getState().text).toBe(WATCH.unkept)
    expect(latest.state).toBe('waiting')
    expect(segment(container)).toBeNull()
    expect(latest.menu()).toBeNull()
    expect(useRecordWatchStore.getState().checkpoint).toBeNull()
  })

  it('reads clean on a later visit with nothing different', async () => {
    seed(await fixtureSnapshot())
    stubFetch()
    const { container } = mount()
    await waitFor(() => expect(latest.state).toBe('clean'))
    expect(segment(container)?.textContent).toBe('WATCH no change')
    expect(useMessage.getState().text).toBe('')
    expect(latest.menu()?.intro[1]).toMatch(/^Nothing new or changed since .+ ET\.$/)
  })

  it('shows news when a record is new, without the warning class', async () => {
    const runId = RUNS[0]?.run_id ?? ''
    seed(edited(await fixtureSnapshot(), (s) => void delete s.sources.runs?.records[runId]))
    stubFetch()
    const marks: Array<ReadonlyMap<string, 'new' | 'changed'>> = []
    const { container } = mount(<Harness onMarks={(m) => marks.push(m)} />)
    await waitFor(() => expect(latest.state).toBe('news'))
    expect(segment(container)?.textContent).toBe('WATCH 1 new')
    expect(segment(container)?.className).toBe('seg keep')
    expect(latest.diff.appended).toMatchObject([{ source: 'runs', key: runId, kind: 'appended', line: `${runId} RUN` }])
    expect(marks.at(-1)).toEqual(new Map([[runId, 'new']]))
    expect(useMessage.getState().text).toMatch(/^Since .+ ET: 1 run\. WATCH <GO> lists them\.$/)
  })

  it('warns when a frozen field was rewritten, and names the first item in the title', async () => {
    const name = REGISTRY.rows[0]?.name ?? ''
    seed(edited(await fixtureSnapshot(), (s) => void (s.sources.registry!.records[name]!.p = 0.987654)))
    stubFetch()
    const { container } = mount()
    await waitFor(() => expect(latest.state).toBe('changed'))
    const seg = segment(container)
    expect(seg?.className).toBe('seg keep warn')
    expect(seg?.textContent).toContain('WATCH 1 changed')
    expect(seg?.querySelector('.sr-only')?.textContent).toContain('WATCH <GO> lists it.')
    expect(name).toBe('za_v0')
    expect(seg?.getAttribute('title')).toBe('registry za_v0: p was 0.987654, now 0.361241')
    const menu = latest.menu()
    expect(menu?.items[0]).toMatchObject({ label: `${name} DES`, act: { kind: 'run', line: `${name} DES` } })
    expect(menu?.items.at(-1)?.label).toBe('WATCH SEEN')
    expect(useMessage.getState().text).toMatch(/^Since .+ ET: 1 registry row\. WATCH <GO> lists them\.$/)
  })

  it('marks a rewritten row as changed for the grids', async () => {
    const name = REGISTRY.rows[0]?.name ?? ''
    seed(edited(await fixtureSnapshot(), (s) => void (s.sources.registry!.records[name]!.p = 0.5)))
    stubFetch()
    const seen: Array<ReadonlyMap<string, 'new' | 'changed'>> = []
    function RegistryMarks() {
      seen.push(useWatchMarks('registry'))
      return null
    }
    mount(<><Harness /><RegistryMarks /></>)
    await waitFor(() => expect(latest.state).toBe('changed'))
    expect(seen.at(-1)).toEqual(new Map([[name, 'changed']]))
  })

  it('accepts back to clean: the checkpoint becomes the current read and the message names the time', async () => {
    const name = REGISTRY.rows[0]?.name ?? ''
    const old = await fixtureSnapshot()
    seed(edited(old, (s) => void (s.sources.registry!.records[name]!.p = 0.5)))
    stubFetch()
    const { container } = mount()
    await waitFor(() => expect(latest.state).toBe('changed'))
    let message: string | null = null
    act(() => {
      message = latest.accept()
    })
    expect(message).toMatch(/^Marked as seen at .+ ET\.$/)
    await waitFor(() => expect(latest.state).toBe('clean'))
    expect(segment(container)?.textContent).toBe('WATCH no change')
    expect(latest.diff.changed).toEqual([])
    const checkpoint = useRecordWatchStore.getState().checkpoint
    expect(checkpoint?.sources.registry?.records[name]?.p).toBe(REGISTRY.rows[0]?.p)
    expect(checkpoint?.takenAt).toBeGreaterThan(old.takenAt)
    expect(JSON.parse(localStorage.getItem(WATCH_KEY) ?? 'null')).toEqual(checkpoint)
  })

  it('does not mark anything as seen when this browser cannot keep the checkpoint', async () => {
    const name = REGISTRY.rows[0]?.name ?? ''
    seed(edited(await fixtureSnapshot(), (s) => void (s.sources.registry!.records[name]!.p = 0.5)))
    stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('changed'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    let message: string | null = null
    act(() => {
      message = latest.accept()
    })
    expect(message).toBe(WATCH.unsaved)
    expect(latest.state).toBe('changed')
  })

  it('posts the start-up line once per page load, not again when the records change later', async () => {
    const runId = RUNS[0]?.run_id ?? ''
    seed(edited(await fixtureSnapshot(), (s) => void delete s.sources.runs?.records[runId]))
    stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('news'))
    const posted = useMessage.getState().id
    expect(posted).toBeGreaterThan(0)
    act(() => {
      client.setQueryData(['api', '/api/runs', {}], [...RUNS, { ...RUNS[0]!, run_id: 'a_run_after_load' }])
    })
    await waitFor(() => expect(latest.diff.appended.map((i) => i.key)).toContain('a_run_after_load'))
    expect(latest.state).toBe('news')
    expect(useMessage.getState().id).toBe(posted)
  })

  it('posts nothing at the start when nothing differs', async () => {
    seed(await fixtureSnapshot())
    stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('clean'))
    expect(useMessage.getState().id).toBe(0)
  })

  it('leaves out a source that failed, and adds it to the checkpoint on a later visit', async () => {
    stubFetch({ '/api/ledger': 500 })
    mount()
    await waitFor(() => expect(latest.state).toBe('baseline'))
    const first = useRecordWatchStore.getState().checkpoint
    expect(first?.sources.ledger).toBeUndefined()
    expect(first?.sources.runs).toBeDefined()
    cleanup()
    vi.restoreAllMocks()
    resetRecordWatchView()
    stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('clean'))
    const second = useRecordWatchStore.getState().checkpoint
    expect(second?.sources.ledger?.count).toBe(LEDGER.rows.length)
    expect(second?.takenAt).toBe(first?.takenAt)
  })

  it('stays waiting, and saves nothing, when every read fails', async () => {
    const fetchSpy = stubFetch(Object.fromEntries(URLS.map((url) => [url, 503] as const)))
    mount()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(6))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(latest.state).toBe('waiting')
    expect(useRecordWatchStore.getState().checkpoint).toBeNull()
    expect(localStorage.getItem(WATCH_KEY)).toBeNull()
  })

  it('keeps the first visit a baseline when a later read of the same records finds nothing new', async () => {
    stubFetch()
    mount()
    await waitFor(() => expect(latest.state).toBe('baseline'))
    act(() => {
      // A field the watch does not follow: new data, so the reader runs again, but no difference.
      client.setQueryData(['api', '/api/runs', {}], [{ ...RUNS[0]!, elapsed_s: 99 }, ...RUNS.slice(1)])
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(latest.state).toBe('baseline')
  })
})
