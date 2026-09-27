// The RUN header (look spec 7.4, first rows): the facts row (Nautilus version, elapsed, venue, fill
// model, cost per side) as read-only grey boxes; the check strip (tags, balance, MTM, coverage,
// anchor) in text and colour; and the ledger row with the copy-only `ledger_append` command exactly as
// the API gives it. The terminal never runs that command; Copy only puts it on the clipboard.
import { Fragment } from 'react'
import { postMessage } from '../../chrome/MessageLine.store'
import { ReadOnlyValue } from '../../chrome/Field'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import { readBalance } from '../../tiles/BalanceCheck'
import { BADGE, RUN } from '../../copy/runs'
import { balanceBadge, checkText, checkTone, runTags } from './model'
import { coverageOf, runFacts, type RunDetail } from './runModel'

const roving = { [ROVING_ATTR]: '' }

export function RunFacts({ detail }: { readonly detail: RunDetail }) {
  return (
    <div className="run-strip" role="group" aria-label={RUN.header.label}>
      {runFacts(detail).map((f) => (
        <span key={f.label} className="run-fact">
          <ReadOnlyValue label={f.label}>{f.value}</ReadOnlyValue>
        </span>
      ))}
    </div>
  )
}

function Check({ label, text, tone }: { readonly label: string; readonly text: string; readonly tone: string | undefined }) {
  return (
    <span>
      {label} <span className={tone ? `tone-${tone}` : undefined}>{text}</span>
    </span>
  )
}

export function RunChecks({ detail }: { readonly detail: RunDetail }) {
  const b = readBalance(detail.balance_check)
  const badge = balanceBadge(b.ok)
  const coverage = coverageOf(detail.coverage_check)
  const anchor = detail.anchor
  const parts = [
    <Check key="b" label={RUN.checks.balance} text={badge.text} tone={badge.tone} />,
    <Check key="m" label={RUN.checks.mtm} text={checkText(b.mtm?.ok ?? detail.summary.mtm_ok)} tone={checkTone(b.mtm?.ok ?? detail.summary.mtm_ok)} />,
    <Check key="c" label={RUN.checks.coverage} text={coverage ?? checkText(detail.summary.coverage_ok)} tone={checkTone(detail.summary.coverage_ok)} />,
    <span key="a" className="run-anchor" data-testid="run-anchor">{fillCopy(RUN.anchor, { verdict: anchor?.verdict ?? BADGE.none })}</span>,
  ]
  return (
    <div className="run-strip">
      {runTags(detail.summary).map((tag) => (
        <span key={tag} className="run-tag">{tag}</span>
      ))}
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="run-strip-sep" aria-hidden="true">|</span> : null}
          {part}
        </Fragment>
      ))}
      {anchor?.base ? <span className="run-anchor">{fillCopy(RUN.anchorOf, { base: anchor.base })}</span> : null}
    </div>
  )
}

function copyCommand(command: string): void {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard) {
    postMessage(RUN.ledger.copyFailed, 'error')
    return
  }
  clipboard.writeText(command).then(
    () => postMessage(RUN.ledger.copied),
    () => postMessage(RUN.ledger.copyFailed, 'error'),
  )
}

export function LedgerRow({ detail }: { readonly detail: RunDetail }) {
  const L = RUN.ledger
  const cmd = detail.ledger_command
  const ledgered = detail.summary.ledger
  return (
    <div className="run-ledger" role="group" aria-label={L.label}>
      <span className="run-ledger-label">{L.label}</span>
      {ledgered ? <span className="run-tag">{fillCopy(L.ledgered, { exp: ledgered.exp_id, ts: ledgered.ts_utc })}</span> : null}
      {cmd.eligible && cmd.command ? (
        <>
          <span className="sr-only">{L.command}</span>
          <code className="run-ledger-cmd" data-testid="ledger-command">{cmd.command}</code>
          <button type="button" className="run-btn" aria-label={L.copyLabel} onClick={() => copyCommand(cmd.command ?? '')} {...roving}>
            {L.copy}
          </button>
          <span className="run-ledger-hint">{fillCopy(L.cwd, { cwd: cmd.cwd })}</span>
          {cmd.exp_id_source === 'placeholder' ? <span className="run-ledger-hint">{L.placeholder}</span> : null}
        </>
      ) : (
        <span className="run-ledger-hint">{fillCopy(L.notEligible, { reasons: cmd.reasons.join('; ') || BADGE.none })}</span>
      )}
    </div>
  )
}

export { copyCommand }
