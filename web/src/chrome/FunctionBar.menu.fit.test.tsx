// @vitest-environment jsdom
// A dropdown opened inside a panel stays inside it (WCAG 2.2 SC 1.4.4 Resize Text and SC 1.4.10 Reflow): .nqt-panel clips, so a
// menu taller or wider than the room the panel leaves under its button is cut, and the rows past the edge cannot be reached by a
// pointer. The menu is held to the panel's box: it scrolls inside its own height and is moved or narrowed sideways. jsdom has no
// layout, so the boxes are planted; e2e/reflow-menus-200.spec.ts proves the outcome in a browser at 200%.
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DropdownMenu from './FunctionBar.menu'
import { fitMenu, type Box } from './FunctionBar.menu.fit'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height })

describe('fitMenu: the room a panel leaves a menu', () => {
  it('limits the height to the panel bottom, with the menu border to spare', () => {
    const fit = fitMenu(box(0, 24, 120, 266), box(0, 0, 400, 256), 'right')
    expect(fit.maxHeight).toBe(256 - 24 - 1)
  })

  it('leaves a menu that fits alone', () => {
    const fit = fitMenu(box(10, 24, 120, 100), box(0, 0, 400, 256), 'left')
    expect(fit).toEqual({ maxHeight: 231, maxWidth: 398, shiftX: 0 })
  })

  it('moves a left-aligned menu back inside the right edge of the panel', () => {
    const fit = fitMenu(box(300, 48, 246, 100), box(0, 0, 479, 256), 'left')
    expect(fit.shiftX).toBe(479 - 1 - 546)
  })

  it('keeps the left edge of a right-aligned menu inside the panel', () => {
    const fit = fitMenu(box(-30, 24, 200, 100), box(0, 0, 400, 256), 'right')
    expect(fit.shiftX).toBe(31)
  })

  it('narrows a menu wider than the panel to the panel and shifts it in', () => {
    const fit = fitMenu(box(20, 24, 600, 100), box(0, 0, 300, 256), 'left')
    expect(fit.maxWidth).toBe(298)
    expect(fit.shiftX).toBe(-19)
  })

  it('never gives a menu less than two rows, however short the panel', () => {
    const fit = fitMenu(box(0, 240, 100, 100), box(0, 0, 400, 256), 'left')
    expect(fit.maxHeight).toBe(48)
  })
})

/** Plants the boxes jsdom cannot lay out: the panel, and the menu (natural size, then as the fit leaves it). */
function plantBoxes(panel: Box, menu: Box): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const at = this.classList.contains('nqt-panel') ? panel : this.getAttribute('role') === 'menu' ? menu : box(0, 0, 0, 0)
    return { ...at, x: at.left, y: at.top, width: at.right - at.left, height: at.bottom - at.top, toJSON: () => at } as DOMRect
  })
}

function renderMenu(align: 'left' | 'right') {
  const trigger = createRef<HTMLElement>()
  render(
    <div className="nqt-panel">
      <DropdownMenu
        id="m"
        label="Options menu"
        tone="dark"
        align={align}
        trigger={trigger}
        entries={Array.from({ length: 10 }, (_, i) => ({ label: `Row ${i + 1}`, onSelect: () => {} }))}
        onClose={() => {}}
      />
    </div>,
  )
  return screen.getByRole('menu', { name: 'Options menu' })
}

describe('DropdownMenu inside a panel', () => {
  it('scrolls inside a height that ends at the panel bottom (a 10-row menu in a 256px panel)', () => {
    plantBoxes(box(0, 0, 480, 256), box(300, 24, 180, 266))
    const menu = renderMenu('right')
    expect(menu.style.maxHeight).toBe('231px')
  })

  it('is moved back inside the panel when it would run past the right edge', () => {
    plantBoxes(box(0, 0, 479, 256), box(300, 48, 246, 100))
    const menu = renderMenu('left')
    expect(menu.style.transform).toBe('translateX(-68px)')
  })

  it('is narrowed, with its rows allowed to wrap, when it is wider than the panel', () => {
    plantBoxes(box(0, 0, 200, 256), box(0, 24, 300, 100))
    const menu = renderMenu('left')
    expect(menu.style.maxWidth).toBe('198px')
    expect(menu.getAttribute('data-wrap')).toBe('true')
  })

  it('sets nothing when the panel has no layout box (a print or a hidden panel)', () => {
    plantBoxes(box(0, 0, 0, 0), box(0, 0, 0, 0))
    const menu = renderMenu('left')
    expect(menu.style.maxHeight).toBe('')
    expect(menu.style.transform).toBe('')
  })

  it('is left alone outside a panel', () => {
    plantBoxes(box(0, 0, 480, 256), box(300, 24, 180, 266))
    const trigger = createRef<HTMLElement>()
    render(<DropdownMenu id="m" label="Free menu" tone="red" trigger={trigger} entries={[{ label: 'One', onSelect: () => {} }]} onClose={() => {}} />)
    expect(screen.getByRole('menu', { name: 'Free menu' }).style.maxHeight).toBe('')
  })
})
