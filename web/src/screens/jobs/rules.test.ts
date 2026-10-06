import { describe, expect, it } from 'vitest'
import { JOBS } from '../../copy/jobs'
import { QUEUE_CAP, RUN_ID_PATTERN, STRATEGIES, VARIANTS, WINDOW_END, WINDOW_START, checkDraft, emptyDraft, type JobDraft } from './rules'

const GOOD: JobDraft = {
  strategy: 'tsmom',
  variant: 'vendor',
  start: '2010-06-01',
  end: '2022-01-01',
  runId: 't_tsmom_a',
  paramsText: '{"ticks": 1}',
}
const NONE: ReadonlySet<string> = new Set()
const check = (patch: Partial<JobDraft> = {}, taken: ReadonlySet<string> = NONE) => checkDraft({ ...GOOD, ...patch }, taken)

describe('the rules mirror ARCHITECTURE section 8', () => {
  it('lists exactly the eight feeds of run_base.FEEDS, and the queue cap of ten', () => {
    expect([...STRATEGIES].sort()).toEqual(['dtsmom', 'eomtsy', 'overnight', 'tsmom', 'tsydemfx', 'volmanaged', 'volmanaged_bh', 'za_orb'])
    expect(QUEUE_CAP).toBe(10)
    expect([...VARIANTS]).toEqual(['repaired', 'vendor'])
    expect([WINDOW_START, WINDOW_END]).toEqual(['2010-01-01', '2022-01-01'])
  })

  it('run ids are t_ then 1 to 80 of letters, digits, underscore, dot, hyphen', () => {
    expect(RUN_ID_PATTERN.test('t_a')).toBe(true)
    expect(RUN_ID_PATTERN.test(`t_${'a'.repeat(80)}`)).toBe(true)
    expect(RUN_ID_PATTERN.test(`t_${'a'.repeat(81)}`)).toBe(false)
    for (const bad of ['t_', 'nt_x', 'T_x', 't_a b', 't_a/b', 't_a\n', 't_..\\x', '']) expect(RUN_ID_PATTERN.test(bad)).toBe(false)
  })
})

describe('checkDraft', () => {
  it('accepts a good draft and returns the exact JobSpec the server takes (the six keys, params parsed)', () => {
    const r = check()
    expect(r.errors).toEqual({})
    expect(r.spec).toEqual({
      strategy: 'tsmom',
      params: { ticks: 1 },
      variant: 'vendor',
      start: '2010-06-01',
      end: '2022-01-01',
      run_id: 't_tsmom_a',
    })
    expect(Object.keys(r.spec ?? {}).sort()).toEqual(['end', 'params', 'run_id', 'start', 'strategy', 'variant'])
  })

  it('holds tsydemfx to its frozen span: the repaired variant from 2010-01-01 to 2022-01-01', () => {
    const frozen = { strategy: 'tsydemfx', variant: 'repaired', start: '2010-01-01', end: '2022-01-01' }
    expect(check(frozen).errors).toEqual({})
    expect(check(frozen).spec).toMatchObject({ strategy: 'tsydemfx', variant: 'repaired' })
    expect(check({ ...frozen, variant: 'vendor' }).errors.variant).toBe(JOBS.errors.frozenSpan)
    expect(check({ ...frozen, start: '2010-06-01' }).errors.start).toBe(JOBS.errors.frozenSpan)
    expect(check({ ...frozen, end: '2021-12-31' }).errors.end).toBe(JOBS.errors.frozenSpan)
    expect(check({ ...frozen, variant: 'vendor' }).spec).toBeNull()
    expect(check({ variant: 'vendor' }).errors.variant).toBeUndefined()
  })

  it('treats empty parameters text as an empty object', () => {
    expect(check({ paramsText: '   ' }).spec?.params).toEqual({})
  })

  it('trims the run id and dates before checking', () => {
    expect(check({ runId: '  t_x  ', start: ' 2010-01-01 ' }).spec).toMatchObject({ run_id: 't_x', start: '2010-01-01' })
  })

  it('refuses a strategy or variant outside the lists', () => {
    expect(check({ strategy: 'rm' }).errors.strategy).toBe(JOBS.errors.strategy)
    expect(check({ strategy: '' }).errors.strategy).toBe(JOBS.errors.strategy)
    expect(check({ variant: 'sealed' }).errors.variant).toBe(JOBS.errors.variant)
    expect(check({ strategy: 'rm' }).spec).toBeNull()
  })

  it('refuses parameters that are not a JSON object', () => {
    expect(check({ paramsText: '{"ticks": ' }).errors.paramsText).toMatch(/^The parameters are not valid JSON: /)
    for (const text of ['[1]', 'null', '3', '"x"', 'true']) expect(check({ paramsText: text }).errors.paramsText).toBe(JOBS.errors.paramsNotObject)
  })

  it('holds the in-sample fence: start from 2010-01-01, end up to 2022-01-01, start before end', () => {
    expect(check({ start: '2009-12-31' }).errors.start).toBe(JOBS.errors.startBefore)
    expect(check({ start: '2010-01-01' }).errors.start).toBeUndefined()
    expect(check({ end: '2022-01-02' }).errors.end).toBe(JOBS.errors.endAfter)
    expect(check({ end: '2022-01-01' }).errors.end).toBeUndefined()
    expect(check({ start: '2015-01-01', end: '2015-01-01' }).errors.end).toBe(JOBS.errors.endNotAfterStart)
    expect(check({ start: '2016-01-01', end: '2015-01-01' }).errors.end).toBe(JOBS.errors.endNotAfterStart)
  })

  it('refuses a date that is not a real calendar day', () => {
    for (const bad of ['', '2010-13-01', '2010-02-30', '20100101', '2010-1-1', '2010-01-01T00:00', 'tomorrow']) {
      expect(check({ start: bad }).errors.start).toBe(JOBS.errors.startFormat)
      expect(check({ end: bad }).errors.end).toBe(JOBS.errors.endFormat)
    }
    expect(check({ start: '2012-02-29' }).errors.start).toBeUndefined()
    expect(check({ start: '2011-02-29' }).errors.start).toBe(JOBS.errors.startFormat)
  })

  it('refuses a run id that does not match, and one a job or a run already uses', () => {
    expect(check({ runId: 'nt_x' }).errors.runId).toBe(JOBS.errors.runIdFormat)
    expect(check({ runId: 't_a b' }).errors.runId).toBe(JOBS.errors.runIdFormat)
    expect(check({ runId: 't_taken' }, new Set(['t_taken'])).errors.runId).toBe(JOBS.errors.runIdTaken)
  })

  it('reports every problem at once and gives no spec', () => {
    const r = check({ strategy: 'x', variant: 'y', start: 'a', end: 'b', runId: 'c', paramsText: '[' })
    expect(Object.keys(r.errors).sort()).toEqual(['end', 'paramsText', 'runId', 'start', 'strategy', 'variant'])
    expect(r.spec).toBeNull()
  })

  it('starts from an empty draft that is not valid', () => {
    const d = emptyDraft()
    expect(d.runId).toBe('t_')
    expect(d.paramsText).toBe('{}')
    expect(checkDraft(d, NONE).spec).toBeNull()
  })
})
