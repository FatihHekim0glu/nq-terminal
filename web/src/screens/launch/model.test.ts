import { describe, expect, it } from 'vitest'
import { ORB_PRESET, ORB_SEED, ORB_SPEC, PRESETS, TICKS_SPEC } from './launch.fixtures'
import {
  checkLaunch,
  initialDraft,
  matchPreset,
  parseParam,
  rangeHint,
  seedFromLedgerRow,
  seedFromPreset,
  seedFromRun,
  serverFieldKey,
  suggestRunId,
  toRequest,
  type LaunchDraft,
} from './model'

const NONE: ReadonlySet<string> = new Set()
const draftOf = (over: Partial<LaunchDraft> = {}, values: Record<string, string> = {}): LaunchDraft => ({
  ...initialDraft(ORB_SEED, ORB_SPEC, NONE),
  ...over,
  values: { ...initialDraft(ORB_SEED, ORB_SPEC, NONE).values, ...values },
})

describe('suggestRunId', () => {
  it('names the run t_<exp id>_<n> with the first free n', () => {
    expect(suggestRunId('EXP12', 't_EXP12_za_base', NONE)).toBe('t_EXP12_1')
    expect(suggestRunId('EXP12', 't_x', new Set(['t_EXP12_1', 't_EXP12_2']))).toBe('t_EXP12_3')
  })

  it('falls back to the source run id when there is no exp id, and drops characters a run id may not hold', () => {
    expect(suggestRunId(null, 't_alpha beta', NONE)).toBe('t_alpha_beta_1')
    expect(suggestRunId('', 'nt_za_v0', NONE)).toBe('t_nt_za_v0_1')
  })

  it('stays inside the 83 character limit and still ends in a free number', () => {
    const long = 'E'.repeat(200)
    const id = suggestRunId(long, long, new Set())
    expect(id.length).toBeLessThanOrEqual(83)
    expect(id).toMatch(/^t_E+_1$/)
  })
})

describe('parseParam', () => {
  const orMinutes = ORB_SPEC.params[0]!
  const stop = ORB_SPEC.params[1]!

  it('reads a whole number inside its range', () => {
    expect(parseParam(orMinutes, '45')).toEqual({ value: 45 })
    expect(parseParam(orMinutes, ' 5 ')).toEqual({ value: 5 })
  })

  it('refuses text, a fraction and a value outside the range, naming the range', () => {
    expect(parseParam(orMinutes, 'abc')).toEqual({ error: 'or_minutes must be a whole number.' })
    expect(parseParam(orMinutes, '4.5')).toEqual({ error: 'or_minutes must be a whole number.' })
    expect(parseParam(orMinutes, '4')).toEqual({ error: 'or_minutes must be between 5 and 120.' })
    expect(parseParam(orMinutes, '121')).toEqual({ error: 'or_minutes must be between 5 and 120.' })
  })

  it('reads a decimal and refuses a non-finite one', () => {
    expect(parseParam(stop, '2.25')).toEqual({ value: 2.25 })
    expect(parseParam(stop, '1e400')).toEqual({ error: 'stop_r must be a number.' })
    expect(parseParam(stop, '0.1')).toEqual({ error: 'stop_r must be between 0.25 and 5.' })
  })

  it('treats an exclusive minimum as a bound that is not allowed itself', () => {
    const open = { ...stop, min: 0, exclusiveMin: true }
    expect(parseParam(open, '0')).toEqual({ error: 'stop_r must be above 0 and at most 5.' })
    expect(parseParam(open, '0.01')).toEqual({ value: 0.01 })
    expect(rangeHint({ ...open, max: null })).toBe('Number, above 0. Default 1.5.')
  })

  it('says one-sided ranges in words', () => {
    expect(parseParam({ ...stop, max: null }, '0')).toEqual({ error: 'stop_r must be at least 0.25.' })
    expect(parseParam({ ...stop, min: null }, '9')).toEqual({ error: 'stop_r must be at most 5.' })
  })

  it('reads a flag, a choice and a short text', () => {
    expect(parseParam(ORB_SPEC.params[2]!, 'true')).toEqual({ value: true })
    expect(parseParam(ORB_SPEC.params[2]!, 'false')).toEqual({ value: false })
    expect(parseParam(ORB_SPEC.params[3]!, 'globex')).toEqual({ value: 'globex' })
    expect(parseParam(ORB_SPEC.params[3]!, 'nyse')).toEqual({ error: 'session must be one of rth, globex.' })
    const free = { ...ORB_SPEC.params[3]!, choices: null }
    expect(parseParam(free, 'a b')).toEqual({ error: 'session may hold letters, digits and _ . : + - only, 1 to 64 characters.' })
  })

  it('reads a JSON list of scalars and refuses anything else', () => {
    const list = TICKS_SPEC.params[1]!
    expect(parseParam(list, '[21, 63, 126]')).toEqual({ value: [21, 63, 126] })
    expect(parseParam(list, '{"a": 1}')).toEqual({ error: 'lookbacks must be a JSON list, for example [1, 2].' })
    expect(parseParam(list, '[1, ')).toEqual({ error: 'lookbacks must be a JSON list, for example [1, 2].' })
    expect(parseParam(list, '[{"a": 1}]')).toEqual({ error: 'lookbacks may hold numbers, flags and short text only.' })
  })

  it('treats an empty value as not set, unless the parameter is required', () => {
    expect(parseParam(orMinutes, '  ')).toEqual({ omit: true })
    expect(parseParam(TICKS_SPEC.params[0]!, '')).toEqual({ error: 'ticks needs a value.' })
  })
})

describe('rangeHint', () => {
  it('shows the type, the allowed range and the default', () => {
    expect(rangeHint(ORB_SPEC.params[0]!)).toBe('Whole number, 5 to 120. Default 30.')
    expect(rangeHint(ORB_SPEC.params[1]!)).toBe('Number, 0.25 to 5. Default 1.5.')
    expect(rangeHint(ORB_SPEC.params[2]!)).toBe('Yes or no. Default no.')
    expect(rangeHint(ORB_SPEC.params[3]!)).toBe('One of rth, globex. Default rth.')
    expect(rangeHint(TICKS_SPEC.params[0]!)).toBe('Whole number, 0 to 2. Required. The cost level')
    expect(rangeHint(TICKS_SPEC.params[1]!)).toBe('A JSON list, for example [1, 2]. No default.')
  })

  it('says so when no range is declared', () => {
    expect(rangeHint({ ...ORB_SPEC.params[1]!, min: null, max: null, default: null })).toBe('Number, no range declared. No default.')
  })
})

describe('initialDraft', () => {
  it('fills each parameter from the preset, else its default, else empty', () => {
    const draft = initialDraft(ORB_SEED, ORB_SPEC, NONE)
    expect(draft.values).toEqual({ or_minutes: '45', stop_r: '2', long_only: 'false', session: 'rth' })
    expect(draft.runId).toBe('t_EXP12_1')
    expect([draft.variant, draft.start, draft.end]).toEqual(['repaired', '2010-06-01', '2022-01-01'])
    expect(initialDraft({ ...ORB_SEED, strategy: 'tsmom', params: {} }, TICKS_SPEC, NONE).values).toEqual({ ticks: '', lookbacks: '' })
  })

  it('keeps a parameter the server does not describe, written as JSON', () => {
    const draft = initialDraft({ ...ORB_SEED, params: { or_minutes: 45, odd: [1, 2] } }, ORB_SPEC, NONE)
    expect(draft.values.odd).toBe('[1,2]')
  })

  it('avoids the run ids already taken', () => {
    expect(initialDraft(ORB_SEED, ORB_SPEC, new Set(['t_EXP12_1'])).runId).toBe('t_EXP12_2')
  })
})

describe('checkLaunch', () => {
  it('builds the request from a valid unchanged draft: the preset, the run id and nothing else', () => {
    const check = checkLaunch(draftOf(), ORB_SEED, ORB_SPEC, NONE, ORB_PRESET.source_run_id)
    expect(check.errors).toEqual({})
    expect(check.request).toEqual({
      kind: 'backtest',
      preset_id: 't_EXP12_za_base',
      params: {},
      start: null,
      end: null,
      run_id: 't_EXP12_1',
    })
    expect(check.changed).toEqual([])
    expect(check.offSpec).toBe(false)
  })

  it('sends an edited preset parameter and marks it changed and the run off spec', () => {
    const check = checkLaunch(draftOf({}, { or_minutes: '60' }), ORB_SEED, ORB_SPEC, NONE, ORB_PRESET.source_run_id)
    expect(check.request?.params).toEqual({ or_minutes: 60 })
    expect(check.changed).toEqual(['or_minutes'])
    expect(check.offSpec).toBe(true)
  })

  it('sends a parameter the preset lacks only when it differs from its default', () => {
    const id = ORB_PRESET.source_run_id
    expect(checkLaunch(draftOf({}, { long_only: 'false' }), ORB_SEED, ORB_SPEC, NONE, id).request?.params).not.toHaveProperty('long_only')
    const set = checkLaunch(draftOf({}, { long_only: 'true' }), ORB_SEED, ORB_SPEC, NONE, id)
    expect(set.request?.params).toMatchObject({ long_only: true })
    expect(set.changed).toEqual(['long_only'])
  })

  it('treats a changed window as off spec too, and sends only the date that changed', () => {
    const check = checkLaunch(draftOf({ end: '2021-12-31' }), ORB_SEED, ORB_SPEC, NONE, ORB_PRESET.source_run_id)
    expect(check.offSpec).toBe(true)
    expect(check.request).toMatchObject({ start: null, end: '2021-12-31' })
  })

  it('gives no request without a preset to start from', () => {
    expect(checkLaunch(draftOf(), ORB_SEED, ORB_SPEC, NONE, null).request).toBeNull()
    expect(checkLaunch(draftOf(), ORB_SEED, ORB_SPEC, NONE).request).toBeNull()
  })

  it('names the field of every problem and gives no request', () => {
    const check = checkLaunch(draftOf({ end: '2022-01-02', runId: 'x' }, { or_minutes: '1' }), ORB_SEED, ORB_SPEC, NONE)
    expect(check.request).toBeNull()
    expect(Object.keys(check.errors).sort()).toEqual(['end', 'param:or_minutes', 'runId'])
    expect(check.errors['param:or_minutes']).toBe('or_minutes must be between 5 and 120.')
    expect(check.errors.end).toMatch(/2022-01-01/)
  })

  it('refuses a taken run id', () => {
    const check = checkLaunch(draftOf(), ORB_SEED, ORB_SPEC, new Set(['t_EXP12_1']))
    expect(check.errors.runId).toMatch(/already uses/)
  })

  it('refuses a start before 2010-01-01 and an end that is not after the start', () => {
    expect(checkLaunch(draftOf({ start: '2009-12-31' }), ORB_SEED, ORB_SPEC, NONE).errors.start).toBeDefined()
    expect(checkLaunch(draftOf({ start: '2015-01-01', end: '2015-01-01' }), ORB_SEED, ORB_SPEC, NONE).errors.end).toBeDefined()
  })

  it('refuses a strategy the queue does not know', () => {
    const check = checkLaunch(draftOf(), { ...ORB_SEED, strategy: 'mystery' }, undefined, NONE)
    expect(check.request).toBeNull()
    expect(check.errors.strategy).toMatch(/registered strategy/)
  })

  it('requires a required parameter', () => {
    const seed = { ...ORB_SEED, strategy: 'tsmom', params: {} }
    const check = checkLaunch(initialDraft(seed, TICKS_SPEC, NONE), seed, TICKS_SPEC, NONE)
    expect(check.errors['param:ticks']).toBe('ticks needs a value.')
  })
})

describe('toRequest', () => {
  it('is the one place that shapes the body the actions route takes', () => {
    expect(toRequest({ presetId: 't_p', params: { a: 1 }, start: '2010-01-01', end: null, runId: 't_a' })).toEqual({
      kind: 'backtest',
      preset_id: 't_p',
      params: { a: 1 },
      start: '2010-01-01',
      end: null,
      run_id: 't_a',
    })
  })
})

describe('seeds', () => {
  const row = { run_id: 't_a', exp_id: 'EXP1', strategy: 'za_orb', variant: 'vendor', start: '2010-06-01', end: '2022-01-01', params: { or_minutes: 30 }, params_json: null }

  it('reads a ledger row', () => {
    expect(seedFromLedgerRow(row as never)).toEqual({ sourceRunId: 't_a', expId: 'EXP1', strategy: 'za_orb', variant: 'vendor', start: '2010-06-01', end: '2022-01-01', params: { or_minutes: 30 } })
  })

  it('falls back to params_json, and gives nothing for a row that records no window or strategy', () => {
    const bare = { ...row, params: null, params_json: '{"or_minutes": 30}' }
    expect(seedFromLedgerRow(bare as never)?.params).toEqual({ or_minutes: 30 })
    expect(seedFromLedgerRow({ ...row, end: null } as never)).toBeNull()
    expect(seedFromLedgerRow({ ...row, strategy: null } as never)).toBeNull()
    expect(seedFromLedgerRow({ ...bare, params_json: 'not json' } as never)?.params).toEqual({})
  })

  it('reads a run summary and a preset', () => {
    const summary = { run_id: 't_a', strategy: 'za_orb', variant: 'vendor', start: '2010-06-01', end: '2022-01-01', params: { or_minutes: 30 }, ledger: { exp_id: 'EXP1', ts_utc: 'x' } }
    expect(seedFromRun({ summary } as never)).toMatchObject({ sourceRunId: 't_a', expId: 'EXP1', params: { or_minutes: 30 } })
    expect(seedFromRun({ summary: { ...summary, variant: null } } as never)).toBeNull()
    expect(seedFromPreset(ORB_PRESET)).toEqual(ORB_SEED)
  })

  it('matches a seed to the preset with the same strategy, variant, window and parameters', () => {
    expect(matchPreset(ORB_SEED, PRESETS.presets)).toBe(ORB_PRESET)
    expect(matchPreset({ ...ORB_SEED, sourceRunId: 't_other', params: { or_minutes: 46 } }, PRESETS.presets)).toBeNull()
  })

  it('matches by the run id first: a ledger row is its own preset', () => {
    expect(matchPreset({ ...ORB_SEED, params: { or_minutes: 46 } }, PRESETS.presets)).toBe(ORB_PRESET)
  })
})

describe('serverFieldKey', () => {
  const names = ['or_minutes', 'ticks']

  it('reads the field a refusal names from its words', () => {
    expect(serverFieldKey("Value error, parameters ['or_minutes'] do not belong to za_orb", names)).toBe('param:or_minutes')
    expect(serverFieldKey('Value error, tsmom needs params.ticks, one of (0, 1, 2)', names)).toBe('param:ticks')
    expect(serverFieldKey('Value error, start must be before end', names)).toBe('start')
    expect(serverFieldKey('end must be 2022-01-01 or earlier (the in-sample fence)', names)).toBe('end')
    expect(serverFieldKey('the run id t_a is already taken', names)).toBe('runId')
  })

  it('names no field when the words name none', () => {
    expect(serverFieldKey('the queue is full', names)).toBeNull()
  })
})
