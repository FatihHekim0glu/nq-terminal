// Page 4 of the DES tear sheet: the Nautilus runs linked to the hypothesis (each opens RUN through the
// command line, and is Number <GO> item 14 on), its sealed-window confirmations and its sealed files.
import { useConfirmations } from '../../api/queries'
import { useSealedIndex } from '../../api/queries.screens'
import { requestLine } from '../../chrome/CommandLine.bus'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { spentStrip, type HypothesisDetail } from './desModel'
import { MAX_NUMBERED_RUNS, runNumber } from './desNumbers'
import { DesCard, roving } from './DesParts'
import DesSpent from './DesSpent'

export interface DesLinksProps {
  readonly detail: HypothesisDetail
}

function RunsTable({ detail }: DesLinksProps) {
  const { card } = detail
  const c = DES.runsColumns
  if (card.nautilus_runs.length === 0) return <p className="des-note">{DES.runsNone}</p>
  return (
    <table className="nqt-grid des-table">
      <caption className="des-caption">{fillCopy(DES.runsCaption, { name: card.name })}</caption>
      <thead>
        <tr><th scope="col" className="num">{c.number}</th><th scope="col">{c.run}</th><th scope="col">{c.open}</th></tr>
      </thead>
      <tbody>
        {card.nautilus_runs.map((run, i) => (
          <tr key={run}>
            <td className="num muted">{i < MAX_NUMBERED_RUNS ? `${runNumber(i)})` : ''}</td>
            <td className="name">{run}</td>
            <td>
              <button type="button" className="des-link" aria-label={fillCopy(DES.openRun, { run })} onClick={() => requestLine(`${run} RUN`)} {...roving}>
                {DES.runOpen}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function DesLinks({ detail }: DesLinksProps) {
  const confirmations = useConfirmations()
  const sealed = useSealedIndex()
  const strip = spentStrip(detail.card, confirmations.data, sealed.data)
  return (
    <div className="des-page">
      <DesCard title={DES.cards.runs}>
        <RunsTable detail={detail} />
      </DesCard>
      {strip ? <DesSpent card={detail.card} strip={strip} /> : (
        <>
          <p className="des-note">{DES.confirmationsNone}</p>
          <p className="des-note">{DES.sealedNone}</p>
        </>
      )}
    </div>
  )
}
