// The mnemonic registry (UI_SPEC section 5): the single source for the parser, the suggestions and
// HELP. Codes, priorities and context rules equal the backend's constants.MNEMONICS
// (registry.test.ts reads that file and compares).
import { MNEMONIC_SCREENS } from '../copy/commands'
import type { ContextKind } from './types'

export type MnemonicCode = keyof typeof MNEMONIC_SCREENS
export type Priority = 'P0' | 'P1' | 'P2'

/** Context text exactly as the backend serves it. */
export type ContextRule =
  | 'none'
  | 'instrument'
  | 'hypothesis'
  | 'run'
  | 'universe'
  | 'hypothesis or instrument'
  | 'instrument or hypothesis'
  | 'run or hypothesis'

/** What may follow the function: nothing, one required date, or one optional timeframe. */
export type ArgumentRule = 'none' | 'date' | 'timeframe'

export interface MnemonicDef {
  readonly code: MnemonicCode
  readonly screen: string
  readonly priority: Priority
  readonly context: ContextRule
  /** Accepted context kinds in preference order; empty when the function takes none. */
  readonly accepts: readonly ContextKind[]
  readonly argument: ArgumentRule
}

export const TIMEFRAMES = ['1m', '5m', '1h', '1d'] as const

function accepts(rule: ContextRule): readonly ContextKind[] {
  if (rule === 'none') return []
  return rule.split(' or ') as ContextKind[]
}

function def(code: MnemonicCode, priority: Priority, context: ContextRule, argument: ArgumentRule = 'none'): MnemonicDef {
  return { code, screen: MNEMONIC_SCREENS[code], priority, context, accepts: accepts(context), argument }
}

export const MNEMONICS: readonly MnemonicDef[] = [
  def('HOME', 'P0', 'none'),
  def('GP', 'P0', 'instrument', 'timeframe'),
  def('GIP', 'P0', 'instrument', 'date'),
  def('DES', 'P0', 'hypothesis or instrument'),
  def('REG', 'P0', 'none'),
  def('MT', 'P0', 'none'),
  def('RUNS', 'P0', 'none'),
  def('RUN', 'P0', 'run'),
  def('EQ', 'P0', 'run or hypothesis'),
  def('DD', 'P0', 'run or hypothesis'),
  def('RET', 'P0', 'run or hypothesis'),
  def('RR', 'P0', 'run or hypothesis'),
  def('MRET', 'P0', 'run or hypothesis'),
  def('MON', 'P0', 'universe'),
  def('CORR', 'P0', 'universe'),
  def('LEDG', 'P0', 'none'),
  def('OOS', 'P0', 'none'),
  def('LIVE', 'P0', 'none'),
  def('JRNL', 'P0', 'none'),
  def('HELP', 'P0', 'none'),
  def('COST', 'P1', 'run or hypothesis'),
  def('BLK', 'P1', 'hypothesis'),
  def('EXPO', 'P1', 'run'),
  def('SEAL', 'P1', 'hypothesis'),
  def('VCONE', 'P1', 'instrument'),
  def('SEAS', 'P1', 'instrument or hypothesis'),
  def('EVT', 'P1', 'instrument'),
  def('ROLL', 'P1', 'instrument'),
  def('DQ', 'P1', 'instrument'),
  def('JOBS', 'P2', 'none'),
]

const BY_CODE: ReadonlyMap<string, MnemonicDef> = new Map(MNEMONICS.map((m) => [m.code, m]))

/** The mnemonic for a code typed in any case, or undefined. */
export function findMnemonic(code: string): MnemonicDef | undefined {
  return BY_CODE.get(code.toUpperCase())
}

/** Two-digit screen number for the status bar (`SCR 00 HOME`): the registry position. */
export function screenNumber(code: MnemonicCode): string {
  return String(MNEMONICS.findIndex((m) => m.code === code)).padStart(2, '0')
}
