// The four pivot views (TASKS 9.1): RUN fills and trades read every page of the run's rows (the API pages at
// 5,000, the contract's maximum), the LEDG pivot and the OOS log take the rows their screen already holds.
// Each view shows the same rows two ways, chosen on a visible Show as [Table | Pivot grid] toggle: the
// accessible table (PivotTableView.tsx, the house MonitorGrid) and the Perspective pivot grid, whose own grid sits
// in a shadow tree that axe leaves out and no screen reader has been run over. The table is the default under
// prefers-reduced-motion and takes over, with an alert, when the pivot grid cannot start (pivotMode.ts). Only
// the pivot grid, its stylesheet and the engine load lazily, so the table works when they cannot.
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet, type ApiError } from '../api/client'
import { ToggleGroup } from '../chrome/Field.buttons'
import { PIVOT } from '../copy/perspective'
import { fillCopy } from '../copy/workspace'
import { DATASETS, type Dataset, type FillRow, type LedgerRow, type OosEntry, type TradeRow } from './datasets'
import { loadPerspective } from './engine'
import { initialPivotMode, rememberPivotMode, type PivotMode } from './pivotMode'
import PivotTableView from './PivotTableView'
import { toColumnar, toSchema } from './schema'

const PerspectiveGrid = lazy(() => import('./PerspectiveGrid'))

/** The API's largest page (ARCHITECTURE section 4). */
export const PAGE_ROWS = 5000
/** A guard against a runaway loop: 100 pages is 500,000 rows. */
const MAX_PAGES = 100

interface Page<Row> {
  readonly items: readonly Row[]
  readonly total: number
}

/** Every row of a paged endpoint, page by page, in order. */
export async function readAllPages<Row>(read: (offset: number) => Promise<Page<Row>>): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const got = await read(rows.length)
    rows.push(...got.items)
    if (got.items.length === 0 || rows.length >= got.total) return rows
  }
  throw new Error(`more than ${MAX_PAGES * PAGE_ROWS} rows`)
}

/** A pivot grid whose code could not load (a failed chunk) reports it like an engine that could not start. */
class GridBoundary extends Component<{ readonly onFailed: (detail: string) => void; readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    this.props.onFailed(error instanceof Error ? error.message : String(error))
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const MODES = [
  { value: 'table', label: PIVOT.showTable },
  { value: 'pivot', label: PIVOT.showPivot },
] as const

interface DatasetPivotProps<Row> {
  readonly name: string
  readonly dataset: Dataset<Row>
  readonly rows: readonly Row[]
}

function PivotGrid<Row>({ name, dataset, rows, onFailed }: DatasetPivotProps<Row> & { readonly onFailed: (detail: string) => void }) {
  const schema = useMemo(() => toSchema(dataset.columns), [dataset])
  const data = useMemo(() => toColumnar(rows, dataset.columns), [rows, dataset])
  return (
    <GridBoundary onFailed={onFailed}>
      <Suspense fallback={<p className="nqt-psp-status" role="status" aria-busy="true">{PIVOT.loadingEngine}</p>}>
        <PerspectiveGrid name={name} schema={schema} data={data} rows={rows.length} preset={dataset.preset} onFailed={onFailed} />
      </Suspense>
    </GridBoundary>
  )
}

function DatasetPivot<Row>({ name, dataset, rows }: DatasetPivotProps<Row>) {
  const [start] = useState(initialPivotMode)
  const [mode, setMode] = useState<PivotMode>(start.mode)
  const [chose, setChose] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const choose = (next: string) => {
    const picked: PivotMode = next === 'pivot' ? 'pivot' : 'table'
    rememberPivotMode(picked)
    setChose(true)
    setFailure(null)
    setMode(picked)
  }
  const onFailed = useCallback((detail: string) => {
    setFailure(detail)
    setMode('table')
  }, [])
  return (
    <div className="nqt-pivot-view">
      <div className="nqt-pivot-row">
        <span className="param-label" aria-hidden="true">{PIVOT.show}</span>
        <ToggleGroup label={PIVOT.show} options={MODES} value={mode} onChange={choose} />
      </div>
      {failure ? <p className="nqt-psp-status nqt-psp-error" role="alert">{fillCopy(PIVOT.table.fallback, { detail: failure })}</p> : null}
      {mode === 'table' && start.byMotion && !chose && !failure ? <p className="nqt-psp-note">{PIVOT.table.reducedMotion}</p> : null}
      {mode === 'table' ? <PivotTableView name={name} dataset={dataset} rows={rows} /> : <PivotGrid name={name} dataset={dataset} rows={rows} onFailed={onFailed} />}
    </div>
  )
}

/** Start the engine while the rows are still being read, so the two overlap; not when the view opens as the table. */
function usePrewarm(): void {
  useEffect(() => {
    if (initialPivotMode().mode === 'pivot') loadPerspective().catch(() => undefined)
  }, [])
}

function Reading({ name, error }: { readonly name: string; readonly error: ApiError | Error | null }) {
  if (error) return <p className="nqt-psp-status nqt-psp-error" role="alert">{fillCopy(PIVOT.readFailed, { name, detail: 'detail' in error ? String(error.detail) : error.message })}</p>
  return <p className="nqt-psp-status" role="status" aria-busy="true">{fillCopy(PIVOT.loadingAll, { name })}</p>
}

export function FillsPivot({ run }: { readonly run: string }) {
  const name = fillCopy(PIVOT.names.fills, { run })
  usePrewarm()
  const query = useQuery<FillRow[], ApiError>({
    queryKey: ['pivot', 'fills', run],
    queryFn: ({ signal }) => readAllPages((offset) => apiGet('/api/runs/{run_id}/fills', { path: { run_id: run }, query: { offset, limit: PAGE_ROWS } }, { signal })),
  })
  if (!query.data) return <Reading name={name} error={query.error} />
  return <DatasetPivot name={name} dataset={DATASETS.fills} rows={query.data} />
}

export function TradesPivot({ run }: { readonly run: string }) {
  const name = fillCopy(PIVOT.names.trades, { run })
  usePrewarm()
  const query = useQuery<TradeRow[], ApiError>({
    queryKey: ['pivot', 'trades', run],
    queryFn: ({ signal }) => readAllPages((offset) => apiGet('/api/runs/{run_id}/trades', { path: { run_id: run }, query: { offset, limit: PAGE_ROWS } }, { signal })),
  })
  if (!query.data) return <Reading name={name} error={query.error} />
  return <DatasetPivot name={name} dataset={DATASETS.trades} rows={query.data} />
}

export function LedgerPivot({ rows }: { readonly rows: readonly LedgerRow[] }) {
  return <DatasetPivot name={PIVOT.names.ledger} dataset={DATASETS.ledger} rows={rows} />
}

export function OosPivot({ entries }: { readonly entries: readonly OosEntry[] }) {
  return <DatasetPivot name={PIVOT.names.oos} dataset={DATASETS.oos} rows={entries} />
}
