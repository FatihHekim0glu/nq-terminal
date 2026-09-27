// The pure parts of MonitorGrid, kept out of the component so they are tested on their own:
// - row numbering for Number <GO> (look spec 4.8 and 7.7): 1) to N) for a plain grid; for a grid in
//   sections, `1) Equity` on the section row and 10) 11) ... on its rows, as the futures monitor
//   numbers them, falling back to 1) to N) when the sections do not fit that scheme;
// - keyboard movement over the grid (WAI-ARIA APG grid pattern);
// - the sort comparator and the spacer heights of the virtual window.

/** The active row index of the header row. */
export const HEADER_ROW = -1

export type DisplayRow<Row> =
  | { readonly kind: 'group'; readonly key: string; readonly label: string; readonly n: number | null }
  | { readonly kind: 'data'; readonly key: string; readonly row: Row; readonly n: number | null }

export interface DisplayOptions<Row> {
  readonly rowId: (row: Row) => string
  readonly numbered: boolean
  /** Section of a row; rows of one section are shown together under a section row. */
  readonly groupOf?: (row: Row) => string
  /** Section order; sections not listed follow in first-seen order. */
  readonly groupOrder?: readonly string[]
}

// The section scheme: section k is `k)`, its rows k*10 to k*10+9, so at most nine sections of ten.
const MAX_SECTIONS = 9
const SECTION_SPAN = 10

function sections<Row>(rows: readonly Row[], groupOf: (row: Row) => string, order: readonly string[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>(order.map((g) => [g, [] as Row[]]))
  for (const row of rows) {
    const g = groupOf(row)
    const list = out.get(g)
    if (list) list.push(row)
    else out.set(g, [row])
  }
  return new Map([...out].filter(([, list]) => list.length > 0))
}

/** The rows as displayed: section rows and data rows, each with its Number <GO> number or null. */
export function buildDisplayRows<Row>(rows: readonly Row[], opts: DisplayOptions<Row>): DisplayRow<Row>[] {
  const { rowId, numbered, groupOf } = opts
  if (!groupOf) return rows.map((row, i) => ({ kind: 'data', key: `r:${rowId(row)}`, row, n: numbered ? i + 1 : null }))
  const bySection = sections(rows, groupOf, opts.groupOrder ?? [])
  const lists = [...bySection.values()]
  const sectionScheme = numbered && lists.length <= MAX_SECTIONS && lists.every((l) => l.length <= SECTION_SPAN)
  const out: DisplayRow<Row>[] = []
  let serial = 0
  let k = 0
  for (const [label, list] of bySection) {
    k += 1
    out.push({ kind: 'group', key: `g:${label}`, label, n: sectionScheme ? k : null })
    list.forEach((row, i) => {
      serial += 1
      const n = !numbered ? null : sectionScheme ? k * SECTION_SPAN + i : serial
      out.push({ kind: 'data', key: `r:${rowId(row)}`, row, n })
    })
  }
  return out
}

export interface GridPos {
  /** Display row index, or HEADER_ROW. */
  readonly row: number
  readonly col: number
}

export interface GridKey {
  readonly key: string
  readonly ctrl?: boolean
}

export interface GridDims {
  readonly rows: number
  readonly cols: number
  /** Rows per page for PageUp and PageDown. */
  readonly page: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * The next active cell for a key, or null when the grid leaves the key alone (Left and Right at the
 * edges go to the panel's roving focus; Tab leaves the grid).
 */
export function moveActive(pos: GridPos, key: GridKey, dims: GridDims): GridPos | null {
  const lastRow = dims.rows - 1
  const lastCol = Math.max(dims.cols - 1, 0)
  const firstRow = dims.rows > 0 ? 0 : HEADER_ROW
  const endRow = dims.rows > 0 ? lastRow : HEADER_ROW
  switch (key.key) {
    case 'ArrowDown':
      return { row: dims.rows > 0 ? Math.min(pos.row + 1, lastRow) : HEADER_ROW, col: pos.col }
    case 'ArrowUp':
      return { row: Math.max(pos.row - 1, HEADER_ROW), col: pos.col }
    case 'ArrowRight':
      return pos.col >= lastCol ? null : { row: pos.row, col: pos.col + 1 }
    case 'ArrowLeft':
      return pos.col <= 0 ? null : { row: pos.row, col: pos.col - 1 }
    case 'PageDown':
      return { row: dims.rows > 0 ? clamp(pos.row + dims.page, 0, lastRow) : HEADER_ROW, col: pos.col }
    case 'PageUp':
      return { row: dims.rows > 0 ? clamp(pos.row - dims.page, 0, lastRow) : HEADER_ROW, col: pos.col }
    case 'Home':
      return { row: key.ctrl ? firstRow : pos.row, col: 0 }
    case 'End':
      return { row: key.ctrl ? endRow : pos.row, col: lastCol }
    default:
      return null
  }
}

export type SortValue = string | number | null | undefined

const collator = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true })

/** Ascending order for sort values: numbers first (numerically), then text (UK collation). */
export function compareValues(a: SortValue, b: SortValue): number {
  const an = typeof a === 'number'
  const bn = typeof b === 'number'
  if (an && bn) return a - b
  if (an !== bn) return an ? -1 : 1
  return collator.compare(String(a ?? ''), String(b ?? ''))
}

export interface VirtualSpan {
  readonly start: number
  readonly end: number
}

/** Heights of the spacer rows above and below the rendered window (relative to the body top). */
export function spacerHeights(items: readonly VirtualSpan[], total: number, bodyStart = 0): { top: number; bottom: number } {
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return { top: 0, bottom: 0 }
  return { top: Math.max(first.start - bodyStart, 0), bottom: Math.max(total - last.end, 0) }
}

/** Width of the `N)` column in em: the look spec's 2.2em, wider once numbers reach five digits. */
export function numberWidthEm(maxNumber: number): number {
  const digits = String(Math.max(Math.trunc(maxNumber), 1)).length
  return digits <= 3 ? 2.2 : 2.2 + (digits - 3) * 0.6
}

/**
 * Glyph widths in ch (the width of 0) for the grid's sans face at data size, measured in Chromium and
 * rounded up: digits are tabular (1ch), punctuation and spaces about half, % and wide capitals more.
 */
const NARROW = new Set(['.', ',', ':', ';', ' ', '(', ')', '[', ']', '|', "'"])
const WIDE = new Set(['%', 'M', 'W', 'm', 'w', '@'])

/** An upper estimate of a text's width in ch, for a column floor (no layout needed). */
export function textWidthCh(text: string): number {
  let w = 0
  for (const ch of text) w += NARROW.has(ch) ? 0.5 : WIDE.has(ch) ? 1.7 : /[A-Z]/.test(ch) ? 1.15 : 1
  return Math.round(w * 100) / 100
}

/** Horizontal padding of a grid cell (grid.css: 5px each side). */
const CELL_PAD_PX = 10
/** Slack for rounding and sub-pixel layout, in ch. */
const SLACK_CH = 0.5

/**
 * A column's CSS width: its declared px, but never narrower than its header, and for a numeric column
 * never narrower than its widest value, so a number is never cut to an ellipsis (look spec 4.8 and 3
 * allow truncation for long names only).
 */
export function columnWidth(px: number, kind: 'name' | 'num' | 'text', header: string, texts: Iterable<string>): string {
  let ch = textWidthCh(header)
  if (kind === 'num') for (const t of texts) ch = Math.max(ch, textWidthCh(t))
  return `max(${px}px, calc(${Math.round((ch + SLACK_CH) * 100) / 100}ch + ${CELL_PAD_PX}px))`
}
