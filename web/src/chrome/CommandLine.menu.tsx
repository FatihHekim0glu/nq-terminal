// A numbered menu in the command sheet (spec 4.7 and 5.1): italic breadcrumb top left, `<Cancel> X`
// top right, then `N) MNEM  Title` rows, categories in white ending in `>`. A listbox the command box
// controls (aria-controls, aria-activedescendant), so arrows, Enter and N <GO> all work from the line.
import { COMMAND_MENUS } from '../copy/menus'
import type { MenuItem, MenuModel } from './CommandLine.menus'
import { menuOptionId } from './CommandLine.menuId'

export interface MenuSheetProps {
  readonly id: string
  readonly menu: MenuModel
  /** Index of the highlighted row, or null before the user arrows. */
  readonly row: number | null
  readonly onChoose: (item: MenuItem) => void
  readonly onClose: () => void
}

// The id helper is in CommandLine.menuId.ts (the command line needs it before this file has loaded); re-exported for the Help screens.
export { menuOptionId }

function Row({ id, item, active, onChoose }: { readonly id: string; readonly item: MenuItem; readonly active: boolean; readonly onChoose: (item: MenuItem) => void }) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      className={item.category ? 'menu-row category' : 'menu-row'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChoose(item)}
    >
      <span className="n">{`${item.n})`}</span>
      <span className="lbl">{item.label}</span>
      {item.detail ? <span className="det">{item.detail}</span> : null}
    </li>
  )
}

export function MenuSheet({ id, menu, row, onChoose, onClose }: MenuSheetProps) {
  return (
    <div className="cmd-menu" data-menu={menu.key}>
      <div className="menu-head">
        <i className="menu-crumb">{menu.breadcrumb.join(' > ')}</i>
        <button type="button" className="menu-close" tabIndex={-1} title={COMMAND_MENUS.menuCancelLabel} onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          {COMMAND_MENUS.menuCancel}
        </button>
      </div>
      {menu.intro.map((line) => (
        <p key={line} className="menu-intro">{line}</p>
      ))}
      {menu.items.length > 0 ? (
        <ul id={id} role="listbox" aria-label={menu.title} className="menu-list">
          {menu.items.map((item, i) => (
            <Row key={item.n} id={menuOptionId(id, item.n)} item={item} active={row === i} onChoose={onChoose} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
