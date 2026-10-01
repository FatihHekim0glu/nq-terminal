// The queue form: the six JobSpec fields and nothing else, checked on the client with the server's own rules (rules.ts)
// before a request is sent. Problems are named per control (aria-invalid, aria-describedby) and counted in one alert
// once a press has found them; the server's refusal (409, 422, 503) is shown in words and the draft is kept.
// Keyboard (WCAG 2.1.1): the panel is one Tab stop and its other controls are reached by the arrow keys (chrome/
// WorkspaceFocus.ts), so every control carries data-roving and none may trap the arrows: the two pickers are the
// terminal's own dropdown (a native select keeps Left and Right for itself) and the dates are plain text (a native
// date input keeps them for its day, month and year parts); the parameters box lets Left at its start and Right at
// its end through.
import { useId, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { DropdownField, type FieldOption } from '../../chrome/Field'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { JOBS } from '../../copy/jobs'
import { fillCopy } from '../../copy/workspace'
import { STRATEGIES, VARIANTS, checkDraft, emptyDraft, type DraftField, type JobDraft } from './rules'
import { useQueueJob } from './useJobs'

const roving = { [ROVING_ATTR]: '' }
const STRATEGY_OPTIONS: readonly FieldOption[] = STRATEGIES.map((value) => ({ value, label: value }))
const VARIANT_OPTIONS: readonly FieldOption[] = VARIANTS.map((value) => ({ value, label: value }))

export interface JobFormProps {
  /** Every run id a job or a run already uses. */
  readonly taken: ReadonlySet<string>
  readonly full: boolean
  readonly cap: number
}

type Notice = { readonly kind: 'done' | 'refused'; readonly text: string } | null

interface FieldProps {
  readonly field: DraftField
  readonly label: string
  readonly hint?: string
  readonly error: string | undefined
  readonly uid: string
  /** The control is not a native one a label can point at (the dropdown names itself), so the label is plain text. */
  readonly custom?: boolean
  readonly children: (describedBy: string, invalid: boolean) => ReactNode
}

function Field({ field, label, hint, error, uid, custom = false, children }: FieldProps) {
  const id = `${uid}-${field}`
  const hintId = hint ? `${id}-hint` : ''
  const errorId = error ? `${id}-error` : ''
  const describedBy = [hintId, errorId].filter(Boolean).join(' ')
  return (
    <div className="jobs-field">
      {custom ? <span className="jobs-label">{label}</span> : <label htmlFor={id} className="jobs-label">{label}</label>}
      {children(describedBy, error !== undefined)}
      {hint ? <span id={hintId} className="jobs-hint">{hint}</span> : null}
      {error ? <span id={errorId} className="jobs-error"><b>{JOBS.form.errorPrefix}</b> {error}</span> : null}
    </div>
  )
}

export default function JobForm({ taken, full, cap }: JobFormProps) {
  const uid = useId()
  const [draft, setDraft] = useState<JobDraft>(emptyDraft)
  const [checked, setChecked] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const queue = useQueueJob()
  const result = useMemo(() => checkDraft(draft, taken), [draft, taken])
  const errors = checked ? result.errors : {}
  const problems = Object.keys(errors).length
  const fullId = `${uid}-full`

  const setValue = (field: DraftField, value: string) => {
    setDraft({ ...draft, [field]: value })
    setNotice(null)
  }
  const set = (field: DraftField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(field, event.target.value)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setChecked(true)
    if (full || queue.isPending || result.spec === null) return
    const runId = result.spec.run_id
    queue.mutate(result.spec, {
      onSuccess: () => {
        setNotice({ kind: 'done', text: fillCopy(JOBS.form.queued, { runId }) })
        setDraft({ ...draft, runId: emptyDraft().runId })
        setChecked(false)
      },
      onError: (error) => setNotice({ kind: 'refused', text: fillCopy(JOBS.form.notQueued, { detail: error.detail }) }),
    })
  }

  return (
    <form className="jobs-form" onSubmit={onSubmit} noValidate>
      <fieldset className="jobs-fieldset">
        <legend className="jobs-legend">{JOBS.form.legend}</legend>
        <div className="jobs-fields">
          <Field field="strategy" label={JOBS.form.strategy} error={errors.strategy} uid={uid} custom>
            {() => <DropdownField label={JOBS.form.strategy} value={draft.strategy} options={STRATEGY_OPTIONS} onChange={(value) => setValue('strategy', value)} />}
          </Field>
          <Field field="variant" label={JOBS.form.variant} error={errors.variant} uid={uid} custom>
            {() => <DropdownField label={JOBS.form.variant} value={draft.variant} options={VARIANT_OPTIONS} onChange={(value) => setValue('variant', value)} />}
          </Field>
          <Field field="start" label={JOBS.form.start} error={errors.start} uid={uid} hint={JOBS.form.windowHint}>
            {(d, bad) => (
              <input id={`${uid}-start`} className="jobs-input" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={10} value={draft.start} onChange={set('start')} aria-invalid={bad} aria-describedby={d || undefined} {...roving} />
            )}
          </Field>
          <Field field="end" label={JOBS.form.end} error={errors.end} uid={uid}>
            {(d, bad) => (
              <input id={`${uid}-end`} className="jobs-input" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={10} value={draft.end} onChange={set('end')} aria-invalid={bad} aria-describedby={d || undefined} {...roving} />
            )}
          </Field>
          <Field field="runId" label={JOBS.form.runId} error={errors.runId} uid={uid} hint={JOBS.form.runIdHint}>
            {(d, bad) => (
              <input id={`${uid}-runId`} className="jobs-input jobs-mono" type="text" autoComplete="off" spellCheck={false} maxLength={83} value={draft.runId} onChange={set('runId')} aria-invalid={bad} aria-describedby={d || undefined} {...roving} />
            )}
          </Field>
        </div>
        <Field field="paramsText" label={JOBS.form.params} error={errors.paramsText} uid={uid} hint={JOBS.form.paramsHint}>
          {(d, bad) => (
            <textarea id={`${uid}-paramsText`} className="jobs-input jobs-mono jobs-params" rows={3} spellCheck={false} value={draft.paramsText} onChange={set('paramsText')} aria-invalid={bad} aria-describedby={d || undefined} {...roving} />
          )}
        </Field>
        <div className="jobs-actions">
          <button type="submit" className="jobs-button" disabled={full || queue.isPending} aria-describedby={full ? fullId : undefined} {...roving}>
            {JOBS.form.queue}
          </button>
          {full ? <span id={fullId} className="jobs-hint">{fillCopy(JOBS.full, { cap })}</span> : null}
          {queue.isPending ? <span className="jobs-hint" role="status">{JOBS.form.queuing}</span> : null}
        </div>
        {problems > 0 ? (
          <p className="jobs-summary" role="alert">{fillCopy(problems === 1 ? JOBS.form.problems : JOBS.form.problemsMany, { n: problems })}</p>
        ) : null}
        {notice?.kind === 'refused' ? <p className="jobs-summary" role="alert">{notice.text}</p> : null}
        {notice?.kind === 'done' ? <p className="jobs-note" role="status">{notice.text}</p> : null}
      </fieldset>
    </form>
  )
}
