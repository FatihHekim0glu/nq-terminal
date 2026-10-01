// The queue table: one row per job, newest first. The status is always in words (colour only on top of them). Each row
// offers View log, Open in RUN (only when the run wrote its result) and Stop (only while queued or running; a second
// press confirms, and the safe answer, Keep it, takes the focus).
import { useEffect, useRef } from 'react'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { JOBS } from '../../copy/jobs'
import { fillCopy } from '../../copy/workspace'
import PlainTable, { type PlainColumn } from '../live/PlainTable'
import { canOpenRun, canStop, formatUtc, jobRows, statusLabel, statusTone } from './model'
import type { JobView } from './types'

export interface JobsTableProps {
  readonly jobs: readonly JobView[]
  readonly selectedId: string | null
  readonly confirmId: string | null
  readonly stopping: boolean
  readonly onSelect: (jobId: string) => void
  readonly onOpenRun: (job: JobView) => void
  readonly onAskStop: (jobId: string) => void
  readonly onKeep: () => void
  readonly onStop: (job: JobView) => void
}

// Every control is a roving item: the panel is one Tab stop and the workspace takes the rest out of the Tab order.
const roving = { [ROVING_ATTR]: '' }
const TONE_CLASS = { up: 'jobs-up', down: 'jobs-down', warn: 'jobs-warn' } as const

function Status({ job }: { readonly job: JobView }) {
  const tone = statusTone(job.state)
  return <b className={tone ? `jobs-status ${TONE_CLASS[tone]}` : 'jobs-status'}>{statusLabel(job.state)}</b>
}

function KeepButton({ onKeep }: { readonly onKeep: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return <button ref={ref} type="button" className="jobs-button" onClick={onKeep} {...roving}>{JOBS.row.confirmKeep}</button>
}

function Actions({ job, props }: { readonly job: JobView; readonly props: JobsTableProps }) {
  const { selectedId, confirmId, stopping, onSelect, onOpenRun, onAskStop, onKeep, onStop } = props
  if (confirmId === job.id) {
    return (
      <span className="jobs-confirm" role="group" aria-label={fillCopy(JOBS.row.confirm, { runId: job.run_id })}>
        <span>{fillCopy(JOBS.row.confirm, { runId: job.run_id })}</span>
        <button type="button" className="jobs-button" disabled={stopping} onClick={() => onStop(job)} {...roving}>{JOBS.row.confirmYes}</button>
        <KeepButton onKeep={onKeep} />
      </span>
    )
  }
  return (
    <span className="jobs-row-actions">
      <button type="button" className="jobs-button" data-job-id={job.id} data-job-action="view" aria-pressed={selectedId === job.id} aria-label={fillCopy(JOBS.row.viewLabel, { runId: job.run_id })} onClick={() => onSelect(job.id)} {...roving}>
        {JOBS.row.view}
      </button>
      {canOpenRun(job) ? (
        <button type="button" className="jobs-button" aria-label={fillCopy(JOBS.row.openLabel, { runId: job.run_id })} onClick={() => onOpenRun(job)} {...roving}>
          {JOBS.row.open}
        </button>
      ) : null}
      {canStop(job) ? (
        <button type="button" className="jobs-button" data-job-id={job.id} data-job-action="stop" aria-label={fillCopy(JOBS.row.stopLabel, { runId: job.run_id })} onClick={() => onAskStop(job.id)} {...roving}>
          {JOBS.row.stop}
        </button>
      ) : null}
    </span>
  )
}

function columns(props: JobsTableProps): readonly PlainColumn<JobView>[] {
  const C = JOBS.table.cols
  return [
    { id: 'run', header: C.run, width: 230, kind: 'name', text: (j) => <span className="jobs-mono">{j.run_id}</span> },
    { id: 'strategy', header: C.strategy, width: 120, kind: 'text', text: (j) => j.spec.strategy },
    { id: 'variant', header: C.variant, width: 80, kind: 'text', text: (j) => j.spec.variant },
    { id: 'window', header: C.window, width: 190, kind: 'text', text: (j) => `${j.spec.start} to ${j.spec.end}` },
    { id: 'status', header: C.status, width: 130, kind: 'text', text: (j) => <Status job={j} /> },
    { id: 'exit', header: C.exit, width: 50, kind: 'num', text: (j) => (j.exit_code === null ? JOBS.exitNone : String(j.exit_code)) },
    { id: 'queued', header: C.queued, width: 160, kind: 'text', text: (j) => formatUtc(j.created) },
    { id: 'started', header: C.started, width: 160, kind: 'text', text: (j) => formatUtc(j.started) },
    { id: 'finished', header: C.finished, width: 160, kind: 'text', text: (j) => formatUtc(j.finished) },
    { id: 'actions', header: C.actions, width: 330, kind: 'text', text: (j) => <Actions job={j} props={props} /> },
  ]
}

/** Which button of a row takes the focus once its confirmation has closed: Stop after Keep it, View log after Yes. */
interface FocusTarget {
  readonly jobId: string
  readonly action: 'stop' | 'view'
}

function focusRowButton(target: FocusTarget): void {
  const find = (action: string) =>
    document.querySelector<HTMLButtonElement>(`button[data-job-id="${CSS.escape(target.jobId)}"][data-job-action="${action}"]`)
  // The row may no longer offer Stop (the job finished meanwhile); View log is always there.
  const button = find(target.action) ?? find('view')
  button?.focus()
}

export default function JobsTable(rawProps: JobsTableProps) {
  const pending = useRef<FocusTarget | null>(null)
  const { confirmId } = rawProps
  const props: JobsTableProps = {
    ...rawProps,
    onKeep: () => {
      pending.current = confirmId === null ? null : { jobId: confirmId, action: 'stop' }
      rawProps.onKeep()
    },
    onStop: (job) => {
      pending.current = { jobId: job.id, action: 'view' }
      rawProps.onStop(job)
    },
  }
  // The confirmation's buttons are gone once it closes: hand the focus to the row's own button, not the page body.
  useEffect(() => {
    if (confirmId !== null || pending.current === null) return
    focusRowButton(pending.current)
    pending.current = null
  }, [confirmId])
  return (
    <PlainTable
      label={JOBS.table.caption}
      rows={jobRows(props.jobs)}
      columns={columns(props)}
      rowId={(j) => j.id}
      rowClassName={(j) => (j.id === props.selectedId ? 'jobs-selected' : undefined)}
      emptyText={JOBS.table.empty}
    />
  )
}
