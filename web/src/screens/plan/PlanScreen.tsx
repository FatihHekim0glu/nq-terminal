// PLAN, the pre-registration planner (research_ux.md item 2). A screen with no context and no data read: the researcher
// types a design (periods a year, the book as n or years, a typed family size beside the registry's, alpha, and
// optionally a Sharpe and an event standard deviation) and the page shows, from GET /api/analytics/plan, the one sided
// Bonferroni and Holm bars at the next slot of the family, the minimum detectable annual Sharpe at alpha and at each
// bar for power 0.80, power at the reference Sharpe 0.50 and the typed one, the observations needed, and for an event
// design the detectable mean per event. SV9's wording: best case, normal and independent returns. Descriptive only.
// The function bar holds 96) Actions and 99) Help; there is no numbered item and no export.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { requestLine } from '../../chrome/CommandLine.bus'
import { AmberField, DropdownField, ParamRow, ReadOnlyValue } from '../../chrome/Field'
import FunctionBar from '../../chrome/FunctionBar'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import { usePanelPage } from '../../chrome/PanelChrome.page'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { PLAN } from '../../copy/plan'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL, fillCopy } from '../../copy/workspace'
import {
  BARS_COLUMNS,
  INITIAL_DRAFT,
  answerSummary,
  barsRows,
  bookLine,
  designColumns,
  designHeaders,
  designRows,
  isPeriods,
  parseDraft,
  type BookBy,
  type PlanDraft,
} from './planModel'
import { PERIODS_OPTIONS, type PlanQuery, type ServedPlan } from './planTypes'
import { usePlan } from './usePlan'
import './plan.css'

/** The wait after the last key before a typed design is asked: a number is rarely one keystroke. */
const DEBOUNCE_MS = 250
const FIELD_WIDTH = '110px'

const PERIOD_CHOICES = PERIODS_OPTIONS.map((p) => ({ value: String(p), label: PLAN.periodsOptions[p] }))
const BY_CHOICES: readonly { readonly value: BookBy; readonly label: string }[] = [
  { value: 'n', label: PLAN.byOptions.n },
  { value: 'years', label: PLAN.byOptions.years },
]

/** The query after it has stood still for `DEBOUNCE_MS`; null while the draft has an unusable field. */
function useSettledQuery(query: PlanQuery | null): PlanQuery | null {
  const key = query === null ? null : JSON.stringify(query)
  const [settled, setSettled] = useState<string | null>(key)
  useEffect(() => {
    if (key === null) {
      setSettled(null)
      return undefined
    }
    const timer = setTimeout(() => setSettled(key), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key])
  return useMemo(() => (settled === null ? null : (JSON.parse(settled) as PlanQuery)), [settled])
}

function Inputs({ draft, set, registry }: {
  readonly draft: PlanDraft
  readonly set: (next: PlanDraft) => void
  readonly registry: string
}) {
  const f = PLAN.fields
  return (
    <>
      <ParamRow label={PLAN.inputsLabel}>
        <DropdownField label={f.periods} value={String(draft.periods)} options={PERIOD_CHOICES}
          onChange={(v) => (isPeriods(Number(v)) ? set({ ...draft, periods: Number(v) as PlanDraft['periods'] }) : undefined)} />
        <DropdownField label={f.by} value={draft.by} options={BY_CHOICES} onChange={(v) => set({ ...draft, by: v as BookBy })} />
        <AmberField label={f.size} value={draft.size} onChange={(v) => set({ ...draft, size: v })} width={FIELD_WIDTH} />
        <AmberField label={f.alpha} value={draft.alpha} onChange={(v) => set({ ...draft, alpha: v })} width={FIELD_WIDTH} />
      </ParamRow>
      <ParamRow label={PLAN.familyLabel}>
        <ReadOnlyValue label={PLAN.registryFamily}>{registry}</ReadOnlyValue>
        <AmberField label={f.k} value={draft.k} placeholder={PLAN.placeholders.k} onChange={(v) => set({ ...draft, k: v })} width="180px" />
        <AmberField label={f.sharpe} value={draft.sharpe} placeholder={PLAN.placeholders.sharpe} onChange={(v) => set({ ...draft, sharpe: v })} width="140px" />
        <AmberField label={f.eventSd} value={draft.eventSd} placeholder={PLAN.placeholders.eventSd} onChange={(v) => set({ ...draft, eventSd: v })} width="220px" />
      </ParamRow>
    </>
  )
}

function BarsTable({ plan }: { readonly plan: ServedPlan }) {
  const rows = useMemo(() => barsRows(plan), [plan])
  return (
    <table className="nqt-grid plan-table">
      <caption>{PLAN.barsCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{PLAN.barsCols.family}</th>
          {BARS_COLUMNS.slice(1).map((col) => <th key={col} scope="col" className="num">{PLAN.barsCols[col]}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.family}</th>
            {BARS_COLUMNS.slice(1).map((col) => <td key={col} className="num">{row[col]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DesignTable({ plan }: { readonly plan: ServedPlan }) {
  const columns = useMemo(() => designColumns(plan), [plan])
  const headers = useMemo(() => designHeaders(), [])
  const rows = useMemo(() => designRows(plan), [plan])
  const [first, ...rest] = columns
  return (
    <table className="nqt-grid plan-table">
      <caption>{PLAN.designCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{headers[first ?? 'test']}</th>
          {rest.map((col) => <th key={col} scope="col" className="num">{headers[col]}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row[first ?? 'test']}</th>
            {rest.map((col) => <td key={col} className="num">{row[col]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Answer({ plan, busy }: { readonly plan: ServedPlan; readonly busy: boolean }) {
  const barsId = useId()
  const designId = useId()
  const busyMark = busy ? true : undefined
  return (
    <>
      <section className="plan-section" aria-labelledby={barsId} aria-busy={busyMark} data-stale={busy ? '' : undefined}>
        <h2 id={barsId} className="plan-heading">{PLAN.barsLabel}</h2>
        <BarsTable plan={plan} />
        <p className="plan-line plan-muted">{PLAN.slotNote}</p>
      </section>
      <section className="plan-section" aria-labelledby={designId} aria-busy={busyMark} data-stale={busy ? '' : undefined}>
        <h2 id={designId} className="plan-heading">{PLAN.designLabel}</h2>
        <DesignTable plan={plan} />
        {plan.event_sd === null ? null : <p className="plan-line plan-muted">{PLAN.eventNote}</p>}
      </section>
      <p className="plan-line">{plan.note}</p>
      <p className="plan-line plan-muted">{PLAN.descriptive}</p>
    </>
  )
}

/** The one polite live region: mounted from the first render (empty text is never inserted with its region), it holds
 * the problem of an invalid draft, the loading line, or the summary of the settled answer. Failures are role=alert. */
function LiveStatus({ draftProblems, result, plan }: {
  readonly draftProblems: readonly string[]
  readonly result: ReturnType<typeof usePlan>
  readonly plan: ServedPlan | undefined
}) {
  const problem = draftProblems.length > 0
  let text: ReactNode = null
  if (problem) text = `${PLAN.invalidLead} ${draftProblems.join(' ')}`
  else if (plan) text = <><span>{bookLine(plan)}</span>{' '}<span>{answerSummary(plan)}</span></>
  else if (!result.isError) text = PLAN.loading
  return <p className={`plan-line${problem ? ' plan-problems' : ''}`} role="status" aria-live="polite" aria-atomic="true">{text}</p>
}

function Failure({ result }: { readonly result: ReturnType<typeof usePlan> }) {
  if (!result.isError || result.data) return null
  return <p className="plan-line plan-problems" role="alert">{fillCopy(PLAN.failed, { detail: result.error.detail })}</p>
}

export default function PlanScreen(_props: ScreenProps) {
  const ref = useRef<HTMLDivElement>(null)
  const page = usePanelPage(ref)
  const panel = usePanelActions()
  const [draft, setDraft] = useState<PlanDraft>(INITIAL_DRAFT)
  const parsed = useMemo(() => parseDraft(draft), [draft])
  const settledQuery = useSettledQuery(parsed.query)
  const result = usePlan(settledQuery)
  const plan = result.data
  // The old tables stay up while the next design is debounced and asked: mark them busy so they are not read as current.
  const busy = parsed.query !== null && (JSON.stringify(parsed.query) !== JSON.stringify(settledQuery) || result.isPlaceholderData || result.isFetching)
  const registry = plan ? (plan.family_k_registry === null ? PLAN.registryUnknown : String(plan.family_k_registry)) : '--'
  return (
    <div className="plan" ref={ref} data-screen="PLAN" role="group" aria-label={PLAN.label}>
      <FunctionBar
        panelId={panel.panelId}
        title={PLAN.title}
        page={page ?? undefined}
        items={[
          {
            n: FUNCTION_NUMBERS.actions,
            label: FUNCTION_BAR.actions,
            menu: [
              { label: PANEL.related, onSelect: () => panel.related() },
              { label: PANEL.back, onSelect: () => panel.back() },
              { label: PANEL.forward, onSelect: () => panel.forward() },
            ],
          },
          { n: FUNCTION_NUMBERS.help, label: FUNCTION_BAR.help, onRun: () => requestLine(PLAN.helpLine) },
        ]}
      />
      <p className="plan-line plan-muted">{PLAN.intro}</p>
      <Inputs draft={draft} set={setDraft} registry={registry} />
      {plan?.registry_note ? <p className="plan-line plan-muted">{plan.registry_note}</p> : null}
      <LiveStatus draftProblems={parsed.problems} result={result} plan={plan} />
      <Failure result={result} />
      {plan && parsed.problems.length === 0 ? <Answer plan={plan} busy={busy} /> : null}
    </div>
  )
}
