// The one place the Start from flow reads the server's field names: the presets route's answer (Schemas['PresetList'])
// becomes the form's own view types. A parameter kind the form has no box for (month, date, str) is entered as short
// text and checked again by the server.
import type { Schemas } from '../../api/types'
import type { ParamKind, ParamSpec, Preset, PresetsView, StrategySpec } from './types'

type Field = Schemas['ParamField']
type Offered = Schemas['LaunchPreset']

const KINDS: Readonly<Record<Field['kind'], ParamKind>> = { int: 'int', float: 'float', str: 'text', month: 'text', date: 'text' }

function paramOf(field: Field): ParamSpec {
  return {
    name: field.name,
    kind: KINDS[field.kind],
    default: field.default ?? null,
    min: field.minimum,
    max: field.maximum,
    exclusiveMin: field.exclusive_minimum,
    choices: field.choices === null ? null : (field.choices as readonly (string | number)[]),
    required: field.required,
    note: null,
  }
}

function presetOf(preset: Offered): Preset {
  return {
    source_run_id: preset.preset_id,
    exp_id: preset.exp_id,
    strategy: preset.strategy,
    variant: preset.variant,
    start: preset.start,
    end: preset.end,
    params: preset.params,
    runtime_s: preset.runtime_s,
    launchable: preset.launchable,
    reasons: preset.reasons,
  }
}

export function presetsView(list: Schemas['PresetList']): PresetsView {
  return {
    presets: list.presets.map(presetOf),
    strategies: list.strategies.map((s): StrategySpec => ({ name: s.strategy, params: s.params.map(paramOf) })),
  }
}
