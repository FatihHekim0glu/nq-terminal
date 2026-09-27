// Default layout per screen (UI_SPEC sections 2 and 7, look spec 7.1): one declarative, frozen table.
// WorkspaceModel turns a layout into dockview calls; the shape is chrome/WorkspaceLayouts.ts's
// ScreenLayout, unchanged, so the chrome can re-export this table in place of its own copy.
//   HOME  the 2x2 launchpad, about 19 grid rows per panel at 1080p: GP and MON in link group A, EQ in
//         group B, REG unlinked. LIVE and OOS open with Shift+Enter; they are not in the default.
//   REG   the registry board beside its multiple-testing view.
//   LIVE  the paper book above its journal tail.
// Every other screen opens as one unlinked panel with no context. validate.ts checks every entry.
import type { LayoutPanel, ScreenLayout } from '../../chrome/WorkspaceLayouts'
import { MNEMONICS, type MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'

/** Dockview panel ids of the HOME layout. Ids are kept when a command replaces a panel. */
export const HOME_PANEL_IDS = Object.freeze({ gp: 'home-gp', mon: 'home-mon', eq: 'home-eq', reg: 'home-reg' })

/** The build phase in TASKS.md that delivers each P0 screen (shown on a placeholder and in HELP). */
export const SCREEN_PHASES: Readonly<Partial<Record<MnemonicCode, string>>> = Object.freeze({
  HOME: '7', GP: '7', GIP: '7', MON: '7', CORR: '7', OOS: '7', LIVE: '7', JRNL: '7',
  DES: '6', REG: '6', MT: '6', RUNS: '6', RUN: '6', LEDG: '6',
  EQ: '6', DD: '6', RET: '6', RR: '6', MRET: '6',
  HELP: '4',
})

const NQ: ResolvedContext = { kind: 'instrument', value: 'NQ' }
const UNIVERSE: ResolvedContext = { kind: 'universe', value: '27F' }
const VOLMANAGED: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }

function freezeLayout(screen: MnemonicCode, panels: readonly LayoutPanel[]): ScreenLayout {
  const frozen = panels.map((p) => Object.freeze({ ...p, args: Object.freeze({ ...p.args }) }))
  return Object.freeze({ screen, panels: Object.freeze(frozen) })
}

// The left column is built first and then each row is split to the right, so the DOM (and with it
// the Tab order and the panel numbers) runs row by row: 1-GP, 2-MON, 3-EQ, 4-REG.
const HOME = freezeLayout('HOME', [
  { id: HOME_PANEL_IDS.gp, code: 'GP', context: NQ, args: { timeframe: '1d' }, group: 'A' },
  { id: HOME_PANEL_IDS.eq, code: 'EQ', context: VOLMANAGED, args: {}, group: 'B', position: { ref: HOME_PANEL_IDS.gp, direction: 'below' } },
  { id: HOME_PANEL_IDS.mon, code: 'MON', context: UNIVERSE, args: {}, group: 'A', position: { ref: HOME_PANEL_IDS.gp, direction: 'right' } },
  { id: HOME_PANEL_IDS.reg, code: 'REG', context: null, args: {}, group: '-', position: { ref: HOME_PANEL_IDS.eq, direction: 'right' } },
])

const REG = freezeLayout('REG', [
  { id: 'reg-board', code: 'REG', context: null, args: {}, group: '-' },
  { id: 'reg-mt', code: 'MT', context: null, args: {}, group: '-', position: { ref: 'reg-board', direction: 'right' } },
])

const LIVE = freezeLayout('LIVE', [
  { id: 'live-book', code: 'LIVE', context: null, args: {}, group: '-' },
  { id: 'live-jrnl', code: 'JRNL', context: null, args: {}, group: '-', position: { ref: 'live-book', direction: 'below' } },
])

const SPECIAL: ReadonlyMap<MnemonicCode, ScreenLayout> = new Map([
  ['HOME', HOME],
  ['REG', REG],
  ['LIVE', LIVE],
])

function singlePanel(code: MnemonicCode): ScreenLayout {
  return freezeLayout(code, [{ id: `${code.toLowerCase()}-main`, code, context: null, args: {}, group: '-' }])
}

export const DEFAULT_LAYOUTS: Readonly<Record<string, ScreenLayout>> = Object.freeze(
  Object.fromEntries(MNEMONICS.map((m) => [m.code, SPECIAL.get(m.code) ?? singlePanel(m.code)])),
)

/** The default layout of a screen. */
export function layoutFor(code: MnemonicCode): ScreenLayout {
  return DEFAULT_LAYOUTS[code] ?? singlePanel(code)
}
