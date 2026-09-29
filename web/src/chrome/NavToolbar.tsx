// NavToolbar (spec 4.2): the 21px nav toolbar plus its 1px rule, reflecting the focused panel. Left:
// `< >` back and forward, the linked context (`[A] NQ1 Index ▾`), the mnemonic (`GP ▾`) and `Related
// Functions Menu`. Right: the message glyph and a visible `Message` label with the kill switch and
// TWS state, favourite layouts, export CSV and the yellow help square. Dividers are 1px x 13px rules.
// Props only.
import type { ReactNode } from 'react'
import { withValue } from '../commands/messages'
import type { MnemonicCode } from '../commands/registry'
import { displayContext } from '../commands/sectors'
import type { ResolvedContext } from '../commands/types'
import { NAV_TOOLBAR } from '../copy/chrome'
import type { PanelLink } from '../state/linkGroups'
import { LinkChip } from './ContextStrip'
import type { KillState } from './StatusBar.format'
import './NavToolbar.css'

export type NavAction = 'back' | 'forward' | 'context' | 'mnemonic' | 'related' | 'favourites' | 'export' | 'help'

export interface NavFocus {
  readonly code: MnemonicCode
  readonly group: PanelLink
  readonly context: ResolvedContext | null
}

export interface NavToolbarProps {
  /** The focused panel, or null when none has focus. */
  readonly focused: NavFocus | null
  /** killState() of the health poll, so this reads the same as the status line. */
  readonly kill: KillState
  readonly onAction: (action: NavAction) => void
}

function NavButton({ action, label, children, onAction, className = '' }: { readonly action: NavAction; readonly label: string; readonly children: ReactNode; readonly onAction: (a: NavAction) => void; readonly className?: string }) {
  return (
    <button type="button" className={`nav-btn ${className}`} aria-label={label} onClick={() => onAction(action)}>
      {children}
    </button>
  )
}

const Divider = () => <span className="nav-div" aria-hidden="true" />

function contextButton(focused: NavFocus | null, onAction: (a: NavAction) => void) {
  if (!focused?.context) {
    return (
      <NavButton action="context" label={NAV_TOOLBAR.noContext} onAction={onAction}>
        <span aria-hidden="true">{`- ${NAV_TOOLBAR.menuGlyph}`}</span>
      </NavButton>
    )
  }
  const text = displayContext(focused.context, null)
  return (
    <NavButton action="context" label={withValue(NAV_TOOLBAR.contextLabel, text)} onAction={onAction}>
      {focused.group !== '-' ? <LinkChip group={focused.group} /> : null}
      <span aria-hidden="true">{` ${text} ${NAV_TOOLBAR.menuGlyph}`}</span>
    </NavButton>
  )
}

const KILL_TEXT: Readonly<Record<KillState, string>> = {
  off: NAV_TOOLBAR.killOff,
  on: NAV_TOOLBAR.killOn,
  reading: NAV_TOOLBAR.killReading,
  unknown: NAV_TOOLBAR.killUnknown,
}

export function NavToolbar({ focused, kill, onAction }: NavToolbarProps) {
  const code = focused?.code
  return (
    <div className="nav-toolbar" role="group" aria-label={NAV_TOOLBAR.label} data-chrome="nav">
      <div className="nav-left">
        <NavButton action="back" label={NAV_TOOLBAR.back} onAction={onAction}><span aria-hidden="true">{'<'}</span></NavButton>
        <NavButton action="forward" label={NAV_TOOLBAR.forward} onAction={onAction}><span aria-hidden="true">{'>'}</span></NavButton>
        <Divider />
        {contextButton(focused, onAction)}
        <Divider />
        <NavButton action="mnemonic" label={code ? withValue(NAV_TOOLBAR.mnemonicLabel, code) : NAV_TOOLBAR.noMnemonic} onAction={onAction}>
          <span aria-hidden="true">{`${code ?? '-'} ${NAV_TOOLBAR.menuGlyph}`}</span>
        </NavButton>
        <Divider />
        <NavButton action="related" label={NAV_TOOLBAR.related} onAction={onAction}>
          <span aria-hidden="true">{`${NAV_TOOLBAR.related} ${NAV_TOOLBAR.relatedGlyph}`}</span>
        </NavButton>
      </div>
      <div className="nav-right">
        <span className="nav-msg" data-kill={kill}>
          <span>
            <span aria-hidden="true">{`${NAV_TOOLBAR.messageGlyph} `}</span>
            <span className="nav-msg-label">{NAV_TOOLBAR.message}</span>
            <span className="sr-only">: </span>
          </span>
          <span className="nav-kill">{KILL_TEXT[kill]}</span>
          <span>{NAV_TOOLBAR.tws}</span>
        </span>
        <NavButton action="favourites" label={NAV_TOOLBAR.favourites} onAction={onAction}><span aria-hidden="true">{`${NAV_TOOLBAR.favouritesGlyph}${NAV_TOOLBAR.menuGlyph}`}</span></NavButton>
        <NavButton action="export" label={NAV_TOOLBAR.exportCsv} onAction={onAction}><span aria-hidden="true">{`${NAV_TOOLBAR.exportGlyph}${NAV_TOOLBAR.menuGlyph}`}</span></NavButton>
        <NavButton action="help" label={NAV_TOOLBAR.help} onAction={onAction} className="nav-help"><span aria-hidden="true">{`${NAV_TOOLBAR.helpGlyph}${NAV_TOOLBAR.menuGlyph}`}</span></NavButton>
      </div>
    </div>
  )
}
