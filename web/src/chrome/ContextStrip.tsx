// ContextStrip (spec 4.2, zone right side, and 4.11): the focused panel's number, so the one global
// command box reads as that panel's command line (decision D3), then one chip per link group with the
// context its panels follow. Each group is a 14px square in the group colour with a black letter;
// the letter always travels with the colour. Instruments show as generic tickers (`NQ1 Index`).
import { displayContext } from '../commands/sectors'
import type { CommandIndexData, ResolvedContext } from '../commands/types'
import { CONTEXT_STRIP } from '../copy/chrome'
import { withValue } from '../commands/messages'
import './ContextStrip.css'

export const LINK_GROUP_IDS = ['A', 'B', 'C'] as const
export type LinkGroupId = (typeof LINK_GROUP_IDS)[number]

/** The context each link group holds (an instrument root, hypothesis, run id or 27F), or null.
 *  Same shape as the link-group store (src/state/linkGroups.ts), so its `contexts` pass straight in. */
export type LinkContexts = Readonly<Record<LinkGroupId, ResolvedContext | null>>

export interface ContextStripProps {
  readonly contexts: LinkContexts
  /** The link group of the focused panel, if it has one. */
  readonly focusedGroup?: LinkGroupId | null
  /** The focused panel's number (1 is the first panel in reading order), or null when none has focus. */
  readonly panelNumber?: number | null
  /** GET /api/commands, for each instrument's sector key; null shows the known roots' keys. */
  readonly index?: CommandIndexData | null
}

/** A link-group chip: the letter on a square in the group colour (spec 4.11). */
export function LinkChip({ group }: { readonly group: LinkGroupId }) {
  return (
    <span className="ctx-chip" data-link={group}>
      {group}
    </span>
  )
}

export function ContextStrip({ contexts, focusedGroup = null, panelNumber = null, index = null }: ContextStripProps) {
  return (
    <div className="ctx-strip" role="group" aria-label={CONTEXT_STRIP.label}>
      {panelNumber !== null ? (
        <span className="ctx-panel-wrap">
          <span className="ctx-panel" aria-hidden="true">{panelNumber}</span>
          <span className="sr-only">{withValue(CONTEXT_STRIP.panelNumber, String(panelNumber))}</span>
        </span>
      ) : null}
      <ul className="ctx-list">
        {LINK_GROUP_IDS.map((group) => {
          const context = contexts[group]
          const text = displayContext(context, index)
          const focused = group === focusedGroup
          return (
            <li key={group} className={focused ? 'ctx-item focused' : 'ctx-item'} aria-current={focused ? 'true' : undefined}>
              <LinkChip group={group} />
              <span className="val" title={context?.value}>
                {context ? text : CONTEXT_STRIP.empty}
              </span>
              {focused ? <span className="sr-only">{CONTEXT_STRIP.focused}</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
