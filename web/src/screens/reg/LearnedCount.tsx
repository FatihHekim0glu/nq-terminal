// REG's learned-rows line (W3), beside the Deflated Sharpe note: 'N counts L of R registered rows', from SV3's own
// answer (GET /api/analytics/deflated: L is n_trials, R adds the registered rows in its `unlearned` list), and on demand
// the rows N leaves out with the reason (a NOT_LEARNABLE reason, or no series source yet). No new route: it reads the
// answer REG already asked for, so the deflated request still waits for the registry and the hypotheses
// (deflatedRequestable). A plain line in the style of RegStaleBanner; the toggle is a native button and a roving item
// of the panel, so the names are reached by keyboard without adding a Tab stop. Read only.
import { useId, useState } from 'react'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { DEFLATED } from '../../copy/deflated'
import { fillCopy } from '../../copy/workspace'

/** One registered row N does not count (DeflatedView.unlearned). */
export interface UnlearnedRow {
  readonly name: string
  readonly reason: string
}

/** The part of the deflated answer the line reads; `unlearned` is absent in an answer from a backend before W3. */
export interface LearnedCountView {
  readonly n_trials: number
  readonly unlearned?: readonly UnlearnedRow[]
}

const roving = { [ROVING_ATTR]: '' }
// reg.css belongs to another file set; the line keeps its height in REG's column like .reg-dsr-note (flex: 0 0 auto).
const WRAP_STYLE = { flex: '0 0 auto' } as const
const LIST_STYLE = { listStyle: 'none', margin: 0, padding: '0 5px' } as const

function toggleLabel(open: boolean, count: number): string {
  if (open) return DEFLATED.learned.hide
  return count === 1 ? DEFLATED.learned.showOne : fillCopy(DEFLATED.learned.show, { n: count })
}

export default function LearnedCount({ view }: { readonly view: LearnedCountView }) {
  const unlearned = view.unlearned ?? []
  const [open, setOpen] = useState(false)
  const listId = useId()
  const line = fillCopy(DEFLATED.learned.line, { learned: view.n_trials, registered: view.n_trials + unlearned.length })
  return (
    <div className="reg-learned" data-reg-learned="" style={WRAP_STYLE}>
      <p className="reg-msg reg-muted">
        <span>{line}</span>
        {unlearned.length > 0 ? (
          <>
            {' '}
            <button type="button" className="reg-link" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} {...roving}>
              {toggleLabel(open, unlearned.length)}
            </button>
          </>
        ) : null}
      </p>
      {unlearned.length > 0 ? (
        <ul id={listId} className="reg-muted" aria-label={DEFLATED.learned.listLabel} hidden={!open} style={LIST_STYLE}>
          {unlearned.map((row) => (
            <li key={row.name}>{fillCopy(DEFLATED.learned.row, { name: row.name, reason: row.reason })}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
