// Number <GO> items of the DES tear sheet (look spec 7.3 numbering, UI_SPEC section 5). Tabs take 1 to 4
// (TabStrip); the boxes and their jumps follow the look spec's DES wireframe from 8; linked runs start at 14
// and sealed confirmations at 40, so the numbers a user learns stay put whichever page is shown.

export type DesTab = 'profile' | 'checks' | 'costs' | 'links'

export const DES_TABS: readonly DesTab[] = ['profile', 'checks', 'costs', 'links']

export const DES_NUMBERS = {
  equity: 8,
  mt: 9,
  checks: 10,
  costs: 11,
  registration: 12,
  runs: 13,
  firstRun: 14,
  firstConfirmation: 40,
} as const

/** At most this many linked runs are numbered (14 to 39). */
export const MAX_NUMBERED_RUNS = DES_NUMBERS.firstConfirmation - DES_NUMBERS.firstRun

export const runNumber = (i: number): number => DES_NUMBERS.firstRun + i
export const confirmationNumber = (i: number): number => DES_NUMBERS.firstConfirmation + i
