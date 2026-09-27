// GP and GIP screens (TASKS 7.1). The workspace registers them by mnemonic in
// src/chrome/WorkspaceScreens.tsx through lazy(), importing this folder dynamically so the screen and
// its chart library load only when a panel shows GP or GIP:
//   const GpScreens = () => import('../screens/gp')
//   GP: lazy(() => GpScreens().then((m) => ({ default: m.GPScreen }))),
//   GIP: lazy(() => GpScreens().then((m) => ({ default: m.GIPScreen }))),
import type { MnemonicCode } from '../../commands/registry'

export { GIPScreen, GPScreen, GpScreen } from './GpScreen'
export type { GpScreenProps } from './GpScreen'

export interface ScreenMeta {
  readonly code: MnemonicCode
  /** The red bar title (look spec 7.6). */
  readonly title: string
  /** Look spec 7.6 model: the reference function each screen follows. */
  readonly model: string
  readonly argument: 'timeframe' | 'date'
}

/** The mnemonics this folder builds; the registry (src/commands/registry.ts) already lists both. */
export const GP_SCREEN_META: readonly ScreenMeta[] = [
  { code: 'GP', title: 'Candle chart', model: 'GP candle chart, 2018 lossless capture and the 2021 GPC', argument: 'timeframe' },
  { code: 'GIP', title: 'Intraday chart', model: 'GIP intraday chart, GP chrome with bar-size buttons', argument: 'date' },
]
