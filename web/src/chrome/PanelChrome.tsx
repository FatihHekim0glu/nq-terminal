// Panel chrome (UI_SPEC sections 2 and 8): SIGNAL's .panel-head compacted to 28px, carrying the
// link chip, the title, the screen name, bracket tags and an optional table-view toggle. The body is
// the panel's one Tab stop (roving tabindex, see WorkspaceFocus), a named group rather than a second
// landmark, so each panel adds one region to the landmark list.
import { useId, useRef, type ReactNode } from 'react'
import { PANEL, fillCopy } from '../copy/workspace'
import type { LinkGroup } from './WorkspaceLayouts'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR, usePanelRoving } from './WorkspaceFocus'
import './PanelChrome.css'

export interface PanelChromeProps {
  readonly panelId: string
  /** `<context> <CODE> [argument]`, e.g. "NQ GP 1d"; names the panel region. */
  readonly title: string
  /** The screen name from the mnemonic registry. */
  readonly screen: string
  readonly group: LinkGroup
  /** Bracket tags such as PRE-REG, POST HOC, SPENT, PLUMBING, UNUSABLE: BALANCE. */
  readonly tags?: readonly string[]
  /** The toggle is shown only when the panel has a table view (both props given). */
  readonly tableView?: boolean
  readonly onTableViewChange?: (next: boolean) => void
  /**
   * True (default): the panel is a region named by its title. Inside the workspace dockview's group
   * element is already that region (named by the same title), so the Workspace passes false.
   */
  readonly landmark?: boolean
  readonly children: ReactNode
}

const roving = { [ROVING_ATTR]: '' }

function LinkChip({ group }: { readonly group: LinkGroup }) {
  const label = group === '-' ? PANEL.linkChipNone : fillCopy(PANEL.linkChipLabel, { group })
  return (
    <span className="link-chip" data-group={group}>
      <span aria-hidden="true">{`[${group}]`}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function TableToggle({ on, onChange }: { readonly on: boolean; readonly onChange: (next: boolean) => void }) {
  return (
    <button type="button" className="panel-toggle" aria-pressed={on} onClick={() => onChange(!on)} {...roving}>
      {PANEL.tableViewLabel}
    </button>
  )
}

export default function PanelChrome(props: PanelChromeProps) {
  const { panelId, title, screen, group, tags = [], tableView, onTableViewChange, landmark = true, children } = props
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)
  usePanelRoving(ref)
  const hasToggle = tableView !== undefined && onTableViewChange !== undefined
  return (
    <section
      ref={ref}
      className="panel nqt-panel"
      data-nqt-panel={panelId}
      data-group={group}
      aria-labelledby={landmark ? titleId : undefined}
      role={landmark ? undefined : 'none'}
    >
      <div className="panel-head">
        <div className="panel-id">
          <LinkChip group={group} />
          <h2 id={titleId} className="eyebrow panel-title" title={title}>{title}</h2>
          <span className="panel-screen" title={screen}>{screen}</span>
        </div>
        <div className="panel-tools">
          {tags.map((tag) => (
            <span key={tag} className="tag-b">{tag}</span>
          ))}
          {hasToggle ? <TableToggle on={tableView} onChange={onTableViewChange} /> : null}
        </div>
      </div>
      <div
        className="panel-body nqt-panel-body"
        role="group"
        aria-label={fillCopy(PANEL.bodyLabel, { title })}
        tabIndex={0}
        {...roving}
        {...{ [ROVING_DEFAULT_ATTR]: '' }}
      >
        {children}
      </div>
    </section>
  )
}
