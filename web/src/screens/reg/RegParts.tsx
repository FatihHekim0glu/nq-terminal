// The parts of REG around its grid (look spec 7.2): the round rail on the left (#1E1E1E), the
// selected screening criteria with their matches, and the sealed confirmations block with their own
// alpha. Every button is a roving item of the panel and a numbered item (Number <GO>): criteria from
// 51), rounds from 61), confirmations from 81), so they never clash with the grid's 1) to N).
import type { ReactNode } from 'react'
import type { ApiError } from '../../api/client'
import PanelFault from '../../chrome/PanelFault'
import { useNumbered } from '../../chrome/PanelChrome.numbers'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { CONFIRM, REG } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'
import type { Schemas } from '../../api/types'
import {
  acceptanceLine, acceptanceRows, badgeText, formatCount, formatPValue, shortSha, verdictTone,
  type ConfirmRow, type Criterion, type CriterionId, type RegRow, type RoundGroup, type RoundKey,
} from './regModel'

export const CRITERIA_START = 51
export const RAIL_START = 61
export const CONFIRM_START = 81

const roving = { [ROVING_ATTR]: '' }

type FilterCriterion = Exclude<CriterionId, 'rows'>

interface RailProps {
  readonly panelId: string
  readonly groups: readonly RoundGroup[]
  readonly selected: RoundKey
  readonly onSelect: (key: RoundKey) => void
}

export function RoundRail({ panelId, groups, selected, onSelect }: RailProps) {
  useNumbered(panelId, 'reg-rail', groups.map((g, i) => ({ n: RAIL_START + i, label: g.label, run: () => onSelect(g.key) })))
  return (
    <nav className="reg-rail" aria-label={REG.railLabel}>
      <p className="reg-rail-head" aria-hidden="true">{REG.railHeading}</p>
      <ul>
        {groups.map((g, i) => (
          <li key={g.key}>
            <button type="button" className="reg-item" aria-pressed={selected === g.key} onClick={() => onSelect(g.key)} {...roving}>
              <span className="reg-n">{`${RAIL_START + i})`}</span>{' '}
              <span className="reg-label">{fillCopy(REG.railItem, { label: g.label, count: g.count })}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

interface CriteriaProps {
  readonly panelId: string
  readonly items: readonly Criterion[]
  readonly selected: FilterCriterion | null
  readonly onToggle: (id: FilterCriterion) => void
  readonly tag: ReactNode
}

const countText = (c: Criterion): string => formatCount(c.count)

export function CriteriaBlock({ panelId, items, selected, onToggle, tag }: CriteriaProps) {
  const universe = items.find((c) => c.id === 'rows')
  const filters = items.filter((c): c is Criterion & { id: FilterCriterion } => c.id !== 'rows')
  useNumbered(panelId, 'reg-criteria', filters.map((c, i) => ({ n: CRITERIA_START + i, label: c.label, run: () => onToggle(c.id) })))
  return (
    <section className="reg-criteria" aria-label={REG.criteriaLabel}>
      <p className="reg-crit-head">
        <span className="reg-crit-title">{REG.criteriaHeading}</span> {tag}{' '}
        <span className="reg-muted">{REG.criteriaSource}</span>
        <span className="reg-crit-matches">{REG.matches}</span>
      </p>
      {universe ? (
        <p className="reg-crit-row reg-universe">
          <span className="reg-crit-label">{universe.label}</span>
          <span className="reg-crit-count">{countText(universe)}</span>
        </p>
      ) : null}
      <ul className="reg-crit-list">
        {filters.map((c, i) => (
          <li key={c.id}>
            <button type="button" className="reg-crit-row reg-item" aria-pressed={selected === c.id} onClick={() => onToggle(c.id)} {...roving}>
              <span className="reg-n">{`${CRITERIA_START + i})`}</span>{' '}
              <span className="reg-crit-label">{c.label}</span>{' '}
              <span className="reg-crit-count">{countText(c)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The verdict notes of the rows shown (`dtsmom_v0: multi-asset universe ...`), nothing when none has one. */
export function VerdictNotes({ rows }: { readonly rows: readonly RegRow[] }) {
  const noted = rows.filter((r) => r.note !== null && r.note !== '')
  const overlay = rows.some((r) => r.tag === 'overlay')
  if (noted.length === 0 && !overlay) return null
  return (
    <ul className="reg-notes" aria-label={REG.notesLabel}>
      {overlay ? <li className="reg-muted">{REG.overlayNote}</li> : null}
      {noted.map((r) => (
        <li key={r.name}>
          <span className="name">{r.name}</span>{REG.noteSeparator}
          <span className="reg-muted">{r.note}</span>
        </li>
      ))}
    </ul>
  )
}

/** The accepted amendments (results/amendment_acceptances.md), each file re-hashed now (look spec 7.2 house block). */
export function AcceptanceBlock({ acceptances }: { readonly acceptances: Schemas['AmendmentAcceptances'] | undefined }) {
  if (!acceptances) return null
  const rows = acceptanceRows(acceptances)
  const A = REG.accept
  const heads = [A.cols.file, A.cols.spec, A.cols.rows, A.cols.accepted, A.cols.now, A.cols.unchanged]
  return (
    <section className="reg-confirm" aria-label={A.label}>
      <p className="reg-band">
        <span className="reg-band-title">{A.heading}</span>{' '}
        <span className={acceptances.all_unchanged || !acceptances.found ? 'reg-accept-line' : 'reg-accept-line down'}>{acceptanceLine(acceptances)}</span>
      </p>
      {rows.length > 0 ? (
        <div className="nqt-grid-scroll nqt-grid-scroll--panel reg-confirm-scroll">
          <table className="nqt-grid reg-confirm-table">
            <thead>
              <tr>{heads.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.file}>
                  <td className="name">{r.file}</td>
                  <td>{r.spec}</td>
                  <td>{r.rows}</td>
                  <td>{r.accepted}</td>
                  <td>{r.now}</td>
                  <td className={r.unchanged ? 'up' : 'down'}>{r.unchanged ? A.yes : A.no}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

interface ConfirmProps {
  readonly panelId: string
  readonly rows: readonly ConfirmRow[] | null
  readonly error: ApiError | null
  readonly onOpen: (name: string) => void
}

function ConfirmTable({ rows, onOpen }: { readonly rows: readonly ConfirmRow[]; readonly onOpen: (name: string) => void }) {
  const C = CONFIRM.cols
  const heads = [C.name, C.parent, C.n, C.p, C.alpha, C.verdict, C.sha, C.hash, C.opening, C.label]
  const numeric = new Set<string>([C.n, C.p, C.alpha])
  return (
    <div className="nqt-grid-scroll nqt-grid-scroll--panel reg-confirm-scroll">
      <table className="nqt-grid reg-confirm-table">
        <thead>
          <tr>{heads.map((h) => <th key={h} scope="col" className={numeric.has(h) ? 'num' : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name}>
              <td className="name">
                <span className="reg-n">{`${CONFIRM_START + i})`}</span>{' '}
                <button type="button" className="reg-link" aria-label={fillCopy(REG.actions.openDes, { name: r.name })} onClick={() => onOpen(r.name)} {...roving}>
                  {r.name}
                </button>
              </td>
              <td className="name">{r.parent ?? '--'}</td>
              <td className="num">{formatCount(r.n)}</td>
              <td className="num">{formatPValue(r.p)}</td>
              <td className="num">{r.alpha === null ? '--' : String(r.alpha)}</td>
              <td className={verdictTone(r.badge)}>{badgeText(r.badge)}</td>
              <td>{shortSha(r.sha)}</td>
              <td className={r.shaOk ? undefined : 'down'}>{r.shaOk ? REG.hash.ok : REG.hash.registry}</td>
              <td>{r.closed ? CONFIRM.closed : CONFIRM.open}</td>
              <td className="reg-muted">{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ConfirmBlock({ panelId, rows, error, onOpen }: ConfirmProps) {
  useNumbered(panelId, 'reg-confirm', (rows ?? []).map((r, i) => ({ n: CONFIRM_START + i, label: r.name, run: () => onOpen(r.name) })))
  let body: ReactNode
  if (error !== null) body = <PanelFault error={error} failedText={CONFIRM.failed} className="reg-msg" />
  else if (rows === null) body = null
  else if (rows.length === 0) body = <p className="reg-msg">{CONFIRM.empty}</p>
  else body = <ConfirmTable rows={rows} onOpen={onOpen} />
  return (
    <section className="reg-confirm" aria-label={CONFIRM.label}>
      <p className="reg-band">
        <span className="reg-band-title">{CONFIRM.heading}</span>{' '}
        <span className="reg-warn">{`[${CONFIRM.spent}]`}</span>{' '}
        <span className="reg-muted">{CONFIRM.note}</span>
      </p>
      {body}
    </section>
  )
}
