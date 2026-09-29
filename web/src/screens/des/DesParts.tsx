// Shared pieces of the DES views (look spec 4.4, 4.5, 7.3): the red function bar with the amber
// hypothesis field, `96) Actions`, `99) Help`, `Page n/m` and the title; the DES cards (20px raised title
// band in white bold, numbered, with an optional `CODE »` jump); bracket badges in their colour; and the
// loading, error and empty states, which name what is missing.
import type { ReactNode } from 'react'
import { useConfirmations, useHypotheses } from '../../api/queries'
import type { ApiError } from '../../api/client'
import { requestLine } from '../../chrome/CommandLine.bus'
import { DropdownField } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import PanelFault from '../../chrome/PanelFault'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { PanelPage } from '../../chrome/PanelChrome.page'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { DES } from '../../copy/des'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import { Inline } from './DesMarkdown'
import '../../grids/grid.css'
import '../../tiles/tiles.css'
import './des.css'

export const roving = { [ROVING_ATTR]: '' }

/** The amber field: every hypothesis and confirmation; choosing one runs `<name> DES`. */
function HypothesisField({ current }: { readonly current: string }) {
  const hypotheses = useHypotheses()
  const confirmations = useConfirmations()
  const names = [
    ...(hypotheses.data ?? []).map((h) => h.name),
    ...(confirmations.data ?? []).map((c) => c.name),
  ]
  const options = (names.includes(current) ? names : [current, ...names]).map((name) => ({ value: name, label: name }))
  return <DropdownField label={DES.field} value={current} options={options} onChange={(name) => requestLine(`${name} DES`)} />
}

export interface DesBarProps {
  readonly title: string
  readonly page: PanelPage | null
  /** The hypothesis or confirmation shown, for the amber field; none on the instrument view. */
  readonly current?: string
  /** 98) Report: saves the description on screen as Markdown; the button shows once there is one. */
  readonly onReport?: () => void
}

export function DesBar({ title, page, current, onReport }: DesBarProps) {
  const actions = usePanelActions()
  return (
    <FunctionBar
      panelId={actions.panelId}
      title={title}
      page={page ?? undefined}
      field={current ? <HypothesisField current={current} /> : undefined}
      items={[
        {
          n: FUNCTION_NUMBERS.actions,
          label: FUNCTION_BAR.actions,
          menu: [
            { label: PANEL.related, onSelect: () => actions.related() },
            { label: PANEL.back, onSelect: () => actions.back() },
            { label: PANEL.forward, onSelect: () => actions.forward() },
          ],
        },
        ...(onReport ? [{ n: FUNCTION_NUMBERS.export, label: DES.report, onRun: onReport }] : []),
        { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(DES.helpLine) },
      ]}
    />
  )
}

export interface JumpProps {
  readonly label: string
  readonly onRun: () => void
  /** The accessible name, when the visible label is a short code such as `EQ »`. */
  readonly name?: string
}

export function Jump({ label, onRun, name }: JumpProps) {
  return (
    <button type="button" className="des-jump" aria-label={name} onClick={onRun} {...roving}>
      {label}
    </button>
  )
}

export interface DesCardProps {
  readonly title: string
  readonly n?: number
  readonly jump?: JumpProps
  readonly className?: string
  readonly testId?: string
  readonly children: ReactNode
}

/** A DES box: 20px title band (number, title, optional jump), then its body. */
export function DesCard({ title, n, jump, className, testId, children }: DesCardProps) {
  return (
    <section className={`nqt-card des-card${className ? ` ${className}` : ''}`} aria-label={title} data-testid={testId}>
      <h3 className="nqt-card-title des-card-title">
        {n !== undefined ? <span className="des-no">{`${n})`}</span> : null}
        <span>{title}</span>
      </h3>
      {jump ? <div className="des-card-jump"><Jump {...jump} /></div> : null}
      <div className="des-card-body">{children}</div>
    </section>
  )
}

const TONES: Readonly<Record<string, string>> = { PASS: 'tone-up', FAIL: 'tone-down', CHECK: 'tone-warn' }

export function VerdictBadge({ badge }: { readonly badge: string }) {
  return <span className={TONES[badge] ?? 'tone-warn'}>{fillCopy(DES.badge, { badge })}</span>
}

const WARN_TAGS: ReadonlySet<string> = new Set([DES.spent, DES.postHoc])

/** A bracket tag; [SPENT] and [POST HOC] carry the warning glyph and colour (look spec 4.8). */
export function Tag({ tag }: { readonly tag: string }) {
  const warn = WARN_TAGS.has(tag)
  return (
    <span className="des-tag" data-warn={warn}>
      {warn ? <span className="des-warn-glyph" aria-hidden="true">{'⚠ '}</span> : null}
      {fillCopy(DES.tag, { tag })}
    </span>
  )
}

export function ShaChecks({ ok, rehash }: { readonly ok: boolean; readonly rehash?: boolean }) {
  return (
    <>
      <span className={ok ? 'tone-up' : 'tone-down'}>{ok ? DES.shaOk : DES.shaBad}</span>
      {rehash === undefined ? null : ' '}
      {rehash === undefined ? null : (
        <span className={rehash ? 'tone-up' : 'tone-down'}>{rehash ? DES.rehashOk : DES.rehashBad}</span>
      )}
    </>
  )
}

export interface PairsProps {
  readonly rows: ReadonlyArray<readonly [string, ReactNode]>
}

/** Amber labels with right-aligned values (look spec 7.3). */
export function Pairs({ rows }: PairsProps) {
  return (
    <dl className="nqt-card-rows des-pairs">
      {rows.map(([label, value]) => (
        <div key={label} className="nqt-card-pair">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Status({ children }: { readonly children: ReactNode }) {
  return <p className="des-status" role="status">{children}</p>
}

export function LoadError({ name, error }: { readonly name: string; readonly error: ApiError | null }) {
  // {detail} is left in the template: PanelFault fills it from the error itself (roadmap #7). DES has
  // its own wording for a 403 too (unchanged text; only the unified amber 403 look comes from
  // PanelFault's default), so refusedText is passed the same template as failedText.
  const text = fillCopy(DES.errorPrefix, { name })
  return <PanelFault className="des-status" error={error} failedText={text} refusedText={text} />
}

/** The guidance an empty DES panel shows, with a runnable example. */
export function DesEmpty({ page }: { readonly page: PanelPage | null }) {
  return (
    <div className="des">
      <DesBar title={DES.emptyTitle} page={page} />
      <p className="des-status"><Inline text={DES.empty} /></p>
    </div>
  )
}
