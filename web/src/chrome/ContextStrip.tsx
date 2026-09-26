// ContextStrip (UI_SPEC section 8): one chip per link group, showing the context its panels follow.
import type { ResolvedContext } from '../commands/types'
import { CONTEXT_STRIP } from '../copy/chrome'
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
}

export function ContextStrip({ contexts, focusedGroup = null }: ContextStripProps) {
  return (
    <div className="ctx ctx-strip" role="group" aria-label={CONTEXT_STRIP.label}>
      <ul className="ctx-list">
        {LINK_GROUP_IDS.map((group) => {
          const value = contexts[group]?.value ?? null
          const focused = group === focusedGroup
          return (
            <li
              key={group}
              className={focused ? 'chip focused' : 'chip'}
              data-group={group}
              aria-current={focused ? 'true' : undefined}
            >
              <span className="grp">{`[${group}]`}</span>
              <span className="val" title={value ?? undefined}>
                {value ?? CONTEXT_STRIP.empty}
              </span>
              {focused ? <span className="sr-only">{CONTEXT_STRIP.focused}</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
