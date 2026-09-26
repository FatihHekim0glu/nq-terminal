// The 50px command zone (spec 4.1 and 4.2): a 6px gap, the 22px global command box with the zone's
// right side (the focused panel's number and the link groups, decision D3), then the 21px message line.
// The one global box reads as the focused panel's command line.
import type { Ref } from 'react'
import type { CommandLineHandle, CommandLineProps } from './chrome/CommandLine'
import { LiveCommandLine } from './chrome/CommandLine.live'
import { LiveContextStrip } from './chrome/ContextStrip.live'
import type { PanelLink } from './state/linkGroups'

export interface CommandZoneProps extends Omit<CommandLineProps, 'index' | 'indexError' | 'fallbackContext' | 'aside' | 'ref'> {
  readonly commandRef: Ref<CommandLineHandle>
  /** The focused panel's link, or null when no panel has focus. */
  readonly focusedGroup: PanelLink | null
  /** The focused panel's number, or null. */
  readonly panelNumber: number | null
}

export default function CommandZone({ commandRef, focusedGroup, panelNumber, ...rest }: CommandZoneProps) {
  return (
    <div className="nqt-cmdzone" data-chrome="zone">
      <LiveCommandLine {...rest} ref={commandRef} focusedGroup={focusedGroup} aside={<LiveContextStrip focusedGroup={focusedGroup} panelNumber={panelNumber} />} />
    </div>
  )
}
