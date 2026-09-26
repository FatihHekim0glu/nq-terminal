// Structural types for the two API responses the chrome reads. They mirror
// components['schemas']['CommandIndex'] and ['Health'] in src/api/schema.d.ts (generated from
// terminal/contract/openapi.json), keeping only the fields the chrome uses, so the generated
// types are assignable to them without a cast.

export interface InstrumentData {
  readonly root: string
  readonly symbol: string
  readonly sector: string
}

export interface MnemonicData {
  readonly code: string
  readonly screen: string
  readonly priority: string
  readonly context: string
}

/** GET /api/commands */
export interface CommandIndexData {
  readonly grammar: string
  readonly mnemonics: readonly MnemonicData[]
  readonly instruments: readonly InstrumentData[]
  readonly universe: readonly string[]
  readonly hypotheses: readonly string[]
  readonly confirmations: readonly string[]
  readonly runs: readonly string[]
  readonly registry_error: string | null
}

/** GET /api/health, the fields the status bar shows. */
export interface HealthData {
  readonly fence: { readonly is_start: string; readonly is_end: string }
  readonly kill_switch_on: boolean
  readonly gate_reads_this_process: number
  readonly fixture_mode: boolean
}

export type ContextKind = 'instrument' | 'hypothesis' | 'run' | 'universe'

export interface ResolvedContext {
  readonly kind: ContextKind
  readonly value: string
}
