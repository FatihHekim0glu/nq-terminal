// Built screens by mnemonic. A mnemonic missing here renders WorkspacePlaceholder, so every command
// resolves to a labelled panel. Each screen is registered through lazy(), so its code (and its chart
// libraries) loads only when a panel shows it; ScreenPanel wraps every screen in Suspense. Screen
// folders are imported dynamically only: an index.ts re-exports its components, so a static import
// from the shell would load them eagerly.
import { lazy, type ComponentType } from 'react'
import type { MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { withHomeEquity } from '../screens/home/homeVariant'
import type { PanelParams } from './WorkspaceLayouts'

export interface ScreenProps {
  readonly params: PanelParams
  /** The context to show: the panel's link-group context when the screen accepts it, else its own. */
  readonly context: ResolvedContext | null
}

export type ScreenRegistry = Readonly<Partial<Record<MnemonicCode, ComponentType<ScreenProps>>>>

const HelpScreen = lazy(() => import('../screens/help/HelpScreen'))
const HomeScreen = lazy(() => import('../screens/home/HomeScreen'))

// 6.1 REG and MT
const RegScreen = lazy(() => import('../screens/reg/RegScreen'))
const MtScreen = lazy(() => import('../screens/reg/MtScreen'))
// 6.2 DES
const DesScreen = lazy(() => import('../screens/des'))
// 6.3 RUNS, RUN and LEDG
const runsScreens = () => import('../screens/runs')
const RunsScreen = lazy(() => runsScreens().then((m) => ({ default: m.RunsScreen })))
const RunScreen = lazy(() => runsScreens().then((m) => ({ default: m.RunScreen })))
const LedgScreen = lazy(() => import('../screens/ledg').then((m) => ({ default: m.LedgScreen })))
// 6.4 the analytics tear sheet, one screen for five mnemonics
const TearSheet = lazy(() => import('../screens/tear'))
// 7.1 GP and GIP
const gpScreens = () => import('../screens/gp')
const GpScreen = lazy(() => gpScreens().then((m) => ({ default: m.GPScreen })))
const GipScreen = lazy(() => gpScreens().then((m) => ({ default: m.GIPScreen })))
// 7.2 MON and CORR
const MonScreen = lazy(() => import('../screens/mon/MonScreen'))
const CorrScreen = lazy(() => import('../screens/corr/CorrScreen'))
// 7.3 OOS, LIVE and JRNL
const OosScreen = lazy(() => import('../screens/oos'))
const liveScreens = () => import('../screens/live')
const LiveScreen = lazy(() => liveScreens().then((m) => ({ default: m.LiveScreen })))
const JrnlScreen = lazy(() => liveScreens().then((m) => ({ default: m.JrnlScreen })))
// 9.4 COST, BLK, EXPO and SEAL, each its own screen
const CostScreen = lazy(() => import('../screens/cost/CostScreen'))
const BlkScreen = lazy(() => import('../screens/blk/BlkScreen'))
const ExpoScreen = lazy(() => import('../screens/expo/ExpoScreen'))
const SealScreen = lazy(() => import('../screens/seal/SealScreen'))

function HelpPanel() {
  return <HelpScreen built={builtScreens(BUILT_SCREENS)} />
}

export const BUILT_SCREENS: ScreenRegistry = {
  HELP: HelpPanel,
  HOME: HomeScreen,
  REG: RegScreen,
  MT: MtScreen,
  DES: DesScreen,
  RUNS: RunsScreen,
  RUN: RunScreen,
  LEDG: LedgScreen,
  // HOME's panel 3 (dockview id home-eq) shows the light HOME equity panel; every other EQ panel
  // shows the full tear sheet.
  EQ: withHomeEquity(TearSheet),
  DD: TearSheet,
  RET: TearSheet,
  RR: TearSheet,
  MRET: TearSheet,
  GP: GpScreen,
  GIP: GipScreen,
  MON: MonScreen,
  CORR: CorrScreen,
  OOS: OosScreen,
  LIVE: LiveScreen,
  JRNL: JrnlScreen,
  COST: CostScreen,
  BLK: BlkScreen,
  EXPO: ExpoScreen,
  SEAL: SealScreen,
}

export function builtScreens(registry: ScreenRegistry): ReadonlySet<string> {
  return new Set(Object.keys(registry))
}
