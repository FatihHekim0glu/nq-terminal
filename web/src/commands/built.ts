// The mnemonics that open a built screen: the keys of chrome/WorkspaceScreens.tsx BUILT_SCREENS,
// listed here without the lazy screen imports so the suggestions and the menus can read them from the
// commands layer (built.test.ts holds the two lists equal). Every mnemonic opens a built screen: P0, P1 and, since
// the P2 build (U3), JOBS, the backtest queue.
import type { MnemonicCode } from './registry'

export const BUILT_CODES: ReadonlySet<MnemonicCode> = new Set<MnemonicCode>([
  'HOME', 'GP', 'GIP', 'DES', 'REG', 'MT', 'RUNS', 'RUN', 'EQ', 'DD', 'RET', 'RR', 'MRET', 'MON', 'CORR', 'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP',
  'COST', 'BLK', 'EXPO', 'SEAL', 'VCONE', 'SEAS', 'EVT', 'ROLL', 'DQ', 'JOBS',
])

/** Whether `code`, exactly as the registry spells it, opens a built screen. */
export function isBuilt(code: string): boolean {
  return (BUILT_CODES as ReadonlySet<string>).has(code)
}
