// The self-test page's view of its own run (D7.2): a heading, the state, the click the clipboard and save probes want, three
// tables (goldens, probes, axe) and the raw report. Plain HTML with the terminal's tokens, so axe judges real markup. The
// dockview probe draws into its own section here. The report itself is `window.__selftest`; this view only shows it.
import { useEffect, useRef, useState } from 'react'
import { GOLDEN_NAMES, GOLDEN_TOLERANCE, PROBE_NAMES, type SelfTestReport } from './report.ts'
import { startSelfTest, type Session } from './session.ts'

const STATE_WORDS = {
  running: 'Running the self-test.',
  'awaiting-gesture': 'Waiting for a click: the clipboard and the save need one.',
  done: 'The self-test has finished.',
} as const

/** The published report is a JSON copy, which writes an Infinity error as null; show that as a word, never throw on it. */
function worstError(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toExponential(2) : 'not finite'
}

export function GoldenTable({ report }: { readonly report: SelfTestReport | null }) {
  return (
    <table className="selftest-table" data-nqt-selftest-table="goldens">
      <caption>Quant goldens, within {GOLDEN_TOLERANCE} relative</caption>
      <thead>
        <tr><th scope="col">Golden</th><th scope="col">Checks</th><th scope="col">Worst error</th><th scope="col">Result</th></tr>
      </thead>
      <tbody>
        {GOLDEN_NAMES.map((name) => {
          const row = report?.goldens.find((g) => g.name === name)
          return (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{row?.checks ?? 'pending'}</td>
              <td>{row === undefined ? 'pending' : worstError(row.maxRelativeError)}</td>
              <td>{row === undefined ? 'pending' : row.passed ? 'pass' : `FAIL ${row.firstFailure ?? ''}`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ProbeTable({ report }: { readonly report: SelfTestReport | null }) {
  return (
    <table className="selftest-table" data-nqt-selftest-table="probes">
      <caption>Feature probes</caption>
      <thead>
        <tr><th scope="col">Probe</th><th scope="col">Result</th><th scope="col">What it saw</th></tr>
      </thead>
      <tbody>
        {PROBE_NAMES.map((name) => {
          const row = report?.probes.find((p) => p.name === name)
          return (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{row === undefined ? 'pending' : row.status}</td>
              <td>{row?.detail ?? ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function AxeSummary({ report }: { readonly report: SelfTestReport | null }) {
  const axe = report?.axe ?? null
  return (
    <section aria-labelledby="selftest-axe">
      <h2 id="selftest-axe">Accessibility (axe, WCAG 2.2 AA)</h2>
      <p>{axe === null ? 'axe runs last, once every probe has finished.' : `axe ${axe.version}: ${axe.violations.length} violations, ${axe.passes} rules passed, ${axe.incomplete} undecided.`}</p>
      {axe !== null && axe.violations.length > 0 ? (
        <ul>{axe.violations.map((v) => <li key={v.id}>{v.id} ({v.impact}): {v.help}, {v.nodes} elements</li>)}</ul>
      ) : null}
    </section>
  )
}

export default function SelfTestApp({ autoGesture }: { readonly autoGesture: boolean }) {
  const [report, setReport] = useState<SelfTestReport | null>(null)
  const dockHost = useRef<HTMLDivElement>(null)
  const session = useRef<Session | null>(null)

  useEffect(() => {
    if (session.current !== null || dockHost.current === null) return
    session.current = startSelfTest({ dockview: dockHost.current }, setReport, autoGesture)
  }, [autoGesture])

  const state = report?.state ?? 'running'
  return (
    <main className="selftest" data-nqt-selftest={state}>
      <h1>Self-test</h1>
      <p role="status">{STATE_WORDS[state]}</p>
      {state === 'awaiting-gesture' ? (
        <button type="button" className="selftest-button" onClick={() => session.current?.release()}>Run the clipboard and export probes</button>
      ) : null}
      <GoldenTable report={report} />
      <ProbeTable report={report} />
      <section aria-labelledby="selftest-dock">
        <h2 id="selftest-dock">Dockview layout probe</h2>
        <div ref={dockHost} className="selftest-dock" />
      </section>
      <AxeSummary report={report} />
      <section aria-labelledby="selftest-json">
        <h2 id="selftest-json">Report</h2>
        <pre className="selftest-json" role="region" tabIndex={0} aria-label="The report as JSON">{JSON.stringify(report, null, 1)}</pre>
      </section>
    </main>
  )
}
