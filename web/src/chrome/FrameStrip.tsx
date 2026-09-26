// FrameStrip (spec 4.1 and 4.2): the 37px light-grey frame strip at the top of the window. An 8px top
// margin, then one 29px tab per layout (HOME, RESEARCH, LIVE, +); the active tab is dark and merges into
// the key toolbar, with a bold mnemonic then its title. On the right the READ ONLY and NO ORDER PATH
// chips, always shown, and `≡ Options` (event tape, colour scheme). No window glyphs: the browser tab
// has its own.
import { useRef, useState, type KeyboardEvent } from 'react'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import { FRAME_STRIP } from '../copy/chrome'
import './FrameStrip.css'

export type ColourScheme = 'standard' | 'deut' | 'prot'

export interface FrameStripProps {
  readonly screen: MnemonicCode
  readonly tapeOn: boolean
  readonly scheme: ColourScheme
  /** Open a layout by its screen mnemonic. */
  readonly onOpen: (screen: MnemonicCode) => void
  /** The + tab: start a new layout from the command line. */
  readonly onNew: () => void
  readonly onTape: () => void
  readonly onScheme: (scheme: ColourScheme) => void
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
  readonly onClick: () => void
}

function Tab({ id, label, title, active, onClick }: TabProps) {
  return (
    <button type="button" className="frame-tab" data-tab={id} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {active ? (
        <>
          <b>{label}</b>
          {` ${title}`}
        </>
      ) : (
        label
      )}
    </button>
  )
}

const SCHEMES: readonly ColourScheme[] = ['standard', 'deut', 'prot']

function Options({ tapeOn, scheme, onTape, onScheme }: Pick<FrameStripProps, 'tapeOn' | 'scheme' | 'onTape' | 'onScheme'>) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    button.current?.focus()
  }
  return (
    <div className="frame-options">
      <button ref={button} type="button" className="frame-btn" aria-expanded={open} aria-label={FRAME_STRIP.options} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{`${FRAME_STRIP.optionsGlyph} ${FRAME_STRIP.options}`}</span>
      </button>
      {open ? (
        <div className="frame-options-list" onKeyDown={close}>
          <button type="button" aria-pressed={tapeOn} onClick={onTape}>{FRAME_STRIP.tape}</button>
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
  const { screen, onOpen, onNew } = props
  const inLayout = LAYOUT_TABS.some((t) => t.screen === screen)
  const def = findMnemonic(screen)
  return (
    <div className="frame-strip" data-chrome="frame">
      <nav className="frame-tabs" aria-label={FRAME_STRIP.label}>
        {LAYOUT_TABS.map((t) => (
          <Tab key={t.id} id={t.id} label={FRAME_STRIP.tabs[t.id].label} title={FRAME_STRIP.tabs[t.id].title} active={t.screen === screen} onClick={() => onOpen(t.screen)} />
        ))}
        {!inLayout && def ? <Tab id={screen} label={screen} title={def.screen} active onClick={() => onOpen(screen)} /> : null}
        <button type="button" className="frame-tab frame-new" data-tab="new" aria-label={FRAME_STRIP.newTab} onClick={onNew}>
          <span aria-hidden="true">+</span>
        </button>
      </nav>
      <div className="frame-right">
        <div className="frame-flags" role="group" aria-label={FRAME_STRIP.safetyLabel}>
          <span className="frame-flag">{FRAME_STRIP.readOnly}</span>
          <span className="frame-flag">{FRAME_STRIP.noOrderPath}</span>
        </div>
        <Options tapeOn={props.tapeOn} scheme={props.scheme} onTape={props.onTape} onScheme={props.onScheme} />
      </div>
    </div>
  )
}
