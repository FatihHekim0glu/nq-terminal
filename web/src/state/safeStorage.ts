// Browser storage for per-viewer conveniences only (remembered layouts and link contexts).
// Every call is wrapped: the accessor can throw in a private window or with blocked site data, reads can
// come back empty, and writes can hit the quota. Nothing here is state that must persist reliably, so a
// failure means "fall back to the default", never an error on screen. Stored values are untrusted input
// and are validated by the caller on the way back in.

export interface SafeStorage {
  /** The stored string, or null when missing or when storage is unavailable. */
  read(key: string): string | null
  /** True when the value was stored. */
  write(key: string, value: string): boolean
  /** True when the key was removed (or was already absent). */
  remove(key: string): boolean
}

type StorageSource = () => Storage | undefined

function browserLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

export function createSafeStorage(source: StorageSource = browserLocalStorage): SafeStorage {
  const attempt = <T>(fallback: T, action: (storage: Storage) => T): T => {
    try {
      const storage = source()
      return storage ? action(storage) : fallback
    } catch {
      return fallback
    }
  }
  return {
    read: (key) => attempt<string | null>(null, (s) => s.getItem(key)),
    write: (key, value) =>
      attempt(false, (s) => {
        s.setItem(key, value)
        return true
      }),
    remove: (key) =>
      attempt(false, (s) => {
        s.removeItem(key)
        return true
      }),
  }
}

/** The shared instance over window.localStorage. */
export const safeLocalStorage: SafeStorage = createSafeStorage()

/** Parse and validate a stored JSON value; null when missing, corrupt or not the expected shape. */
export function readJson<T>(storage: SafeStorage, key: string, isValid: (value: unknown) => value is T): T | null {
  const text = storage.read(key)
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return isValid(value) ? value : null
  } catch {
    return null
  }
}

/** Store a value as JSON; false when it cannot be encoded or storage refuses it. */
export function writeJson(storage: SafeStorage, key: string, value: unknown): boolean {
  let text: string
  try {
    text = JSON.stringify(value)
  } catch {
    return false
  }
  return storage.write(key, text)
}

/** An in-memory Storage for tests and for environments without localStorage. */
export function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, String(value))
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

/** A plain JSON object (not an array, not null): the shape every stored record must have. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
