// Where the record watch keeps its checkpoint: this browser's localStorage under one key, capped in size.
// The checkpoint is untrusted input on the way back in: it loads only through the schema's strict check
// (never through the diff module, which stays a lazy chunk), and a value that fails it is ignored.
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { isWatchSnapshot, type WatchSnapshot } from './recordWatch.schema'
import { readJson, safeLocalStorage, type SafeStorage } from './safeStorage'

export const WATCH_KEY = 'nqt.watch'
/** Cap on the checkpoint's JSON text, well inside a browser's per-origin quota. */
export const MAX_WATCH_CHARS = 200_000

export interface RecordWatchState {
  /** The records as the viewer last marked them seen, or null before the first visit. */
  readonly checkpoint: WatchSnapshot | null
  /** Keep a checkpoint; false (and no change) when it is invalid, over the cap or storage refuses it. */
  setCheckpoint(snapshot: WatchSnapshot): boolean
  clear(): void
}

export type RecordWatchStore = UseBoundStore<StoreApi<RecordWatchState>>

export function createRecordWatchStore(storage: SafeStorage = safeLocalStorage): RecordWatchStore {
  return create<RecordWatchState>()((set) => ({
    checkpoint: readJson(storage, WATCH_KEY, isWatchSnapshot),
    setCheckpoint: (snapshot) => {
      if (!isWatchSnapshot(snapshot)) return false
      const text = JSON.stringify(snapshot)
      if (text.length > MAX_WATCH_CHARS || !storage.write(WATCH_KEY, text)) return false
      set({ checkpoint: snapshot })
      return true
    },
    clear: () => {
      storage.remove(WATCH_KEY)
      set({ checkpoint: null })
    },
  }))
}

/** The app-wide store over window.localStorage. */
export const useRecordWatchStore: RecordWatchStore = createRecordWatchStore()
