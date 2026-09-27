// The MNQ paper book's roll schedule (nq_lab.mnq_roll through /api/market/paper-rolls): dates only, no price.
// The contract the book holds after today's close (New York) is marked with aria-current and a status word, so
// the mark is never colour alone. The rule and its source are printed under the table.
import { ROLL } from '../../copy/roll'
import { fillCopy } from '../../copy/workspace'
import QueryStatus from '../mon/QueryStatus'
import type { usePaperRolls } from '../../api/queries'

export default function PaperRolls({ query }: { readonly query: ReturnType<typeof usePaperRolls> }) {
  const schedule = query.data
  if (!schedule) {
    return <QueryStatus loading={query.isPending} error={query.error} loadingText={ROLL.paperLoading} failedText={ROLL.paperFailed} />
  }
  const C = ROLL.paperCols
  return (
    <div className="roll-paper">
      <p className="roll-note roll-heading">{ROLL.paperTitle}</p>
      <p className="roll-note">{fillCopy(ROLL.paperHeld, { today: schedule.today_et, held: schedule.held, roll: schedule.next_roll })}</p>
      {schedule.roll_today ? <p className="roll-note mkt-warn-text">{ROLL.paperRollToday}</p> : null}
      <div className="nqt-grid-scroll">
        <table className="nqt-grid roll-table" data-testid="roll-paper">
          <caption className="roll-note">{ROLL.paperCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{C.contract}</th>
              <th scope="col">{C.expiry}</th>
              <th scope="col">{C.rollDate}</th>
              <th scope="col">{C.into}</th>
              <th scope="col">{C.status}</th>
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((r) => (
              <tr key={r.contract} className={r.status === 'held' ? 'roll-held' : undefined} aria-current={r.status === 'held' ? 'true' : undefined}>
                <th scope="row" className="name">{r.contract}</th>
                <td className="time">{r.expiry}</td>
                <td className="time">{r.roll_date}</td>
                <td>{r.into}</td>
                <td className={r.status === 'past' ? 'muted' : undefined}>{ROLL.paperStatus[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="roll-note">{fillCopy(ROLL.paperRule, { rule: schedule.rule })}</p>
      <p className="roll-note muted">{fillCopy(ROLL.paperSource, { source: schedule.source })}</p>
    </div>
  )
}
