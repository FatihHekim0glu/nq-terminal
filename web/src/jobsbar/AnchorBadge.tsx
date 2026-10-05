// The result of an anchor comparison as a badge: MATCH, MISMATCH or NOT COMPARABLE in words, then the clause that
// says why (the first differing field for a mismatch). Colour only sits on top of the words (WCAG 1.4.1).
import { JOBS_BAR } from '../copy/jobsBar'
import { anchorView, type AnchorPair, type AnchorView } from './anchorModel'
import './AnchorBadge.css'

const TONE = { match: 'up', mismatch: 'down', incomparable: 'muted' } as const

export default function AnchorBadge({ pair }: { readonly pair: AnchorPair }) {
  return <AnchorViewBadge view={anchorView(pair)} />
}

/** The same badge for a view already built (the exact comparison of a re-run). */
export function AnchorViewBadge({ view }: { readonly view: AnchorView }) {
  return (
    <span className="anchor-badge" data-outcome={view.outcome} role="group" aria-label={JOBS_BAR.anchor.label}>
      <b className={`anchor-badge-word ${TONE[view.outcome]}`}>{view.word}</b>
      <span className="anchor-badge-detail">{view.detail}</span>
    </span>
  )
}
