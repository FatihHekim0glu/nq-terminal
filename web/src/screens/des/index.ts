// DES screen (TASKS 6.2) for the workspace. The merge step registers it in src/chrome/WorkspaceScreens.tsx
// through lazy(), so its code and chart libraries load only when a panel shows DES:
//   const DesScreen = lazy(() => import('../screens/des'))
//   export const BUILT_SCREENS: ScreenRegistry = { HELP: HelpPanel, DES: DesScreen, ... }
import type { MnemonicCode } from '../../commands/registry'
import DesScreen from './DesScreen'

export default DesScreen
export { DesScreen }

/** What the workspace needs to know about this screen: its mnemonic and the contexts it accepts. */
export const DES_SCREEN = {
  code: 'DES' as MnemonicCode,
  accepts: ['hypothesis', 'instrument'] as const,
  phase: '6.2',
} as const
