// A strip of labelled values (look spec 7.11 top lines): amber label, white value, and the tone as a
// colour only on top of the words (on, FAIL, yes), so colour is never the only cue.
import type { StateItem } from './liveModel'

export default function StateStrip({ label, items }: { readonly label: string; readonly items: readonly StateItem[] }) {
  return (
    <ul className="live-strip" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="live-item" data-key={i.key}>
          <span className="live-label">{i.label}</span>{' '}
          <b className={i.tone ? `live-value live-${i.tone}` : 'live-value'}>{i.value}</b>
        </li>
      ))}
    </ul>
  )
}
