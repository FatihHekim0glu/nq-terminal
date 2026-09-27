// The pure parts of MonitorGrid: row numbering (plain and by section, look spec 4.8 and 7.7),
// keyboard movement over the grid (APG grid pattern), sorting order and the virtual window.
import { describe, expect, it } from 'vitest'
import {
  HEADER_ROW,
  buildDisplayRows,
  columnWidth,
  compareValues,
  textWidthCh,
  moveActive,
  numberWidthEm,
  spacerHeights,
  type DisplayRow,
} from './MonitorGrid.model'

interface Sym {
  readonly sym: string
  readonly sector: string
}

const id = (r: Sym) => r.sym
const sector = (r: Sym) => r.sector

function labels<Row>(rows: readonly DisplayRow<Row>[], name: (r: Row) => string): string[] {
  return rows.map((d) => (d.kind === 'group' ? `${d.n ?? '-'}) ${d.label}` : `${d.n ?? '-'} ${name(d.row)}`))
}

describe('buildDisplayRows', () => {
  const rows: Sym[] = [
    { sym: 'NQ', sector: 'Equity' },
    { sym: 'ES', sector: 'Equity' },
    { sym: 'ZN', sector: 'Rates' },
    { sym: 'YM', sector: 'Equity' },
  ]

  it('numbers plain rows 1 to N in display order', () => {
    const out = buildDisplayRows(rows, { rowId: id, numbered: true })
    expect(labels(out, (r) => r.sym)).toEqual(['1 NQ', '2 ES', '3 ZN', '4 YM'])
    expect(out.every((d) => d.kind === 'data')).toBe(true)
  })

  it('leaves every number out when the grid is not numbered', () => {
    const out = buildDisplayRows(rows, { rowId: id, numbered: false })
    expect(out.map((d) => d.n)).toEqual([null, null, null, null])
  })

  it('groups by section in first-seen order and numbers sections 1), rows 10) 11) ... (7.7)', () => {
    const out = buildDisplayRows(rows, { rowId: id, numbered: true, groupOf: sector, groupOrder: ['Equity', 'Rates'] })
    expect(labels(out, (r) => r.sym)).toEqual(['1) Equity', '10 NQ', '11 ES', '12 YM', '2) Rates', '20 ZN'])
  })

  it('keeps the section order it is given even when a sort reorders the rows', () => {
    const sorted = [rows[2]!, rows[3]!, rows[0]!, rows[1]!]
    const out = buildDisplayRows(sorted, { rowId: id, numbered: true, groupOf: sector, groupOrder: ['Equity', 'Rates'] })
    expect(labels(out, (r) => r.sym)).toEqual(['1) Equity', '10 YM', '11 NQ', '12 ES', '2) Rates', '20 ZN'])
  })

  it('falls back to 1 to N (sections unnumbered) when a section holds more than ten rows', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ sym: `S${i}`, sector: 'Equity' }))
    const out = buildDisplayRows(many, { rowId: id, numbered: true, groupOf: sector })
    expect(out[0]).toMatchObject({ kind: 'group', n: null })
    expect(out.slice(1).map((d) => d.n)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1))
  })

  it('falls back to 1 to N when there are more than nine sections', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ sym: `S${i}`, sector: `G${i}` }))
    const out = buildDisplayRows(many, { rowId: id, numbered: true, groupOf: sector })
    expect(out.filter((d) => d.kind === 'data').map((d) => d.n)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1))
    expect(out.filter((d) => d.kind === 'group').every((d) => d.n === null)).toBe(true)
  })

  it('gives every display row a unique key, sections included', () => {
    const out = buildDisplayRows(rows, { rowId: id, numbered: true, groupOf: sector })
    expect(new Set(out.map((d) => d.key)).size).toBe(out.length)
  })
})

describe('moveActive (APG grid keys)', () => {
  const dims = { rows: 100, cols: 5, page: 10 }

  it('moves down and up one row, from the header into the body and back', () => {
    expect(moveActive({ row: 3, col: 1 }, { key: 'ArrowDown' }, dims)).toEqual({ row: 4, col: 1 })
    expect(moveActive({ row: 0, col: 1 }, { key: 'ArrowUp' }, dims)).toEqual({ row: HEADER_ROW, col: 1 })
    expect(moveActive({ row: HEADER_ROW, col: 1 }, { key: 'ArrowUp' }, dims)).toEqual({ row: HEADER_ROW, col: 1 })
    expect(moveActive({ row: 99, col: 1 }, { key: 'ArrowDown' }, dims)).toEqual({ row: 99, col: 1 })
  })

  it('moves between cells and leaves Left and Right at the edges to the panel (unhandled)', () => {
    expect(moveActive({ row: 3, col: 1 }, { key: 'ArrowRight' }, dims)).toEqual({ row: 3, col: 2 })
    expect(moveActive({ row: 3, col: 4 }, { key: 'ArrowRight' }, dims)).toBeNull()
    expect(moveActive({ row: 3, col: 0 }, { key: 'ArrowLeft' }, dims)).toBeNull()
  })

  it('pages by the visible row count and stops at the ends', () => {
    expect(moveActive({ row: 3, col: 0 }, { key: 'PageDown' }, dims)).toEqual({ row: 13, col: 0 })
    expect(moveActive({ row: 95, col: 0 }, { key: 'PageDown' }, dims)).toEqual({ row: 99, col: 0 })
    expect(moveActive({ row: 5, col: 0 }, { key: 'PageUp' }, dims)).toEqual({ row: 0, col: 0 })
  })

  it('goes to the first and last cell of the row with Home and End, and of the grid with Ctrl', () => {
    expect(moveActive({ row: 7, col: 2 }, { key: 'Home' }, dims)).toEqual({ row: 7, col: 0 })
    expect(moveActive({ row: 7, col: 2 }, { key: 'End' }, dims)).toEqual({ row: 7, col: 4 })
    expect(moveActive({ row: 7, col: 2 }, { key: 'Home', ctrl: true }, dims)).toEqual({ row: 0, col: 0 })
    expect(moveActive({ row: 7, col: 2 }, { key: 'End', ctrl: true }, dims)).toEqual({ row: 99, col: 4 })
  })

  it('stays on the header when the grid has no rows', () => {
    const empty = { rows: 0, cols: 3, page: 10 }
    expect(moveActive({ row: HEADER_ROW, col: 0 }, { key: 'ArrowDown' }, empty)).toEqual({ row: HEADER_ROW, col: 0 })
    expect(moveActive({ row: HEADER_ROW, col: 0 }, { key: 'End', ctrl: true }, empty)).toEqual({ row: HEADER_ROW, col: 2 })
  })

  it('does not handle other keys', () => {
    expect(moveActive({ row: 1, col: 1 }, { key: 'a' }, dims)).toBeNull()
    expect(moveActive({ row: 1, col: 1 }, { key: 'Tab' }, dims)).toBeNull()
  })
})

describe('compareValues', () => {
  it('orders numbers numerically and text in UK collation, ascending', () => {
    expect([3, -1, 20].sort(compareValues)).toEqual([-1, 3, 20])
    expect(['zn', 'ES', 'nq'].sort(compareValues)).toEqual(['ES', 'nq', 'zn'])
  })

  it('puts numbers before text so a mixed column still sorts deterministically', () => {
    expect(['b', 2, 'a', 1].sort(compareValues)).toEqual([1, 2, 'a', 'b'])
  })
})

describe('spacerHeights (virtual window)', () => {
  it('fills the space above and below the rendered rows', () => {
    expect(spacerHeights([{ start: 400, end: 420 }, { start: 420, end: 440 }], 2000)).toEqual({ top: 400, bottom: 1560 })
  })

  it('is zero on both sides when nothing is rendered', () => {
    expect(spacerHeights([], 2000)).toEqual({ top: 0, bottom: 0 })
  })
})

describe('numberWidthEm', () => {
  it('widens the N) column for five-digit numbers', () => {
    expect(numberWidthEm(19)).toBe(2.2)
    expect(numberWidthEm(10_000)).toBeGreaterThan(2.2)
  })
})

describe('column widths: a number or a header is never cut with an ellipsis (look spec 4.8)', () => {
  it('estimates text width in ch at or above the measured width of the grid face', () => {
    // Measured in Chromium at 15px, where 1ch is 7.46px: '+11.69%' 53.4px, 'Hash ok' 50.3px.
    expect(textWidthCh('1234')).toBe(4)
    expect(textWidthCh('+11.69%')).toBeGreaterThanOrEqual(53.4 / 7.46)
    expect(textWidthCh('Hash ok') + 0.5).toBeGreaterThanOrEqual(50.3 / 7.46)
    expect(textWidthCh('Net P&L (USD)') + 0.5).toBeGreaterThanOrEqual(88.8 / 7.46)
  })

  it('keeps the declared px width and adds a ch floor that fits the widest value and the header', () => {
    const css = columnWidth(62, 'num', '1M %', ['+11.69%', '-0.40%', '--'])
    expect(css).toBe(`max(62px, calc(${textWidthCh('+11.69%') + 0.5}ch + 10px))`)
    // A text column fits its header only; long names may still end in an ellipsis.
    expect(columnWidth(36, 'text', 'Flag', ['a very long text value'])).toBe(`max(36px, calc(${textWidthCh('Flag') + 0.5}ch + 10px))`)
  })
})
