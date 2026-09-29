// @vitest-environment jsdom
// U09: REG's grid sat 25 ArrowRight presses behind the panel's Tab stop (16 round buttons and 8 criteria
// buttons come first in the item walk), so 'row 9 and Enter' cost 35 keys. A grid that opts in with
// data-roving-entry takes the panel's Tab stop from the body, and ArrowUp on it (when the grid leaves
// the key alone, on its header row) steps back to the item before it, so the controls above stay reachable.
import { afterEach, describe, expect, it } from 'vitest'
import { ROVING_ENTRY_ATTR, handleRovingKey, panelTabStops, rovingItems, syncRoving } from './WorkspaceFocus'

function panel(html: string): HTMLElement {
  const el = document.createElement('section')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

// REG's shape: the bar, the panel body (default), the rail and criteria buttons, then the grid.
const REG_LIKE = `
  <button data-roving id="bar">bar</button>
  <div data-roving data-roving-default tabindex="0" id="body">
    <button data-roving id="round1">r1</button><button data-roving id="round2">r2</button>
    <button data-roving id="crit1">c1</button><button data-roving id="crit2">c2</button>
    <table data-roving data-roving-default ${ROVING_ENTRY_ATTR} tabindex="0" id="grid"></table>
    <button data-roving id="confirm">open</button>
  </div>`

const stops = (el: HTMLElement) => panelTabStops(el).map((n) => n.id)

afterEach(() => {
  document.body.innerHTML = ''
})

describe('data-roving-entry: the grid holds the panel Tab stop (U09)', () => {
  it('takes the Tab stop from the panel body when both render as stops', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    expect(stops(el)).toEqual(['grid'])
  })

  it('born failing without the mark: the body keeps the Tab stop and the grid is 4 arrows away', () => {
    const el = panel(REG_LIKE.replace(ROVING_ENTRY_ATTR, ''))
    syncRoving(el)
    expect(stops(el)).toEqual(['body'])
  })

  it('keeps the stop the user moved to: an entry grid does not steal it back on the next sync', () => {
    const el = panel(REG_LIKE)
    syncRoving(el, el.querySelector('#crit2') as HTMLElement)
    syncRoving(el)
    syncRoving(el)
    expect(stops(el)).toEqual(['crit2'])
  })

  it('does not hand the stop back to an overflowing body: the grid is inside it', () => {
    const el = panel(REG_LIKE)
    const body = el.querySelector('#body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 })
    syncRoving(el)
    syncRoving(el)
    expect(stops(el)).toEqual(['grid'])
  })

  it('falls back to the body when the grid is not rendered (REG on its Evidence view)', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    el.querySelector('#grid')?.remove()
    syncRoving(el)
    expect(stops(el)).toEqual(['body'])
  })

  it('the entry item outranks a box that scrolls on its own: it is the deliberate choice', () => {
    const el = panel(`
      <div data-roving data-roving-default tabindex="0" id="body">
        <table data-roving data-roving-scroll tabindex="0" id="scroller"></table>
        <table data-roving data-roving-default ${ROVING_ENTRY_ATTR} tabindex="0" id="grid"></table>
      </div>`)
    syncRoving(el)
    expect(stops(el)).toEqual(['grid'])
  })
})

describe('ArrowUp on an entry item steps back through the walk', () => {
  it('moves to the item before it and makes that the Tab stop', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    const grid = el.querySelector('#grid') as HTMLElement
    const event = key(grid, 'ArrowUp')
    expect(handleRovingKey(el, event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('crit2')
    expect(stops(el)).toEqual(['crit2'])
  })

  it('leaves a key the grid already handled alone (a row above exists, so the grid moved)', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    const grid = el.querySelector('#grid') as HTMLElement
    const event = key(grid, 'ArrowUp', { cancelable: true })
    event.preventDefault()
    expect(handleRovingKey(el, event)).toBe(false)
    expect(document.activeElement?.id).not.toBe('crit2')
  })

  it('leaves ArrowUp on an ordinary roving item to the browser (it scrolls)', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    expect(handleRovingKey(el, key(el.querySelector('#crit1') as HTMLElement, 'ArrowUp'))).toBe(false)
  })

  it('ArrowDown on the entry item stays with the grid', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    expect(handleRovingKey(el, key(el.querySelector('#grid') as HTMLElement, 'ArrowDown'))).toBe(false)
  })

  it('does nothing when the entry item is the first in the walk', () => {
    const el = panel(`<table data-roving ${ROVING_ENTRY_ATTR} tabindex="0" id="grid"></table><button data-roving id="after">a</button>`)
    syncRoving(el)
    expect(rovingItems(el)[0]?.id).toBe('grid')
    expect(handleRovingKey(el, key(el.querySelector('#grid') as HTMLElement, 'ArrowUp'))).toBe(false)
  })
})

// REG's round rail and criteria block are display: none in a HOME quadrant (reg.css container queries). Such an
// item cannot take focus, and made the Tab stop it left the panel with none anyone could reach (found in a
// real browser: ArrowLeft on the grid's first cell parked the stop on a hidden criteria button).
describe('the walk skips items that cannot take focus', () => {
  /** jsdom has no layout, so a folded-away item is one whose focus() does nothing, as in a browser. */
  const fold = (el: Element | null) => {
    Object.defineProperty(el, 'focus', { configurable: true, value: () => {} })
  }

  it('ArrowUp on the entry item passes over hidden items to the nearest one that takes focus', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    fold(el.querySelector('#crit2'))
    fold(el.querySelector('#crit1'))
    fold(el.querySelector('#round2'))
    fold(el.querySelector('#round1'))
    const event = key(el.querySelector('#grid') as HTMLElement, 'ArrowUp')
    expect(handleRovingKey(el, event)).toBe(true)
    expect(document.activeElement?.id).toBe('body')
    expect(stops(el)).toEqual(['body'])
  })

  it('ArrowLeft on a roving item passes over hidden items too', () => {
    const el = panel(REG_LIKE)
    syncRoving(el, el.querySelector('#confirm') as HTMLElement)
    fold(el.querySelector('#grid'))
    const event = key(el.querySelector('#confirm') as HTMLElement, 'ArrowLeft')
    expect(handleRovingKey(el, event)).toBe(true)
    expect(document.activeElement?.id).toBe('crit2')
  })

  it('ArrowRight at the end of the walk keeps the current item as the Tab stop', () => {
    const el = panel(REG_LIKE)
    syncRoving(el, el.querySelector('#confirm') as HTMLElement)
    const confirm = el.querySelector('#confirm') as HTMLElement
    confirm.focus()
    const event = key(confirm, 'ArrowRight')
    expect(handleRovingKey(el, event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(stops(el)).toEqual(['confirm'])
  })

  it('when nothing before the entry item takes focus, the entry item keeps the Tab stop', () => {
    const el = panel(REG_LIKE)
    syncRoving(el)
    for (const id of ['bar', 'body', 'round1', 'round2', 'crit1', 'crit2']) fold(el.querySelector(`#${id}`))
    const grid = el.querySelector('#grid') as HTMLElement
    grid.focus()
    handleRovingKey(el, key(grid, 'ArrowUp'))
    expect(stops(el)).toEqual(['grid'])
    expect(document.activeElement).toBe(grid)
  })
})
