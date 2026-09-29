// Page 2 of the DES tear sheet with the gating statistic (U15): every pass check as recorded in the screen JSON
// (key verbatim, the key read as text, the boolean result as [PASS] or [FAIL]), the recorded figure the check
// gates on beside it, any recorded value formatted with the headline unit and flagged when its magnitude is
// implausible, then the spec's frozen pass bar in full. It replaces DesChecks on the tab and keeps that page's
// table (caption, one row per check, reading and result cells). Thresholds are not a field of the API, so the
// note says where they come from; nothing on the page is computed.
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { cardTag, passBarText, passCheckRows, type CheckSource, type HypothesisDetail, type PassCheckRow } from './desModel'

export interface DesPassChecksProps {
  readonly detail: HypothesisDetail
}

function Result({ result }: { readonly result: PassCheckRow['result'] }) {
  if (result === 'pass') return <span className="tone-up">{DES.checkPass}</span>
  if (result === 'fail') return <span className="tone-down">{DES.checkFail}</span>
  return <span className="des-muted">{DES.checkValue}</span>
}

/** The figure a boolean check gates on, its unit and bar, and where it was read from. */
function Statistic({ row }: { readonly row: PassCheckRow }) {
  const { source } = row
  if (row.result === 'value') return <span className="des-muted">--</span>
  if (source === null) return <span className="des-muted">{DES.passChecks.statNone}</span>
  return <StatisticText source={source} />
}

function StatisticText({ source }: { readonly source: CheckSource }) {
  return (
    <>
      <span>{source.text}</span>
      {source.unit ? <span className="des-muted">{` ${source.unit}`}</span> : null}
      {source.threshold ? <span className="des-muted">{`, ${fillCopy(DES.passChecks.bar, { threshold: source.threshold })}`}</span> : null}
      <br />
      <span className="des-muted">{`${source.label}, ${fillCopy(DES.passChecks.from, { from: source.from })}`}</span>
    </>
  )
}

function Value({ row }: { readonly row: PassCheckRow }) {
  const { cells } = row
  if (cells.length === 0) return <span className="des-muted">{row.source === null ? DES.checkNone : '--'}</span>
  const first = cells[0]
  if (cells.length === 1 && first?.path === '') {
    return (
      <>
        {first.text}
        {first.flag ? <span className="tone-warn">{` ${first.flag}`}</span> : null}
      </>
    )
  }
  return (
    <dl className="des-flat">
      {cells.map((cell) => (
        <div key={cell.path}>
          <dt>{cell.path}</dt>
          <dd>
            {cell.text}
            {cell.flag ? <span className="tone-warn">{` ${cell.flag}`}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default function DesPassChecks({ detail }: DesPassChecksProps) {
  const { card } = detail
  const rows = passCheckRows(detail)
  const passBar = passBarText(detail.spec)
  const c = DES.checksColumns
  return (
    <div className="des-page">
      {rows.length === 0 ? <p className="des-note">{DES.checksNone}</p> : (
        <table className="nqt-grid des-table des-checks">
          <caption className="des-caption">{fillCopy(DES.checksCaption, { name: card.name })}</caption>
          <thead>
            <tr>
              <th scope="col" className="num">{c.number}</th><th scope="col">{c.key}</th><th scope="col">{c.reading}</th>
              <th scope="col">{c.result}</th><th scope="col">{DES.passChecks.statColumn}</th><th scope="col">{c.value}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="num muted">{`${row.n})`}</td>
                <td><code className="des-key">{row.key}</code></td>
                <td className="name">{row.reading}</td>
                <td><Result result={row.result} /></td>
                <td className="des-value"><Statistic row={row} /></td>
                <td className="des-value"><Value row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="des-note">{DES.thresholdNote}</p>
      <p className="des-note">{fillCopy(DES.passChecks.statNote, { tag: cardTag(card) })}</p>
      <section className="nqt-card des-card" aria-label={DES.passBar}>
        <h3 className="nqt-card-title">{DES.passBar}</h3>
        {passBar ? <pre className="des-prose des-prose-full">{passBar}</pre> : <p className="des-note">{DES.passBarNone}</p>}
      </section>
    </div>
  )
}
