// Sorting for MonitorGrid through TanStack Table v9: one sort column at a time, ascending first,
// missing values (null) last in both directions, section order fixed by the unsorted rows.
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { RowData } from '@tanstack/react-table'
import { useCallback, useMemo } from 'react'
import { compareValues, type SortValue } from './MonitorGrid.model'

export interface SortSpec {
  readonly id: string
  readonly desc: boolean
}

export interface SortableColumn<Row extends RowData> {
  readonly id: string
  readonly header: string
  readonly value: (row: Row) => string | number | null
  readonly sortable?: boolean
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() })

function useColumnDefs<Row extends RowData>(columns: readonly SortableColumn<Row>[]) {
  return useMemo(() => {
    const helper = createColumnHelper<typeof features, Row>()
    return helper.columns(
      columns.map((c) =>
        helper.accessor((row: Row): SortValue => c.value(row) ?? undefined, {
          id: c.id,
          header: c.header,
          enableSorting: c.sortable !== false,
          sortUndefined: 'last',
          sortFn: (a, b, id) => compareValues(a.getValue<SortValue>(id), b.getValue<SortValue>(id)),
        }),
      ),
    )
  }, [columns])
}

function firstSeen<Row extends RowData>(rows: readonly Row[], groupOf: (row: Row) => string): string[] {
  const seen = new Set<string>()
  for (const row of rows) seen.add(groupOf(row))
  return [...seen]
}

export function useSortedRows<Row extends RowData>(
  rows: readonly Row[],
  columns: readonly SortableColumn<Row>[],
  rowId: (row: Row) => string,
  initialSort: SortSpec | undefined,
  groupOf: ((row: Row) => string) | undefined,
) {
  const defs = useColumnDefs(columns)
  const table = useTable(
    {
      features,
      columns: defs,
      data: rows as Row[],
      getRowId: (row: Row) => rowId(row),
      initialState: { sorting: initialSort ? [{ id: initialSort.id, desc: initialSort.desc }] : [] },
      sortDescFirst: false,
      enableSortingRemoval: false,
      enableMultiSort: false,
    },
    (state) => ({ sorting: state.sorting }),
  )
  const model = table.getRowModel()
  const sorted = useMemo(() => model.rows.map((r) => r.original), [model])
  const first = table.state.sorting[0]
  const sort: SortSpec | null = first ? { id: first.id, desc: first.desc } : null
  const toggleSort = useCallback(
    (id: string) => {
      const current = table.atoms.sorting.get()[0]
      table.setSorting([{ id, desc: current?.id === id ? !current.desc : false }])
    },
    [table],
  )
  const groupOrder = useMemo(() => (groupOf ? firstSeen(rows, groupOf) : undefined), [rows, groupOf])
  return { sorted, sort, toggleSort, groupOrder }
}
