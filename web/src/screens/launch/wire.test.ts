import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { presetsView } from './wire'

const FIELD: Schemas['ParamField'] = {
  name: 'or_minutes', kind: 'int', default: 30, required: false, minimum: 5, maximum: 120, exclusive_minimum: false, choices: null, feed_key: false,
}

const LIST: Schemas['PresetList'] = {
  ledger_found: true,
  presets: [
    {
      preset_id: 't_EXP12_za_base', exp_id: 'EXP12', ts_utc: '2026-09-01T10:00:00Z', strategy: 'za_orb', variant: 'repaired', start: '2010-06-01', end: '2022-01-01',
      params: { or_minutes: 45 }, runtime_s: 41.5, run_found: true, launchable: true, reasons: [],
    },
    {
      preset_id: 't_bh', exp_id: null, ts_utc: null, strategy: 'volmanaged_bh', variant: 'vendor', start: '2010-06-01', end: '2022-01-01',
      params: { t0: '2012-01' }, runtime_s: null, run_found: false, launchable: false, reasons: ['t0 is not a launch parameter'],
    },
  ],
  strategies: [
    {
      strategy: 'za_orb',
      params: [
        FIELD,
        { ...FIELD, name: 'stop_r', kind: 'float', default: 1.5, minimum: 0, maximum: null, exclusive_minimum: true },
        { ...FIELD, name: 'session', kind: 'str', default: 'rth', minimum: null, maximum: null, choices: ['rth', 'globex'] },
        { ...FIELD, name: 't0', kind: 'month', default: null, required: true, minimum: null, maximum: null },
      ],
    },
  ],
}

describe('presetsView', () => {
  const view = presetsView(LIST)

  it('names a preset by its id and keeps its window, parameters, run time and launch state', () => {
    expect(view.presets[0]).toEqual({
      source_run_id: 't_EXP12_za_base', exp_id: 'EXP12', strategy: 'za_orb', variant: 'repaired', start: '2010-06-01', end: '2022-01-01',
      params: { or_minutes: 45 }, runtime_s: 41.5, launchable: true, reasons: [],
    })
    expect(view.presets[1]).toMatchObject({ exp_id: null, runtime_s: null, launchable: false, reasons: ['t0 is not a launch parameter'] })
  })

  it('reads each parameter field as the form types it', () => {
    const [orb] = view.strategies
    expect(orb?.name).toBe('za_orb')
    expect(orb?.params[0]).toEqual({ name: 'or_minutes', kind: 'int', default: 30, min: 5, max: 120, exclusiveMin: false, choices: null, required: false, note: null })
    expect(orb?.params[1]).toMatchObject({ kind: 'float', min: 0, max: null, exclusiveMin: true })
    expect(orb?.params[2]).toMatchObject({ kind: 'text', choices: ['rth', 'globex'] })
    expect(orb?.params[3]).toMatchObject({ kind: 'text', required: true })
  })

  it('says so when the ledger is missing: no presets, and no strategies to describe', () => {
    expect(presetsView({ ledger_found: false, presets: [], strategies: [] })).toEqual({ presets: [], strategies: [] })
  })
})
