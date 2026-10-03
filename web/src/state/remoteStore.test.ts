import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_DOCS, KEY_NAMES, defaultData, type DocName } from './remoteStore.keys'
import { attachPageEvents, createRemoteStore, type RemoteStore } from './remoteStore'
import type { StoreReply, StoreTransport } from './remoteStore.transport'
import { createSafeStorage, memoryStorage, type SafeStorage } from './safeStorage'

const ORIGIN = 'http://127.0.0.1:8765'
const SIDECAR = 'nqt.remote'
const recipe = (line: string) => ({ version: 1, panels: [{ line, group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } })
const snapshot = { version: 1, takenAt: 1, sources: {} }

interface Held {
  version: number
  data: unknown
}

/** An in-memory backend with the store's version rules: 412 on a stale If-Match, and a scripted fault per call. */
class FakeBackend implements StoreTransport {
  readonly docs = new Map<DocName, Held>()
  readonly calls: string[] = []
  faults: Array<{ method: 'GET' | 'PUT'; doc?: DocName; status: number }> = []
  constructor() {
    for (const doc of DATA_DOCS) this.docs.set(doc, { version: 0, data: defaultData(doc) })
    this.docs.set('meta', { version: 0, data: { schema: 1, imports: [] } })
  }

  private fault(method: 'GET' | 'PUT', doc: DocName): StoreReply | null {
    const at = this.faults.findIndex((f) => f.method === method && (f.doc === undefined || f.doc === doc))
    if (at < 0) return null
    const [hit] = this.faults.splice(at, 1)
    return { status: hit!.status, body: hit!.status === 0 ? null : { detail: 'scripted' } }
  }

  async read(doc: DocName): Promise<StoreReply> {
    this.calls.push(`GET ${doc}`)
    return this.fault('GET', doc) ?? { status: 200, body: { doc, ...this.docs.get(doc)! } }
  }

  async write(doc: DocName, version: number, data: unknown): Promise<StoreReply> {
    this.calls.push(`PUT ${doc}`)
    const faulted = this.fault('PUT', doc)
    if (faulted) return faulted
    const held = this.docs.get(doc)!
    if (held.version !== version) return { status: 412, body: { detail: 'stale' } }
    const next = { version: held.version + 1, data: JSON.parse(JSON.stringify(data)) as unknown }
    this.docs.set(doc, next)
    return { status: 200, body: { doc, ...next } }
  }

  writeLast(doc: DocName, version: number, data: unknown): Promise<StoreReply> {
    this.calls.push('LAST')
    return this.write(doc, version, data)
  }

  /** Another page's write: bumps the version behind this page's back. */
  elsewhere(doc: DocName, data: unknown): void {
    this.docs.set(doc, { version: this.docs.get(doc)!.version + 1, data })
  }

  puts(): string[] {
    return this.calls.filter((c) => c.startsWith('PUT'))
  }
}

interface Rig {
  backend: FakeBackend
  cache: SafeStorage
  raw: Storage
  told: string[]
  make(options?: { origin?: string; demo?: boolean }): RemoteStore
}

function rig(existing?: Storage): Rig {
  const raw = existing ?? memoryStorage()
  const backend = new FakeBackend()
  const cache = createSafeStorage(() => raw)
  const told: string[] = []
  return {
    backend,
    cache,
    raw,
    told,
    make: (options = {}) => createRemoteStore({ transport: backend, cache, origin: options.origin ?? ORIGIN, demo: options.demo, announce: (key) => told.push(key) }),
  }
}

const seedTen = (raw: Storage) => {
  raw.setItem('nqt.workspaces', JSON.stringify({ version: 1, list: { MINE: recipe('NQ GP 1d') }, last: 'MINE' }))
  raw.setItem('nqt.layouts', JSON.stringify({ version: 1, layouts: { HOME: { grid: 1 } } }))
  raw.setItem('nqt.linkGroups', JSON.stringify({ version: 1, contexts: { A: { kind: 'instrument', value: 'NQ' }, B: null, C: null } }))
  raw.setItem('nqt.watch', JSON.stringify(snapshot))
  raw.setItem('nqt.cmd.history', JSON.stringify(['NQ GP 1d', 'REG']))
  raw.setItem('nqt.tape', 'true')
  raw.setItem('nqt.cvd', 'deut')
  raw.setItem('nqt.theme', 'amber-classic')
  raw.setItem('nqt.orientation', '1')
  raw.setItem('nqt.mon.defaults', JSON.stringify({ view: 'normalised', heat: true, window: 60 }))
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('an older backend, a rollback or a store that is down', () => {
  it('falls back to localStorage alone, without an error, when the store answers 404', async () => {
    const r = rig()
    r.backend.faults = [{ method: 'GET', status: 404 }]
    seedTen(r.raw)
    const store = r.make()
    expect(await store.start()).toBe('off')
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(2000)
    expect(r.backend.calls).toEqual(['GET meta'])
    expect(r.raw.getItem(SIDECAR)).toBeNull()
    expect(r.raw.getItem('nqt.theme')).toBe('amber-classic')
  })

  it('treats a 503 on the read as "unavailable", never as an empty store: nothing imported, nothing overwritten', async () => {
    const r = rig()
    seedTen(r.raw)
    r.backend.faults = [{ method: 'GET', doc: 'meta', status: 503 }]
    const store = r.make()
    expect(await store.start()).toBe('unavailable')
    expect(r.raw.getItem('nqt.workspaces')).not.toBeNull()
    expect(r.backend.puts()).toEqual([])
    r.backend.faults = [{ method: 'GET', doc: 'layouts', status: 503 }]
    expect(await store.start()).toBe('unavailable')
    expect(r.backend.puts()).toEqual([])
    expect(await store.start()).toBe('ready')
    expect(r.backend.docs.get('workspaces')!.version).toBe(1)
  })

  it('treats a reply that is not the store (a page, a 200 with no JSON) as no store', async () => {
    const r = rig()
    r.backend.read = async () => ({ status: 200, body: null })
    expect(await r.make().start()).toBe('off')
  })

  it('does nothing in the demo build: no request, no key of its own', async () => {
    const r = rig()
    seedTen(r.raw)
    const store = r.make({ demo: true })
    expect(await store.start()).toBe('off')
    expect(r.backend.calls).toEqual([])
    expect(r.raw.getItem(SIDECAR)).toBeNull()
  })
})

describe('the page on an empty origin (the app at every launch)', () => {
  it('reads the stored documents into the cache and tells the page which keys changed', async () => {
    const r = rig()
    r.backend.elsewhere('workspaces', { list: { KEPT: recipe('REG') }, last: 'KEPT' })
    r.backend.elsewhere('prefs', { theme: 'amber-classic', tape: true })
    r.backend.elsewhere('history', ['REG', 'NQ GP 1d'])
    expect(await r.make().start()).toBe('ready')
    expect(JSON.parse(r.raw.getItem('nqt.workspaces')!)).toEqual({ version: 1, list: { KEPT: recipe('REG') }, last: 'KEPT' })
    expect(r.raw.getItem('nqt.theme')).toBe('amber-classic')
    expect(r.raw.getItem('nqt.tape')).toBe('true')
    expect(JSON.parse(r.raw.getItem('nqt.cmd.history')!)).toEqual(['REG', 'NQ GP 1d'])
    expect(r.told.sort()).toEqual(['nqt.cmd.history', 'nqt.tape', 'nqt.theme', 'nqt.workspaces'])
  })

  it('adds nothing and does not list its origin when its storage is empty', async () => {
    const r = rig()
    expect(await r.make().start()).toBe('ready')
    expect(r.backend.puts()).toEqual([])
    expect(r.backend.docs.get('meta')!.data).toEqual({ schema: 1, imports: [] })
  })

  it('counts storage holding only values the page would not accept as empty: nothing imported, origin not listed', async () => {
    const r = rig()
    r.raw.setItem('nqt.theme', 'not-a-theme')
    r.raw.setItem('nqt.cmd.history', '{"not":"a list"}')
    expect(await r.make().start()).toBe('ready')
    expect(r.backend.puts()).toEqual([])
    expect((r.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toEqual([])
  })

  it('keeps a key the store holds nothing for (a document never written) and sends it on', async () => {
    const r = rig()
    r.raw.setItem(SIDECAR, JSON.stringify({ synced: true, dirty: [] }))
    r.raw.setItem('nqt.theme', 'amber-classic')
    await r.make().start()
    await vi.advanceTimersByTimeAsync(10)
    expect(r.raw.getItem('nqt.theme')).toBe('amber-classic')
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'amber-classic' })
  })
})

describe('the one-time per-origin import (03 section 10.4)', () => {
  it('writes every document that has something, then lists the origin in meta last, and marks the origin synced', async () => {
    const r = rig()
    seedTen(r.raw)
    expect(await r.make().start()).toBe('ready')
    expect(r.backend.puts()).toEqual(['PUT workspaces', 'PUT layouts', 'PUT linkGroups', 'PUT watch', 'PUT history', 'PUT prefs', 'PUT meta'])
    expect(r.backend.docs.get('workspaces')!.data).toEqual({ list: { MINE: recipe('NQ GP 1d') }, last: 'MINE' })
    expect(r.backend.docs.get('layouts')!.data).toEqual({ HOME: { grid: 1 } })
    expect(r.backend.docs.get('history')!.data).toEqual(['NQ GP 1d', 'REG'])
    expect(r.backend.docs.get('prefs')!.data).toEqual({ tape: true, cvd: 'deut', theme: 'amber-classic', orientation: '1', mon: { view: 'normalised', heat: true, window: 60 } })
    const meta = r.backend.docs.get('meta')!.data as { imports: Array<{ origin: string; at: string }> }
    expect(meta.imports.map((e) => e.origin)).toEqual([ORIGIN])
    expect(JSON.parse(r.raw.getItem(SIDECAR)!)).toEqual({ synced: true, dirty: [] })
    expect(KEY_NAMES.every((key) => r.raw.getItem(key) !== null)).toBe(true)
  })

  it('does not list the origin when a document write fails, keeps the cache, and finishes on the next try', async () => {
    const r = rig()
    seedTen(r.raw)
    r.backend.faults = [{ method: 'PUT', doc: 'history', status: 503 }]
    const store = r.make()
    expect(await store.start()).toBe('unavailable')
    expect((r.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toEqual([])
    expect(r.raw.getItem('nqt.cmd.history')).not.toBeNull()
    expect(await store.start()).toBe('ready')
    expect((r.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toHaveLength(1)
    expect(r.backend.docs.get('history')!.data).toEqual(['NQ GP 1d', 'REG'])
  })

  it('adds what the store lacks, keeps differing workspace and layout entries as "<name> (imported)", and the store\'s value stays', async () => {
    const r = rig()
    seedTen(r.raw)
    r.backend.elsewhere('workspaces', { list: { MINE: recipe('REG'), OTHER: recipe('MON') }, last: 'OTHER' })
    r.backend.elsewhere('layouts', { HOME: { grid: 2 } })
    r.backend.elsewhere('prefs', { theme: 'standard' })
    await r.make().start()
    const workspaces = r.backend.docs.get('workspaces')!.data as { list: Record<string, unknown>; last: string }
    expect(workspaces.list['MINE']).toEqual(recipe('REG'))
    expect(workspaces.list['MINE (imported)']).toEqual(recipe('NQ GP 1d'))
    expect(workspaces.list['OTHER']).toEqual(recipe('MON'))
    expect(workspaces.last).toBe('OTHER')
    const layouts = r.backend.docs.get('layouts')!.data as Record<string, unknown>
    expect(layouts).toEqual({ HOME: { grid: 2 }, 'HOME (imported)': { grid: 1 } })
    expect(r.backend.docs.get('prefs')!.data).toMatchObject({ theme: 'standard', tape: true, cvd: 'deut' })
    expect(JSON.parse(r.raw.getItem('nqt.workspaces')!).list['MINE']).toEqual(recipe('REG'))
  })

  it('retries a layouts document the store refuses with copy names without them, so the import still completes', async () => {
    const r = rig()
    seedTen(r.raw)
    r.backend.elsewhere('layouts', { HOME: { grid: 2 } })
    r.backend.faults = [{ method: 'PUT', doc: 'layouts', status: 422 }]
    expect(await r.make().start()).toBe('ready')
    expect(r.backend.docs.get('layouts')!.data).toEqual({ HOME: { grid: 2 } })
    expect((r.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toHaveLength(1)
  })

  it('repeats safely: a second page, or a retry, adds nothing new, and a listed origin does not import again', async () => {
    const r = rig()
    seedTen(r.raw)
    await r.make().start()
    const before = JSON.stringify([...r.backend.docs])
    const again = rig(memoryStorage())
    again.backend.docs.clear()
    for (const [doc, held] of r.backend.docs) again.backend.docs.set(doc, { ...held })
    seedTen(again.raw)
    await again.make().start()
    expect(again.backend.puts()).toEqual([])
    expect(JSON.stringify([...again.backend.docs])).toBe(before)
  })

  it('imports again the same content with no change when the first attempt wrote documents but not meta (idempotent merge)', async () => {
    const r = rig()
    seedTen(r.raw)
    r.backend.faults = [{ method: 'PUT', doc: 'meta', status: 503 }]
    const store = r.make()
    expect(await store.start()).toBe('unavailable')
    const docsAfterFirst = JSON.stringify([...r.backend.docs].filter(([d]) => d !== 'meta'))
    await store.start()
    expect(JSON.stringify([...r.backend.docs].filter(([d]) => d !== 'meta'))).toBe(docsAfterFirst)
    expect((r.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toHaveLength(1)
  })

  it('does not touch the keys of the page when another origin already imported theirs (empty page, second origin)', async () => {
    const r = rig()
    seedTen(r.raw)
    await r.make().start()
    const other = rig()
    other.backend.docs.clear()
    for (const [doc, held] of r.backend.docs) other.backend.docs.set(doc, { ...held })
    await other.make({ origin: 'http://127.0.0.1:50123' }).start()
    expect(other.backend.puts()).toEqual([])
    expect((other.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toHaveLength(1)
  })

  it('on a 412 while writing meta, re-reads it and stops when the origin is already there', async () => {
    const r = rig()
    seedTen(r.raw)
    const original = r.backend.write.bind(r.backend)
    r.backend.write = async (doc, version, data) => {
      if (doc === 'meta') r.backend.elsewhere('meta', { schema: 1, imports: [{ origin: ORIGIN, at: '2026-01-01T00:00:00Z' }] })
      return original(doc, version, data)
    }
    expect(await r.make().start()).toBe('ready')
    expect((r.backend.docs.get('meta')!.data as { imports: unknown[] }).imports).toHaveLength(1)
  })
})

describe('writes: debounce, flush and the version clash', () => {
  async function ready(r: Rig): Promise<RemoteStore> {
    r.raw.setItem(SIDECAR, JSON.stringify({ synced: true, dirty: [] }))
    const store = r.make()
    await store.start()
    r.backend.calls.length = 0
    return store
  }

  it('debounces writes at 500 ms: many changes in a burst make one write, sent when the burst is 500 ms quiet', async () => {
    const r = rig()
    const store = await ready(r)
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(400)
    store.note('nqt.cvd', 'prot')
    await vi.advanceTimersByTimeAsync(400)
    expect(r.backend.puts()).toEqual([])
    await vi.advanceTimersByTimeAsync(150)
    expect(r.backend.puts()).toEqual(['PUT prefs'])
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'standard', cvd: 'prot' })
    expect(JSON.parse(r.raw.getItem(SIDECAR)!).dirty).toEqual([])
  })

  it('writes the changed document only, with the version it read', async () => {
    const r = rig()
    r.backend.elsewhere('history', ['REG'])
    const store = await ready(r)
    store.note('nqt.cmd.history', JSON.stringify(['REG', 'NQ GP 1d']))
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.puts()).toEqual(['PUT history'])
    expect(r.backend.docs.get('history')).toEqual({ version: 2, data: ['REG', 'NQ GP 1d'] })
  })

  it('keeps the change in the sidecar until it is written, so a closed page does not lose it', async () => {
    const r = rig()
    const store = await ready(r)
    store.note('nqt.theme', 'amber-classic')
    expect(JSON.parse(r.raw.getItem(SIDECAR)!)).toEqual({ synced: true, dirty: ['nqt.theme'] })
    store.dispose()
    r.raw.setItem('nqt.theme', 'amber-classic')
    const next = r.make()
    await next.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'amber-classic' })
  })

  it('flushes at once on pagehide and when the page becomes hidden, but not when it becomes visible', async () => {
    const r = rig()
    const store = await ready(r)
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    attachPageEvents(store, win, doc)
    store.note('nqt.theme', 'standard')
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(r.backend.puts()).toEqual([])
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(r.backend.puts()).toEqual(['PUT prefs'])
    store.note('nqt.cvd', 'deut')
    win.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(r.backend.calls).toContain('LAST')
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'standard', cvd: 'deut' })
  })

  it('a page hidden while the store is unavailable keeps its retry timer, so the change is still sent later', async () => {
    const r = rig()
    const store = await ready(r)
    r.backend.faults = [{ method: 'PUT', doc: 'prefs', status: 503 }]
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(store.status()).toBe('unavailable')
    await store.flush(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(store.status()).toBe('ready')
  })

  it('on a 412 merges by the document\'s rule and retries once: workspaces, newest wins, the loser as "(conflict)"', async () => {
    const r = rig()
    r.backend.elsewhere('workspaces', { list: { ONE: recipe('A') }, last: 'ONE' })
    const store = await ready(r)
    r.backend.elsewhere('workspaces', { list: { ONE: recipe('theirs'), THEIRS: recipe('t') }, last: 'ONE' })
    store.note('nqt.workspaces', JSON.stringify({ version: 1, list: { ONE: recipe('mine') }, last: 'ONE' }))
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.calls.filter((c) => c === 'PUT workspaces')).toHaveLength(2)
    const merged = r.backend.docs.get('workspaces')!.data as { list: Record<string, unknown> }
    expect(merged.list['ONE']).toEqual(recipe('mine'))
    expect(merged.list['ONE (conflict)']).toEqual(recipe('theirs'))
    expect(merged.list['THEIRS']).toEqual(recipe('t'))
    expect(JSON.parse(r.raw.getItem('nqt.workspaces')!).list['THEIRS']).toEqual(recipe('t'))
    expect(r.told).toContain('nqt.workspaces')
  })

  it('on a 412 merges prefs field by field and history as a union', async () => {
    const r = rig()
    r.backend.elsewhere('prefs', { theme: 'standard', cvd: 'deut' })
    r.backend.elsewhere('history', ['a'])
    const store = await ready(r)
    r.backend.elsewhere('prefs', { theme: 'amber-classic', cvd: 'deut', orientation: '1' })
    r.backend.elsewhere('history', ['a', 'b'])
    store.note('nqt.cvd', 'prot')
    store.note('nqt.cmd.history', JSON.stringify(['a', 'c']))
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'amber-classic', cvd: 'prot', orientation: '1' })
    expect(r.backend.docs.get('history')!.data).toEqual(['a', 'b', 'c'])
  })

  it('on a 412 settles layouts per mnemonic, and linkGroups and watch as whole documents', async () => {
    const r = rig()
    r.backend.elsewhere('layouts', { HOME: { n: 1 } })
    const store = await ready(r)
    r.backend.elsewhere('layouts', { HOME: { n: 1 }, REG: { n: 5 } })
    r.backend.elsewhere('watch', snapshot)
    store.note('nqt.layouts', JSON.stringify({ version: 1, layouts: { HOME: { n: 2 } } }))
    store.note('nqt.watch', JSON.stringify({ ...snapshot, takenAt: 99 }))
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.docs.get('layouts')!.data).toEqual({ HOME: { n: 2 }, REG: { n: 5 } })
    expect(r.backend.docs.get('watch')!.data).toEqual({ ...snapshot, takenAt: 99 })
  })

  it('retries a clash once only: a second 412 leaves the change pending, and a later flush sends it', async () => {
    const r = rig()
    const store = await ready(r)
    const original = r.backend.write.bind(r.backend)
    let clashes = 2
    r.backend.write = async (doc, version, data) => {
      if (doc === 'prefs' && clashes-- > 0) r.backend.elsewhere('prefs', { orientation: '1' })
      return original(doc, version, data)
    }
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.calls.filter((c) => c === 'PUT prefs')).toHaveLength(2)
    expect(JSON.parse(r.raw.getItem(SIDECAR)!).dirty).toEqual(['nqt.theme'])
    await store.flush()
    expect(r.backend.docs.get('prefs')!.data).toEqual({ orientation: '1', theme: 'standard' })
  })

  it('keeps a change pending and tries again later when the store does not answer', async () => {
    const r = rig()
    const store = await ready(r)
    r.backend.faults = [{ method: 'PUT', status: 0 }]
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.docs.get('prefs')!.version).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
  })

  it('drops a change the store refuses (422) instead of sending it for ever, and keeps it in the cache', async () => {
    const r = rig()
    const store = await ready(r)
    r.backend.faults = [{ method: 'PUT', doc: 'prefs', status: 422 }]
    r.raw.setItem('nqt.theme', 'standard')
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(JSON.parse(r.raw.getItem(SIDECAR)!).dirty).toEqual([])
    expect(r.raw.getItem('nqt.theme')).toBe('standard')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(r.backend.calls.filter((c) => c === 'PUT prefs')).toHaveLength(1)
  })

  it.each([401, 403])('keeps a change the store will not take from this session (%i) pending and sends it again, instead of dropping it', async (status) => {
    const r = rig()
    const store = await ready(r)
    r.backend.faults = [{ method: 'PUT', doc: 'prefs', status }]
    r.raw.setItem('nqt.theme', 'standard')
    store.note('nqt.theme', 'standard')
    await vi.advanceTimersByTimeAsync(600)
    expect(JSON.parse(r.raw.getItem(SIDECAR)!).dirty).toEqual(['nqt.theme'])
    expect(store.status()).toBe('unavailable')
    expect(r.raw.getItem('nqt.theme')).toBe('standard')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(r.backend.docs.get('prefs')!.data).toEqual({ theme: 'standard' })
    expect(JSON.parse(r.raw.getItem(SIDECAR)!).dirty).toEqual([])
    expect(store.status()).toBe('ready')
  })

  it('keeps what another origin added to a document while this page had an unsent change (carried over a reload)', async () => {
    const r = rig()
    r.backend.elsewhere('workspaces', { list: { ONE: recipe('A'), EXTRA: recipe('theirs') }, last: 'ONE' })
    r.backend.elsewhere('layouts', { HOME: { n: 1 }, REG: { n: 5 } })
    r.raw.setItem(SIDECAR, JSON.stringify({ synced: true, dirty: ['nqt.workspaces', 'nqt.layouts'] }))
    r.raw.setItem('nqt.workspaces', JSON.stringify({ version: 1, list: { ONE: recipe('mine') }, last: 'ONE' }))
    r.raw.setItem('nqt.layouts', JSON.stringify({ version: 1, layouts: { HOME: { n: 2 } } }))
    await r.make().start()
    await vi.advanceTimersByTimeAsync(600)
    const spaces = r.backend.docs.get('workspaces')!.data as { list: Record<string, unknown> }
    expect(spaces.list['ONE']).toEqual(recipe('mine'))
    expect(spaces.list['EXTRA']).toEqual(recipe('theirs'))
    expect(r.backend.docs.get('layouts')!.data).toEqual({ HOME: { n: 2 }, REG: { n: 5 } })
    expect(JSON.parse(r.raw.getItem(SIDECAR)!).dirty).toEqual([])
  })

  it('ignores a written value it cannot read as that key\'s format (nothing is sent for it)', async () => {
    const r = rig()
    const store = await ready(r)
    store.note('nqt.theme', 'not-a-theme')
    store.note('nqt.cmd.history', '{"not":"a list"}')
    await vi.advanceTimersByTimeAsync(600)
    expect(r.backend.puts()).toEqual([])
  })
})
