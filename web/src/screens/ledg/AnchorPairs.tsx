// The anchor pairs under the ledger (rule 3; ARCHITECTURE section 4 "Run detail carries anchor"): each
// fresh re-run against its base, with the exact-equality checks and the verdict (IDENTICAL, DIFFERENT
// or NOT COMPARABLE) as the API computed them. A plain table: a handful of rows, no drill-down.
import type { ReactNode } from 'react'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import { formatRatio } from '../runs/model'
import { LEDG } from './copy'
import type { AnchorPair } from './model'

const P = LEDG.pairs
// The pairs box scrolls on its own when long, so it is a roving item the keyboard can reach.
const roving = { [ROVING_ATTR]: '' }

function Flag({ ok }: { readonly ok: boolean }): ReactNode {
  return <span className={ok ? 'up' : 'down'}>{ok ? LEDG.yes : LEDG.no}</span>
}

function verdictClass(verdict: AnchorPair['verdict']): string {
  if (verdict === 'IDENTICAL') return 'up'
  if (verdict === 'DIFFERENT') return 'down'
  return 'muted'
}

function PairRow({ pair }: { readonly pair: AnchorPair }) {
  return (
    <tr>
      <td className="name">{pair.anchor}</td>
      <td className="name">{pair.base ?? '--'}</td>
      <td>{pair.base_source ?? '--'}</td>
      <td><Flag ok={pair.n_trades_equal} /></td>
      <td><Flag ok={pair.pnl_total_equal} /></td>
      <td><Flag ok={pair.fees_total_equal} /></td>
      <td className="num">{formatRatio(pair.sharpe_anchor, 4)}</td>
      <td className="num">{formatRatio(pair.sharpe_base, 4)}</td>
      <td className={verdictClass(pair.verdict)}>{pair.verdict}</td>
    </tr>
  )
}

export default function AnchorPairs({ pairs }: { readonly pairs: readonly AnchorPair[] }) {
  const headers = [P.anchor, P.base, P.source, P.trades, P.pnl, P.fees, P.sharpeAnchor, P.sharpeBase, P.verdict]
  return (
    <section className="ledg-pairs" aria-label={fillCopy(P.caption, { n: pairs.length })} tabIndex={0} {...roving}>
      <table className="nqt-grid ledg-pairs-table">
        <caption className="ledg-pairs-caption">{fillCopy(P.caption, { n: pairs.length })}</caption>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} scope="col" className={i === 6 || i === 7 ? 'num' : undefined}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.length === 0 ? (
            <tr><td colSpan={headers.length} className="muted">{P.none}</td></tr>
          ) : (
            pairs.map((pair) => <PairRow key={`${pair.anchor}|${pair.base ?? ''}`} pair={pair} />)
          )}
        </tbody>
      </table>
      <p className="runs-note">{P.note}</p>
    </section>
  )
}
