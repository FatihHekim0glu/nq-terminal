import { describe, expect, it } from 'vitest'
import { JOBS } from '../../copy/jobs'
import { JOB_FIXTURES, job } from './jobs.fixtures'
import { canOpenRun, canStop, formatUtc, isActive, jobRows, newlyFinished, pollMs, queueState, runLinkLine, statusLabel, statusTone, takenRunIds } from './model'

describe('status words and tones', () => {
  it('every status has its own words, so colour is never the only cue', () => {
    expect(statusLabel('queued')).toBe('QUEUED')
    expect(statusLabel('running')).toBe('RUNNING')
    expect(statusLabel('ok')).toBe('OK')
    expect(statusLabel('failed')).toBe('FAILED CHECKS')
    expect(statusLabel('error')).toBe('ERROR')
    expect(statusLabel('stopped')).toBe('STOPPED')
    const words = Object.values(JOBS.statuses)
    expect(new Set(words).size).toBe(words.length)
  })

  it('shows an unknown status as it came, never as a guess', () => {
    expect(statusLabel('weird')).toBe('UNKNOWN weird')
    expect(statusTone('weird')).toBe('warn')
  })

  it('tones: ok up, failed checks warn, error down, active ones plain', () => {
    expect(statusTone('ok')).toBe('up')
    expect(statusTone('failed')).toBe('warn')
    expect(statusTone('error')).toBe('down')
    expect(statusTone('queued')).toBeUndefined()
    expect(statusTone('running')).toBeUndefined()
    expect(statusTone('stopped')).toBeUndefined()
  })
})

describe('what a job allows', () => {
  it('stops only a queued or running job', () => {
    expect((['queued', 'running'] as const).map((s) => canStop(job({ state: s })))).toEqual([true, true])
    expect((['ok', 'failed', 'error', 'stopped'] as const).map((s) => canStop(job({ state: s })))).toEqual([false, false, false, false])
    expect(isActive(job({ state: 'running' }))).toBe(true)
    expect(isActive(job({ state: 'ok' }))).toBe(false)
  })

  it('links to RUN only when the run wrote its result: exit 0 (ok) or 1 (failed checks)', () => {
    expect(canOpenRun(job({ state: 'ok', exit_code: 0 }))).toBe(true)
    expect(canOpenRun(job({ state: 'failed', exit_code: 1 }))).toBe(true)
    expect(canOpenRun(job({ state: 'error', exit_code: 2 }))).toBe(false)
    expect(canOpenRun(job({ state: 'running', exit_code: null }))).toBe(false)
    expect(canOpenRun(job({ state: 'stopped', exit_code: null }))).toBe(false)
  })

  it('the RUN link is the command line text for that run id', () => {
    expect(runLinkLine(job({ run_id: 't_a' }))).toBe('t_a RUN')
  })
})

describe('the queue state', () => {
  it('counts running and queued jobs and says when the queue is full at the cap', () => {
    expect(queueState(JOB_FIXTURES, 10)).toEqual({ running: 1, queued: 2, cap: 10, full: false })
    const nine = Array.from({ length: 10 }, (_, i) => job({ id: `j${i}`, run_id: `t_${i}`, state: i === 0 ? 'running' : 'queued' }))
    expect(queueState(nine, 10)).toMatchObject({ running: 1, queued: 9, full: false })
    const ten = Array.from({ length: 11 }, (_, i) => job({ id: `j${i}`, run_id: `t_${i}`, state: i === 0 ? 'running' : 'queued' }))
    expect(queueState(ten, 10)).toMatchObject({ running: 1, queued: 10, full: true })
  })

  it('a finished job does not take a place in the queue', () => {
    const done = Array.from({ length: 12 }, (_, i) => job({ id: `j${i}`, run_id: `t_${i}`, state: 'ok', exit_code: 0 }))
    expect(queueState(done, 10).full).toBe(false)
  })

  it('polls fast while anything is active and slowly when nothing is', () => {
    expect(pollMs(JOB_FIXTURES)).toBe(2000)
    expect(pollMs([job({ state: 'ok', exit_code: 0 })])).toBe(15000)
    expect(pollMs(undefined)).toBe(15000)
  })

  it('collects the ids a new job may not reuse: every job and every known run', () => {
    const taken = takenRunIds(JOB_FIXTURES, ['nt_old', 't_done'])
    expect(taken.has('t_done')).toBe(true)
    expect(taken.has('nt_old')).toBe(true)
    expect(taken.has('t_fresh')).toBe(false)
  })
})

describe('newlyFinished', () => {
  it('names the runs of jobs that were active and now hold a result, so the run index can be read again', () => {
    const before = [job({ id: 'a', run_id: 't_a', state: 'running' }), job({ id: 'b', run_id: 't_b', state: 'queued' }), job({ id: 'c', run_id: 't_c', state: 'running' })]
    const after = [
      job({ id: 'a', run_id: 't_a', state: 'ok', exit_code: 0 }),
      job({ id: 'b', run_id: 't_b', state: 'running' }),
      job({ id: 'c', run_id: 't_c', state: 'error', exit_code: 2 }),
      job({ id: 'd', run_id: 't_d', state: 'ok', exit_code: 0 }),
    ]
    expect(newlyFinished(before, after)).toEqual(['t_a'])
    expect(newlyFinished(after, after)).toEqual([])
  })
})

describe('table rows', () => {
  it('lists newest first by queued time', () => {
    const times = jobRows(JOB_FIXTURES).map((r) => r.created)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('does not change the list it was given', () => {
    const copy = [...JOB_FIXTURES]
    jobRows(JOB_FIXTURES)
    expect(JOB_FIXTURES).toEqual(copy)
  })

  it('formats a UTC stamp to the second, and a missing one as dashes', () => {
    expect(formatUtc('2026-10-01T09:30:05.123456+00:00')).toBe('2026-10-01 09:30:05')
    expect(formatUtc('2026-10-01T09:30:05Z')).toBe('2026-10-01 09:30:05')
    expect(formatUtc(null)).toBe(JOBS.missing)
    expect(formatUtc('not a time')).toBe('not a time')
  })
})
