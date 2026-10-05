import { describe, expect, it } from 'vitest'
import { job } from '../screens/jobs/jobs.fixtures'
import type { JobView } from '../screens/jobs/types'
import {
  activeJobs,
  durationSeconds,
  elapsedSeconds,
  formatSpan,
  indicatorState,
  leadJob,
  noticeFor,
  noticeText,
  typicalSeconds,
  unseenFinished,
} from './model'

const T0 = Date.parse('2026-10-01T08:00:00Z')

type Strategy = JobView['spec']['strategy']

function ran(id: string, strategy: Strategy, seconds: number, patch: Partial<JobView> = {}): JobView {
  const started = new Date(T0).toISOString()
  const finished = new Date(T0 + seconds * 1000).toISOString()
  return job({ id, run_id: `t_${id}`, state: 'ok', exit_code: 0, started, finished, spec: { ...job({}).spec, strategy }, ...patch })
}

describe('formatSpan', () => {
  it('writes seconds, minutes and hours in words that read aloud', () => {
    expect(formatSpan(0)).toBe('0 s')
    expect(formatSpan(12.4)).toBe('12 s')
    expect(formatSpan(59.6)).toBe('1 min 0 s')
    expect(formatSpan(65)).toBe('1 min 5 s')
    expect(formatSpan(3600)).toBe('1 h 0 min')
    expect(formatSpan(3725)).toBe('1 h 2 min')
  })

  it('never writes a negative or non-finite span', () => {
    expect(formatSpan(-5)).toBe('0 s')
    expect(formatSpan(Number.NaN)).toBe('0 s')
  })
})

describe('elapsedSeconds', () => {
  it('counts a running job from its start and a queued job from the time it was queued', () => {
    const running = job({ state: 'running', created: '2026-10-01T07:59:00Z', started: '2026-10-01T08:00:00Z' })
    const queued = job({ state: 'queued', created: '2026-10-01T07:59:30Z' })
    expect(elapsedSeconds(running, T0 + 12_000)).toBe(12)
    expect(elapsedSeconds(queued, T0)).toBe(30)
  })

  it('is null for an unreadable stamp and never negative', () => {
    expect(elapsedSeconds(job({ state: 'running', started: 'soon' }), T0)).toBeNull()
    expect(elapsedSeconds(job({ state: 'queued', created: '2026-10-01T09:00:00Z' }), T0)).toBe(0)
  })
})

describe('durationSeconds and typicalSeconds', () => {
  it('measures a finished run from start to finish and nothing else', () => {
    expect(durationSeconds(ran('a', 'tsmom', 20))).toBe(20)
    expect(durationSeconds(job({ state: 'running', started: '2026-10-01T08:00:00Z' }))).toBeNull()
    expect(durationSeconds(ran('b', 'tsmom', 20, { state: 'error', exit_code: 2 }))).toBeNull()
    expect(durationSeconds(ran('c', 'tsmom', 20, { state: 'stopped', exit_code: null }))).toBeNull()
  })

  it('takes the median of past completed runs of the same strategy only', () => {
    const past = [ran('a', 'tsmom', 10), ran('b', 'tsmom', 30), ran('c', 'tsmom', 20), ran('d', 'overnight', 600)]
    expect(typicalSeconds(past, 'tsmom')).toBe(20)
    expect(typicalSeconds(past, 'overnight')).toBe(600)
  })

  it('averages the middle pair of an even count and counts failed checks as completed', () => {
    const past = [ran('a', 'tsmom', 10), ran('b', 'tsmom', 20, { state: 'failed', exit_code: 1 })]
    expect(typicalSeconds(past, 'tsmom')).toBe(15)
  })

  it('is null when no past run of that strategy exists', () => {
    expect(typicalSeconds([ran('a', 'tsmom', 10)], 'eomtsy')).toBeNull()
    expect(typicalSeconds([], 'tsmom')).toBeNull()
  })
})

describe('leadJob and activeJobs', () => {
  it('leads with the earliest running job, else the earliest queued one', () => {
    const jobs = [
      job({ id: 'q2', state: 'queued', created: '2026-10-01T08:02:00Z' }),
      job({ id: 'q1', state: 'queued', created: '2026-10-01T08:01:00Z' }),
      job({ id: 'r', state: 'running', created: '2026-10-01T08:00:00Z', started: '2026-10-01T08:00:05Z' }),
    ]
    expect(leadJob(jobs)?.id).toBe('r')
    expect(leadJob(jobs.slice(0, 2))?.id).toBe('q1')
    expect(leadJob([ran('a', 'tsmom', 5)])).toBeNull()
    expect(activeJobs(jobs)).toHaveLength(3)
  })
})

describe('unseenFinished and noticeFor', () => {
  it('names finished jobs the reader has not seen, and no active job', () => {
    const jobs = [ran('a', 'tsmom', 5), ran('b', 'tsmom', 5), job({ id: 'c', state: 'running', started: '2026-10-01T08:00:00Z' })]
    expect(unseenFinished(jobs, new Set(['a'])).map((j) => j.id)).toEqual(['b'])
  })

  it('makes a notice for ok, failed checks and error, and none for a job the owner stopped', () => {
    expect(noticeFor(ran('a', 'tsmom', 12))).toMatchObject({ jobId: 'a', runId: 't_a', kind: 'finished', canOpen: true, seconds: 12 })
    expect(noticeFor(ran('b', 'tsmom', 12, { state: 'failed', exit_code: 1 }))).toMatchObject({ kind: 'failed', canOpen: true })
    expect(noticeFor(ran('c', 'tsmom', 12, { state: 'error', exit_code: 2 }))).toMatchObject({ kind: 'failed', canOpen: false, exit: 2 })
    expect(noticeFor(ran('d', 'tsmom', 12, { state: 'stopped', exit_code: null }))).toBeNull()
  })
})

describe('noticeText', () => {
  it('says what happened in words, with the time taken when known', () => {
    expect(noticeText(noticeFor(ran('a', 'tsmom', 12))!)).toBe('Finished: t_a (tsmom), OK in 12 s.')
    expect(noticeText(noticeFor(ran('b', 'tsmom', 70, { state: 'failed', exit_code: 1 }))!)).toBe(
      'Finished with failed checks: t_b (tsmom) in 1 min 10 s. The result is still written.',
    )
    expect(noticeText(noticeFor(ran('c', 'tsmom', 9, { state: 'error', exit_code: 2 }))!)).toBe(
      'The run t_c (tsmom) ended with an error (exit 2). No result was written.',
    )
  })

  it('leaves the time out when the stamps cannot give one', () => {
    const odd = ran('a', 'tsmom', 5, { finished: 'later' })
    expect(noticeText(noticeFor(odd)!)).toBe('Finished: t_a (tsmom), OK.')
  })
})

describe('indicatorState', () => {
  const running = job({ id: 'r', state: 'running', started: '2026-10-01T08:00:00Z' })
  const queued = job({ id: 'q', state: 'queued' })

  it('is none with nothing active and no notice', () => {
    expect(indicatorState([ran('a', 'tsmom', 5)], [])).toBe('none')
    expect(indicatorState([], [])).toBe('none')
  })

  it('is running when a job runs and queued when jobs only wait', () => {
    expect(indicatorState([running, queued], [])).toBe('running')
    expect(indicatorState([queued], [])).toBe('queued')
  })

  it('shows a finish notice over the active state: finished for ok, failed for failed checks or error', () => {
    const ok = noticeFor(ran('a', 'tsmom', 5))!
    const bad = noticeFor(ran('b', 'tsmom', 5, { state: 'failed', exit_code: 1 }))!
    expect(indicatorState([running], [ok])).toBe('finished')
    expect(indicatorState([], [bad])).toBe('failed')
    expect(indicatorState([], [ok, bad])).toBe('failed')
  })
})
