// MV6 term structure panel (TASKS Phase 12; ANALYTICS_CATALOG section 11), a DES-style card for one root's market
// view: the front to next calendar-chain carry as percent a year over the spread in the market's units (a LineStack
// stack on one time axis, with its table view), the summary and the void sessions in words, and the latest curve over
// every chain rank. Positive carry is backwardation. No p-value, no verdict. Presentational: the host passes the
// /market/term-structure/{root} response.
import { useMemo } from 'react'
import LineStack from '../../charts/LineStack'
import { RCT } from '../../copy/regimesCapacityTerm'
import { fillCopy } from '../../copy/workspace'
import type { PanelLink } from '../../state/linkGroups'
import { Card, ScrollRegion } from '../tear/TearCard'
import '../tear/tear.css'
import { curveRows, gateLine, termStack, termSummaryLine, voidLine } from './model'
import type { TermStructure } from './types'
import './p2rct.css'

export interface TermStructurePanelProps {
  readonly term: TermStructure
  /** The chart's link group; '-' (the default) keeps its crosshair to this card. */
  readonly link?: PanelLink
}

const K = RCT.term

function TermChart({ term, link }: { readonly term: TermStructure; readonly link: PanelLink }) {
  const stack = useMemo(() => termStack(term), [term])
  if (stack === null) return <p className="tear-note">{fillCopy(K.chart.empty, { root: term.root })}</p>
  return (
    <div className="tear-chart tear-chart-p1">
      <LineStack title={stack.title} t={stack.t} panes={stack.panes} link={link} />
    </div>
  )
}

function CurveTable({ term }: { readonly term: TermStructure }) {
  const C = K.curveCols
  if (term.curve.date === null) return <p className="tear-note">{K.curveNone}</p>
  const caption = fillCopy(K.curveCaption, { date: term.curve.date })
  return (
    <ScrollRegion label={caption}>
      <table className="nqt-grid rct-table">
        <caption className="tear-caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">{C.rank}</th>
            <th scope="col">{C.contract}</th>
            <th scope="col">{C.expiry}</th>
            {[C.days, C.close, C.volume].map((h) => <th key={h} scope="col" className="num">{h}</th>)}
            <th scope="col">{C.thin}</th>
          </tr>
        </thead>
        <tbody>
          {curveRows(term).map((r) => (
            <tr key={r.rank}>
              <td className="num">{r.rank}</td>
              <th scope="row" className="name tear-rowhead">{r.contract}</th>
              <td className="time">{r.expiry}</td>
              <td className="num">{r.days}</td>
              <td className="num tear-value">{r.close}</td>
              <td className="num">{r.volume}</td>
              <td className="muted">{r.thin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

export default function TermStructurePanel({ term, link = '-' }: TermStructurePanelProps) {
  const gate = gateLine(term.gate)
  const missing = term.curve.missing_ranks
  return (
    <Card title={fillCopy(K.title, { root: term.root })} tag={term.tag} className="rct-card">
      <p className="tear-basis">{term.label}</p>
      <p className="tear-note">{termSummaryLine(term)}</p>
      <TermChart term={term} link={link} />
      <CurveTable term={term} />
      {missing.length > 0 ? <p className="tear-note">{fillCopy(K.missingRanks, { ranks: missing.join(', ') })}</p> : null}
      <p className="tear-note">{voidLine(term)}</p>
      {term.fenced > 0 ? <p className="tear-note">{fillCopy(K.fenced, { n: term.fenced })}</p> : null}
      <p className="tear-note">{K.unit}</p>
      <p className="tear-note">{fillCopy(K.ranks, { ranks: term.ranks.join(', ') })}</p>
      <p className="tear-note">{fillCopy(K.expirySource, { source: term.expiry_source })}</p>
      {gate ? <p className="tear-note rct-gate">{gate}</p> : null}
    </Card>
  )
}
