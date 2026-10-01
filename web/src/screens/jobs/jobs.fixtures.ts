// Fixtures for the JOBS tests (imported by *.test.* files only, never by the app).
import type { JobDetail, JobSpec, JobView } from './types'

export const SPEC: JobSpec = {
  strategy: 'tsmom',
  params: { ticks: 1 },
  variant: 'vendor',
  start: '2010-06-01',
  end: '2022-01-01',
  run_id: 't_tsmom_new',
}

const BASE: JobView = {
  id: 'j1',
  run_id: 't_base',
  spec: { ...SPEC, run_id: 't_base' },
  state: 'queued',
  exit_code: null,
  created: '2026-10-01T08:00:00+00:00',
  started: null,
  finished: null,
  message: '',
  log_tail: [],
}

/** A job with the given fields over a queued default. */
export function job(patch: Partial<JobView>): JobView {
  return { ...BASE, ...patch }
}

export function detail(patch: Partial<JobView>, log: readonly string[] = []): JobDetail {
  return { ...job(patch), log_tail: [...log] }
}

/** One running, two queued, then one of each end state. */
export const JOB_FIXTURES: readonly JobView[] = [
  job({ id: 'j7', run_id: 't_run', state: 'running', created: '2026-10-01T08:06:00+00:00', started: '2026-10-01T08:06:05+00:00', spec: { ...SPEC, run_id: 't_run', strategy: 'dtsmom' } }),
  job({ id: 'j8', run_id: 't_wait_a', state: 'queued', created: '2026-10-01T08:07:00+00:00', spec: { ...SPEC, run_id: 't_wait_a', strategy: 'eomtsy' } }),
  job({ id: 'j9', run_id: 't_wait_b', state: 'queued', created: '2026-10-01T08:08:00+00:00', spec: { ...SPEC, run_id: 't_wait_b', strategy: 'overnight', variant: 'repaired' } }),
  job({ id: 'j3', run_id: 't_done', state: 'ok', exit_code: 0, created: '2026-10-01T07:00:00+00:00', started: '2026-10-01T07:00:02+00:00', finished: '2026-10-01T07:04:30+00:00', spec: { ...SPEC, run_id: 't_done' } }),
  job({ id: 'j4', run_id: 't_checks', state: 'failed', exit_code: 1, created: '2026-10-01T06:00:00+00:00', started: '2026-10-01T06:00:02+00:00', finished: '2026-10-01T06:03:00+00:00', spec: { ...SPEC, run_id: 't_checks' } }),
  job({ id: 'j5', run_id: 't_broken', state: 'error', exit_code: 2, created: '2026-10-01T05:00:00+00:00', started: '2026-10-01T05:00:02+00:00', finished: '2026-10-01T05:00:09+00:00', spec: { ...SPEC, run_id: 't_broken' } }),
  job({ id: 'j6', run_id: 't_stopped', state: 'stopped', created: '2026-10-01T04:00:00+00:00', finished: '2026-10-01T04:01:00+00:00', spec: { ...SPEC, run_id: 't_stopped' } }),
]
