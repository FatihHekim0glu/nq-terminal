// The indicator is mounted on every screen, HOME included, so its reads are the backend's only periodic job traffic
// there (the backend counts a read of the list as a background poll, nq_terminal/memtrim.py, so the idle trim still
// fires): slow while no job is active, quick while one is, never while the runner is off, rare while it does not answer.
import { describe, expect, it } from 'vitest'
import { job } from '../screens/jobs/jobs.fixtures'
import type { JobsList } from '../screens/jobs/types'
import { POLL_ERROR_MS, feedInterval } from './useJobIndicator'

function list(jobs: JobsList['jobs'], enabled = true): JobsList {
  return { jobs, queued: 0, running: 0, queue_cap: 10, enabled } as JobsList
}

describe('how often the job indicator reads the job list', () => {
  it('reads every 15 s while no job is active, and before the first answer', () => {
    expect(feedInterval(undefined, false)).toBe(15000)
    expect(feedInterval(list([]), false)).toBe(15000)
    expect(feedInterval(list([job({ state: 'ok', exit_code: 0 })]), false)).toBe(15000)
  })

  it('reads every 2 s only while a job is queued or running', () => {
    expect(feedInterval(list([job({ state: 'queued' })]), false)).toBe(2000)
    expect(feedInterval(list([job({ state: 'running' })]), false)).toBe(2000)
  })

  it('never polls while the runner is off, and asks a silent server once a minute', () => {
    expect(feedInterval(list([], false), false)).toBe(false)
    expect(feedInterval(undefined, true)).toBe(POLL_ERROR_MS)
    expect(POLL_ERROR_MS).toBe(60_000)
  })
})
