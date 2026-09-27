// BalanceCheck (TASKS 5.4, UI_SPEC sections 6 and 7 RUN, look spec 7.4, nq-lab rule 4): a run's
// balance reconciliation. The summary line reads `Balance [OK] diff 0.00 USD | MTM [OK] ... |
// Coverage 15/15 | Anchor IDENTICAL`; the card lists the reconciliation in USD. A failed check marks
// the run [UNUSABLE: BALANCE] and says in words that its equity is not drawn. `balance_check` comes
// from result.json through the API as an open dict, so every field is read defensively, and a
// missing or malformed `ok` is NOT RECORDED, never a pass.
import { Fragment, useId, type ReactNode } from 'react'
import { BALANCE } from '../copy/tiles'
import { fillCopy } from '../copy/workspace'
import './tiles.css'

type Dict = Readonly<Record<string, unknown>>

export interface MtmCheck {
  readonly ok: boolean | null
  readonly maxAbsDiffUsd: number | null
  readonly nBad: number | null
  readonly rows: number | null
}

export interface BalanceReading {
  readonly ok: boolean | null
  readonly diffUsd: number | null
  readonly startingUsd: number | null
  readonly finalUsd: number | null
  readonly deltaUsd: number | null
  readonly realisedUsd: number | null
  readonly tradeListUsd: number | null
  readonly openPositions: number | null
  readonly mtm: MtmCheck | null
}

export interface BalanceCheckProps {
  /** `balance_check` from the run detail. */
  readonly check: Dict
  /** `coverage_check` from the run detail, if any. */
  readonly coverage?: Dict | null
  /** Anchor comparison status, e.g. IDENTICAL. */
  readonly anchor?: string | null
  readonly runId?: string
}

const MISSING = '--'
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const dict = (v: unknown): Dict | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null)

export function readBalance(check: Dict): BalanceReading {
  const mtm = dict(check.mtm)
  return {
    ok: flag(check.ok),
    diffUsd: num(check.diff_usd),
    startingUsd: num(check.starting_usd),
    finalUsd: num(check.final_usd),
    deltaUsd: num(check.delta_usd),
    realisedUsd: num(check.realized_sum_usd),
    tradeListUsd: num(check.trade_list_sum_usd),
    openPositions: num(check.open_positions),
    mtm: mtm ? { ok: flag(mtm.ok), maxAbsDiffUsd: num(mtm.max_abs_diff_usd), nBad: num(mtm.n_bad), rows: num(mtm.rows) } : null,
  }
}

const usd = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function money(v: number | null, signed = false): string {
  if (v === null) return MISSING
  const text = usd.format(v)
  return signed && v > 0 && text !== '0.00' ? `+${text}` : text
}

function Status({ ok }: { readonly ok: boolean | null }) {
  if (ok === null) return <span className="tone-muted">{BALANCE.missing}</span>
  return <span className={ok ? 'tone-up' : 'tone-down'}>{ok ? BALANCE.ok : BALANCE.fail}</span>
}

function coverageText(coverage: Dict | null | undefined): string | null {
  if (!coverage) return null
  const total = num(coverage.sessions) ?? num(coverage.nights)
  const done = num(coverage.processed) ?? num(coverage.n_trades)
  return total === null || done === null ? null : fillCopy(BALANCE.coverageValue, { done, total })
}

function Summary({ b, coverage, anchor }: { readonly b: BalanceReading; readonly coverage: string | null; readonly anchor?: string | null }) {
  const parts: ReactNode[] = [
    <>{BALANCE.balance} <Status ok={b.ok} /> {fillCopy(BALANCE.diff, { value: money(b.diffUsd) })}</>,
  ]
  if (b.mtm) parts.push(<>{BALANCE.mtm} <Status ok={b.mtm.ok} /> {fillCopy(BALANCE.mtmDiff, { value: money(b.mtm.maxAbsDiffUsd), bad: b.mtm.nBad ?? MISSING })}</>)
  if (coverage) parts.push(<>{BALANCE.coverage} {coverage}</>)
  if (anchor) parts.push(<>{BALANCE.anchor} {anchor}</>)
  return (
    <p className="nqt-card-summary" data-testid="balance-summary">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="sep"> | </span> : null}
          {part}
        </Fragment>
      ))}
    </p>
  )
}

function Rows({ b }: { readonly b: BalanceReading }) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    [BALANCE.starting, money(b.startingUsd)],
    [BALANCE.final, money(b.finalUsd)],
    [BALANCE.delta, money(b.deltaUsd, true)],
    [BALANCE.realised, money(b.realisedUsd, true)],
    [BALANCE.tradeList, money(b.tradeListUsd, true)],
    [BALANCE.difference, money(b.diffUsd)],
    [BALANCE.openPositions, b.openPositions === null ? MISSING : String(b.openPositions)],
    ...(b.mtm ? [[BALANCE.mtmRows, b.mtm.rows === null ? MISSING : String(b.mtm.rows)] as const] : []),
  ]
  return (
    <dl className="nqt-card-rows">
      {rows.map(([label, value]) => (
        <div key={label} className="nqt-card-pair">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function BalanceCheck({ check, coverage, anchor, runId }: BalanceCheckProps) {
  const titleId = useId()
  const b = readBalance(check)
  return (
    <section className="nqt-card" aria-labelledby={titleId}>
      <h3 id={titleId} className="nqt-card-title">{runId ? `${BALANCE.title}: ${runId}` : BALANCE.title}</h3>
      <Summary b={b} coverage={coverageText(coverage)} anchor={anchor} />
      <Rows b={b} />
      {b.ok === false ? (
        <p className="nqt-card-alert" role="note">
          <span className="tag">{BALANCE.unusableTag}</span> {BALANCE.unusable}
        </p>
      ) : null}
    </section>
  )
}
