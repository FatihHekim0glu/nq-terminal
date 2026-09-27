// 98) Export (look spec 4.4 house numbering; TASKS Phase 8 notes): what a screen shows, as a CSV file in
// the viewer's downloads folder. Built in the page from data the screen already holds: no request
// leaves it and nothing is written anywhere else (saveText uses a local object URL). Cells are RFC 4180
// fields; numbers keep the precision the API sent; a text a spreadsheet would run as a formula is
// prefixed with an apostrophe, while a signed figure such as `+1.23` or `-0.52%` stays as shown.
import { EXPORT, fillCopy } from '../copy/workspace'
import { saveText } from './download'
import { postMessage } from './MessageLine.store'

export type CsvValue = string | number | boolean | null | undefined

/** `=`, `@`, tab or CR anywhere at the start; `+` or `-` unless a number follows. */
const FORMULA_START = /^(?:[=@\t\r]|[+-](?![\d.]))/
const NEEDS_QUOTES = /[",\r\n]/

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return String(value)
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** A header line and one line per row, CRLF line ends. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** `<part>_<part>.csv` with anything but letters, digits, dots, dashes and underscores made `_`. */
export function csvFileName(...parts: readonly string[]): string {
  const stem = parts.map((p) => p.trim()).filter(Boolean).join('_').replace(/[^A-Za-z0-9._-]+/g, '_')
  return `${stem || 'export'}.csv`
}

/**
 * Saves `csv` (a header plus `rows` lines) and says so on the message line. Returns false, with the
 * reason on the message line, when there is nothing to save or the browser cannot save a file.
 */
export function exportCsv(fileName: string, csv: string, rows: number): boolean {
  if (rows <= 0) {
    postMessage(EXPORT.empty)
    return false
  }
  const saved = saveText(fileName, csv)
  if (!saved) {
    postMessage(EXPORT.unavailable, 'error')
    return false
  }
  postMessage(fillCopy(rows === 1 ? EXPORT.doneOne : EXPORT.done, { n: rows, file: fileName }))
  return true
}
