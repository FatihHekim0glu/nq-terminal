// Dropdown menus (look spec 4.4 red dropdowns, IS-04; the dark variant for panel options).
// Opens under its button, left-aligned (or right-aligned on the title bar); rows one grid row high,
// no separators, check marks or icons; the active row takes the hover fill. Arrow keys move, Enter or
// Space runs, Escape closes and hands focus back to the button, Tab or a click elsewhere closes.
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

export interface MenuEntry {
  readonly label: string
  readonly onSelect: () => void
}

export interface DropdownMenuProps {
  readonly id: string
  readonly label: string
  readonly entries: ReadonlyArray<MenuEntry>
  readonly tone: 'red' | 'dark'
  readonly align?: 'left' | 'right'
  /** The button that opened the menu: clicks on it are its own toggle, not an outside click. */
  readonly trigger: RefObject<HTMLElement | null>
  /** `restoreFocus` is true when focus should go back to the trigger (Escape, a chosen row). */
  readonly onClose: (restoreFocus: boolean) => void
}

function items(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : []
}

function moveFocus(menu: HTMLElement | null, from: EventTarget, step: number | 'first' | 'last'): void {
  const list = items(menu)
  if (list.length === 0) return
  const index = list.indexOf(from as HTMLElement)
  const next =
    step === 'first' ? 0 : step === 'last' ? list.length - 1 : (index + step + list.length) % list.length
  list[next]?.focus()
}

/** Closes the menu on a pointer press outside it and its trigger. */
function useOutsidePress(menu: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>, close: () => void): void {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (menu.current?.contains(target) || trigger.current?.contains(target))) return
      latest.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menu, trigger])
}

export default function DropdownMenu(props: DropdownMenuProps) {
  const { id, label, entries, tone, align = 'left', trigger, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    items(ref.current)[0]?.focus()
  }, [])
  useOutsidePress(ref, trigger, () => onClose(false))

  const choose = (entry: MenuEntry) => {
    onClose(true)
    entry.onSelect()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, entry: MenuEntry) => {
    const moves: Readonly<Record<string, number | 'first' | 'last'>> = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
    const move = moves[event.key]
    if (move !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      moveFocus(ref.current, event.target, move)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
      return
    }
    if (event.key === 'Tab') {
      onClose(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      choose(entry)
    }
    // Left and Right stay inside the menu: they must not move the panel's roving focus.
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation()
  }

  return (
    <div
      ref={ref}
      id={id}
      role="menu"
      aria-label={label}
      className={`menu menu-${tone} menu-${align}`}
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="menu-item"
          onClick={() => choose(entry)}
          onKeyDown={(e) => onKeyDown(e, entry)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}
