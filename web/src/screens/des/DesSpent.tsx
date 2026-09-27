// The in-sample against sealed strip (UI_SPEC sections 6 and 7 "DES"): the registered in-sample test beside
// each sealed-window confirmation that tested it, with the confirmation's own alpha, and the sealed files
// that belong to the hypothesis. Everything here is [SPENT]: the window was opened once on 2026-09-26 and is
// descriptive only; the label is the API's own text.
import { requestLine } from '../../chrome/CommandLine.bus'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { formatNumber, verdictBadge, type HypothesisCard, type SpentStrip } from './desModel'
import { confirmationNumber } from './desNumbers'
import { Tag, VerdictBadge, roving } from './DesParts'

export interface DesSpentProps {
  readonly card: HypothesisCard
  readonly strip: SpentStrip
}

const P_DECIMALS = 4
const ALPHA_DECIMALS = 2

export function Comparison({ card, strip }: DesSpentProps) {
  const c = DES.spentColumns
  return (
    <table className="nqt-grid des-table">
      <caption className="sr-only">{fillCopy(DES.confirmationsCaption, { name: card.name })}</caption>
      <thead>
        <tr>
          <th scope="col">{c.row}</th><th scope="col">{c.window}</th><th scope="col" className="num">{c.n}</th>
          <th scope="col" className="num">{c.p}</th><th scope="col" className="num">{c.alpha}</th><th scope="col">{c.verdict}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="name">{DES.inSample}</th>
          <td>{DES.inSampleWindow}</td>
          <td className="num">{card.n ?? '--'}</td>
          <td className="num">{formatNumber(card.p, P_DECIMALS)}</td>
          <td className="num">--</td>
          <td><VerdictBadge badge={card.verdict_badge} /></td>
        </tr>
        {strip.confirmations.map((conf, i) => (
          <tr key={conf.name}>
            <th scope="row" className="name">
              <span className="des-no">{`${confirmationNumber(i)})`}</span>{' '}
              <button type="button" className="des-link" aria-label={fillCopy(DES.openConfirmation, { name: conf.name })} onClick={() => requestLine(`${conf.name} DES`)} {...roving}>
                {conf.name}
              </button>
            </th>
            <td>{DES.sealedWindow}</td>
            <td className="num">{conf.n ?? '--'}</td>
            <td className="num">{formatNumber(conf.p, P_DECIMALS)}</td>
            <td className="num">{formatNumber(conf.alpha, ALPHA_DECIMALS)}</td>
            <td><VerdictBadge badge={verdictBadge(conf.verdict)} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SealedFiles({ card, strip }: DesSpentProps) {
  const c = DES.sealedColumns
  if (strip.sealed.length === 0) return null
  return (
    <table className="nqt-grid des-table">
      <caption className="sr-only">{fillCopy(DES.sealedCaption, { name: card.name })}</caption>
      <thead>
        <tr><th scope="col">{c.name}</th><th scope="col">{c.kind}</th><th scope="col">{c.label}</th></tr>
      </thead>
      <tbody>
        {strip.sealed.map((s) => (
          <tr key={s.name}>
            <td className="name">{s.name}</td>
            <td>{s.kind ?? '--'}</td>
            <td>{s.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function DesSpent({ card, strip }: DesSpentProps) {
  return (
    <section className="des-spent" aria-label={DES.spentStrip} data-testid="des-spent">
      <h3 className="des-spent-title">
        <Tag tag={DES.spent} /> <span>{DES.spentStrip}</span> <span className="des-spent-label">{strip.label}</span>
      </h3>
      <div className="des-spent-body">
        {strip.confirmations.length > 0 ? <Comparison card={card} strip={strip} /> : null}
        <SealedFiles card={card} strip={strip} />
      </div>
    </section>
  )
}
