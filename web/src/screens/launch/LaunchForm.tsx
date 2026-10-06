// The Start from form (a region on LEDG and RUN): the named parameters of a registered strategy, typed, with the allowed
// range shown, a summary of the run and Launch, which posts to the actions route. It is keyboard first: it takes focus
// on its first parameter, Enter in a field (or Control with Enter anywhere) launches, Escape closes, the arrow keys
// move between the controls like in every panel. A problem is shown next to its field (aria-describedby, aria-invalid)
// and counted in one status line; Launch stays unavailable while any problem remains, while a request is in flight and
// while the runner is off or the queue is full. It is aria-disabled, never disabled, so it can still be focused and its
// reasons heard; pressing it, or Enter in a field, says the reason again and moves focus to the first invalid field.
// One always-mounted status region carries the stopped reason and the problem count: it is filled after it is mounted
// (a region inserted already holding text is not reliably announced) and refilled when the owner is refused. The run is checked here with the server's own rules (model.ts) and
// again by the server. A run that differs from its preset, or starts from a preset that no spec hash backs, carries the
// OFF SPEC warning, never a block; the preset's spec file and sha256 are shown above it. The form writes nothing
// itself: Launch queues the run in JOBS, and the run writes backtests/output like any queued run.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { DropdownField, type FieldOption } from '../../chrome/Field'
import { requestLine } from '../../chrome/CommandLine.bus'
import { postMessage } from '../../chrome/MessageLine.store'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { LAUNCH } from '../../copy/launch'
import { fillCopy } from '../../copy/workspace'
import { FieldShell, ParamControl, TextBox } from './LaunchFields'
import { failureDetail } from './launchClient'
import {
  checkLaunch,
  fieldsOf,
  initialDraft,
  matchPreset,
  paramKey,
  presetValue,
  rangeHint,
  seedFromPreset,
  seedLabel,
  serverFieldKey,
  shownValue,
  specView,
  type LaunchDraft,
} from './model'
import type { LaunchSeed, Preset, StrategySpec } from './types'
import { useLaunchAction } from './useLaunch'
import './launch.css'

const roving = { [ROVING_ATTR]: '' }
const SELF = 'self'
/** The pause between emptying the status region and refilling it, so an unchanged reason is announced again. */
const REPEAT_MS = 60

export interface LaunchFormProps {
  readonly seed: LaunchSeed
  /** The parameters of every strategy the queue can run, as the presets route served them (empty when it could not be read). */
  readonly strategies: readonly StrategySpec[]
  readonly presets: readonly Preset[]
  /** Why the presets or ranges are missing, in words, or null. */
  readonly presetsNote: string | null
  /** Every run id a job or a run already uses. */
  readonly taken: ReadonlySet<string>
  /** Why a run cannot be launched now (the runner is off, the queue is full), in words, or null. */
  readonly blocked: string | null
  readonly onPick: (seed: LaunchSeed) => void
  /** True when this form replaced another through the preset picker: focus returns to the picker, not the first parameter (WCAG 3.2.2). */
  readonly fromPicker?: boolean
  readonly onClose: () => void
}

interface Edits {
  readonly top: Partial<Omit<LaunchDraft, 'values'>>
  readonly values: Readonly<Record<string, string>>
}

interface ServerProblem {
  readonly detail: string
  readonly key: string | null
}

const NO_EDITS: Edits = { top: {}, values: {} }

function changesText(n: number): string {
  if (n === 0) return LAUNCH.changesNone
  return n === 1 ? LAUNCH.changesOne : fillCopy(LAUNCH.changesMany, { n })
}

/** Why the form cannot launch yet, or null: the preset list is missing, the run is not a preset, or the server would refuse the preset. */
function presetBlock(presetsNote: string | null, preset: Preset | null): string | null {
  if (presetsNote === LAUNCH.presetsLoading) return null
  if (presetsNote !== null) return LAUNCH.needsPresets
  if (preset === null) return LAUNCH.notPreset
  return preset.launchable ? null : fillCopy(LAUNCH.notLaunchable, { reasons: preset.reasons.join('; ') })
}

function PresetPicker({ seed, presets, onPick }: Pick<LaunchFormProps, 'seed' | 'presets' | 'onPick'>) {
  const uid = useId()
  const others = presets.filter((p) => matchPreset(seed, [p]) === null)
  if (others.length === 0) return null
  const options: readonly FieldOption[] = [
    { value: SELF, label: fillCopy(LAUNCH.presetSelf, { label: seedLabel(seed) }) },
    ...others.map((p, i) => ({ value: String(i), label: fillCopy(LAUNCH.presetItem, { label: seedLabel(seedFromPreset(p)) }) })),
  ]
  const choose = (value: string) => {
    const hit = others[Number(value)]
    if (value !== SELF && hit !== undefined) onPick(seedFromPreset(hit))
  }
  return (
    <FieldShell id={`${uid}-preset`} label={LAUNCH.presetLabel} hint={LAUNCH.presetHint} custom picker>
      {() => <DropdownField label={LAUNCH.presetLabel} value={SELF} options={options} onChange={choose} />}
    </FieldShell>
  )
}

function Queued({ runId, onAnother, onClose }: { readonly runId: string; readonly onAnother: () => void; readonly onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <div className="launch-done">
      <p className="launch-note" role="status">{fillCopy(LAUNCH.queued, { runId })}</p>
      <div className="launch-actions">
        <button ref={first} type="button" className="launch-button" onClick={() => requestLine('JOBS')} {...roving}>{LAUNCH.openJobs}</button>
        <button type="button" className="launch-button" onClick={onAnother} {...roving}>{LAUNCH.another}</button>
        <button type="button" className="launch-button" onClick={onClose} {...roving}>{LAUNCH.close}</button>
      </div>
    </div>
  )
}

export default function LaunchForm({ seed, strategies, presets, presetsNote, taken, blocked, onPick, fromPicker = false, onClose }: LaunchFormProps) {
  const uid = useId()
  const body = useRef<HTMLDivElement>(null)
  const [edits, setEdits] = useState<Edits>(NO_EDITS)
  const [problem, setProblem] = useState<ServerProblem | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  const [used, setUsed] = useState<readonly string[]>([])
  const action = useLaunchAction()
  const spec = strategies.find((s) => s.name === seed.strategy)
  const fields = useMemo(() => fieldsOf(seed, spec), [seed, spec])
  const allTaken = useMemo(() => new Set([...taken, ...used]), [taken, used])
  const base = useMemo(() => initialDraft(seed, spec, allTaken), [seed, spec, allTaken])
  const draft: LaunchDraft = useMemo(() => ({ ...base, ...edits.top, values: { ...base.values, ...edits.values } }), [base, edits])
  const matched = useMemo(() => matchPreset(seed, presets), [seed, presets])
  const check = useMemo(() => checkLaunch(draft, seed, spec, allTaken, matched?.source_run_id ?? null), [draft, seed, spec, allTaken, matched])
  const specState = useMemo(() => specView(check, matched), [check, matched])
  const errors = useMemo(() => ({ ...check.errors, ...(problem?.key ? { [problem.key]: problem.detail } : {}) }), [check.errors, problem])
  const problems = Object.keys(errors).length
  const stopped = blocked ?? presetBlock(presetsNote, matched)
  const disabled = stopped !== null || presetsNote !== null || action.isPending || problems > 0
  const summaryId = `${uid}-summary`
  const statusId = `${uid}-status`
  const specLineId = `${uid}-specline`
  const badgeId = `${uid}-specstate`
  const statusText = [stopped ?? '', problems > 0 ? fillCopy(problems === 1 ? LAUNCH.problems : LAUNCH.problemsMany, { n: problems }) : ''].filter(Boolean).join(' ')
  const [said, setSaid] = useState('')
  const [refusals, setRefusals] = useState(0)
  const statusRef = useRef(statusText)
  statusRef.current = statusText
  useEffect(() => setSaid(statusText), [statusText])
  useEffect(() => {
    if (refusals === 0) return undefined
    setSaid('')
    const timer = setTimeout(() => setSaid(statusRef.current), REPEAT_MS)
    return () => clearTimeout(timer)
  }, [refusals])

  // Focus goes to the first parameter on opening. When the strategy description arrives and swaps a plain box for a picker,
  // the focused control is replaced and the focus falls to the page: it is put back, but never taken from a control the owner
  // chose since (the focus is claimed once; later only a lost focus is restored).
  const layout = fields.map((f) => `${f.name}:${f.kind}:${f.choices === null ? '' : 'c'}`).join('|')
  const claimed = useRef(false)
  useEffect(() => {
    const root = body.current
    if (queued !== null || root === null) return
    const lost = document.activeElement === null || document.activeElement === document.body
    if (claimed.current && !lost) return
    // After a pick from the preset picker the focus stays on the picker (the new form's own, the old one is gone).
    const picker = !claimed.current && fromPicker ? root.querySelector<HTMLElement>('[data-launch-picker] [role="combobox"]') : null
    const first = picker ?? root.querySelector<HTMLElement>('[data-launch-params] input, [data-launch-params] [role="combobox"]') ?? root.querySelector<HTMLElement>('.launch-input')
    first?.focus()
    claimed.current = true
  }, [queued, layout, fromPicker])

  const setTop = (patch: Partial<Omit<LaunchDraft, 'values'>>) => {
    setEdits({ ...edits, top: { ...edits.top, ...patch } })
    setProblem(null)
  }
  const setValue = (name: string, value: string) => {
    setEdits({ ...edits, values: { ...edits.values, [name]: value } })
    setProblem(null)
  }

  const again = () => {
    const { runId: _stale, ...top } = edits.top
    setEdits({ ...edits, top })
    setQueued(null)
  }

  const refuse = () => {
    setRefusals((n) => n + 1)
    body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }

  const launch = () => {
    if (disabled || check.request === null) {
      if (!action.isPending && queued === null) refuse()
      return
    }
    const request = check.request
    const runId = draft.runId.trim()
    action.mutate(request, {
      onSuccess: () => {
        setUsed([...used, runId])
        setQueued(runId)
        postMessage(fillCopy(LAUNCH.messageQueued, { runId }))
      },
      onError: (error) => {
        const detail = failureDetail(error)
        setProblem({ detail: fillCopy(LAUNCH.notLaunched, { detail }), key: serverFieldKey(detail, fields.map((f) => f.name)) })
      },
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    launch()
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    launch()
  }

  const headingId = `${uid}-heading`
  const summary = fillCopy(LAUNCH.summary, {
    strategy: seed.strategy,
    variant: draft.variant.trim(),
    start: draft.start.trim(),
    end: draft.end.trim(),
    runId: draft.runId.trim(),
    changes: changesText(check.changed.length),
  })
  const alert = problem?.detail ?? null
  const describedBy = [summaryId, specState.line !== null ? specLineId : '', badgeId, said ? statusId : ''].filter(Boolean).join(' ')

  return (
    <section className="launch" aria-labelledby={headingId} ref={body}>
      <h3 id={headingId} className="launch-heading">{fillCopy(LAUNCH.heading, { label: seedLabel(seed) })}</h3>
      <p className="launch-note">{LAUNCH.basis}</p>
      {queued !== null ? (
        <Queued runId={queued} onAnother={again} onClose={onClose} />
      ) : (
        <form className="launch-form" onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
          <p className="launch-note">{fillCopy(LAUNCH.specUnknown, { name: seed.expId ?? seed.sourceRunId })}</p>
          {presetsNote ? <p className="launch-hint">{presetsNote}</p> : null}
          <div className="launch-fields">
            <PresetPicker seed={seed} presets={presets} onPick={onPick} />
            <FieldShell id={`${uid}-strategy`} label={LAUNCH.strategy} error={errors.strategy} custom>
              {() => <span className="launch-value launch-mono">{seed.strategy}</span>}
            </FieldShell>
            <FieldShell id={`${uid}-variant`} label={LAUNCH.variant} error={errors.variant} hint={LAUNCH.variantFixed} custom>
              {() => <span className="launch-value launch-mono">{seed.variant}</span>}
            </FieldShell>
            <FieldShell id={`${uid}-start`} label={LAUNCH.start} error={errors.start} hint={LAUNCH.windowHint}>
              {(d, bad) => <TextBox id={`${uid}-start`} value={draft.start} onChange={(v) => setTop({ start: v })} describedBy={d} invalid={bad} mono numeric maxLength={10} />}
            </FieldShell>
            <FieldShell id={`${uid}-end`} label={LAUNCH.end} error={errors.end}>
              {(d, bad) => <TextBox id={`${uid}-end`} value={draft.end} onChange={(v) => setTop({ end: v })} describedBy={d} invalid={bad} mono numeric maxLength={10} />}
            </FieldShell>
            <FieldShell id={`${uid}-runId`} label={LAUNCH.runId} error={errors.runId} hint={LAUNCH.runIdHint}>
              {(d, bad) => <TextBox id={`${uid}-runId`} value={draft.runId} onChange={(v) => setTop({ runId: v })} describedBy={d} invalid={bad} mono maxLength={83} />}
            </FieldShell>
          </div>
          <fieldset className="launch-params" data-launch-params>
            <legend className="launch-legend">{LAUNCH.params}</legend>
            {fields.length === 0 ? <p className="launch-hint">{LAUNCH.paramsNone}</p> : null}
            <div className="launch-fields">
              {fields.map((f) => {
                const id = `${uid}-p-${f.name}`
                const was = presetValue(seed, f)
                const changed = check.changed.includes(f.name)
                return (
                  <FieldShell
                    key={f.name}
                    id={id}
                    label={f.name}
                    hint={rangeHint(f)}
                    error={errors[paramKey(f.name)]}
                    mono
                    custom={f.kind === 'text' && f.choices !== null}
                    extra={changed ? <span className="launch-changed">{fillCopy(LAUNCH.changed, { was: was === undefined ? LAUNCH.changedNone : shownValue(was) })}</span> : null}
                  >
                    {(d, bad) => <ParamControl spec={f} id={id} value={draft.values[f.name] ?? ''} onChange={(v) => setValue(f.name, v)} describedBy={d} invalid={bad} />}
                  </FieldShell>
                )
              })}
            </div>
          </fieldset>
          <p id={summaryId} className="launch-summary">{summary}</p>
          {specState.line !== null ? <p id={specLineId} className="launch-note launch-mono" data-launch-spec>{specState.line}</p> : null}
          <p id={badgeId} role="status" className={specState.offSpec ? 'launch-badge launch-off' : 'launch-badge'} data-spec-state={specState.state}>{specState.badge}</p>
          <div className="launch-actions">
            <button type="submit" className="launch-button launch-primary" aria-disabled={disabled || undefined} aria-describedby={describedBy} {...roving}>{LAUNCH.launch}</button>
            <button type="button" className="launch-button" onClick={onClose} {...roving}>{LAUNCH.close}</button>
            {action.isPending ? <span className="launch-hint" role="status">{LAUNCH.launching}</span> : null}
          </div>
          <p className="launch-hint">{LAUNCH.keys}</p>
          <p id={statusId} className="launch-error-line" role="status" data-launch-status>{said}</p>
          {alert ? <p className="launch-error-line" role="alert">{alert}</p> : null}
        </form>
      )}
    </section>
  )
}
