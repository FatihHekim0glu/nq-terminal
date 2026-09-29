import { describe, expect, it } from 'vitest'
import { createSafeStorage, memoryStorage, type SafeStorage } from './safeStorage'
import { MAX_WATCH_CHARS, WATCH_KEY, createRecordWatchStore } from './recordWatch.store'
import type { WatchSnapshot } from './recordWatch.schema'

const SNAPSHOT: WatchSnapshot = {
  version: 1,
  takenAt: 1_790_000_000_000,
  sources: {
    registry: { count: 2, records: { a_v0: { p: 0.05, verdict: 'FAIL', registered: true }, b_v0: { p: null, verdict: 'PASS', registered: false } } },
    runs: { count: 1, records: { r1: { created_utc: '2026-09-26', pnl_total: 12.5, n_trades: 3 } } },
  },
}

const fresh = (): SafeStorage => {
  const backing = memoryStorage()
  return createSafeStorage(() => backing)
}

describe('the record watch store', () => {
  it('uses the key nqt.watch and a 200,000 character cap', () => {
    expect(WATCH_KEY).toBe('nqt.watch')
    expect(MAX_WATCH_CHARS).toBe(200_000)
  })

  it('starts with no checkpoint on empty storage', () => {
    expect(createRecordWatchStore(fresh()).getState().checkpoint).toBeNull()
  })

  it('persists a checkpoint and reloads it in a new store', () => {
    const storage = fresh()
    const a = createRecordWatchStore(storage)
    expect(a.getState().setCheckpoint(SNAPSHOT)).toBe(true)
    expect(a.getState().checkpoint).toEqual(SNAPSHOT)
    expect(storage.read(WATCH_KEY)).toBe(JSON.stringify(SNAPSHOT))
    expect(createRecordWatchStore(storage).getState().checkpoint).toEqual(SNAPSHOT)
  })

  it('refuses a checkpoint over the cap, keeps the old one and writes nothing new', () => {
    const storage = fresh()
    const store = createRecordWatchStore(storage)
    store.getState().setCheckpoint(SNAPSHOT)
    const huge: WatchSnapshot = { ...SNAPSHOT, sources: { runs: { count: 1, records: { r1: { blob: 'x'.repeat(MAX_WATCH_CHARS) } } } } }
    expect(store.getState().setCheckpoint(huge)).toBe(false)
    expect(store.getState().checkpoint).toEqual(SNAPSHOT)
    expect(storage.read(WATCH_KEY)).toBe(JSON.stringify(SNAPSHOT))
  })

  it('accepts a checkpoint that is exactly at the cap', () => {
    const store = createRecordWatchStore(fresh())
    const base: WatchSnapshot = { version: 1, takenAt: 1, sources: { runs: { count: 1, records: { r1: { blob: '' } } } } }
    const slack = MAX_WATCH_CHARS - JSON.stringify(base).length
    const exact: WatchSnapshot = { ...base, sources: { runs: { count: 1, records: { r1: { blob: 'x'.repeat(slack) } } } } }
    expect(JSON.stringify(exact)).toHaveLength(MAX_WATCH_CHARS)
    expect(store.getState().setCheckpoint(exact)).toBe(true)
  })

  it('refuses something that is not a snapshot', () => {
    const store = createRecordWatchStore(fresh())
    expect(store.getState().setCheckpoint({ version: 2 } as unknown as WatchSnapshot)).toBe(false)
    expect(store.getState().checkpoint).toBeNull()
  })

  it('ignores corrupt JSON in storage', () => {
    const storage = fresh()
    storage.write(WATCH_KEY, '{"version":1,"takenAt":')
    expect(createRecordWatchStore(storage).getState().checkpoint).toBeNull()
  })

  it('ignores JSON of the wrong shape in storage', () => {
    const storage = fresh()
    storage.write(WATCH_KEY, JSON.stringify({ ...SNAPSHOT, version: 9 }))
    expect(createRecordWatchStore(storage).getState().checkpoint).toBeNull()
    storage.write(WATCH_KEY, JSON.stringify({ ...SNAPSHOT, extra: 1 }))
    expect(createRecordWatchStore(storage).getState().checkpoint).toBeNull()
  })

  it('ignores a stored checkpoint whose time is beyond the range of a Date', () => {
    const storage = fresh()
    storage.write(WATCH_KEY, JSON.stringify({ ...SNAPSHOT, takenAt: 1e20 }))
    expect(createRecordWatchStore(storage).getState().checkpoint).toBeNull()
  })

  it('reports false, and keeps nothing, when storage refuses the write', () => {
    const blocked: SafeStorage = { read: () => null, write: () => false, remove: () => false }
    const store = createRecordWatchStore(blocked)
    expect(store.getState().setCheckpoint(SNAPSHOT)).toBe(false)
    expect(store.getState().checkpoint).toBeNull()
  })

  it('clear forgets the checkpoint in memory and in storage', () => {
    const storage = fresh()
    const store = createRecordWatchStore(storage)
    store.getState().setCheckpoint(SNAPSHOT)
    store.getState().clear()
    expect(store.getState().checkpoint).toBeNull()
    expect(storage.read(WATCH_KEY)).toBeNull()
    expect(createRecordWatchStore(storage).getState().checkpoint).toBeNull()
  })
})
