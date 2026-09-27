// The openings card (UI_SPEC section 7 OOS, look spec 7.10, ANALYTICS_CATALOG RI2): each sealed-window
// opening with who decided it and when, CLOSED or OPEN, its window and symbols, and the gate's own pin
// checks. A pin state is text as well as colour (ok, FAILED, unknown).
import { useOpenings } from '../../api/queries'
import { OPENINGS } from '../../copy/oos'
import { fillCopy } from '../../copy/workspace'
import { openingsCard, type PinStatus } from './oosModel'

function pinClass(pin: PinStatus): string {
  if (pin.ok === null) return 'oos-pin oos-pin-unknown'
  return pin.ok ? 'oos-pin oos-pin-ok' : 'oos-pin oos-pin-bad'
}

function CardBody() {
  const query = useOpenings()
  if (query.isError) return <p className="oos-card-line">{fillCopy(OPENINGS.error, { detail: query.error.detail })}</p>
  if (!query.data) return <p className="oos-card-line">{OPENINGS.loading}</p>
  const card = openingsCard(query.data)
  return (
    <>
      {card.rows.length === 0 ? <p className="oos-card-line">{OPENINGS.none}</p> : null}
      {card.rows.map((row) => (
        <p key={row.key} className="oos-card-line">
          <span className="oos-card-title">{OPENINGS.title}</span> <span>{row.opened}</span>{' '}
          <b className="oos-state">{row.state}</b>
          {row.closed ? <> <span>{row.closed}</span></> : null} <span className="oos-card-muted">{row.caller}</span>{' '}
          <span className="oos-card-muted">{row.window}</span> <span className="oos-card-muted">{row.symbols}</span>
        </p>
      ))}
      <p className="oos-card-line">
        {card.pins.map((pin) => (
          <span key={pin.text} className={pinClass(pin)}>{pin.text}</span>
        ))}
        {card.sealedLines ? <span className="oos-card-muted">{card.sealedLines}</span> : null}
        <span className="oos-spent">
          <span className="oos-warn-glyph" aria-hidden="true">{'⚠'}</span> {OPENINGS.spentTag} {card.label}
        </span>
      </p>
    </>
  )
}

export default function OpeningsCard() {
  return (
    <section className="oos-card" aria-label={OPENINGS.label}>
      <CardBody />
    </section>
  )
}
