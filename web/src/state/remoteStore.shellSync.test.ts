import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_DOCS, defaultData, type DocName } from './remoteStore.keys'
import { SHELL_SYNC_HOOK, attachShellSync, createRemoteStore, type RemoteStore } from './remoteStore'
import type { StoreReply, StoreTransport } from './remoteStore.transport'
import { createSafeStorage, memoryStorage } from './safeStorage'

// The shell flushes the page's unsent changes before it stops the backend (03 section 2.3, 10.3): it runs the hook
// below in the page, reads the answer (a JSON text) and asks again until nothing is pending. The page calls no shell
// command; the shell calls the page.

interface Held {
  version: number
  data: unknown
}

class Backend implements StoreTransport {
  readonly docs = new Map<DocName, Held>()
  puts = 0
  /** When set, a write answers only after this promise settles (a send in flight). */
  hold: Promise<void> | null = null
  failWith: number | null = null
  constructor() {
    for (const doc of DATA_DOCS) this.docs.set(doc, { version: 0, data: defaultData(doc) })
    this.docs.set('meta', { version: 0, data: { schema: 1, imports: [] } })
  }

  async read(doc: DocName): Promise<StoreReply> {
    return { status: 200, body: { doc, ...this.docs.get(doc)! } }
  }

  async write(doc: DocName, version: number, data: unknown): Promise<StoreReply> {
    this.puts += 1
    if (this.hold !== null) await this.hold
    if (this.failWith !== null) return { status: this.failWith, body: { detail: 'scripted' } }
    const held = this.docs.get(doc)!
    if (held.version !== version) return { status: 412, body: { detail: 'stale' } }
    const next = { version: held.version + 1, data: JSON.parse(JSON.stringify(data)) as unknown }
    this.docs.set(doc, next)
    return { status: 200, body: { doc, ...next } }
  }

  writeLast(doc: DocName, version: number, data: unknown): Promise<StoreReply> {
    return this.write(doc, version, data)
  }
}

interface Answer {
  status: string
  pending: number
}

async function rig(): Promise<{ backend: Backend; store: RemoteStore; win: Record<string, unknown>; ask: () => Answer }> {
  const raw = memoryStorage()
  raw.setItem('nqt.remote', JSON.stringify({ synced: true, dirty: [] }))
  const backend = new Backend()
  const store = createRemoteStore({
    transport: backend,
    cache: createSafeStorage(() => raw),
    origin: 'http://127.0.0.1:8765',
    announce: () => undefined,
    notify: () => undefined,
  })
  await store.start()
  const win: Record<string, unknown> = {}
  attachShellSync(store, win)
  const ask = (): Answer => JSON.parse((win[SHELL_SYNC_HOOK] as () => string)()) as Answer
  return { backend, store, win, ask }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the shell flush hook', () => {
  it('is a read-only function the page defines once (a second definition is ignored), hidden from enumeration', async () => {
    const { win } = await rig()
    expect(typeof win[SHELL_SYNC_HOOK]).toBe('function')
    expect(Object.keys(win)).toEqual([])
    expect(() => {
      ;(win as Record<string, unknown>)[SHELL_SYNC_HOOK] = () => 'x'
    }).toThrow()
    const first = win[SHELL_SYNC_HOOK]
    attachShellSync({} as RemoteStore, win)
    expect(win[SHELL_SYNC_HOOK]).toBe(first)
  })

  it('says nothing is pending when nothing was changed', async () => {
    const { ask, backend } = await rig()
    expect(ask()).toEqual({ status: 'ready', pending: 0 })
    expect(backend.puts).toBe(0)
  })

  it('sends a change that is still waiting out its 500 ms debounce, at once, and then reports it settled', async () => {
    const { ask, backend, store } = await rig()
    store.note('nqt.theme', 'standard')
    const first = ask()
    expect(first).toEqual({ status: 'ready', pending: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.puts).toBe(1)
    expect(backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(ask()).toEqual({ status: 'ready', pending: 0 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(backend.puts).toBe(1)
  })

  it('does not send again while the first send is in flight, however often the shell asks', async () => {
    const { ask, backend, store } = await rig()
    let release: () => void = () => undefined
    backend.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    store.note('nqt.theme', 'standard')
    for (let i = 0; i < 5; i += 1) {
      expect(ask().pending).toBe(1)
      await vi.advanceTimersByTimeAsync(150)
    }
    expect(backend.puts).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(ask()).toEqual({ status: 'ready', pending: 0 })
    expect(backend.puts).toBe(1)
  })

  it('keeps reporting a change the store will not take, so the shell can say it was lost', async () => {
    const { ask, backend, store } = await rig()
    backend.failWith = 503
    store.note('nqt.theme', 'standard')
    ask()
    await vi.advanceTimersByTimeAsync(0)
    const after = ask()
    expect(after.pending).toBe(1)
    expect(after.status).toBe('unavailable')
  })

  it('sends a change that failed once as soon as the backend is back, even inside the retry backoff (the close must not lose it)', async () => {
    const { ask, backend, store } = await rig()
    backend.failWith = 503
    store.note('nqt.theme', 'standard')
    ask()
    await vi.advanceTimersByTimeAsync(0)
    expect([store.status(), store.pending()]).toEqual(['unavailable', 1])
    const failedPuts = backend.puts
    backend.failWith = null
    await vi.advanceTimersByTimeAsync(1_000) // still inside the 5 s backoff
    expect(backend.puts).toBe(failedPuts)
    ask()
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.puts).toBeGreaterThan(failedPuts)
    expect(backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(ask()).toEqual({ status: 'ready', pending: 0 })
  })

  it('sends a change made before the first read finished once the store is ready (status idle)', async () => {
    const raw = memoryStorage()
    raw.setItem('nqt.remote', JSON.stringify({ synced: true, dirty: [] }))
    const backend = new Backend()
    const store = createRemoteStore({ transport: backend, cache: createSafeStorage(() => raw), origin: 'http://127.0.0.1:8765', announce: () => undefined, notify: () => undefined })
    const win: Record<string, unknown> = {}
    attachShellSync(store, win)
    store.note('nqt.theme', 'standard')
    expect(store.status()).toBe('idle')
    ;(win[SHELL_SYNC_HOOK] as () => string)()
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(JSON.parse((win[SHELL_SYNC_HOOK] as () => string)())).toEqual({ status: 'ready', pending: 0 })
  })

  it('reports off for a backend with no store (nothing to flush)', async () => {
    const raw = memoryStorage()
    const backend = new Backend()
    backend.read = async () => ({ status: 404, body: null })
    const store = createRemoteStore({ transport: backend, cache: createSafeStorage(() => raw), origin: 'http://127.0.0.1:1', announce: () => undefined, notify: () => undefined })
    await store.start()
    const win: Record<string, unknown> = {}
    attachShellSync(store, win)
    expect(JSON.parse((win[SHELL_SYNC_HOOK] as () => string)())).toEqual({ status: 'off', pending: 0 })
  })
})
