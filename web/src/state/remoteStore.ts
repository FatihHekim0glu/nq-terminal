// The page's side of the workspace store (03 sections 10.2 to 10.4, D3.3): the ten localStorage keys are kept as seven
// documents on the backend (GET and PUT /api/workspaces/{doc}, If-Match), and localStorage stays as a fast cache.
//
// How it fits. The store modules (state/workspaces.ts and the others) are unchanged in how they work: they read the
// cache synchronously and write it through `safeLocalStorage`, which tells this module of each write (setWriteObserver).
// This module sends the change on 500 ms after the last one (at once on pagehide and when the page is hidden), settles
// a version clash by the document's merge rule and retries once, and on start reads the documents into the cache and
// raises a `storage` event for each key that changed, which the modules already listen for.
//
// The unsent list is no safety net in the desktop app: its origin changes with the shell's port, so the cache (and this
// list) starts empty at every launch. It protects the fixed-origin door only; in the app a change not yet sent is saved
// by the page-hide flush (keepalive requests that fit the shared 64 kB quota) and by the shell's flush before it stops.
//
// States: `off` (the backend has no store: a 404, an older backend or a rollback, the demo build; the keys then work as
// plain localStorage, with no error), `unavailable` (the store did not answer or failed: tried again, never read as
// empty), `ready`. A change not yet sent is listed in the key `nqt.remote` (with whether this origin's cache was ever
// made from the store), so on the fixed-origin door a closed page or a stopped backend loses nothing.
import { createSafeStorage, readJson, safeLocalStorage, type SafeStorage } from './safeStorage'
import { setWriteObserver } from './safeStorage.observe'
import {
  DATA_DOCS, KEY_NAMES, cleanData, defaultData, keysOf, overlayKeys, specFor, textsFromDoc, type DataDoc, type DocName,
} from './remoteStore.keys'
import { mergeImport, mergeOnClash, same, stripCopies } from './remoteStore.merge'
import { refreshTape, TAPE_KEY } from '../chrome/EventTape.store'
import { postMessage, type MessageTone } from '../chrome/MessageLine.store'
import { STORE_NOTICE } from '../copy/storeNotice'
import { applyScheme, loadScheme, SCHEME_KEY } from '../chrome/FrameStrip.scheme'
import { applyStoredLook, LOOK_KEY } from '../theme/look'
import { LINK_GROUPS_KEY, loadContexts, useLinkGroups } from './linkGroups'
import { isWatchSnapshot } from './recordWatch.schema'
import { useRecordWatchStore, WATCH_KEY } from './recordWatch.store'
import { createFetchTransport, type StoreReply, type StoreTransport } from './remoteStore.transport'

export type RemoteStatus = 'idle' | 'ready' | 'off' | 'unavailable'

export const DEBOUNCE_MS = 500
export const RETRY_MS = 5_000
/** The delay between sends doubles with each failed one, up to this: an outage is waited out, not hammered. */
export const RETRY_MAX_MS = 60_000
/** The bookkeeping key: which keys await sending, and whether this origin's cache was ever made from the store. */
export const SIDECAR_KEY = 'nqt.remote'

export interface RemoteDeps {
  readonly transport: StoreTransport
  /** The cache, written directly (not through the observed shared storage: its writes are not changes to send). */
  readonly cache: SafeStorage
  /** The page's origin: what `meta.imports` lists. */
  readonly origin: string
  readonly demo?: boolean
  /** Tells the page a cache key changed under it; by default a `storage` event on the window. */
  readonly announce?: (key: string) => void
  /** Says something to the user (the message line by default): the store cannot take a change, or can again. */
  readonly notify?: (text: string, tone: MessageTone) => void
  readonly now?: () => Date
}

export interface RemoteStore {
  /** Reads the store, imports this origin's keys once, makes the cache match; again after `unavailable`. */
  start(): Promise<RemoteStatus>
  /** A key was written (text) or removed (null): send it on after the debounce. */
  note(key: string, value: string | null): void
  /** Sends what is pending now; `last` is the page's last moment (no waiting, no retry after a clash). */
  flush(last?: boolean): Promise<void>
  status(): RemoteStatus
  /** How many keys are changed and not yet taken by the store. */
  pending(): number
  /** Stops the timers (tests, and a page that is going away). */
  dispose(): void
}

interface Held {
  readonly version: number
  readonly data: unknown
}

type Put =
  | { readonly kind: 'ok'; readonly held: Held }
  | { readonly kind: 'skip' | 'refused' | 'off' | 'down' | 'clash' }

/** How a read or an import step came out: fine (`ok`), no store (`off`), or to be tried again (`down`). */
type Verdict = 'ok' | 'off' | 'down'

const isHeld = (body: unknown): body is { version: number; data: unknown } =>
  typeof body === 'object' && body !== null && Number.isInteger((body as { version?: unknown }).version) && 'data' in body

const outage = (reply: StoreReply): boolean => reply.status === 0 || reply.status >= 500

/** The store will not take anything from this session (no session, or not this origin's): a fault of the connection, not
 * of the change, so the change waits and is sent again; dropping it would let the next read overwrite it in the cache. */
const notAllowed = (reply: StoreReply): boolean => reply.status === 401 || reply.status === 403

/** What a reply that is not a 200 or a 412 means for a write: no answer, no such route, or the store's refusal. */
function refusal(reply: StoreReply): Put {
  if (outage(reply) || notAllowed(reply)) return { kind: 'down' }
  return { kind: [404, 405].includes(reply.status) ? 'off' : 'refused' }
}

const verdict = (result: Put): Verdict => (result.kind === 'off' ? 'off' : result.kind === 'down' || result.kind === 'clash' ? 'down' : 'ok')

function textsEqual(a: string | null, b: string | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  try {
    return same(JSON.parse(a), JSON.parse(b))
  } catch {
    return false
  }
}

function defaultAnnounce(key: string): void {
  if (typeof window === 'undefined' || typeof StorageEvent === 'undefined') return
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

/** The engine behind `createRemoteStore`: one instance per page, its state in fields, each step a short method. */
class RemoteEngine implements RemoteStore {
  private readonly docs = new Map<DocName, Held>()
  private readonly dirty = new Map<string, string | null>()
  /** Documents whose unsent keys were carried over a reload: the cache copy may lack what the store gained since (no known base). */
  private readonly baseUnknown = new Set<DataDoc>()
  private readonly announce: (key: string) => void
  private readonly now: () => Date
  private readonly notify: (text: string, tone: MessageTone) => void
  /** True from the unsaved-changes message until the store takes the pending changes (one message per outage, not per retry). */
  private warned = false
  private state: RemoteStatus = 'idle'
  private synced = false
  private booting: Promise<RemoteStatus> | null = null
  private flushing: Promise<void> = Promise.resolve()
  /** The page's last-moment send while it runs: a second ask joins it instead of sending the same version again. */
  private lastRun: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private retries = 0
  /** True while a queued flush runs its step: a boot inside it must not queue another flush behind it (see `boot`). */
  private stepping = false

  private readonly deps: RemoteDeps

  constructor(deps: RemoteDeps) {
    this.deps = deps
    this.announce = deps.announce ?? defaultAnnounce
    this.now = deps.now ?? (() => new Date())
    this.notify = deps.notify ?? postMessage
  }

  /** The first failed send of an outage: the changes are only in this browser for now (WCAG 4.1.3). */
  private warnUnsaved(): void {
    if (this.warned) return
    this.warned = true
    this.notify(STORE_NOTICE.unsaved, 'error')
  }

  /** The store took everything that was waiting after a warning. */
  private announceRestored(): void {
    if (!this.warned || this.state !== 'ready' || this.dirty.size > 0) return
    this.warned = false
    this.notify(STORE_NOTICE.restored, 'info')
  }

  status = (): RemoteStatus => this.state

  pending = (): number => this.dirty.size

  dispose = (): void => this.clearTimer()

  private setStatus(next: RemoteStatus): RemoteStatus {
    this.state = next
    return next
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private saveSidecar(): void {
    this.deps.cache.write(SIDECAR_KEY, JSON.stringify({ synced: this.synced, dirty: [...this.dirty.keys()] }))
  }

  private readSidecar(): { synced: boolean; dirty: string[] } {
    try {
      const value = JSON.parse(this.deps.cache.read(SIDECAR_KEY) ?? 'null') as { synced?: unknown; dirty?: unknown } | null
      const listed = Array.isArray(value?.dirty) ? (value.dirty as unknown[]) : []
      return { synced: value?.synced === true, dirty: listed.filter((k): k is string => typeof k === 'string' && KEY_NAMES.includes(k)) }
    } catch {
      return { synced: false, dirty: [] }
    }
  }

  /** Reads one document into `docs`; the reply's verdict otherwise. */
  private async pull(doc: DocName): Promise<Verdict> {
    const reply = await this.deps.transport.read(doc)
    if (reply.status === 200 && isHeld(reply.body)) {
      this.docs.set(doc, { version: reply.body.version, data: reply.body.data })
      return 'ok'
    }
    return outage(reply) || notAllowed(reply) ? 'down' : 'off'
  }

  /** One write of `make(server)` made from the version held, with one retry after a 412 (a re-read and a re-merge). */
  private async put(doc: DocName, make: (server: unknown, retry: boolean) => unknown, last = false): Promise<Put> {
    for (const retry of [false, true]) {
      const held = this.docs.get(doc)
      if (held === undefined) return { kind: 'down' }
      const data = make(held.data, retry)
      if (data === undefined) return { kind: 'skip' }
      const { transport } = this.deps
      const reply = await (last ? transport.writeLast(doc, held.version, data) : transport.write(doc, held.version, data))
      if (reply.status === 200 && isHeld(reply.body)) {
        const stored: Held = { version: reply.body.version, data: reply.body.data }
        this.docs.set(doc, stored)
        return { kind: 'ok', held: stored }
      }
      if (reply.status !== 412) return refusal(reply)
      if (last || retry || (await this.pull(doc)) !== 'ok') return { kind: 'clash' }
    }
    return { kind: 'clash' }
  }

  /** Makes the cache hold the document: only keys that differ are written, each announced; `keep` keys are left alone. */
  private hydrate(doc: DataDoc, data: unknown, keep: ReadonlySet<string>): void {
    const clean = cleanData(doc, data)
    if (clean === null) return
    const { cache } = this.deps
    for (const [key, text] of textsFromDoc(doc, clean)) {
      if (keep.has(key) || textsEqual(cache.read(key), text)) continue
      if (text === null) cache.remove(key)
      else cache.write(key, text)
      this.announce(key)
    }
  }

  /** What this origin's cache holds of a document, cleaned; null when it holds nothing worth sending. */
  private importable(doc: DataDoc): unknown {
    const values = new Map(keysOf(doc).map((spec) => [spec.key, this.deps.cache.read(spec.key)]))
    if ([...values.values()].every((text) => text === null)) return null
    const clean = cleanData(doc, overlayKeys(doc, defaultData(doc), values))
    return clean === null || same(clean, defaultData(doc)) ? null : clean
  }

  private async importDoc(doc: DataDoc): Promise<Verdict> {
    const mine = this.importable(doc)
    if (mine === null) return 'ok'
    const merge = (server: unknown) => {
      const merged = mergeImport(doc, server, mine)
      return same(merged, server) ? undefined : merged
    }
    const first = await this.put(doc, merge)
    if (first.kind !== 'refused') return verdict(first)
    // The store refused the document (the copies' names, say): once more without them, so the import still completes.
    const without = (server: unknown) => {
      const merged = merge(server)
      return merged === undefined ? undefined : stripCopies(doc, merged)
    }
    return verdict(await this.put(doc, without))
  }

  /** Lists this origin in `meta` once the documents are written; stops when it is already there (another page was first). */
  private async markImported(): Promise<Verdict> {
    const { origin } = this.deps
    const add = (server: unknown) => {
      const imports = (server as { imports?: Array<{ origin: string }> }).imports ?? []
      if (imports.some((entry) => entry.origin === origin)) return undefined
      const schema = (server as { schema?: number }).schema ?? 1
      return { schema, imports: [...imports, { origin, at: this.now().toISOString() }] }
    }
    return verdict(await this.put('meta', add))
  }

  private async runImport(): Promise<Verdict> {
    for (const doc of DATA_DOCS) {
      const step = await this.importDoc(doc)
      if (step !== 'ok') return step
    }
    return this.markImported()
  }

  /** After the read: pending keys go on the list, a document the store never held gets this cache's keys, the rest is read in. */
  private adopt(listed: readonly string[]): void {
    const { cache } = this.deps
    for (const key of listed) {
      if (!this.dirty.has(key)) this.dirty.set(key, cache.read(key))
      const spec = specFor(key)
      if (spec !== undefined) this.baseUnknown.add(spec.doc)
    }
    for (const doc of DATA_DOCS) {
      const held = this.docs.get(doc)
      if (held === undefined) continue
      const specs = keysOf(doc)
      if (held.version > 0) {
        this.hydrate(doc, held.data, new Set(specs.map((s) => s.key).filter((key) => this.dirty.has(key))))
        continue
      }
      for (const { key } of specs) if (!this.dirty.has(key) && cache.read(key) !== null) this.dirty.set(key, cache.read(key))
    }
  }

  private isListed(): boolean {
    const meta = this.docs.get('meta')?.data as { imports?: Array<{ origin: string }> } | undefined
    return (meta?.imports ?? []).some((entry) => entry.origin === this.deps.origin)
  }

  private async boot(): Promise<RemoteStatus> {
    if (this.deps.demo === true) return this.setStatus('off')
    const probe = await this.pull('meta')
    if (probe !== 'ok') return this.setStatus(probe === 'off' ? 'off' : 'unavailable')
    const verdicts = await Promise.all(DATA_DOCS.map((doc) => this.pull(doc)))
    if (verdicts.includes('down')) return this.setStatus('unavailable')
    if (verdicts.includes('off')) return this.setStatus('off')
    const side = this.readSidecar()
    this.synced = side.synced
    if (!this.isListed() && !this.synced && DATA_DOCS.some((doc) => this.importable(doc) !== null)) {
      const imported = await this.runImport()
      if (imported !== 'ok') return this.setStatus(imported === 'off' ? 'off' : 'unavailable')
    }
    this.synced = true
    this.adopt(side.dirty)
    this.saveSidecar()
    this.setStatus('ready')
    // The retry budget is not renewed here: reads that work say nothing about writes. A boot inside a flush step is
    // followed by that step's own send; a flush queued from here would restart at once, kill the retry timer and loop
    // for as long as the writes keep failing, with no delay.
    if (this.dirty.size > 0 && !this.stepping) void this.flush()
    return this.state
  }

  start(): Promise<RemoteStatus> {
    if (this.state === 'ready' || this.state === 'off') return Promise.resolve(this.state)
    this.booting ??= this.boot().finally(() => {
      this.booting = null
    })
    return this.booting
  }

  private scheduleRetry(): void {
    if (this.timer !== null) return
    const delay = Math.min(RETRY_MS * 2 ** this.retries, RETRY_MAX_MS)
    this.retries += 1
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  /** Takes the sent values off the pending list (a key changed since stays: its text no longer matches). */
  private settle(snapshot: ReadonlyMap<string, string | null>): void {
    for (const [key, text] of snapshot) if (this.dirty.has(key) && this.dirty.get(key) === text) this.dirty.delete(key)
    this.saveSidecar()
  }

  private async flushDoc(doc: DataDoc, last: boolean): Promise<Put['kind']> {
    const snapshot = new Map(keysOf(doc).filter((spec) => this.dirty.has(spec.key)).map((spec) => [spec.key, this.dirty.get(spec.key) ?? null]))
    const base = this.docs.get(doc)
    if (snapshot.size === 0 || base === undefined) return 'skip'
    const mine = cleanData(doc, overlayKeys(doc, base.data, snapshot))
    if (mine === null || same(mine, base.data)) {
      this.baseUnknown.delete(doc)
      this.settle(snapshot)
      return 'skip'
    }
    // A whole-document key carried over a reload is not made from the store's current copy, so a plain send would delete
    // what another origin added since: merge with no base (this page's edit wins a clash, server-only entries stay).
    // Prefs are laid over the store's copy field by field, so they need no such step.
    const unknown = this.baseUnknown.has(doc) && doc !== 'prefs'
    const make = (server: unknown, retry: boolean) =>
      unknown ? mergeOnClash(doc, null, mine, server) : retry ? mergeOnClash(doc, base.data, mine, server) : mine
    const result = await this.put(doc, make, last)
    if (result.kind === 'ok' || result.kind === 'refused') this.baseUnknown.delete(doc)
    if (result.kind === 'ok') {
      this.settle(snapshot)
      if (!same(result.held.data, mine) && !last) this.hydrate(doc, result.held.data, new Set(this.dirty.keys()))
    } else if (result.kind === 'refused') {
      this.settle(snapshot)
    }
    return result.kind
  }

  private async flushAll(last: boolean): Promise<void> {
    const kinds = await Promise.all(DATA_DOCS.map((doc) => this.flushDoc(doc, last)))
    if (kinds.includes('off')) {
      this.setStatus('off')
      this.dirty.clear()
    } else if (kinds.includes('down')) {
      this.setStatus('unavailable')
      this.warnUnsaved()
    }
    // A refused change is settled (not sent again), so it is said at once; a clash is retried and says nothing.
    if (kinds.includes('refused')) this.notify(STORE_NOTICE.refused, 'error')
    if (kinds.includes('down') || kinds.includes('clash')) this.scheduleRetry()
    else this.retries = 0
  }

  /**
   * The page's last-moment send. A store that is not ready ('unavailable' after a failed send, 'idle' before the first
   * read ended) is started first, so a change that could still be taken is not lost to the retry backoff; a start
   * that fails sends nothing and leaves the retry timer to go on.
   */
  private async sendLast(): Promise<void> {
    if (this.state !== 'ready') {
      this.stepping = true // the boot must not queue a flush of its own: this send follows it
      try {
        if ((await this.start()) !== 'ready') return
      } finally {
        this.stepping = false
      }
    }
    if (this.dirty.size === 0) return
    this.clearTimer()
    await this.flushAll(true)
  }

  async flush(last = false): Promise<void> {
    if (last) {
      // No store, or nothing to send. The retry timer stays untouched when nothing could be sent: a hidden page must not cancel it.
      if (this.state === 'off' || this.dirty.size === 0) return
      this.lastRun ??= this.sendLast().finally(() => {
        this.lastRun = null
      })
      await this.lastRun
      return
    }
    this.clearTimer()
    if (this.state === 'off' || this.dirty.size === 0) return
    this.flushing = this.flushing
      .then(async () => {
        this.stepping = true
        if (this.state !== 'ready' && (await this.start()) !== 'ready') {
          if (this.state === 'unavailable') this.warnUnsaved()
          return this.scheduleRetry()
        }
        if (this.dirty.size > 0) await this.flushAll(false)
        this.announceRestored()
      })
      .catch(() => this.scheduleRetry())
      .finally(() => {
        this.stepping = false
      })
    await this.flushing
  }

  /** Bound: it is handed to the shared storage as the write observer. */
  note = (key: string, value: string | null): void => {
    if (this.state === 'off' || specFor(key) === undefined) return
    this.dirty.set(key, value)
    this.saveSidecar()
    this.retries = 0
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, DEBOUNCE_MS)
  }
}

export function createRemoteStore(deps: RemoteDeps): RemoteStore {
  return new RemoteEngine(deps)
}

interface PageEventTarget {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** Sends the pending changes at once on `pagehide` and when the page becomes hidden; returns the way to detach. */
export function attachPageEvents(store: RemoteStore, win: PageEventTarget, doc: PageEventTarget & { visibilityState?: string }): () => void {
  const onHide = () => void store.flush(true)
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') void store.flush(true)
  }
  win.addEventListener('pagehide', onHide)
  doc.addEventListener('visibilitychange', onVisibility)
  return () => {
    win.removeEventListener('pagehide', onHide)
    doc.removeEventListener('visibilitychange', onVisibility)
  }
}

/** The name of the one function the page defines for the shell to call (never the other way round). */
export const SHELL_SYNC_HOOK = '__NQT_STORE_SYNC__'

/**
 * Defines the shell's flush hook on `target` (the window): a read-only, hidden function that sends what is pending at once
 * (the page's last-moment send, which a second call joins; defined once, a second definition is ignored) and answers a JSON text, `{"status":...,"pending":n}`. The
 * shell runs it in the page before it stops the backend and asks again until nothing is pending (03 section 2.3). It is a
 * call from the shell into the page: the page itself calls no shell command (scripts/noShellIpc.test.ts).
 */
export function attachShellSync(store: RemoteStore, target: object): void {
  if (Object.getOwnPropertyDescriptor(target, SHELL_SYNC_HOOK) !== undefined) return // defined once: the first store keeps it
  Object.defineProperty(target, SHELL_SYNC_HOOK, {
    value: (): string => {
      void store.flush(true)
      return JSON.stringify({ status: store.status(), pending: store.pending() })
    },
    writable: false,
    configurable: false,
    enumerable: false,
  })
}

/**
 * The store changed the stored theme, colour scheme, tape switch, link groups or record watch checkpoint under the page (its first read, a merge): apply it. Kept here, not
 * in those modules, which are part of the first-paint shell; this one loads on its own. The theme and the scheme are
 * also applied once before the first render (main.tsx), from whatever the cache holds by then.
 */
export function applyLookOnStoredChange(win: Pick<Window, 'addEventListener'>): void {
  win.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === null || e.key === LOOK_KEY) applyStoredLook()
    if (e.key === null || e.key === SCHEME_KEY) applyScheme(loadScheme())
    if (e.key === null || e.key === TAPE_KEY) refreshTape()
    if (e.key === null || e.key === LINK_GROUPS_KEY) useLinkGroups.setState({ contexts: loadContexts(safeLocalStorage) })
    if (e.key === null || e.key === WATCH_KEY) {
      useRecordWatchStore.setState({ checkpoint: readJson(safeLocalStorage, WATCH_KEY, isWatchSnapshot) })
    }
  })
}

let shared: RemoteStore | null = null

/**
 * Starts the app-wide workspace store (once): installs the write observer on the shared storage and the page-hide
 * flush, then reads the store. With `waitMs`, answers after that long even if the store has not (the first paint is not
 * held up for ever; the page picks the keys up as they arrive). Safe to call where there is no backend: it falls back to
 * localStorage alone, and the demo build never asks.
 */
export function startRemoteStore(options: { readonly waitMs?: number } = {}): Promise<RemoteStatus> {
  if (shared === null) {
    const demo = document.documentElement.dataset['demo'] === 'on'
    shared = createRemoteStore({ transport: createFetchTransport(), cache: createSafeStorage(), origin: window.location.origin, demo })
    if (!demo) {
      setWriteObserver(shared.note)
      applyLookOnStoredChange(window)
      attachPageEvents(shared, window, document)
      attachShellSync(shared, window)
    }
  }
  const store = shared
  const started = store.start()
  if (options.waitMs === undefined) return started
  return Promise.race([started, new Promise<RemoteStatus>((resolve) => setTimeout(() => resolve(store.status()), options.waitMs))])
}

/** The app-wide store's state ('idle' before it starts). */
export function remoteStatus(): RemoteStatus {
  return shared?.status() ?? 'idle'
}
