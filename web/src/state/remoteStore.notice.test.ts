import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_NOTICE } from '../copy/storeNotice'
import { DATA_DOCS, defaultData, type DocName } from './remoteStore.keys'
import { createRemoteStore, type RemoteStore } from './remoteStore'
import type { StoreReply, StoreTransport } from './remoteStore.transport'
import { createSafeStorage, memoryStorage } from './safeStorage'

// A change the store cannot take must be said on the message line (WCAG 4.1.3), once per outage, and said again when it ends.

interface Held {
  version: number
  data: unknown
}

/** A store with the version rules and a scripted status for each PUT of a document. */
class Backend implements StoreTransport {
  readonly docs = new Map<DocName, Held>()
  putStatuses: number[] = []
  constructor() {
    for (const doc of DATA_DOCS) this.docs.set(doc, { version: 0, data: defaultData(doc) })
    this.docs.set('meta', { version: 0, data: { schema: 1, imports: [] } })
  }

  async read(doc: DocName): Promise<StoreReply> {
    return { status: 200, body: { doc, ...this.docs.get(doc)! } }
  }

  async write(doc: DocName, version: number, data: unknown): Promise<StoreReply> {
    const scripted = this.putStatuses.shift()
    if (scripted !== undefined && scripted !== 200) return { status: scripted, body: scripted === 0 ? null : { detail: 'scripted' } }
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

interface Notice {
  readonly text: string
  readonly tone: 'info' | 'error'
}

async function startReady(): Promise<{ backend: Backend; store: RemoteStore; notices: Notice[] }> {
  const backend = new Backend()
  const notices: Notice[] = []
  const store = createRemoteStore({
    transport: backend,
    cache: createSafeStorage(() => memoryStorage()),
    origin: 'http://127.0.0.1:8765',
    announce: () => undefined,
    notify: (text, tone) => notices.push({ text, tone }),
  })
  await store.start()
  return { backend, store, notices }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('telling the user the store cannot take a change', () => {
  it.each([401, 403, 503, 0])('posts one error for two failed sends answered %i (the second after the delay of 5 s), then one notice when the store takes the change', async (status) => {
    const { backend, store, notices } = await startReady()
    backend.putStatuses = Array.from({ length: 2 }, () => status)
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(notices).toEqual([{ text: STORE_NOTICE.unsaved, tone: 'error' }])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(store.status()).toBe('ready')
    expect(notices).toEqual([
      { text: STORE_NOTICE.unsaved, tone: 'error' },
      { text: STORE_NOTICE.restored, tone: 'info' },
    ])
  })

  it('posts a notice when the store answers again and the change is saved, once', async () => {
    const { backend, store, notices } = await startReady()
    backend.putStatuses = [403]
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    await vi.advanceTimersByTimeAsync(5_100)
    expect(store.status()).toBe('ready')
    expect(backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(notices).toEqual([
      { text: STORE_NOTICE.unsaved, tone: 'error' },
      { text: STORE_NOTICE.restored, tone: 'info' },
    ])
  })

  it('posts the unsaved error again for a second outage after a recovery', async () => {
    const { backend, store, notices } = await startReady()
    backend.putStatuses = [503]
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(5_700)
    backend.putStatuses = [503]
    store.note('nqt.theme', 'amber-classic')
    await vi.advanceTimersByTimeAsync(600)
    expect(notices.map((n) => n.text)).toEqual([STORE_NOTICE.unsaved, STORE_NOTICE.restored, STORE_NOTICE.unsaved])
  })

  it('posts an error when the store refuses a change (422), which is kept in the browser only', async () => {
    const { backend, store, notices } = await startReady()
    backend.putStatuses = [422]
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(notices).toEqual([{ text: STORE_NOTICE.refused, tone: 'error' }])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(notices).toHaveLength(1)
  })

  it('says nothing when every write is taken', async () => {
    const { store, notices } = await startReady()
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(notices).toEqual([])
  })
})
