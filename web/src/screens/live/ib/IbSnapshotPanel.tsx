// LIVE's IB snapshot panel (PRD U3, DL6; ARCHITECTURE section 8; read only). One GET, /api/ib/snapshot, polled gently:
// the masked account, net liquidation, positions, the open orders TWS lists (view only) and today's executions.
// Every state is said in words: off (NQT_IB_READONLY not set), TWS not reachable, refused (a guard stopped the read),
// stale (last values, with their age), a failed read, and live. There is no control here; nothing on this panel can place, change or withdraw anything.
//
// The status line's TWS segment reads ibLiveStore: this panel sets it to true only while the snapshot is live (an ok
// body whose time proves it fresh) and back to false when it goes stale, fails or unmounts.
import { useEffect, useMemo, useState } from 'react'
import { IB } from '../../../copy/ib'
import { fillCopy } from '../../../copy/workspace'
import PlainTable, { type PlainColumn } from '../PlainTable'
import StateStrip from '../StateStrip'
import { setIbSnapshotLive } from './ibLiveStore'
import {
  STALE_AFTER_MS,
  accountItems,
  executionRows,
  formatAge,
  ibViewState,
  positionRows,
  readIbSnapshot,
  snapshotAgeMs,
  workingRows,
  type ExecutionRowView,
  type PositionRowView,
  type WorkingRowView,
} from './ibSnapshotModel'
import type { IbSnapshot } from './ibTypes'
import { useIbSnapshot } from './useIbSnapshot'
import './ib.css'

/** How often the panel re-judges the age of the body it holds, so a body that stops refreshing turns stale on time. */
const NOW_TICK_MS = 5_000

const POSITION_COLUMNS: PlainColumn<PositionRowView>[] = [
  { id: 'symbol', header: IB.colSymbol, width: 110, kind: 'name', text: (r) => r.symbol },
  { id: 'type', header: IB.colType, width: 60, kind: 'text', text: (r) => r.secType },
  { id: 'exchange', header: IB.colExchange, width: 80, kind: 'text', text: (r) => r.exchange },
  { id: 'currency', header: IB.colCurrency, width: 56, kind: 'text', text: (r) => r.currency },
  { id: 'expiry', header: IB.colExpiry, width: 84, kind: 'text', text: (r) => r.expiry },
  { id: 'position', header: IB.colPosition, width: 84, kind: 'num', text: (r) => r.position, tone: (r) => r.tone },
  { id: 'avgCost', header: IB.colAvgCost, width: 110, kind: 'num', text: (r) => r.avgCost },
]

const WORKING_COLUMNS: PlainColumn<WorkingRowView>[] = [
  { id: 'symbol', header: IB.colSymbol, width: 110, kind: 'name', text: (r) => r.symbol },
  { id: 'action', header: IB.colAction, width: 64, kind: 'text', text: (r) => r.action, tone: (r) => r.tone },
  { id: 'kind', header: IB.colKind, width: 64, kind: 'text', text: (r) => r.kind },
  { id: 'quantity', header: IB.colQuantity, width: 56, kind: 'num', text: (r) => r.quantity },
  { id: 'limit', header: IB.colLimit, width: 100, kind: 'num', text: (r) => r.limit },
  { id: 'status', header: IB.colStatus, width: 96, kind: 'text', text: (r) => r.status },
  { id: 'filled', header: IB.colFilled, width: 56, kind: 'num', text: (r) => r.filled },
  { id: 'remaining', header: IB.colRemaining, width: 56, kind: 'num', text: (r) => r.remaining },
]

const EXECUTION_COLUMNS: PlainColumn<ExecutionRowView>[] = [
  { id: 'time', header: IB.colTime, width: 190, kind: 'name', text: (r) => r.time },
  { id: 'symbol', header: IB.colSymbol, width: 110, kind: 'text', text: (r) => r.symbol },
  { id: 'side', header: IB.colSide, width: 56, kind: 'text', text: (r) => r.side, tone: (r) => r.tone },
  { id: 'shares', header: IB.colShares, width: 64, kind: 'num', text: (r) => r.shares },
  { id: 'price', header: IB.colPrice, width: 100, kind: 'num', text: (r) => r.price },
  { id: 'exchange', header: IB.colExchange, width: 80, kind: 'text', text: (r) => r.exchange },
]

const rowKey = (r: { readonly key: string }) => r.key

export interface IbSnapshotViewProps {
  /** The body held, or null before the first answer. */
  readonly snapshot: IbSnapshot | null
  /** True when the latest read failed (with a body held, it stays on screen as stale). */
  readonly failed: boolean
  /** The reason the latest read failed, when it did. */
  readonly detail: string | null
  /** The clock the age is judged against, in epoch milliseconds. */
  readonly nowMs: number
  /** When the browser received the body, on the same clock; the age then ignores the server's clock (skew, lag). */
  readonly receivedAtMs?: number
}

function Tables({ snapshot }: { readonly snapshot: IbSnapshot }) {
  const positions = useMemo(() => positionRows(snapshot), [snapshot])
  const working = useMemo(() => workingRows(snapshot), [snapshot])
  const executions = useMemo(() => executionRows(snapshot), [snapshot])
  const totals = [
    { key: 'positions', label: IB.footPositions, value: String(positions.length) },
    { key: 'working', label: IB.footWorking, value: String(working.length) },
    { key: 'executions', label: IB.footExecutions, value: String(executions.length) },
  ]
  return (
    <>
      <StateStrip label={IB.stripLabel} items={accountItems(snapshot)} />
      {snapshot.incomplete.length > 0 ? <p className="live-message live-ib-warn live-ib-state"><b>{fillCopy(IB.incomplete, { sections: snapshot.incomplete.join(', ') })}</b></p> : null}
      {snapshot.truncated ? <p className="live-message live-ib-state">{IB.truncated}</p> : null}
      {snapshot.notes.length > 0 ? <p className="live-message live-ib-state">{fillCopy(IB.notes, { notes: snapshot.notes.join('; ') })}</p> : null}
      <h3 className="live-section">{IB.positionsTitle}</h3>
      <PlainTable label={IB.positionsLabel} rows={positions} columns={POSITION_COLUMNS} rowId={rowKey} emptyText={IB.positionsEmpty} />
      <h3 className="live-section">{IB.workingTitle}</h3>
      <PlainTable label={IB.workingLabel} rows={working} columns={WORKING_COLUMNS} rowId={rowKey} emptyText={IB.workingEmpty} />
      <h3 className="live-section">{IB.executionsTitle}</h3>
      <PlainTable label={IB.executionsLabel} rows={executions} columns={EXECUTION_COLUMNS} rowId={rowKey} emptyText={IB.executionsEmpty} />
      <div className="live-foot">
        <StateStrip label={IB.footLabel} items={totals} />
      </div>
    </>
  )
}

function StateLine({ snapshot, failed, nowMs, receivedAtMs, state }: {
  readonly snapshot: IbSnapshot
  readonly failed: boolean
  readonly nowMs: number
  readonly receivedAtMs: number | undefined
  readonly state: 'disabled' | 'unavailable' | 'refused' | 'stale' | 'live'
}) {
  const age = snapshotAgeMs(snapshot, nowMs, receivedAtMs)
  const ageText = age === null ? IB.none : formatAge(age)
  if (state === 'disabled') {
    return <p role="status" className="live-message live-ib-state"><b>{IB.stateOff}</b> {fillCopy(IB.stateOffNote, { message: snapshot.message })}</p>
  }
  if (state === 'unavailable') {
    return <p role="status" className="live-message live-ib-state live-ib-warn"><b>{IB.stateUnreachable}</b> {fillCopy(IB.stateUnreachableNote, { message: snapshot.message })}</p>
  }
  if (state === 'refused') {
    return <p role="status" className="live-message live-ib-state live-ib-warn"><b>{IB.stateRefused}</b> {fillCopy(IB.stateRefusedNote, { message: snapshot.message })}</p>
  }
  if (state === 'stale') {
    return (
      <p className="live-message live-ib-state live-ib-warn">
        <b role="status">{IB.stateStaleWord}</b>: <b>{fillCopy(IB.stateStaleAge, { age: ageText, limit: formatAge(STALE_AFTER_MS) })}</b> {IB.stateStaleNote}{failed ? ` ${IB.stateStaleFailed}` : ''}
      </p>
    )
  }
  return (
    <p className="live-message live-ib-state">
      <span role="status">{IB.stateLiveWord}</span>: {fillCopy(IB.stateLiveAge, { age: ageText })}
    </p>
  )
}

/** The panel's content for a given state; the container below feeds it from the query. */
export function IbSnapshotView({ snapshot, failed, detail, nowMs, receivedAtMs }: IbSnapshotViewProps) {
  const state = ibViewState(snapshot, failed, nowMs, receivedAtMs)
  return (
    <section className="live-routes live-ib" aria-label={IB.title}>
      <h3 className="live-section">
        <span className="live-readonly">{IB.readOnlyTag}</span> {IB.title}
      </h3>
      <p className="live-message live-basis">{IB.basisNote}</p>
      {state === 'loading' ? <p className="live-message" role="status" aria-busy="true">{IB.loading}</p> : null}
      {state === 'error' ? <p role="alert" className="live-message live-guard">{fillCopy(IB.loadError, { detail: detail ?? IB.none })}</p> : null}
      {snapshot !== null && state !== 'loading' && state !== 'error' ? (
        <>
          <StateLine snapshot={snapshot} failed={failed} nowMs={nowMs} receivedAtMs={receivedAtMs} state={state} />
          {state === 'live' || state === 'stale' ? <Tables snapshot={snapshot} /> : null}
        </>
      ) : null}
    </section>
  )
}

function useNowMs(tickMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs])
  return now
}

export default function IbSnapshotPanel() {
  const query = useIbSnapshot()
  const tickMs = useNowMs(NOW_TICK_MS)
  // Freshness is judged on the browser's own receipt time, never against the server's clock. The tick can lag a body
  // that has just arrived, so the clock is never read behind the receipt.
  const receivedAtMs = query.data === undefined ? undefined : query.dataUpdatedAt
  const nowMs = receivedAtMs === undefined ? tickMs : Math.max(tickMs, receivedAtMs)
  const snapshot = readIbSnapshot(query.data)
  const malformed = query.data !== undefined && snapshot === null
  const failed = query.isError || malformed
  const live = ibViewState(snapshot, failed, nowMs, receivedAtMs) === 'live'
  useEffect(() => {
    setIbSnapshotLive(live)
    return () => setIbSnapshotLive(false)
  }, [live])
  return <IbSnapshotView snapshot={snapshot} failed={failed} detail={malformed ? IB.badBody : (query.error?.detail ?? null)} nowMs={nowMs} receivedAtMs={receivedAtMs} />
}
