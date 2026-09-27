// SpecCard (TASKS 5.4, UI_SPEC sections 6 and 7 DES, look spec 7.3): the registration card of a
// hypothesis, read from the API's HypothesisCard. Tag and verdict are bracketed text in their colour
// ([PASS] up, [FAIL] down, [CHECK] warning), the spec hash shows as `d594...0b74` with its check and
// re-hash, then n, t and the multiple-testing values, and the frozen pass bar verbatim, clamped to four
// lines behind a More toggle.
import { useId, useState, type ReactNode } from 'react'
import type { Schemas } from '../api/types'
import { SPEC } from '../copy/tiles'
import { fillCopy } from '../copy/workspace'
import { ROVING_ATTR } from '../chrome/WorkspaceFocus'
import './tiles.css'

export type SpecCardData = Pick<
  Schemas['HypothesisCard'],
  | 'name' | 'registered' | 'round' | 'verdict' | 'verdict_badge' | 'verdict_note' | 'spec' | 'spec_sha256' | 'spec_sha_ok'
  | 'spec_rehash_ok' | 'n' | 't_stat' | 't_label' | 'p' | 'control_p' | 'bonferroni_p' | 'holm_p' | 'bh_q' | 'confirmations'
>

export interface SpecCardProps {
  readonly card: SpecCardData
  /** The spec's frozen pass bar, verbatim. */
  readonly passBar?: string | null
}

const MISSING = '--'
const SHA_KEEP = 4
const roving = { [ROVING_ATTR]: '' }

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return MISSING
  return sha.length <= SHA_KEEP * 2 ? sha : `${sha.slice(0, SHA_KEEP)}...${sha.slice(-SHA_KEEP)}`
}

const num = (v: number | null | undefined, decimals: number) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(decimals) : MISSING)

const BADGE_TONE: Readonly<Record<SpecCardData['verdict_badge'], string>> = { PASS: 'tone-up', FAIL: 'tone-down', CHECK: 'tone-warn' }

function HashCheck({ card }: { readonly card: SpecCardData }) {
  return (
    <>
      <span className={card.spec_sha_ok ? 'tone-up' : 'tone-down'}>{card.spec_sha_ok ? SPEC.shaOk : SPEC.shaBad}</span>{' '}
      <span className={card.spec_rehash_ok ? undefined : 'tone-down'}>{card.spec_rehash_ok ? SPEC.rehashOk : SPEC.rehashBad}</span>
    </>
  )
}

function Rows({ card }: { readonly card: SpecCardData }) {
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    [SPEC.tag, card.registered ? SPEC.preReg : SPEC.postHoc],
    [SPEC.verdict, <span className={BADGE_TONE[card.verdict_badge]}>{fillCopy(SPEC.badge, { badge: card.verdict_badge })}</span>],
    [SPEC.round, card.round === null ? MISSING : String(card.round)],
    [SPEC.spec, card.spec],
    [SPEC.sha, <span title={card.spec_sha256 ?? undefined}>{shortSha(card.spec_sha256)}</span>],
    [SPEC.shaCheck, <HashCheck card={card} />],
    [SPEC.n, card.n === null ? MISSING : String(card.n)],
    [card.t_label ?? SPEC.t, num(card.t_stat, 2)],
    [SPEC.p, num(card.p, 3)],
    [SPEC.controlP, num(card.control_p, 3)],
    [SPEC.bonferroni, num(card.bonferroni_p, 3)],
    [SPEC.holm, num(card.holm_p, 3)],
    [SPEC.bhq, num(card.bh_q, 3)],
    [SPEC.confirmations, card.confirmations.length > 0 ? card.confirmations.join(', ') : MISSING],
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

function PassBar({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <p id={id} className="nqt-card-prose" data-clamped={!open} data-testid="spec-passbar" aria-label={SPEC.passBar}>{text}</p>
      <div className="nqt-card-foot">
        <button type="button" className="nqt-card-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} {...roving}>
          {open ? SPEC.less : SPEC.more}
        </button>
      </div>
    </>
  )
}

export default function SpecCard({ card, passBar }: SpecCardProps) {
  const titleId = useId()
  const title = `${SPEC.title}: ${card.name}`
  return (
    <section className="nqt-card" aria-labelledby={titleId}>
      <h3 id={titleId} className="nqt-card-title">{title}</h3>
      <Rows card={card} />
      {passBar ? <PassBar text={passBar} /> : null}
    </section>
  )
}
