// Types of the Start from flow. The wire shapes are the generated contract's (Schemas['PresetList'], Schemas['BacktestAction'],
// Schemas['ActionResult']); the interfaces here are the form's own reading of them (wire.ts converts), so the form never
// depends on the server's field names beyond that one module.
import type { Schemas } from '../../api/types'

/** How a parameter is typed and entered: a whole number, a decimal, a yes or no, a short text, or a JSON list of scalars. */
export type ParamKind = 'int' | 'float' | 'bool' | 'text' | 'list'

/** One named parameter of a registered strategy, as the server describes it. */
export interface ParamSpec {
  readonly name: string
  readonly kind: ParamKind
  /** The strategy's own default, or null when it has none. */
  readonly default: unknown
  /** The allowed range of a number, or null for no bound on that side. */
  readonly min: number | null
  readonly max: number | null
  /** The minimum itself is not allowed (the value must be above it). */
  readonly exclusiveMin?: boolean
  /** The allowed values of a text or number that takes a fixed set, or null. */
  readonly choices: readonly (string | number)[] | null
  /** The run cannot start without it (the feed's cost level, for one). */
  readonly required: boolean
  /** A short plain note for the field, or null. */
  readonly note: string | null
}

/** A registered strategy and the parameters it declares. */
export interface StrategySpec {
  readonly name: string
  readonly params: readonly ParamSpec[]
}

/** A ledger row offered as a starting point (GET /api/jobs/actions/presets, read through wire.ts). `source_run_id` is its preset id. */
export interface Preset {
  readonly source_run_id: string
  readonly exp_id: string | null
  readonly strategy: string
  readonly variant: string
  readonly start: string
  readonly end: string
  readonly params: Readonly<Record<string, unknown>>
  /** The sha256 of experiments/<exp_id>.json when the lab holds that spec file, else null (the preset is not tied to a spec). */
  readonly spec_sha256: string | null
  /** Typical run time of this configuration in seconds, from the ledger, or null. */
  readonly runtime_s: number | null
  /** False when the server would refuse the preset's own parameters as they stand; `reasons` says why. */
  readonly launchable: boolean
  readonly reasons: readonly string[]
}

/** The presets newest first and the parameters of every strategy the queue can run, in the form's own words. */
export interface PresetsView {
  readonly presets: readonly Preset[]
  readonly strategies: readonly StrategySpec[]
}

/** The body of POST /api/jobs/actions for a backtest: a preset, the parameters that were edited and the window. */
export type LaunchRequest = Schemas['BacktestAction']

/** Where a form starts from: the configuration of a ledger row, a run or a preset. */
export interface LaunchSeed {
  readonly sourceRunId: string
  readonly expId: string | null
  readonly strategy: string
  readonly variant: string
  readonly start: string
  readonly end: string
  readonly params: Readonly<Record<string, unknown>>
}
