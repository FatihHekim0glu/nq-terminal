// The mnemonics that open a built screen: the keys of chrome/WorkspaceScreens.tsx BUILT_SCREENS,
// listed here without the lazy screen imports so the suggestions and the menus can read them from the
// commands layer (built.test.ts holds the two lists equal). Every P0 and P1 screen is built; JOBS, the
// P2 slot, renders the placeholder and stays out.
import type { MnemonicCode } from './registry'

export const BUILT_CODES: ReadonlySet<MnemonicCode> = new Set<MnemonicCode>([
  'HOME', 'GP', 'GIP', 'DES', 'REG', 'MT', 'RUNS', 'RUN', 'EQ', 'DD', 'RET', 'RR', 'MRET', 'MON', 'CORR', 'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP',
  'COST', 'BLK', 'EXPO', 'SEAL', 'VCONE', 'SEAS', 'EVT', 'ROLL', 'DQ',
])

/** Whether `code`, exactly as the registry spells it, opens a built screen. */
export function isBuilt(code: string): boolean {
  return (BUILT_CODES as ReadonlySet<string>).has(code)
}
