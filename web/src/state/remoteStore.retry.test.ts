import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_DOCS, defaultData, type DocName } from './remoteStore.keys'
import { RETRY_MAX_MS, RETRY_MS, createRemoteStore } from './remoteStore'
import type { StoreReply, StoreTransport } from './remoteStore.transport'
import { createSafeStorage, memoryStorage } from './safeStorage'

// A store whose reads work and whose writes keep failing (a backend that can read its folder but not write it, say):
// the page must wait the retry delay between sends, never restart the send the moment the last one failed.

interface Held {
  version: number
  data: unknown
}

class WriteFailingBackend implements StoreTransport {
  readonly docs = new Map<DocName, Held>()
  reads = 0
  writes = 0
  writeStatus = 503
  constructor() {
    for (const doc of DATA_DOCS) this.docs.set(doc, { version: 0, data: defaultData(doc) })
    this.docs.set('meta', { version: 0, data: { schema: 1, imports: [] } })
  }

  async read(doc: DocName): Promise<StoreReply> {
    this.reads += 1
    return { status: 200, body: { doc, ...this.docs.get(doc)! } }
  }

  async write(doc: DocName, version: number, data: unknown): Promise<StoreReply> {
    this.writes += 1
    if (this.writeStatus !== 200) return { status: this.writeStatus, body: { detail: 'scripted' } }
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

const ORIGIN = 'http://127.0.0.1:8765'
const SIDECAR = 'nqt.remote'

function setUp() {
  const raw = memoryStorage()
  raw.setItem(SIDECAR, JSON.stringify({ synced: true, dirty: [] }))
  const backend = new WriteFailingBackend()
  const store = createRemoteStore({
    transport: backend,
    cache: createSafeStorage(() => raw),
    origin: ORIGIN,
    announce: () => undefined,
    notify: () => undefined,
  })
  return { raw, backend, store }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('writes that keep failing while reads work', () => {
  it('waits the retry delay between sends: no send, and no re-read, starts again inside it', async () => {
    const { backend, store } = setUp()
    await store.start()
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    const writesAfterFirst = backend.writes
    const readsAfterFirst = backend.reads
    expect(writesAfterFirst).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1_000)
    expect(backend.writes).toBe(writesAfterFirst)
    expect(backend.reads).toBe(readsAfterFirst)
    expect(store.status()).toBe('unavailable')
  })

  it('tries again after the delay, and keeps the change pending until a write is taken', async () => {
    const { raw, backend, store } = setUp()
    await store.start()
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    const writesAfterFirst = backend.writes
    await vi.advanceTimersByTimeAsync(RETRY_MS + 100)
    expect(backend.writes).toBeGreaterThan(writesAfterFirst)
    expect(JSON.parse(raw.getItem(SIDECAR)!).dirty).toEqual(['nqt.theme'])
    backend.writeStatus = 200
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2)
    expect(backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(JSON.parse(raw.getItem(SIDECAR)!).dirty).toEqual([])
    expect(store.status()).toBe('ready')
  })

  it('backs off over a long outage: the delay doubles to a cap, so the sends are few, never a loop', async () => {
    const { backend, store } = setUp()
    await store.start()
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    // Sends at 0.5 s, then after 5, 10, 20, 40 s and every 60 s: 4 + 1 + 9 or 10 in ten minutes.
    expect(backend.writes).toBeLessThanOrEqual(16)
    expect(backend.writes).toBeGreaterThanOrEqual(10)
  })

  it('keeps trying at the cap for as long as the outage lasts, and starts the delay again with the next change', async () => {
    const { backend, store } = setUp()
    await store.start()
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const before = backend.writes
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 100)
    expect(backend.writes).toBeGreaterThan(before)
    const again = backend.writes
    store.note('nqt.cvd', 'deut')
    await vi.advanceTimersByTimeAsync(600 + RETRY_MS + 100)
    expect(backend.writes).toBeGreaterThan(again + 1)
  })
})
