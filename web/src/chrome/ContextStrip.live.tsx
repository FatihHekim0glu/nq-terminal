// The context strip on the link-group store. Instrument sector keys come from the known roots.
import { useLinkGroups, type PanelLink } from '../state/linkGroups'
import { ContextStrip } from './ContextStrip'

export interface LiveContextStripProps {
  /** The focused panel's link, if a panel has focus. */
  readonly focusedGroup: PanelLink | null
  /** The focused panel's number, or null. */
  readonly panelNumber?: number | null
}

export function LiveContextStrip({ focusedGroup, panelNumber = null }: LiveContextStripProps) {
  const contexts = useLinkGroups((state) => state.contexts)
  return <ContextStrip contexts={contexts} focusedGroup={focusedGroup === '-' ? null : focusedGroup} panelNumber={panelNumber} />
}
