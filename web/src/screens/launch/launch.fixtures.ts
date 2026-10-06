// Fixtures of the Start from flow: a strategy description as the presets route serves it, a preset and the seed a ledger
// row gives. The numbers are plain test values; none is a research result.
import type { LaunchSeed, Preset, PresetsView, StrategySpec } from './types'

/** A plain 64 hex test value standing for the sha256 of experiments/EXP12.json; not the hash of any real file. */
export const ORB_SPEC_SHA = 'a3f1c200000000000000000000000000000000000000000000000000009e7d4b'

export const ORB_SPEC: StrategySpec = {
  name: 'za_orb',
  params: [
    { name: 'or_minutes', kind: 'int', default: 30, min: 5, max: 120, choices: null, required: false, note: null },
    { name: 'stop_r', kind: 'float', default: 1.5, min: 0.25, max: 5, choices: null, required: false, note: null },
    { name: 'long_only', kind: 'bool', default: false, min: null, max: null, choices: null, required: false, note: null },
    { name: 'session', kind: 'text', default: 'rth', min: null, max: null, choices: ['rth', 'globex'], required: false, note: null },
  ],
}

export const TICKS_SPEC: StrategySpec = {
  name: 'tsmom',
  params: [
    { name: 'ticks', kind: 'int', default: null, min: 0, max: 2, choices: null, required: true, note: 'The cost level' },
    { name: 'lookbacks', kind: 'list', default: null, min: null, max: null, choices: null, required: false, note: null },
  ],
}

export const ORB_SEED: LaunchSeed = {
  sourceRunId: 't_EXP12_za_base',
  expId: 'EXP12',
  strategy: 'za_orb',
  variant: 'repaired',
  start: '2010-06-01',
  end: '2022-01-01',
  params: { or_minutes: 45, stop_r: 2 },
}

export const ORB_PRESET: Preset = {
  source_run_id: 't_EXP12_za_base',
  exp_id: 'EXP12',
  strategy: 'za_orb',
  variant: 'repaired',
  start: '2010-06-01',
  end: '2022-01-01',
  params: { or_minutes: 45, stop_r: 2 },
  spec_sha256: ORB_SPEC_SHA,
  runtime_s: 42,
  launchable: true,
  reasons: [],
}

/** The same preset when experiments/EXP12.json is not in the lab: the server serves no spec hash. */
export const ORB_PRESET_NO_SPEC: Preset = { ...ORB_PRESET, spec_sha256: null }

export const PRESETS: PresetsView = {
  presets: [
    ORB_PRESET,
    { ...ORB_PRESET, source_run_id: 't_EXP9_za_old', exp_id: 'EXP9', params: { or_minutes: 30 }, spec_sha256: null, runtime_s: null },
  ],
  strategies: [ORB_SPEC, TICKS_SPEC],
}
