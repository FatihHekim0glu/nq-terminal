// RUN tabs 2) to 6) and 8) (look spec 7.4, UI_SPEC section 7): trades, fills and the strategy log
// sections in MonitorGrids, one API page (5,000 rows, the contract's maximum) at a time with a pager
// when a run has more. Trades are newest first with P&L in up and down text; prices show exactly the
// API value with the decimals the column needs. Log sections are free-form rows: one column per key.
// A section the run does not record is named, and never requested. Each grid registers its loaded page
// for the screen's 98) Export. Trades and fills also open in the Perspective pivot grid (TASKS 9.1),
// which reads every page of the run's rows.
import { useMemo, useState, type ReactNode } from 'react'
import { useRunFills, useRunLog, useRunTrades } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { csvFileName } from '../../chrome/exportCsv'
import { useExportSource } from '../../chrome/exportSource'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import MonitorGrid, { type MonitorColumn } from '../../grids/MonitorGrid'
import { gridCsv } from '../../grids/gridCsv'
import type { SortSpec } from '../../grids/MonitorGrid.sort'
import { RUN } from '../../copy/runs'
import { FillsPivot, PivotToggle, TradesPivot, type GridView } from '../../perspective'
import { decimalsFor, formatExact, formatRatio, formatUsd, logColumns, logText, signTone } from './model'
import { PAGE_ROWS, type LogSection } from './runModel'

type Trade = Schemas['TradeRow']
type Fill = Schemas['FillRow']
type LogRow = Readonly<Record<string, unknown>>

const roving = { [ROVING_ATTR]: '' }

/** Registers a grid's loaded page (its columns, as shown) for 98) Export as `<run>_<name>.csv`. */
function useGridExport<Row extends object>(run: string, name: string, columns: readonly MonitorColumn<Row>[], items: readonly Row[]): void {
  useExportSource(useMemo(() => ({ fileName: csvFileName(run, name), csv: gridCsv(columns, items), rows: items.length }), [run, name, columns, items]))
}
const NEWEST_TRADE: SortSpec = { id: 'exit', desc: true }
const NEWEST_FILL: SortSpec = { id: 'ts', desc: true }

interface PagerProps {
  readonly offset: number
  readonly total: number
  readonly onOffset: (offset: number) => void
}

function Pager({ offset, total, onOffset }: PagerProps) {
  if (total <= PAGE_ROWS) return null
  const P = RUN.page
  const prev = offset > 0
  const next = offset + PAGE_ROWS < total
  const step = (to: number, ok: boolean) => () => (ok ? onOffset(to) : undefined)
  return (
    <div className="run-pager">
      <span>{fillCopy(P.label, { from: offset + 1, to: Math.min(total, offset + PAGE_ROWS), total })}</span>
      <button type="button" className="run-btn" aria-disabled={!prev} onClick={step(offset - PAGE_ROWS, prev)} {...roving}>{P.prev}</button>
      <button type="button" className="run-btn" aria-disabled={!next} onClick={step(offset + PAGE_ROWS, next)} {...roving}>{P.next}</button>
    </div>
  )
}

interface Loadable<T> {
  readonly data?: { readonly items: readonly T[]; readonly total: number }
  readonly error: { readonly detail: string } | null
  readonly isPending: boolean
}

function Paged<T>({ query, offset, onOffset, children }: { readonly query: Loadable<T>; readonly offset: number; readonly onOffset: (o: number) => void; readonly children: (items: readonly T[], total: number) => ReactNode }) {
  if (query.error) return <p className="run-msg" role="status">{query.error.detail}</p>
  if (!query.data) return query.isPending ? <p className="run-msg" role="status">{RUN.page.loading}</p> : null
  return (
    <>
      <Pager offset={offset} total={query.data.total} onOffset={onOffset} />
      <div className="run-grid">{children(query.data.items, query.data.total)}</div>
    </>
  )
}

function tradeColumns(priceDecimals: number): MonitorColumn<Trade>[] {
  const T = RUN.trades
  const px = (v: number | null) => formatExact(v, priceDecimals)
  return [
    { id: 'date', header: T.date, width: 100, kind: 'name', value: (r) => r.date },
    { id: 'side', header: T.side, width: 60, kind: 'text', value: (r) => r.direction, format: (r) => (r.direction === 1 ? T.long : r.direction === -1 ? T.short : '--') },
    { id: 'entry', header: T.entryTs, width: 210, kind: 'text', value: (r) => r.entry_ts_epoch_s, format: (r) => r.entry_ts ?? '--' },
    { id: 'entryPx', header: T.entryPx, width: 110, kind: 'num', value: (r) => r.entry_px, format: (r) => px(r.entry_px) },
    { id: 'exit', header: T.exitTs, width: 210, kind: 'text', value: (r) => r.exit_ts_epoch_s, format: (r) => r.exit_ts ?? '--' },
    { id: 'exitPx', header: T.exitPx, width: 110, kind: 'num', value: (r) => r.exit_px, format: (r) => px(r.exit_px) },
    { id: 'reason', header: T.reason, width: 80, kind: 'text', value: (r) => r.reason },
    { id: 'pts', header: T.pnlPts, width: 90, kind: 'num', value: (r) => r.pnl_pts, format: (r) => formatRatio(r.pnl_pts, 2), tone: (r) => signTone(r.pnl_pts) },
    { id: 'usd', header: T.pnlUsd, width: 116, kind: 'num', value: (r) => r.pnl_usd, format: (r) => formatUsd(r.pnl_usd, true), tone: (r) => signTone(r.pnl_usd) },
    { id: 'costs', header: T.commission, width: 96, kind: 'num', value: (r) => r.commissions_usd, format: (r) => formatUsd(r.commissions_usd) },
    { id: 'netR', header: T.netR, width: 80, kind: 'num', value: (r) => r.net_r, format: (r) => formatRatio(r.net_r, 3), tone: (r) => signTone(r.net_r) },
  ]
}

const tradeId = (r: Trade) => `${r.entry_ts ?? ''}|${r.exit_ts ?? ''}|${r.entry_px ?? ''}|${r.direction ?? ''}|${r.pnl_usd ?? ''}`

function TradesGrid({ run, items, total }: { readonly run: string; readonly items: readonly Trade[]; readonly total: number }) {
  const decimals = decimalsFor(items.flatMap((t) => [t.entry_px, t.exit_px]))
  const columns = useMemo(() => tradeColumns(decimals), [decimals])
  useGridExport(run, 'trades', columns, items)
  return (
    <MonitorGrid label={fillCopy(RUN.trades.label, { run, n: total })} rows={items} columns={columns} rowId={tradeId} numbered={false} initialSort={NEWEST_TRADE} emptyText={RUN.trades.empty} />
  )
}

function ViewRow({ view, onView }: { readonly view: GridView; readonly onView: (v: GridView) => void }) {
  return <div className="nqt-pivot-row"><PivotToggle value={view} onChange={onView} /></div>
}

function PagedTrades({ run }: { readonly run: string }) {
  const [offset, setOffset] = useState(0)
  const query = useRunTrades(run, { offset, limit: PAGE_ROWS })
  return (
    <Paged query={query} offset={offset} onOffset={setOffset}>
      {(items, total) => <TradesGrid run={run} items={items} total={total} />}
    </Paged>
  )
}

export function TradesTab({ run }: { readonly run: string }) {
  const [view, setView] = useState<GridView>('grid')
  return (
    <>
      <ViewRow view={view} onView={setView} />
      {view === 'pivot' ? <div className="nqt-pivot-frame"><TradesPivot run={run} /></div> : <PagedTrades run={run} />}
    </>
  )
}

function fillColumns(priceDecimals: number): MonitorColumn<Fill>[] {
  const F = RUN.fills
  return [
    { id: 'ts', header: F.ts, width: 250, kind: 'name', value: (r) => r.ts_epoch_s, format: (r) => r.ts ?? '--' },
    { id: 'instrument', header: F.instrument, width: 110, kind: 'text', value: (r) => r.instrument },
    { id: 'side', header: F.side, width: 60, kind: 'text', value: (r) => r.side },
    { id: 'qty', header: F.qty, width: 70, kind: 'num', value: (r) => r.qty, format: (r) => formatExact(r.qty, decimalsFor([r.qty])) },
    { id: 'px', header: F.px, width: 120, kind: 'num', value: (r) => r.px, format: (r) => formatExact(r.px, priceDecimals) },
    { id: 'commission', header: F.commission, width: 100, kind: 'num', value: (r) => r.commission_float, format: (r) => r.commission ?? '--' },
    { id: 'position', header: F.position, width: 200, kind: 'text', value: (r) => r.position_id },
    { id: 'ref', header: F.orderRef, width: 260, kind: 'text', value: (r) => r.order_id },
    { id: 'tags', header: F.tags, width: 100, kind: 'text', value: (r) => r.tags },
  ]
}

const fillId = (r: Fill) => `${r.ts ?? ''}|${r.order_id ?? ''}|${r.position_id ?? ''}|${r.side ?? ''}|${r.qty ?? ''}`

function FillsGrid({ run, items, total }: { readonly run: string; readonly items: readonly Fill[]; readonly total: number }) {
  const decimals = decimalsFor(items.map((f) => f.px))
  const columns = useMemo(() => fillColumns(decimals), [decimals])
  useGridExport(run, 'fills', columns, items)
  return (
    <MonitorGrid label={fillCopy(RUN.fills.label, { run, n: total })} rows={items} columns={columns} rowId={fillId} numbered={false} initialSort={NEWEST_FILL} emptyText={RUN.fills.empty} />
  )
}

function PagedFills({ run }: { readonly run: string }) {
  const [offset, setOffset] = useState(0)
  const query = useRunFills(run, { offset, limit: PAGE_ROWS })
  return (
    <Paged query={query} offset={offset} onOffset={setOffset}>
      {(items, total) => <FillsGrid run={run} items={items} total={total} />}
    </Paged>
  )
}

export function FillsTab({ run }: { readonly run: string }) {
  const [view, setView] = useState<GridView>('grid')
  return (
    <>
      <ViewRow view={view} onView={setView} />
      {view === 'pivot' ? <div className="nqt-pivot-frame"><FillsPivot run={run} /></div> : <PagedFills run={run} />}
    </>
  )
}

function logColumnDefs(items: readonly LogRow[]): MonitorColumn<LogRow>[] {
  return logColumns(items).map((key, i) => {
    const numeric = items.some((r) => typeof r[key] === 'number') && items.every((r) => r[key] === null || r[key] === undefined || typeof r[key] === 'number')
    const cell = (r: LogRow) => r[key]
    return {
      id: key, header: key, width: numeric ? 110 : 170, kind: i === 0 ? 'name' : numeric ? 'num' : 'text',
      value: (r) => {
        const v = cell(r)
        return typeof v === 'number' || typeof v === 'string' ? v : logText(v)
      },
      format: (r) => logText(cell(r)),
    }
  })
}

interface LogGridProps {
  readonly run: string
  readonly section: string
  readonly sectionKey: LogSection
  readonly items: readonly LogRow[]
  readonly total: number
}

function LogGrid({ run, section, sectionKey, items, total }: LogGridProps) {
  const columns = useMemo(() => logColumnDefs(items), [items])
  useGridExport(run, sectionKey, columns, items)
  const rowIds = useMemo(() => new Map(items.map((r, i) => [r, String(i)])), [items])
  return (
    <MonitorGrid
      label={fillCopy(RUN.log.label, { section, run, n: total })}
      rows={items}
      columns={columns}
      rowId={(r) => rowIds.get(r) ?? ''}
      numbered={false}
      emptyText={fillCopy(RUN.log.empty, { section })}
    />
  )
}

export function LogTab({ run, section, title }: { readonly run: string; readonly section: LogSection; readonly title: string }) {
  const [offset, setOffset] = useState(0)
  const query = useRunLog(run, section, { offset, limit: PAGE_ROWS })
  return (
    <Paged query={query} offset={offset} onOffset={setOffset}>
      {(items, total) => <LogGrid run={run} section={title} sectionKey={section} items={items} total={total} />}
    </Paged>
  )
}

export function AbsentLog({ title }: { readonly title: string }) {
  return <p className="run-msg">{fillCopy(RUN.log.absent, { section: title.toLowerCase() })}</p>
}
