// FrameStrip (spec 4.1 and 4.2): the 37px light-grey frame strip at the top of the window. An 8px top
// margin, then one 29px tab per layout (HOME, RESEARCH, LIVE, +); the active tab is dark and merges into
// the key toolbar, with a bold mnemonic then its title. The active tab is the layout owner: the screen
// whose layout the panels are arranged under (a command that only replaces or adds a panel leaves it
// alone), with an edited `*` when the viewer has a saved layout for it. On the right the READ ONLY and
// NO ORDER PATH chips, always shown, then DEMO DATA in the demo only (src/demo/boot.tsx marks the
// page), and `≡ Options` (event tape, colour scheme, Undo layout change, Reset this layout). No window
// glyphs: the browser tab has its own.
import { useRef, useState, type KeyboardEvent } from 'react'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import { FRAME_STRIP } from '../copy/chrome'
import { LAYOUT } from '../copy/layout'
import './FrameStrip.css'

export type ColourScheme = 'standard' | 'deut' | 'prot'

export interface FrameStripProps {
  /** The layout owner: the screen whose layout the panels are arranged under. */
  readonly screen: MnemonicCode
  /** The viewer has a saved layout for `screen`: its tab carries the edited mark. */
  readonly edited?: boolean
  readonly tapeOn: boolean
  readonly scheme: ColourScheme
  /** Open a layout by its screen mnemonic. */
  readonly onOpen: (screen: MnemonicCode) => void
  /** The + tab: start a new layout from the command line. */
  readonly onNew: () => void
  readonly onTape: () => void
  readonly onScheme: (scheme: ColourScheme) => void
  /** Options: undo the last layout change (the UNDO word). */
  readonly onUndo?: () => void
  /** Options: put this screen's layout back to its default (the RESET word). */
  readonly onReset?: () => void
}

type TabId = keyof typeof FRAME_STRIP.tabs

const LAYOUT_TABS: ReadonlyArray<{ readonly id: TabId; readonly screen: MnemonicCode }> = [
  { id: 'HOME', screen: 'HOME' },
  { id: 'RESEARCH', screen: 'REG' },
  { id: 'LIVE', screen: 'LIVE' },
]

interface TabProps {
  readonly id: string
  readonly label: string
  readonly title: string
  readonly active: boolean
  readonly edited?: boolean
  readonly onClick: () => void
}

/** Only the active tab (the layout owner) can be edited: an aria-hidden `*` by the mnemonic, and the
 * word for a screen reader after the title. */
function Tab({ id, label, title, active, edited, onClick }: TabProps) {
  return (
    <button type="button" className="frame-tab" data-tab={id} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {active ? (
        <>
          <b>{label}</b>
          {edited ? <span aria-hidden="true">{LAYOUT.editedMark}</span> : null}
          {` ${title}`}
          {edited ? <>{' '}<span className="sr-only">{LAYOUT.editedLabel}</span></> : null}
        </>
      ) : (
        label
      )}
    </button>
  )
}

const SCHEMES: readonly ColourScheme[] = ['standard', 'deut', 'prot']

/** Whether the demo boot marked the page (data-demo="on"): every answer is then fixture data. */
function isDemo(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.demo === 'on'
}

function Options({ tapeOn, scheme, onTape, onScheme, onUndo, onReset }: Pick<FrameStripProps, 'tapeOn' | 'scheme' | 'onTape' | 'onScheme' | 'onUndo' | 'onReset'>) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    button.current?.focus()
  }
  // UNDO and RESET run through the command line, which takes focus, so the list closes behind them.
  const layoutAction = (run: () => void) => {
    run()
    setOpen(false)
  }
  return (
    <div className="frame-options">
      <button ref={button} type="button" className="frame-btn" aria-expanded={open} aria-label={FRAME_STRIP.options} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{`${FRAME_STRIP.optionsGlyph} ${FRAME_STRIP.options}`}</span>
      </button>
      {open ? (
        <div className="frame-options-list" onKeyDown={close}>
          <button type="button" aria-pressed={tapeOn} onClick={onTape}>{FRAME_STRIP.tape}</button>
          {onUndo ? <button type="button" onClick={() => layoutAction(onUndo)}>{LAYOUT.undoOption}</button> : null}
          {onReset ? <button type="button" onClick={() => layoutAction(onReset)}>{LAYOUT.resetOption}</button> : null}
          <div role="group" aria-label={FRAME_STRIP.schemesLabel}>
            {SCHEMES.map((s) => (
              <button key={s} type="button" aria-pressed={scheme === s} onClick={() => onScheme(s)}>{FRAME_STRIP.schemes[s]}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function FrameStrip(props: FrameStripProps) {
  const { screen, edited, onOpen, onNew } = props
  const inLayout = LAYOUT_TABS.some((t) => t.screen === screen)
  const def = findMnemonic(screen)
  return (
    <div className="frame-strip" data-chrome="frame">
      <nav className="frame-tabs" aria-label={FRAME_STRIP.label}>
        {LAYOUT_TABS.map((t) => (
          <Tab key={t.id} id={t.id} label={FRAME_STRIP.tabs[t.id].label} title={FRAME_STRIP.tabs[t.id].title} active={t.screen === screen} edited={edited} onClick={() => onOpen(t.screen)} />
        ))}
        {!inLayout && def ? <Tab id={screen} label={screen} title={def.screen} active edited={edited} onClick={() => onOpen(screen)} /> : null}
        <button type="button" className="frame-tab frame-new" data-tab="new" aria-label={FRAME_STRIP.newTab} onClick={onNew}>
          <span aria-hidden="true">+</span>
        </button>
      </nav>
      <div className="frame-right">
        <div className="frame-flags" role="group" aria-label={FRAME_STRIP.safetyLabel}>
          <span className="frame-flag">{FRAME_STRIP.readOnly}</span>
          <span className="frame-flag">{FRAME_STRIP.noOrderPath}</span>
          {isDemo() ? <span className="frame-flag" data-flag="demo">{FRAME_STRIP.demoData}</span> : null}
        </div>
        <Options tapeOn={props.tapeOn} scheme={props.scheme} onTape={props.onTape} onScheme={props.onScheme} onUndo={props.onUndo} onReset={props.onReset} />
      </div>
    </div>
  )
}
