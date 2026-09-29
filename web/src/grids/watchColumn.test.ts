// The NEW and CHG column the research-record watch adds to RUNS, REG and LEDG (roadmap 16, slice 3): a
// 44 px text column headed Seen, built from the watch's marks for one source, present only when the watch
// has marked something. The text always carries the cue, never colour alone.
import { describe, expect, it } from 'vitest'
import { WATCH } from '../copy/watch'
import { cellText, type MonitorColumn } from './MonitorGrid'
import { compareValues } from './MonitorGrid.model'
import { watchColumn, withWatchColumn } from './watchColumn'

interface Row {
  readonly id: string
  readonly note?: string
}

const keyOf = (r: Row): string => r.id
const NEW_ROW: Row = { id: 'a' }
const CHANGED_ROW: Row = { id: 'b' }
const PLAIN_ROW: Row = { id: 'c' }
const MARKS: ReadonlyMap<string, 'new' | 'changed'> = new Map([
  ['a', 'new'],
  ['b', 'changed'],
])

const NAME: MonitorColumn<Row> = { id: 'name', header: 'Name', width: 100, kind: 'name', value: (r) => r.id }
const NOTE: MonitorColumn<Row> = { id: 'note', header: 'Note', width: 60, kind: 'text', value: (r) => r.note ?? null }

describe('watchColumn: the Seen column', () => {
  const col = watchColumn<Row>(MARKS, keyOf)

  it('is a 44 px text column with the id watch and the header from the copy', () => {
    expect(col.id).toBe('watch')
    expect(col.header).toBe(WATCH.column)
    expect(col.header).toBe('Seen')
    expect(col.width).toBe(44)
    expect(col.kind).toBe('text')
  })

  it('has values NEW and CHG for marked rows and null for the rest', () => {
    expect(col.value(NEW_ROW)).toBe('NEW')
    expect(col.value(CHANGED_ROW)).toBe('CHG')
    expect(col.value(PLAIN_ROW)).toBeNull()
  })

  it('takes the words from the shell copy', () => {
    expect(WATCH.new).toBe('NEW')
    expect(WATCH.chg).toBe('CHG')
    expect(col.value(NEW_ROW)).toBe(WATCH.new)
    expect(col.value(CHANGED_ROW)).toBe(WATCH.chg)
  })

  it('shows NEW, CHG or an empty cell (never the -- of a missing number)', () => {
    expect(col.format?.(NEW_ROW)).toBe(WATCH.new)
    expect(col.format?.(CHANGED_ROW)).toBe(WATCH.chg)
    expect(col.format?.(PLAIN_ROW)).toBe('')
    expect(cellText(col, NEW_ROW)).toBe('NEW')
    expect(cellText(col, CHANGED_ROW)).toBe('CHG')
    expect(cellText(col, PLAIN_ROW)).toBe('')
  })

  it('tones NEW muted and leaves CHG and an unmarked row untoned: the cue is the text', () => {
    expect(col.tone?.(NEW_ROW)).toBe('muted')
    expect(col.tone?.(CHANGED_ROW)).toBeUndefined()
    expect(col.tone?.(PLAIN_ROW)).toBeUndefined()
  })

  it('reads the key through keyOf, so a composite key finds its mark', () => {
    const composite = watchColumn<Row>(new Map([['x@2026-09-26', 'new']]), (r) => `${r.id}@2026-09-26`)
    expect(composite.value({ id: 'x' })).toBe('NEW')
    expect(composite.value({ id: 'y' })).toBeNull()
  })

  it('does not treat an inherited property name as a mark', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(col.value({ id })).toBeNull()
      expect(cellText(col, { id })).toBe('')
    }
  })

  it('sorts by the word, so the marked rows group together: CHG before NEW ascending', () => {
    const ascending = [NEW_ROW, CHANGED_ROW].sort((a, b) => compareValues(col.value(a), col.value(b)))
    expect(ascending.map((r) => r.id)).toEqual(['b', 'a'])
    const descending = [CHANGED_ROW, NEW_ROW].sort((a, b) => compareValues(col.value(b), col.value(a)))
    expect(descending.map((r) => r.id)).toEqual(['a', 'b'])
    // An unmarked row has no value (null), which MonitorGrid keeps last in both directions.
    expect(col.value(PLAIN_ROW)).toBeNull()
  })

  it('offers no custom render, so the cell text is the cue', () => {
    expect(col.render).toBeUndefined()
    expect(col.sortable).not.toBe(false)
  })

  it('reads the marks it was given: a new map gives a new answer, the old column keeps its own', () => {
    const later = watchColumn<Row>(new Map([['c', 'changed']]), keyOf)
    expect(later.value(PLAIN_ROW)).toBe('CHG')
    expect(later.value(NEW_ROW)).toBeNull()
    expect(col.value(NEW_ROW)).toBe('NEW')
  })
})

describe('withWatchColumn: first after the number, and only when the watch has marks', () => {
  const base = [NAME, NOTE]

  it('returns the very same array when nothing is marked, so a clean watch adds no column', () => {
    const none = new Map<string, 'new' | 'changed'>()
    expect(withWatchColumn(base, none, keyOf)).toBe(base)
  })

  it('puts the Seen column first when something is marked, and keeps the others in order', () => {
    const out = withWatchColumn(base, MARKS, keyOf)
    expect(out.map((c) => c.id)).toEqual(['watch', 'name', 'note'])
    expect(out.slice(1)).toEqual(base)
    expect(out.slice(1).every((c, i) => c === base[i])).toBe(true)
  })

  it('does not change the columns it was given', () => {
    const copy = [...base]
    withWatchColumn(base, MARKS, keyOf)
    expect(base).toEqual(copy)
  })

  it('adds exactly 44 px to the width the grid needs', () => {
    const sum = (cols: readonly MonitorColumn<Row>[]) => cols.reduce((n, c) => n + c.width, 0)
    expect(sum(withWatchColumn(base, MARKS, keyOf)) - sum(base)).toBe(44)
  })
})
