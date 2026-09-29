// The book composition view of a run (roadmap #13, ANALYTICS_CATALOG EX1 by instrument): the exposure
// endpoint's per-instrument series, grouped by sector, at the sessions the screen can draw. Pure
// functions. Every value is the API's, taken at a chosen index exactly as served: sessions are SELECTED
// (every one, the last of each ISO week, or the last of each month), never averaged, summed or signed.
// by_instrument is |notional| / equity per instrument (unsigned); the API's net line carries the book's
// direction. A micro contract (MNQ) is placed with its parent root (NQ) for grouping and display only:
// its values stay its own and are never added to the parent's.
import type { Schemas } from '../../api/types'
import { toneOfSector, type CompositionInput, type CompositionInputRow, type CompositionMode } from '../../charts/echarts/compositionModel'
import { COMPOSITION } from '../../copy/composition'
import { fillCopy } from '../../copy/workspace'
import { SECTOR_SEQUENCE, sectorTitle } from '../mon/model'

export type ExposureView = Schemas['ExposureView']

/** The most session columns one figure draws. */
export const MAX_COMPOSITION_COLUMNS = 260
/** Exposures per instrument are small fractions of equity, so three decimals keep a small holding visible. */
export const COMPOSITION_DECIMALS = 3
/** The sector of an instrument the index does not name. */
export const OTHER_SECTOR = 'other'

export type Sampling = 'every' | 'week' | 'month'

export interface SampledIndexes {
  readonly idx: number[]
  readonly sampling: Sampling
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000
const DAYS_PER_WEEK = 7
const THURSDAY = 4
const MONTH_KEY_LENGTH = 7

/** The UTC milliseconds of a real YYYY-MM-DD date, or null. */
function utcMs(date: string): number | null {
  const m = DATE.exec(date)
  if (m === null) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(year, month - 1, day)
  const back = new Date(ms)
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? ms : null
}

/**
 * `YYYY-Www` in ISO 8601 (weeks run Monday to Sunday; week 1 holds the year's first Thursday), in UTC.
 * A text that is not a real date comes back unchanged, so a bad row can never break a chart.
 */
export function isoWeekKey(date: string): string {
  const ms = utcMs(date)
  if (ms === null) return date
  const weekday = new Date(ms).getUTCDay() || DAYS_PER_WEEK
  const thursday = ms + (THURSDAY - weekday) * DAY_MS
  const year = new Date(thursday).getUTCFullYear()
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / DAYS_PER_WEEK) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

const monthKey = (date: string) => date.slice(0, MONTH_KEY_LENGTH)

/** The last index of each key, in ascending order. */
function lastPerKey(dates: readonly string[], keyOf: (date: string) => string): number[] {
  const last = new Map<string, number>()
  dates.forEach((date, i) => last.set(keyOf(date), i))
  return [...last.values()].sort((a, b) => a - b)
}

/**
 * Which sessions to draw when there may be too many columns: all of them when they fit, else the last
 * session of each ISO week when the weeks fit, else the last of each month. A selection only (indexes),
 * and it always ends on the last index. Beyond `maxColumns` months the months are all kept.
 */
export function sampleIndexes(dates: readonly string[], maxColumns: number): SampledIndexes {
  const cap = Number.isFinite(maxColumns) ? Math.max(1, Math.floor(maxColumns)) : MAX_COMPOSITION_COLUMNS
  if (dates.length <= cap) return { idx: dates.map((_, i) => i), sampling: 'every' }
  const weekly = lastPerKey(dates, isoWeekKey)
  if (weekly.length <= cap) return { idx: weekly, sampling: 'week' }
  return { idx: lastPerKey(dates, monthKey), sampling: 'month' }
}

/** `ES.XCME` is the instrument `ES` on the venue `XCME`; `MNQ.XCME` gives `MNQ`. */
export function rootOfInstrument(key: string): string {
  const dot = key.indexOf('.')
  return dot < 0 ? key : key.slice(0, dot)
}

/** The instrument list of GET /api/commands, as far as this file reads it. */
export interface RootIndex {
  readonly instruments?: ReadonlyArray<{ readonly root: string; readonly sector: string }>
}

interface RootTable {
  readonly sectors: ReadonlyMap<string, string>
  readonly slots: ReadonlyMap<string, number>
}

function rootTable(index: RootIndex | null | undefined): RootTable {
  const sectors = new Map<string, string>()
  const slots = new Map<string, number>()
  index?.instruments?.forEach((instrument, slot) => {
    if (instrument.sector === '' || sectors.has(instrument.root)) return
    sectors.set(instrument.root, instrument.sector)
    slots.set(instrument.root, slot)
  })
  return { sectors, slots }
}

/** The indexed root a root stands for: itself, or for a micro (M plus an indexed root) its parent. */
function indexedRoot(root: string, table: RootTable): string | null {
  if (table.sectors.has(root)) return root
  const parent = root.slice(1)
  return root.length > 1 && root.startsWith('M') && table.sectors.has(parent) ? parent : null
}

function sectorIn(root: string, table: RootTable): string {
  const stands = indexedRoot(root, table)
  return stands === null ? OTHER_SECTOR : (table.sectors.get(stands) ?? OTHER_SECTOR)
}

/** Position in the index; a micro sits half a place after its parent; an unindexed root has none. */
function slotIn(root: string, table: RootTable): number | null {
  const stands = indexedRoot(root, table)
  if (stands === null) return null
  return (table.slots.get(stands) ?? 0) + (stands === root ? 0 : 0.5)
}

/** The sector of a root from the index; a micro takes its parent's; anything else is `other`. */
export function sectorOfRoot(root: string, index: RootIndex | null | undefined): string {
  return sectorIn(root, rootTable(index))
}

export interface CompositionViewBand {
  readonly kind: 'band'
  readonly sector: string
  readonly title: string
}

export interface CompositionInstrumentRow {
  readonly kind: 'instrument'
  readonly key: string
  readonly root: string
  readonly sector: string
  /** The served values at the shown sessions; null where the API sent none. */
  readonly values: Array<number | null>
}

export type CompositionViewRow = CompositionViewBand | CompositionInstrumentRow

export interface CompositionView {
  /** The shown sessions (YYYY-MM-DD). */
  readonly columns: string[]
  readonly sampling: Sampling
  readonly rows: CompositionViewRow[]
  /** The API's gross and net at the shown sessions. */
  readonly gross: Array<number | null>
  readonly net: Array<number | null>
  readonly instruments: number
  readonly sectors: number
  readonly unit: string
  readonly label: string
  readonly priceBasis: string
}

/** House sectors in their sequence, then any other sector the index names, then `other`. */
function sectorGroup(sector: string): number {
  if (sector === OTHER_SECTOR) return SECTOR_SEQUENCE.length + 1
  const i = (SECTOR_SEQUENCE as readonly string[]).indexOf(sector)
  return i < 0 ? SECTOR_SEQUENCE.length : i
}

const compare = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

interface Entry {
  readonly key: string
  readonly root: string
  readonly sector: string
  readonly slot: number | null
}

function compareEntries(a: Entry, b: Entry): number {
  const slot = a.slot === null ? (b.slot === null ? 0 : 1) : b.slot === null ? -1 : compare(a.slot, b.slot)
  return compare(sectorGroup(a.sector), sectorGroup(b.sector)) || compare(a.sector, b.sector) || slot || compare(a.key, b.key)
}

function sectorTitleOf(sector: string): string {
  return sector === OTHER_SECTOR ? COMPOSITION.other : sectorTitle(sector)
}

/**
 * The exposure grouped for drawing: a band row per sector (house sequence, then other index sectors,
 * then `other`) and, under it, an instrument row per key in the index's order (a micro just after its
 * parent), then by key. Values are read at the sampled indexes exactly as served. Null when the API
 * sends no instrument or no session.
 */
export function compositionView(
  e: ExposureView | null | undefined,
  index: RootIndex | null | undefined,
  maxColumns: number = MAX_COMPOSITION_COLUMNS,
): CompositionView | null {
  if (!e) return null
  const keys = Object.keys(e.by_instrument)
  if (keys.length === 0 || e.date.length === 0) return null
  const { idx, sampling } = sampleIndexes(e.date, maxColumns)
  const pick = (served: ReadonlyArray<number | null> | undefined): Array<number | null> => idx.map((i) => served?.[i] ?? null)
  const table = rootTable(index)
  const entries: Entry[] = keys.map((key) => {
    const root = rootOfInstrument(key)
    return { key, root, sector: sectorIn(root, table), slot: slotIn(root, table) }
  })
  entries.sort(compareEntries)
  const rows: CompositionViewRow[] = []
  let band = ''
  for (const entry of entries) {
    if (rows.length === 0 || entry.sector !== band) {
      band = entry.sector
      rows.push({ kind: 'band', sector: band, title: sectorTitleOf(band) })
    }
    rows.push({ kind: 'instrument', key: entry.key, root: entry.root, sector: entry.sector, values: pick(e.by_instrument[entry.key]) })
  }
  return {
    columns: idx.map((i) => e.date[i]!),
    sampling,
    rows,
    gross: pick(e.gross),
    net: pick(e.net),
    instruments: entries.length,
    sectors: rows.length - entries.length,
    unit: e.unit,
    label: e.label,
    priceBasis: e.price_basis,
  }
}

/** The chart input: sector titles and tones on the rows, the sampling sentence as the note. */
export function compositionInput(view: CompositionView, run: string, mode: CompositionMode): CompositionInput {
  const titles = new Map<string, string>()
  const perRoot = new Map<string, number>()
  for (const row of view.rows) {
    if (row.kind === 'band') titles.set(row.sector, row.title)
    else perRoot.set(row.root, (perRoot.get(row.root) ?? 0) + 1)
  }
  const rows: CompositionInputRow[] = view.rows.map((row) =>
    row.kind === 'band'
      ? { kind: 'band', label: row.title, tone: toneOfSector(row.sector) }
      : {
          kind: 'instrument',
          // two keys on one root (two venues) would share a label, so they are told apart by key
          label: (perRoot.get(row.root) ?? 0) > 1 ? row.key : row.root,
          sector: titles.get(row.sector) ?? sectorTitleOf(row.sector),
          tone: toneOfSector(row.sector),
          values: row.values,
        },
  )
  return {
    name: fillCopy(mode === 'heat' ? COMPOSITION.heatName : COMPOSITION.stackName, { run }),
    unit: view.unit,
    decimals: COMPOSITION_DECIMALS,
    columns: view.columns,
    rows,
    gross: view.gross,
    net: view.net,
    note: COMPOSITION.sampling[view.sampling],
  }
}
