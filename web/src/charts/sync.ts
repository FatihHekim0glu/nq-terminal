// Crosshair sync by link group (UI_SPEC section 2, look spec 6.3). Panels in one link group share a
// time crosshair across both chart libraries:
//   - uPlot to uPlot: uPlot's own `cursor.sync` with the group's key (crosshairSyncKey), syncing by
//     the x scale's value, so charts with different widths and ranges agree on the time;
//   - across libraries: this bus. A uPlot chart feeds it from the same cursor.sync publication
//     (`filters.pub`, which uPlot calls only for moves that start on that chart), and a
//     lightweight-charts chart from `subscribeCrosshairMove`. Each chart applies moves that came from
//     the other library: uPlot through `setCursor` without re-publishing, lightweight-charts through
//     `setCrosshairPosition` / `clearCrosshairPosition` (which fire no crosshairMove, so nothing echoes).
// Times are epoch seconds (the API's `t`, uPlot's x values and lightweight-charts' UTCTimestamp).
// The bus is plain JavaScript on purpose: moves arrive at pointer rate and must not re-render React.
// Unlinked panels ('-') neither publish nor listen. No chart library code is imported here (the one
// library import is type-only and erased).
import type { UTCTimestamp } from 'lightweight-charts'
import type { LinkGroup, PanelLink } from '../state/linkGroups'

export type CrosshairLibrary = 'uplot' | 'lwc'

export interface CrosshairMove {
  /** The chart that moved; a chart never receives its own moves. */
  readonly sourceId: string
  readonly library: CrosshairLibrary
  /** Epoch seconds, or null when the pointer left the chart. */
  readonly time: number | null
}

export type CrosshairListener = (move: CrosshairMove) => void

export interface CrosshairBus {
  publish(group: LinkGroup, move: CrosshairMove): void
  /** Listen to a group's moves from every chart except `listenerId`; returns the unsubscribe. */
  subscribe(group: LinkGroup, listenerId: string, listener: CrosshairListener): () => void
  /** The group's latest move, for a chart that mounts while another is hovered. */
  last(group: LinkGroup): CrosshairMove | null
}

interface Subscription {
  readonly id: string
  readonly listener: CrosshairListener
}

/** Where a throwing listener's error goes: the browser's reportError (window.onerror), else the console. */
export type CrosshairErrorReporter = (err: unknown) => void

function defaultReporter(err: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(err)
  else console.error(err)
}

export function createCrosshairBus(onError: CrosshairErrorReporter = defaultReporter): CrosshairBus {
  const subs = new Map<LinkGroup, ReadonlyArray<Subscription>>()
  const latest = new Map<LinkGroup, CrosshairMove>()
  return {
    publish(group, move) {
      const prev = latest.get(group)
      if (prev && prev.sourceId === move.sourceId && prev.time === move.time) return
      latest.set(group, move)
      for (const sub of subs.get(group) ?? []) {
        if (sub.id === move.sourceId) continue
        // One broken chart must not stop the others following the crosshair.
        try {
          sub.listener(move)
        } catch (err: unknown) {
          onError(err)
        }
      }
    },
    subscribe(group, listenerId, listener) {
      const entry: Subscription = { id: listenerId, listener }
      subs.set(group, [...(subs.get(group) ?? []), entry])
      return () => {
        subs.set(group, (subs.get(group) ?? []).filter((s) => s !== entry))
      }
    },
    last(group) {
      return latest.get(group) ?? null
    },
  }
}

/** The one bus the app uses; tests pass their own. */
export const crosshairBus: CrosshairBus = createCrosshairBus()

const SYNC_KEY_PREFIX = 'nqt-link-'

/** uPlot's `cursor.sync.key` for a link group, or null for an unlinked panel. */
export function crosshairSyncKey(link: PanelLink): string | null {
  return link === '-' ? null : `${SYNC_KEY_PREFIX}${link}`
}

// ---------------------------------------------------------------------------------------------
// uPlot adapter

/** The parts of a uPlot instance the adapter uses (a real uPlot satisfies it). */
export interface UplotSyncPlot {
  readonly data: ReadonlyArray<ArrayLike<number | null | undefined>>
  readonly over: { readonly clientHeight: number }
  valToPos(value: number, scaleKey: string): number
  /** uPlot's setCursor(opts, fireHooks, publishToSync); the third argument exists at run time. */
  setCursor(opts: { left: number; top: number }, fire?: boolean, pub?: boolean): void
}

export type UplotSyncFilter = (
  type: string,
  src: UplotSyncPlot,
  x: number,
  y: number,
  w: number,
  h: number,
  idx: number | null,
) => boolean

export interface UplotCursorSync {
  readonly key: string
  /** Sync by the x scale's value, not by position. */
  readonly scales: ['x', null]
  readonly filters: { readonly pub: UplotSyncFilter; readonly sub: UplotSyncFilter }
}

export interface UplotSyncPlugin {
  readonly hooks: {
    readonly init?: (u: UplotSyncPlot) => void
    readonly destroy?: (u: UplotSyncPlot) => void
  }
}

export interface UplotCrosshairSync {
  /** Put this in `cursor.sync` (undefined for an unlinked panel). */
  readonly cursorSync: UplotCursorSync | undefined
  /** Add this to `plugins`; it applies moves from lightweight-charts panels of the group. */
  readonly plugin: UplotSyncPlugin
}

/** uPlot hides its cursor for a negative position. */
const HIDDEN = -10
const PUBLISHED_TYPES = new Set(['mousemove', 'mouseleave'])

function xAt(u: UplotSyncPlot, idx: number | null): number | null {
  if (idx == null) return null
  const v = u.data[0]?.[idx]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Link-group sync for one uPlot chart. `sourceId` must be unique per chart instance. For a
 * keyboard crosshair call `u.setCursor({ left, top }, true, true)`: the third argument publishes
 * the move to uPlot's sync, which reaches the other uPlot charts and this bus.
 */
export function uplotCrosshairSync(link: PanelLink, sourceId: string, bus: CrosshairBus = crosshairBus): UplotCrosshairSync {
  const key = crosshairSyncKey(link)
  if (key === null || link === '-') return { cursorSync: undefined, plugin: { hooks: {} } }
  const group: LinkGroup = link
  const pub: UplotSyncFilter = (type, src, _x, _y, _w, _h, idx) => {
    if (PUBLISHED_TYPES.has(type)) {
      const time = type === 'mouseleave' ? null : xAt(src, idx)
      bus.publish(group, { sourceId, library: 'uplot', time })
    }
    return true
  }
  let unsubscribe: (() => void) | null = null
  const init = (u: UplotSyncPlot) => {
    unsubscribe?.()
    unsubscribe = bus.subscribe(group, sourceId, (move) => {
      // uPlot charts of the group already follow each other through the native sync.
      if (move.library === 'uplot') return
      const left = move.time === null ? HIDDEN : u.valToPos(move.time, 'x')
      const top = move.time === null ? HIDDEN : u.over.clientHeight / 2
      u.setCursor({ left, top }, true, false)
    })
  }
  const destroy = () => {
    unsubscribe?.()
    unsubscribe = null
  }
  return {
    cursorSync: { key, scales: ['x', null], filters: { pub, sub: () => true } },
    plugin: { hooks: { init, destroy } },
  }
}

// ---------------------------------------------------------------------------------------------
// lightweight-charts adapter

/** The parts of a lightweight-charts IChartApi the adapter uses (a real chart satisfies it). */
export interface LwcSyncChart<S = unknown> {
  subscribeCrosshairMove(handler: (param: { readonly time?: unknown }) => void): void
  unsubscribeCrosshairMove(handler: (param: { readonly time?: unknown }) => void): void
  setCrosshairPosition(price: number, time: UTCTimestamp, series: S): void
  clearCrosshairPosition(): void
}

export interface LwcCrosshairSyncOptions<S> {
  readonly chart: LwcSyncChart<S>
  /** The series the crosshair snaps to (the candles). */
  readonly series: S
  readonly link: PanelLink
  readonly sourceId: string
  /** The price to put the horizontal line at for a time (the bar's close), or null for no bar. */
  readonly priceAt: (time: number) => number | null
  readonly bus?: CrosshairBus
}

export interface LwcCrosshairSync {
  /** Publish a move made without the pointer (the keyboard crosshair). */
  publish(time: number | null): void
  dispose(): void
}

export function lwcCrosshairSync<S>(opts: LwcCrosshairSyncOptions<S>): LwcCrosshairSync {
  const { chart, series, link, sourceId, priceAt, bus = crosshairBus } = opts
  if (link === '-') return { publish: () => undefined, dispose: () => undefined }
  const group: LinkGroup = link
  const publish = (time: number | null) => bus.publish(group, { sourceId, library: 'lwc', time })
  const onMove = (param: { readonly time?: unknown }) => {
    publish(typeof param.time === 'number' && Number.isFinite(param.time) ? param.time : null)
  }
  chart.subscribeCrosshairMove(onMove)
  const unsubscribe = bus.subscribe(group, sourceId, (move) => {
    const price = move.time === null ? null : priceAt(move.time)
    if (move.time === null || price === null) chart.clearCrosshairPosition()
    else chart.setCrosshairPosition(price, move.time as UTCTimestamp, series)
  })
  return {
    publish,
    dispose: () => {
      chart.unsubscribeCrosshairMove(onMove)
      unsubscribe()
    },
  }
}
