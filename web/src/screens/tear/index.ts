// The analytics tear sheet (TASKS 6.4): one screen for the five mnemonics EQ, DD, RET, RR and MRET,
// which open the matching tab of the same panel. The workspace registers the default export once per
// mnemonic through lazy(), so the screen and its chart libraries load only when a panel shows it.
import TearSheet, { TEAR_CODES, isTearCode, tearTarget, type TearCode } from './TearSheet'

export default TearSheet
export { TEAR_CODES, isTearCode, tearTarget }
export type { TearCode }

/** Registry metadata for the merge step: each mnemonic, its screen title and the context it takes. */
export const TEAR_MNEMONICS: ReadonlyArray<{ readonly code: TearCode; readonly tab: number; readonly context: 'run or hypothesis' }> =
  TEAR_CODES.map((code, i) => ({ code, tab: i + 1, context: 'run or hypothesis' }))
