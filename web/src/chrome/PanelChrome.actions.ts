// What a screen may ask of the panel it sits in: the related functions menu, back and forward in
// the panel's own history, and opening another function in the same panel. The Workspace provides
// it; outside a workspace every action reports false and does nothing.
import { createContext, useContext } from 'react'
import type { MnemonicCode } from '../commands/registry'

export interface PanelActions {
  readonly panelId: string
  related(): boolean
  back(): boolean
  forward(): boolean
  open(code: MnemonicCode): boolean
}

const none: PanelActions = {
  panelId: '',
  related: () => false,
  back: () => false,
  forward: () => false,
  open: () => false,
}

export const PanelActionsContext = createContext<PanelActions>(none)

export function usePanelActions(): PanelActions {
  return useContext(PanelActionsContext)
}
