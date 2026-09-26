// The context strip on the link-group store.
import { useLinkGroups, type PanelLink } from '../state/linkGroups'
import { ContextStrip } from './ContextStrip'

export interface LiveContextStripProps {
  /** The focused panel's link, if a panel has focus. */
  readonly focusedGroup: PanelLink | null
}

export function LiveContextStrip({ focusedGroup }: LiveContextStripProps) {
  const contexts = useLinkGroups((state) => state.contexts)
  return <ContextStrip contexts={contexts} focusedGroup={focusedGroup === '-' ? null : focusedGroup} />
}
