// @vitest-environment jsdom
// The store modules on a page with the workspace store behind them: the shared storage tells the store of each
// write, the store's first read reaches the modules through `storage` events, and the whole thing starts from
// startRemoteStore. The backend is an in-memory fetch.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOME_ORIENTATION } from '../copy/home'
import { createSafeStorage, memoryStorage } from './safeStorage'
import { setWriteObserver } from './safeStorage.observe'
import { DATA_DOCS, defaultData } from './remoteStore.keys'

const recipe = { version: 1, panels: [{ line: 'NQ GP 1d', group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }
const storageEvent = (key: string) => window.dispatchEvent(new StorageEvent('storage', { key }))

/** A backend in memory, behind a stubbed fetch: GET and PUT of /api/workspaces/{doc} with If-Match. */
function backend() {
  const docs = new Map<string, { version: number; data: unknown }>()
  for (const doc of DATA_DOCS) docs.set(doc, { version: 0, data: defaultData(doc) })
  docs.set('meta', { version: 0, data: { schema: 1, imports: [] } })
  const calls: string[] = []
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const doc = String(url).replace('/api/workspaces/', '')
    const held = docs.get(doc)
    if (held === undefined) return answer(404, { detail: 'unknown document' })
    if (init?.method !== 'PUT') return answer(200, { doc, ...held })
    calls.push(`PUT ${doc}`)
    const headers = init.headers as Record<string, string>
    if (String(held.version) !== headers['If-Match']) return answer(412, { detail: 'stale' })
    const next = { version: held.version + 1, data: (JSON.parse(String(init.body)) as { data: unknown }).data }
    docs.set(doc, next)
    return answer(200, { doc, ...next })
  })
  return { docs, calls, fetcher }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  document.documentElement.removeAttribute('data-demo')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-cvd')
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  setWriteObserver(null)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the shared storage and the store', () => {
  it('tells the observer of every write and removal, and survives an observer that throws', async () => {
    const { safeLocalStorage } = await import('./safeStorage')
    const { setWriteObserver: install } = await import('./safeStorage.observe')
    const told: Array<[string, string | null]> = []
    install((key, value) => told.push([key, value]))
    safeLocalStorage.write('nqt.theme', 'amber-classic')
    safeLocalStorage.remove('nqt.theme')
    expect(told).toEqual([['nqt.theme', 'amber-classic'], ['nqt.theme', null]])
    install(() => {
      throw new Error('broken observer')
    })
    expect(safeLocalStorage.write('nqt.cvd', 'deut')).toBe(true)
    expect(localStorage.getItem('nqt.cvd')).toBe('deut')
  })

  it('does not tell it of a storage made for a test, and tells nothing when no store has started (plain localStorage)', () => {
    const told: string[] = []
    setWriteObserver((key) => told.push(key))
    createSafeStorage(() => memoryStorage()).write('nqt.theme', 'standard')
    expect(told).toEqual([])
    setWriteObserver(null)
    expect(() => createSafeStorage(() => memoryStorage()).write('k', 'v')).not.toThrow()
  })
})

describe('startRemoteStore on a page', () => {
  it('imports a seeded page once, then keeps localStorage as a cache and sends a later save 500 ms after it', async () => {
    const server = backend()
    vi.stubGlobal('fetch', server.fetcher)
    localStorage.setItem('nqt.workspaces', JSON.stringify({ version: 1, list: { MINE: recipe }, last: 'MINE' }))
    localStorage.setItem('nqt.theme', 'amber-classic')
    const { startRemoteStore } = await import('./remoteStore')
    const { useWorkspaces } = await import('./workspaces')
    expect(await startRemoteStore()).toBe('ready')
    expect(server.calls).toEqual(['PUT workspaces', 'PUT prefs', 'PUT meta'])
    expect((server.docs.get('meta')!.data as { imports: Array<{ origin: string }> }).imports[0]!.origin).toBe(window.location.origin)
    server.calls.length = 0
    expect(useWorkspaces.getState().save('NEWONE', recipe as never)).toBe(true)
    expect(JSON.parse(localStorage.getItem('nqt.workspaces')!).list.NEWONE).toBeDefined()
    await vi.advanceTimersByTimeAsync(499)
    expect(server.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(5)
    expect(server.calls).toEqual(['PUT workspaces'])
    expect(Object.keys((server.docs.get('workspaces')!.data as { list: object }).list).sort()).toEqual(['MINE', 'NEWONE'])
  })

  it('sends a pending change at once when the page goes away', async () => {
    const server = backend()
    vi.stubGlobal('fetch', server.fetcher)
    const { startRemoteStore } = await import('./remoteStore')
    const { useLayouts } = await import('./layouts')
    await startRemoteStore()
    useLayouts.getState().saveLayout('HOME', { grid: 1 })
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.calls).toEqual(['PUT layouts'])
    const sent = server.fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(sent[0]![1]!.keepalive).toBe(true)
  })

  it('reads the store into a page with empty storage and the modules pick it up through storage events', async () => {
    const server = backend()
    server.docs.set('linkGroups', { version: 2, data: { contexts: { A: { kind: 'instrument', value: 'ES' }, B: null, C: null } } })
    server.docs.set('prefs', { version: 1, data: { theme: 'amber-classic', cvd: 'deut', tape: true } })
    vi.stubGlobal('fetch', server.fetcher)
    const { startRemoteStore } = await import('./remoteStore')
    const { useLinkGroups } = await import('./linkGroups')
    const { useTapeOn } = await import('../chrome/EventTape.store')
    await import('../chrome/FrameStrip.scheme')
    await import('../theme/look')
    const tape = renderHook(() => useTapeOn())
    expect(useLinkGroups.getState().contexts.A).toBeNull()
    expect(tape.result.current).toBe(false)
    await act(async () => {
      await startRemoteStore()
    })
    expect(useLinkGroups.getState().contexts.A).toEqual({ kind: 'instrument', value: 'ES' })
    expect(tape.result.current).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber-classic')
    expect(document.documentElement.getAttribute('data-cvd')).toBe('deut')
    expect(server.calls).toEqual([])
  })

  it('with waitMs, answers when the time is up even if the store has not', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const { startRemoteStore, remoteStatus } = await import('./remoteStore')
    const answered = startRemoteStore({ waitMs: 300 })
    await vi.advanceTimersByTimeAsync(301)
    expect(await answered).toBe('idle')
    expect(remoteStatus()).toBe('idle')
  })

  it('falls back to plain localStorage on an older backend that answers 404, with no error and nothing written elsewhere', async () => {
    const fetcher = vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 }))
    vi.stubGlobal('fetch', fetcher)
    localStorage.setItem('nqt.theme', 'amber-classic')
    const { startRemoteStore } = await import('./remoteStore')
    expect(await startRemoteStore()).toBe('off')
    const { safeLocalStorage } = await import('./safeStorage')
    expect(safeLocalStorage.write('nqt.cvd', 'deut')).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('nqt.remote')).toBeNull()
    expect(localStorage.getItem('nqt.cvd')).toBe('deut')
  })

  it('does not even ask in the demo build', async () => {
    document.documentElement.dataset['demo'] = 'on'
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { startRemoteStore } = await import('./remoteStore')
    expect(await startRemoteStore()).toBe('off')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('the modules read the cache again on a storage event', () => {
  /** The page with the workspace store started on a backend without a store (404): its storage listener is installed. */
  async function startedPage() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 })))
    const { startRemoteStore } = await import('./remoteStore')
    await startRemoteStore()
  }

  it('link groups', async () => {
    await startedPage()
    const { useLinkGroups } = await import('./linkGroups')
    localStorage.setItem('nqt.linkGroups', JSON.stringify({ version: 1, contexts: { A: null, B: { kind: 'run', value: 'r1' }, C: null } }))
    storageEvent('nqt.layouts')
    expect(useLinkGroups.getState().contexts.B).toBeNull()
    storageEvent('nqt.linkGroups')
    expect(useLinkGroups.getState().contexts.B).toEqual({ kind: 'run', value: 'r1' })
  })

  it('the record watch checkpoint', async () => {
    await startedPage()
    const { useRecordWatchStore } = await import('./recordWatch.store')
    const snapshot = { version: 1, takenAt: 5, sources: {} }
    localStorage.setItem('nqt.watch', JSON.stringify(snapshot))
    storageEvent('nqt.watch')
    expect(useRecordWatchStore.getState().checkpoint).toEqual(snapshot)
    localStorage.removeItem('nqt.watch')
    storageEvent('nqt.watch')
    expect(useRecordWatchStore.getState().checkpoint).toBeNull()
  })

  it('the orientation line closes when the dismissal arrives', async () => {
    const { default: HomeOrientation } = await import('../screens/home/HomeOrientation')
    render(<HomeOrientation demo={false} />)
    expect(screen.queryByRole('note', { name: HOME_ORIENTATION.label })).not.toBeNull()
    localStorage.setItem('nqt.orientation', '1')
    act(() => storageEvent('nqt.orientation'))
    expect(screen.queryByRole('note', { name: HOME_ORIENTATION.label })).toBeNull()
  })
})
