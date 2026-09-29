// The Seen column of the research-record watch (roadmap 16, slice 3): NEW for a record that is new or
// moved since this browser's checkpoint, CHG for one that should never change and was rewritten. It
// reads the marks of one source (useWatchMarks) and adds nothing when there are none. The cue is text, so
// colour is never the only signal. A local change watch from this browser, not a proof.
import type { RowData } from '@tanstack/react-table'
import type { WatchMark } from '../chrome/RecordWatch.marks'
import { WATCH } from '../copy/watch'
import type { MonitorColumn } from './MonitorGrid'

/** The column's fixed width in CSS px: wide enough for the header and for NEW or CHG. */
const WIDTH = 44

/** The word for a mark; null (which sorts last in both directions) for a row the watch did not mark. */
function markText(mark: WatchMark | undefined): string | null {
  if (mark === 'new') return WATCH.new
  if (mark === 'changed') return WATCH.chg
  return null
}

/**
 * The Seen column for one source. `keyOf` gives a row's key in the watch (the run id, the registry name,
 * run id and time for the ledger). Sorting groups the marked rows. Build it once per marks map.
 */
export function watchColumn<Row extends RowData>(marks: ReadonlyMap<string, WatchMark>, keyOf: (row: Row) => string): MonitorColumn<Row> {
  const textOf = (row: Row): string | null => markText(marks.get(keyOf(row)))
  return {
    id: 'watch',
    header: WATCH.column,
    width: WIDTH,
    kind: 'text',
    value: textOf,
    format: (row) => textOf(row) ?? '',
    tone: (row) => (textOf(row) === WATCH.new ? 'muted' : undefined),
  }
}

/**
 * `columns` with the Seen column first (after the grid's own number) while the watch has marks for this
 * source; the very same array when it has none, so a clean watch changes nothing, not even the identity
 * the grid's table model depends on. Call it inside a useMemo keyed on the marks map.
 */
export function withWatchColumn<Row extends RowData>(
  columns: readonly MonitorColumn<Row>[],
  marks: ReadonlyMap<string, WatchMark>,
  keyOf: (row: Row) => string,
): readonly MonitorColumn<Row>[] {
  return marks.size === 0 ? columns : [watchColumn(marks, keyOf), ...columns]
}
