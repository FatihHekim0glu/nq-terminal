// The red function bar (look spec 4.4): flat red, optional amber context field at the left,
// numbered buttons `NN) Label ▾` split by 2px dark dividers, then `Page n/m` and the screen title in
// bold white at the right. Hover, press and disabled are hard-cut fills and labels (IS-05). A button
// with a menu opens a red dropdown. Every enabled button is a numbered item (Number <GO>) and a
// roving item of its panel. Inside a panel the bar renders into the panel's bar slot, fixed above the
// scrolling body.
import { useId, useRef, useState, type ReactNode } from 'react'
import { FUNCTION_BAR, fillCopy } from '../copy/workspace'
import DropdownMenu, { type MenuEntry } from './FunctionBar.menu'
import { usePanelPage } from './PanelChrome.page'
import { useNumbered } from './PanelChrome.numbers'
import { useSlot } from './PanelChrome.slots'
import { ROVING_ATTR } from './WorkspaceFocus'
import './FunctionBar.css'

export type { MenuEntry } from './FunctionBar.menu'

export interface FunctionBarItem {
  readonly n: number
  readonly label: string
  /** A plain button runs this. */
  readonly onRun?: () => void
  /** A menu button opens these rows in a red dropdown. */
  readonly menu?: ReadonlyArray<MenuEntry>
  readonly disabled?: boolean
}

export interface FunctionBarProps {
  readonly panelId: string
  /** The screen title shown bold at the right, e.g. "Registry board". Names the toolbar. */
  readonly title: string
  readonly items: ReadonlyArray<FunctionBarItem>
  readonly page?: { readonly n: number; readonly m: number }
  /** An amber context field (a real input) at the left. */
  readonly field?: ReactNode
}

const roving = { [ROVING_ATTR]: '' }

interface ButtonProps {
  readonly item: FunctionBarItem
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
}

function FunctionButton({ item, open, onToggle }: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const hasMenu = item.menu !== undefined && item.menu.length > 0
  const activate = () => {
    if (item.disabled) return
    if (hasMenu) onToggle(!open)
    else item.onRun?.()
  }
  return (
    <div className="fn-cell">
      <button
        ref={ref}
        type="button"
        className="fn-btn"
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        aria-controls={hasMenu && open ? menuId : undefined}
        aria-disabled={item.disabled ? true : undefined}
        onClick={activate}
        {...roving}
      >
        <span className="fn-no">{`${item.n})`}</span>{' '}
        <span className="fn-label">{item.label}</span>
        {hasMenu ? <span className="fn-caret" aria-hidden="true">▾</span> : null}
      </button>
      {hasMenu && open ? (
        <DropdownMenu
          id={menuId}
          label={fillCopy(FUNCTION_BAR.menuLabel, { label: item.label })}
          entries={item.menu ?? []}
          tone="red"
          trigger={ref}
          onClose={(restore) => {
            onToggle(false)
            if (restore) ref.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

export default function FunctionBar({ panelId, title, items, page, field }: FunctionBarProps) {
  const [openN, setOpenN] = useState<number | null>(null)
  const place = useSlot('bar')
  const barRef = useRef<HTMLDivElement>(null)
  // U27: DES, InstrumentDes, ConfirmationDes and COST already compute and pass their own page; every
  // other scrolling panel (REG, BLK, EXPO, SEAL, HELP, and any screen not yet built) gets one for free,
  // read straight off its own body (PanelChrome.page's usePanelPage, generalised to find the body from
  // this slot too). A screen's own `page` prop always wins, so nothing is shown twice.
  const auto = usePanelPage(barRef)
  const shownPage = page ?? auto ?? undefined
  useNumbered(
    panelId,
    'bar',
    items
      .filter((item) => !item.disabled)
      .map((item) => ({
        n: item.n,
        label: item.label,
        run: () => (item.menu && item.menu.length > 0 ? setOpenN(item.n) : item.onRun?.()),
      })),
  )
  return place(
    <div ref={barRef} className="fn-bar" role="toolbar" aria-label={fillCopy(FUNCTION_BAR.label, { title })}>
      {field ? <div className="fn-field">{field}</div> : null}
      {items.map((item) => (
        <FunctionButton
          key={item.n}
          item={item}
          open={openN === item.n}
          onToggle={(open) => setOpenN(open ? item.n : null)}
        />
      ))}
      <div className="fn-right">
        {shownPage ? <span className="fn-page">{fillCopy(FUNCTION_BAR.page, { n: shownPage.n, m: shownPage.m })}</span> : null}
        <span className="fn-title">{title}</span>
      </div>
    </div>,
  )
}
