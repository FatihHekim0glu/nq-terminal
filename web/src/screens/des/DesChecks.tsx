// Page 2 of the DES tear sheet: every pass check as recorded in the screen JSON (key verbatim, the key
// read as text, the boolean result as [PASS] or [FAIL], and any recorded value), then the spec's frozen
// pass bar in full. Thresholds are not a field of the API, so the note says where they come from.
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { checkRows, passBarText, type HypothesisDetail } from './desModel'

export interface DesChecksProps {
  readonly detail: HypothesisDetail
}

function Result({ result }: { readonly result: 'pass' | 'fail' | 'value' }) {
  if (result === 'pass') return <span className="tone-up">{DES.checkPass}</span>
  if (result === 'fail') return <span className="tone-down">{DES.checkFail}</span>
  return <span className="des-muted">{DES.checkValue}</span>
}

function Value({ value }: { readonly value: ReadonlyArray<readonly [string, string]> }) {
  if (value.length === 0) return <span className="des-muted">{DES.checkNone}</span>
  if (value.length === 1 && value[0]?.[0] === '') return <>{value[0]?.[1]}</>
  return (
    <dl className="des-flat">
      {value.map(([path, text]) => (
        <div key={path}>
          <dt>{path}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function DesChecks({ detail }: DesChecksProps) {
  const { card } = detail
  const rows = checkRows(card.pass_checks, 1)
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
              <th scope="col">{c.result}</th><th scope="col">{c.value}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="num muted">{`${row.n})`}</td>
                <td><code className="des-key">{row.key}</code></td>
                <td className="name">{row.reading}</td>
                <td><Result result={row.result} /></td>
                <td className="des-value"><Value value={row.value} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="des-note">{DES.thresholdNote}</p>
      <section className="nqt-card des-card" aria-label={DES.passBar}>
        <h3 className="nqt-card-title">{DES.passBar}</h3>
        {passBar ? <pre className="des-prose des-prose-full">{passBar}</pre> : <p className="des-note">{DES.passBarNone}</p>}
      </section>
    </div>
  )
}
