// The `96) Actions` red-bar menu the Phase 7.3 screens share (look spec 4.4): related functions, and
// back and forward in the panel's own history, through the panel actions the workspace provides.
import type { FunctionBarItem } from '../../chrome/FunctionBar'
import type { PanelActions } from '../../chrome/PanelChrome.actions'
import { FUNCTION_BAR, FUNCTION_NUMBERS, PANEL } from '../../copy/workspace'

export function actionsItem(actions: PanelActions): FunctionBarItem {
  return {
    n: FUNCTION_NUMBERS.actions,
    label: FUNCTION_BAR.actions,
    menu: [
      { label: PANEL.related, onSelect: () => actions.related() },
      { label: PANEL.back, onSelect: () => actions.back() },
      { label: PANEL.forward, onSelect: () => actions.forward() },
    ],
  }
}
