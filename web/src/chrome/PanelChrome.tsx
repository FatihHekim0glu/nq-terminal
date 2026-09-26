// Panel chrome (look spec 4.3). Top to bottom:
//   title bar   `<panel no>-<MNEMONIC>`, the link-group square and the context at the left; bracket
//               tags, the T table toggle, `≡ Options` and maximise at the right; frame grey, black text
//   quote slot  the two-line quote header of instrument panels (QuoteHeader renders into it)
//   stage       red function bar slot, tab slot and the scrolling body, plus an optional overlay
//               (the related functions menu) whose dim covers the stage only
// The body is the panel's one Tab stop (roving tabindex, see WorkspaceFocus); every title-bar control
// is a roving item. The focused panel carries data-focused for its 1px command-blue line.
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { PANEL, fillCopy } from '../copy/workspace'
import DropdownMenu, { type MenuEntry } from './FunctionBar.menu'
import { CollectorContext, NumberingContext, mergeNumbered, type NumberCollector, type NumberedItem } from './PanelChrome.numbers'
import { PanelSlotsContext, type PanelSlots } from './PanelChrome.slots'
import Tooltip from './Tooltip'
import type { LinkGroup } from './WorkspaceLayouts'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR, usePanelRoving } from './WorkspaceFocus'
import './PanelChrome.css'

export interface PanelChromeProps {
  readonly panelId: string
  /** Position of the panel in reading order, shown as `<n>-<CODE>`. */
  readonly number?: number
  /** The mnemonic, e.g. "GP". */
  readonly code?: string
  /** `<context> <CODE> [argument]`, e.g. "NQ GP 1d": names the body and identifies the panel. */
  readonly title: string
  /** What the panel shows after the chip: context and argument, e.g. "NQ 1d". */
  readonly subject?: string
  readonly group: LinkGroup
  /** Bracket tags such as PRE-REG, POST HOC, SPENT, PLUMBING, UNUSABLE: BALANCE. */
  readonly tags?: readonly string[]
  /** The T toggle is shown only when the panel has a table view (both props given). */
  readonly tableView?: boolean
  readonly onTableViewChange?: (next: boolean) => void
  readonly focused?: boolean
  readonly maximised?: boolean
  readonly onToggleMaximise?: () => void
  readonly onRelated?: () => void
  readonly onBack?: () => void
  readonly onForward?: () => void
  /** Drawn over the stage (red bar and below), e.g. the related functions menu. */
  readonly overlay?: ReactNode
  /**
   * True (default): the panel is a region named by its title bar. Inside the workspace dockview's
   * group element is already that region, so the Workspace passes false.
   */
  readonly landmark?: boolean
  readonly children: ReactNode
}

const roving = { [ROVING_ATTR]: '' }

function LinkChip({ group }: { readonly group: Exclude<LinkGroup, '-'> }) {
  return (
    <span className="pchip" data-group={group}>
      <span aria-hidden="true">{group}</span>
      <span className="sr-only">{fillCopy(PANEL.linkChipLabel, { group })}</span>
    </span>
  )
}

interface OptionsProps {
  readonly title: string
  readonly entries: ReadonlyArray<MenuEntry>
}

function OptionsButton({ title, entries }: OptionsProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  return (
    <div className="ptitle-optwrap">
      <button
        ref={ref}
        type="button"
        className="ptitle-btn ptitle-opt"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        {...roving}
      >
        <span aria-hidden="true">≡</span> {PANEL.options}
      </button>
      {open ? (
        <DropdownMenu
          id={menuId}
          label={fillCopy(PANEL.optionsMenu, { title })}
          entries={entries}
          tone="dark"
          align="right"
          trigger={ref}
          onClose={(restore) => {
            setOpen(false)
            if (restore) ref.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

function optionEntries(props: PanelChromeProps): MenuEntry[] {
  const out: MenuEntry[] = []
  if (props.onRelated) out.push({ label: PANEL.related, onSelect: props.onRelated })
  if (props.onBack) out.push({ label: PANEL.back, onSelect: props.onBack })
  if (props.onForward) out.push({ label: PANEL.forward, onSelect: props.onForward })
  if (props.onToggleMaximise) {
    out.push({ label: props.maximised ? PANEL.restore : PANEL.maximise, onSelect: props.onToggleMaximise })
  }
  return out
}

function TitleTools(props: PanelChromeProps) {
  const { tags = [], tableView, onTableViewChange, maximised = false, onToggleMaximise, title } = props
  const entries = optionEntries(props)
  return (
    <div className="ptitle-tools">
      {tags.map((tag) => (
        <span key={tag} className="ptag">{`[${tag}]`}</span>
      ))}
      {tableView !== undefined && onTableViewChange ? (
        <Tooltip text={PANEL.tableViewLabel}>
          <button
            type="button"
            className="ptitle-btn"
            aria-label={PANEL.tableViewLabel}
            aria-pressed={tableView}
            onClick={() => onTableViewChange(!tableView)}
            {...roving}
          >
            {PANEL.tableViewKey}
          </button>
        </Tooltip>
      ) : null}
      {entries.length > 0 ? <OptionsButton title={title} entries={entries} /> : null}
      {onToggleMaximise ? (
        <Tooltip text={maximised ? PANEL.restore : PANEL.maximise}>
          <button
            type="button"
            className="ptitle-btn"
            aria-label={PANEL.maximise}
            aria-pressed={maximised}
            onClick={onToggleMaximise}
            {...roving}
          >
            <span aria-hidden="true">□</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}

/** Collects the numbered items of the panel's parts and registers them as one list. */
function usePanelNumbers(panelId: string): NumberCollector {
  const registrar = useContext(NumberingContext)
  const [sources, setSources] = useState<ReadonlyMap<string, ReadonlyArray<NumberedItem>>>(() => new Map())
  const collector = useMemo<NumberCollector>(
    () => ({
      set: (source, items) =>
        setSources((prev) => {
          const next = new Map(prev)
          if (items) next.set(source, items)
          else next.delete(source)
          return next
        }),
    }),
    [],
  )
  const merged = useMemo(() => mergeNumbered(sources), [sources])
  useEffect(() => (merged.length > 0 ? registrar(panelId, merged) : undefined), [registrar, panelId, merged])
  return collector
}

export default function PanelChrome(props: PanelChromeProps) {
  const { panelId, number, code, title, subject, group, focused = false, overlay, landmark = true, children } = props
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)
  usePanelRoving(ref)
  const [quote, setQuote] = useState<HTMLElement | null>(null)
  const [bar, setBar] = useState<HTMLElement | null>(null)
  const [tabs, setTabs] = useState<HTMLElement | null>(null)
  const slots = useMemo<PanelSlots>(() => ({ quote, bar, tabs }), [quote, bar, tabs])
  const collector = usePanelNumbers(panelId)
  const label = number !== undefined && code ? fillCopy(PANEL.number, { n: number, code }) : code
  return (
    <section
      ref={ref}
      className="nqt-panel"
      data-nqt-panel={panelId}
      data-nqt-title={title}
      data-group={group}
      data-focused={String(focused)}
      aria-labelledby={landmark ? titleId : undefined}
      role={landmark ? undefined : 'none'}
    >
      <div className="ptitle">
        <h2 id={titleId} className="ptitle-name">
          {label ? <span className="ptitle-no">{label}</span> : null}
          {group !== '-' ? <LinkChip group={group} /> : null}
          <span className="ptitle-ctx">{subject ?? (label ? '' : title)}</span>
        </h2>
        <TitleTools {...props} />
      </div>
      <CollectorContext value={collector}>
        <PanelSlotsContext value={slots}>
          <div className="pslot pslot-quote" ref={setQuote} />
          <div className="pstage">
            <div className="pslot pslot-bar" ref={setBar} />
            <div className="pslot pslot-tabs" ref={setTabs} />
            <div
              className="nqt-panel-body"
              role="group"
              aria-label={fillCopy(PANEL.bodyLabel, { title })}
              tabIndex={0}
              {...roving}
              {...{ [ROVING_DEFAULT_ATTR]: '' }}
            >
              {children}
            </div>
            {overlay}
          </div>
        </PanelSlotsContext>
      </CollectorContext>
    </section>
  )
}
