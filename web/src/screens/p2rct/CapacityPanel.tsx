// EX5 capacity panel (TASKS Phase 12; ANALYTICS_CATALOG section 9), a DES-style card for a run's exposure and costs
// row: per volume series the sessions traded, the contracts per session and the participation (contracts over the
// session's volume: mean, median, 95th percentile, largest and its date), the sessions of largest participation, and
// the instruments with the series whose volume measures each. Participation is shown as a percentage of the volume
// (4 decimals). Void sessions are counted, never dropped. Presentational: the host passes the /capacity response.
import { RCT } from '../../copy/regimesCapacityTerm'
import { fillCopy } from '../../copy/workspace'
import { Card, ScrollRegion } from '../tear/TearCard'
import '../tear/tear.css'
import { capacityRows, gateLine, instrumentRows, maxLine, worstRows } from './model'
import type { RunCapacity } from './types'
import './p2rct.css'

export interface CapacityPanelProps {
  readonly capacity: RunCapacity
}

const K = RCT.capacity

function InstrumentsTable({ capacity }: { readonly capacity: RunCapacity }) {
  const C = K.instrumentCols
  return (
    <table className="nqt-grid rct-table">
      <caption className="tear-caption">{K.instrumentsCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{C.instrument}</th>
          <th scope="col">{C.symbol}</th>
          <th scope="col" className="num">{C.factor}</th>
          <th scope="col">{C.note}</th>
        </tr>
      </thead>
      <tbody>
        {instrumentRows(capacity).map((r) => (
          <tr key={r.instrument}>
            <th scope="row" className="name tear-rowhead">{r.instrument}</th>
            <td>{r.symbol}</td>
            <td className="num">{r.factor}</td>
            <td className="muted">{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SeriesTable({ capacity }: { readonly capacity: RunCapacity }) {
  const C = K.rowCols
  return (
    <table className="nqt-grid rct-table">
      <caption className="tear-caption">{K.rowsCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{C.symbol}</th>
          {[C.sessions, C.void, C.contracts, C.mean, C.median, C.p95, C.max].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
          <th scope="col">{C.maxDate}</th>
          <th scope="col" className="num">{C.volume}</th>
        </tr>
      </thead>
      <tbody>
        {capacityRows(capacity).map((r) => (
          <tr key={r.symbol}>
            <th scope="row" className="name tear-rowhead">{r.symbol}</th>
            <td className="num">{r.sessions}</td>
            <td className="num">{r.void}</td>
            <td className="num">{r.contracts}</td>
            <td className="num tear-value">{r.mean}</td>
            <td className="num">{r.median}</td>
            <td className="num">{r.p95}</td>
            <td className="num">{r.max}</td>
            <td className="time">{r.maxDate}</td>
            <td className="num">{r.volume}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function WorstTable({ capacity }: { readonly capacity: RunCapacity }) {
  const C = K.worstCols
  return (
    <table className="nqt-grid rct-table">
      <caption className="tear-caption">{K.worstCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{C.date}</th>
          <th scope="col">{C.symbol}</th>
          {[C.contracts, C.volume, C.ratio].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {worstRows(capacity).map((r) => (
          <tr key={`${r.date}-${r.symbol}`}>
            <th scope="row" className="time tear-rowhead">{r.date}</th>
            <td>{r.symbol}</td>
            <td className="num">{r.contracts}</td>
            <td className="num">{r.volume}</td>
            <td className="num tear-value">{r.ratio}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function CapacityPanel({ capacity }: CapacityPanelProps) {
  const gate = gateLine(capacity.gate)
  return (
    <Card title={K.title} tag={capacity.tag} className="rct-card">
      <p className="tear-basis">{capacity.label}</p>
      <p className="tear-note">{maxLine(capacity)}</p>
      <ScrollRegion label={K.rowsRegion}>
        <SeriesTable capacity={capacity} />
      </ScrollRegion>
      <p className="tear-note">{K.voidNote}</p>
      {capacity.worst.length > 0 ? (
        <ScrollRegion label={K.worstRegion}>
          <WorstTable capacity={capacity} />
        </ScrollRegion>
      ) : null}
      <ScrollRegion label={K.instrumentsCaption}>
        <InstrumentsTable capacity={capacity} />
      </ScrollRegion>
      <p className="tear-note">{fillCopy(K.unit, { unit: capacity.unit })}</p>
      <p className="tear-note">{fillCopy(K.source, { source: K.sourceNames[capacity.source] ?? capacity.source })}</p>
      {gate ? <p className="tear-note rct-gate">{gate}</p> : null}
    </Card>
  )
}
