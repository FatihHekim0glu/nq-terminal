// The 50px command zone (spec 4.1 and 4.2): a 6px gap, the 22px global command box with the zone's
// right side (the focused panel's number and the link groups, decision D3), then the 21px message line.
// The one global box reads as the focused panel's command line. A #go= link in the address bar replays
// through it from here (useDeepLinks, mounted by chrome/DeepLinks.tsx), once, so it runs exactly like the same lines
// typed. The reader loads on demand: the shell carries none of its code (scripts/shellBudget.test.ts).
import { useEffect, useState, type ComponentType, type Ref } from 'react'
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

let readerLoad: Promise<ComponentType> | null = null

/** The reader component, fetched once; a failed fetch is forgotten so the next mount tries again. */
function loadReader(): Promise<ComponentType> {
  readerLoad ??= import('./chrome/DeepLinks').then(
    (m) => m.default,
    (error: unknown) => {
      readerLoad = null
      throw error
    },
  )
  return readerLoad
}

/**
 * Fetches the link reader once the zone has mounted and renders it. The address bar keeps its link until the reader has
 * arrived (it reads the fragment when it mounts), so nothing is lost by the wait. A chunk that cannot be fetched is
 * dropped without a word: a link then does nothing, and the terminal is otherwise as before.
 */
function DeepLinksOnDemand() {
  const [Reader, setReader] = useState<ComponentType | null>(null)
  useEffect(() => {
    let live = true
    loadReader().then(
      (component) => {
        if (live) setReader(() => component)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])
  return Reader ? <Reader /> : null
}

export default function CommandZone({ commandRef, focusedGroup, panelNumber, ...rest }: CommandZoneProps) {
  return (
    <div className="nqt-cmdzone" data-chrome="zone">
      <DeepLinksOnDemand />
      <LiveCommandLine {...rest} ref={commandRef} focusedGroup={focusedGroup} aside={<LiveContextStrip focusedGroup={focusedGroup} panelNumber={panelNumber} />} />
    </div>
  )
}
