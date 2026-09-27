// RUN tab 7) Config (look spec 7.4): the run's configuration, read only, in numbered sections on
// table-header bars; values in grey boxes, never amber (amber is for real inputs only, 4.5).
import { useId } from 'react'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { RUN } from './copy'
import { configSections, type ConfigSection, type RunDetail } from './runModel'

// The section list scrolls on its own, so it is a roving item: the keyboard can reach and scroll it.
const roving = { [ROVING_ATTR]: '' }

function Section({ section, n }: { readonly section: ConfigSection; readonly n: number }) {
  const id = useId()
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{`${n}. ${section.title}`}</h3>
      {section.pairs.length === 0 ? (
        <p className="run-note">{RUN.config.empty}</p>
      ) : (
        <dl>
          {section.pairs.map((p) => (
            <div key={p.label} className="run-config-pair">
              <dt>{p.label}</dt>
              <dd>{p.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default function RunConfig({ detail }: { readonly detail: RunDetail }) {
  return (
    <section className="run-config" aria-label={RUN.config.label} tabIndex={0} {...roving}>
      {configSections(detail).map((s, i) => (
        <Section key={s.id} section={s} n={i + 1} />
      ))}
    </section>
  )
}
