// The log tail of the chosen job: the last lines of what run_base printed, read as plain text (never as markup) in a
// scrollable region that is a Tab stop, so a keyboard reader can scroll it. Polled while the job is active.
import { useEffect, useRef } from 'react'
import { JOBS } from '../../copy/jobs'
import { ROVING_ATTR, ROVING_SCROLL_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import { useJobDetail } from './useJobs'
import type { JobView } from './types'

/** The most lines the screen draws, whatever the server sends. */
export const LOG_MAX_LINES = 500

const rovingScroll = { [ROVING_ATTR]: '', [ROVING_SCROLL_ATTR]: '' }

export interface JobLogProps {
  readonly job: JobView | null
  readonly active: boolean
}

export default function JobLog({ job, active }: JobLogProps) {
  const query = useJobDetail(job?.id ?? null, active)
  const box = useRef<HTMLPreElement>(null)
  const lines = query.data?.log_tail ?? []
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length, job?.id])

  if (job === null) return <p className="jobs-note">{JOBS.log.none}</p>
  const runId = job.run_id
  const shown = lines.length > LOG_MAX_LINES ? lines.slice(-LOG_MAX_LINES) : lines
  return (
    <section className="jobs-log" aria-label={JOBS.log.section}>
      <h3 className="jobs-heading">{fillCopy(JOBS.log.heading, { runId })}</h3>
      {query.isError ? (
        <p className="jobs-summary" role="alert">{fillCopy(JOBS.log.loadError, { detail: query.error.detail })}</p>
      ) : query.data === undefined ? (
        <p className="jobs-note" role="status" aria-busy="true">{JOBS.log.loading}</p>
      ) : shown.length === 0 ? (
        <p className="jobs-note">{JOBS.log.empty}</p>
      ) : (
        <>
          {lines.length > LOG_MAX_LINES ? <p className="jobs-note">{fillCopy(JOBS.log.lines, { n: LOG_MAX_LINES })}</p> : null}
          <pre ref={box} className="jobs-pre" role="region" aria-label={fillCopy(JOBS.log.label, { runId })} tabIndex={0} {...rovingScroll}>
            {shown.join('\n')}
          </pre>
        </>
      )}
    </section>
  )
}
