// SEAL (TASKS 9.4; ARCHITECTURE section 3.3; UI_SPEC section 6 "Spent window"): the sealed-window files
// of a hypothesis, as GET /api/sealed and /api/sealed/{name} serve them (CSV columns through the
// allowlist, JSON without price-like keys, markdown as text). A confirmation's name shows its parent's
// files. Every view is spent and says so with the API's own label. Pure.
import type { Schemas } from '../../api/types'
import { toCsv, type CsvValue } from '../../chrome/exportCsv'

export type SealedItem = Schemas['SealedItem']
export type SealedView = Schemas['SealedView']
export type Confirmation = Schemas['Confirmation']
export type HypothesisCard = Schemas['HypothesisCard']

/** Rows drawn at once in the file view; the export saves every row. */
export const SHOWN_ROWS = 500

export interface SealTarget {
  /** The registry hypothesis whose files are shown. */
  readonly hypothesis: string
  /** The confirmation the panel was given, when it was one. */
  readonly confirmation: string | null
}

/** A confirmation name points at its parent hypothesis; anything else is a hypothesis itself. */
export function sealTarget(name: string, confirmations: readonly Confirmation[] | undefined): SealTarget {
  const conf = confirmations?.find((c) => c.name === name)
  return conf?.parent ? { hypothesis: conf.parent, confirmation: conf.name } : { hypothesis: name, confirmation: null }
}

export interface SealedFileRow {
  readonly n: number
  readonly name: string
  readonly kind: string | null
  readonly label: string | null
  /** False when the card names a file the API does not serve (it is listed, never requested). */
  readonly served: boolean
}

export function sealedFiles(card: HypothesisCard, index: readonly SealedItem[] | undefined): SealedFileRow[] {
  return card.sealed.map((name, i) => {
    const item = index?.find((s) => s.name === name)
    return { n: i + 1, name, kind: item?.kind ?? null, label: item?.label ?? null, served: item !== undefined }
  })
}

export type CsvCell = string | number | boolean | null

/** A CSV view's rows in column order, from its column arrays (`values`), as many as `limit`. */
export function csvRows(view: SealedView, limit = Number.POSITIVE_INFINITY): CsvCell[][] {
  const columns = view.columns ?? []
  const values = view.values ?? {}
  const n = Math.min(view.n_rows ?? Math.max(0, ...columns.map((c) => values[c]?.length ?? 0)), limit)
  return Array.from({ length: n }, (_, i) => columns.map((c) => cell(values[c]?.[i])))
}

function cell(value: unknown): CsvCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  return JSON.stringify(value)
}

/** A cell as the table prints it: numbers exactly as served, missing as `--`. */
export function cellText(value: CsvCell): string {
  if (value === null) return '--'
  return String(value)
}

/** The file as the export saves it: a CSV view as CSV, JSON as indented JSON, markdown as served. */
export function sealedExport(view: SealedView): { readonly text: string; readonly type: 'csv' | 'json' | 'md'; readonly rows: number } {
  if (view.kind === 'csv') {
    const rows = csvRows(view)
    return { text: toCsv(view.columns ?? [], rows as CsvValue[][]), type: 'csv', rows: rows.length }
  }
  if (view.kind === 'markdown') return { text: view.markdown ?? '', type: 'md', rows: 1 }
  return { text: JSON.stringify(view.data ?? null, null, 2), type: 'json', rows: 1 }
}
