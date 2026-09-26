// Default layout per screen (UI_SPEC sections 2 and 7). Declarative data: WorkspaceModel turns it
// into dockview calls. Phase 7.4 may move these into src/screens/layouts/; the shape stays.
import { MNEMONICS, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import type { CommandArgs } from '../commands/parser'
import type { PanelLink } from '../state/linkGroups'

/** A panel's link group: A, B, C, or '-' for unlinked (the link-group store's PanelLink). */
export type LinkGroup = PanelLink

/** What a panel shows. JSON only, because dockview keeps it in the serialised layout. */
export interface PanelParams {
  readonly code: MnemonicCode
  readonly context: ResolvedContext | null
  readonly args: CommandArgs
  readonly group: LinkGroup
}

export type SplitDirection = 'right' | 'below'

export interface LayoutPanel extends PanelParams {
  readonly id: string
  /** Where the panel goes relative to an earlier panel of the same layout; the first has none. */
  readonly position?: { readonly ref: string; readonly direction: SplitDirection }
}

export interface ScreenLayout {
  readonly screen: MnemonicCode
  readonly panels: readonly LayoutPanel[]
}

/** The build phase in TASKS.md that delivers each P0 screen (shown on its placeholder). */
export const SCREEN_PHASES: Readonly<Partial<Record<MnemonicCode, string>>> = {
  HOME: '7', GP: '7', GIP: '7', MON: '7', CORR: '7', OOS: '7', LIVE: '7', JRNL: '7',
  DES: '6', REG: '6', MT: '6', RUNS: '6', RUN: '6', LEDG: '6',
  EQ: '6', DD: '6', RET: '6', RR: '6', MRET: '6',
  HELP: '4',
}

const NQ: ResolvedContext = { kind: 'instrument', value: 'NQ' }
const UNIVERSE: ResolvedContext = { kind: 'universe', value: '27F' }
const VOLMANAGED: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }

// HOME wireframe, UI_SPEC section 7: three rows of two panels. Rows are built first and then split,
// so the DOM, and with it the Tab order, runs row by row in reading order.
const HOME: ScreenLayout = {
  screen: 'HOME',
  panels: [
    { id: 'home-gp', code: 'GP', context: NQ, args: { timeframe: '1d' }, group: 'A' },
    { id: 'home-eq', code: 'EQ', context: VOLMANAGED, args: {}, group: 'B', position: { ref: 'home-gp', direction: 'below' } },
    { id: 'home-live', code: 'LIVE', context: null, args: {}, group: '-', position: { ref: 'home-eq', direction: 'below' } },
    { id: 'home-mon', code: 'MON', context: UNIVERSE, args: {}, group: 'A', position: { ref: 'home-gp', direction: 'right' } },
    { id: 'home-reg', code: 'REG', context: null, args: {}, group: '-', position: { ref: 'home-eq', direction: 'right' } },
    { id: 'home-oos', code: 'OOS', context: null, args: {}, group: '-', position: { ref: 'home-live', direction: 'right' } },
  ],
}

// REG sits beside its multiple-testing view (UI_SPEC section 7, "REG and MT").
const REG: ScreenLayout = {
  screen: 'REG',
  panels: [
    { id: 'reg-board', code: 'REG', context: null, args: {}, group: '-' },
    { id: 'reg-mt', code: 'MT', context: null, args: {}, group: '-', position: { ref: 'reg-board', direction: 'right' } },
  ],
}

// LIVE sits above its journal tail (UI_SPEC section 7, "LIVE and JRNL").
const LIVE: ScreenLayout = {
  screen: 'LIVE',
  panels: [
    { id: 'live-book', code: 'LIVE', context: null, args: {}, group: '-' },
    { id: 'live-jrnl', code: 'JRNL', context: null, args: {}, group: '-', position: { ref: 'live-book', direction: 'below' } },
  ],
}

const SPECIAL: ReadonlyMap<MnemonicCode, ScreenLayout> = new Map([
  ['HOME', HOME],
  ['REG', REG],
  ['LIVE', LIVE],
])

function singlePanel(code: MnemonicCode): ScreenLayout {
  return { screen: code, panels: [{ id: `${code.toLowerCase()}-main`, code, context: null, args: {}, group: '-' }] }
}

export const DEFAULT_LAYOUTS: Readonly<Record<string, ScreenLayout>> = Object.freeze(
  Object.fromEntries(MNEMONICS.map((m) => [m.code, SPECIAL.get(m.code) ?? singlePanel(m.code)])),
)

export function layoutFor(code: MnemonicCode): ScreenLayout {
  return DEFAULT_LAYOUTS[code] ?? singlePanel(code)
}
