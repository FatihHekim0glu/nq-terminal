// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ROVING_OVERLAY_ATTR, ROVING_SCROLL_ATTR, handleRovingKey, panelTabStops, syncRoving } from './WorkspaceFocus'

function panel(html: string): HTMLElement {
  const el = document.createElement('section')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

function key(target: HTMLElement, name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('syncRoving: one tab stop per panel', () => {
  it('leaves exactly one tab stop: the default item when none was chosen', () => {
    const el = panel(`
      <button data-roving id="toggle">t</button>
      <div data-roving data-roving-default id="body">
        <a href="#x" id="link">x</a><button id="inner">i</button>
      </div>`)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['body'])
    expect((el.querySelector('#link') as HTMLElement).tabIndex).toBe(-1)
    expect((el.querySelector('#inner') as HTMLElement).tabIndex).toBe(-1)
  })

  it('keeps the item the user moved to as the tab stop', () => {
    const el = panel(`<button data-roving id="a">a</button><div data-roving data-roving-default id="b">b</div>`)
    syncRoving(el, el.querySelector('#a') as HTMLElement)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['a'])
  })

  it('born failing: a focusable child that is not a roving item would be a second tab stop', () => {
    const el = panel(`<div data-roving id="body"><button id="stray">s</button></div>`)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['stray'])
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['body'])
  })

  it('moves the one tab stop into an open overlay, and to the panel default when it closes', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default id="body">x</div>
      <div ${ROVING_OVERLAY_ATTR} data-roving id="menu"><button id="cancel">c</button><button id="row">r</button></div>`)
    syncRoving(el, el.querySelector('#bar') as HTMLElement)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['menu'])
    el.querySelector('#menu')?.remove()
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['body'])
  })

  it('born failing: without the overlay mark the open menu has no tab stop at all', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div id="menu"><button id="cancel">c</button></div>`)
    syncRoving(el, el.querySelector('#bar') as HTMLElement)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['bar'])
  })

  // axe scrollable-region-focusable (WCAG 2.1.1): a box that scrolls on its own (a virtualised grid,
  // a statistics table in a fixed column) must hold the panel's Tab stop, or no Tab reaches it.
  it('born failing: a box that scrolls on its own takes the Tab stop from the panel body', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default tabindex="0" id="body">
        <div data-roving data-roving-default tabindex="0" id="chart">c</div>
        <table data-roving data-roving-default ${ROVING_SCROLL_ATTR} tabindex="0" id="grid"></table>
      </div>`)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['grid'])
  })

  it('takes the Tab stop when it mounts after the first sync, and keeps one chosen by the user', () => {
    const el = panel(`<button data-roving id="bar">b</button><div data-roving data-roving-default tabindex="0" id="body"></div>`)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['body'])
    const body = el.querySelector('#body') as HTMLElement
    body.insertAdjacentHTML('beforeend', `<div data-roving ${ROVING_SCROLL_ATTR} tabindex="0" id="stats">s</div>`)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['stats'])
    syncRoving(el, el.querySelector('#bar') as HTMLElement)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['bar'])
  })

  it('writes nothing when the tab stops are already right (so an observer cannot loop)', () => {
    const el = panel(`<button data-roving id="a">a</button><div data-roving data-roving-default id="b">b</div>`)
    syncRoving(el)
    const records: MutationRecord[] = []
    const observer = new MutationObserver((r) => records.push(...r))
    observer.observe(el, { subtree: true, attributes: true })
    syncRoving(el)
    records.push(...observer.takeRecords())
    observer.disconnect()
    expect(records).toEqual([])
  })
})

describe('handleRovingKey: arrows move inside the panel', () => {
  it('moves right and left between items, clamped at the ends', () => {
    const el = panel(`<button data-roving id="a">a</button><button data-roving id="b">b</button><div data-roving id="c">c</div>`)
    syncRoving(el, el.querySelector('#a') as HTMLElement)
    const a = el.querySelector('#a') as HTMLElement
    const b = el.querySelector('#b') as HTMLElement
    const c = el.querySelector('#c') as HTMLElement

    expect(handleRovingKey(el, key(a, 'ArrowRight'))).toBe(true)
    expect(document.activeElement).toBe(b)
    expect(panelTabStops(el)).toEqual([b])
    handleRovingKey(el, key(b, 'ArrowRight'))
    handleRovingKey(el, key(c, 'ArrowRight'))
    expect(document.activeElement).toBe(c)
    handleRovingKey(el, key(c, 'ArrowLeft'))
    expect(document.activeElement).toBe(b)
  })

  it('leaves keys alone that a chart or grid already handled', () => {
    const el = panel(`<div data-roving id="a">a</div><div data-roving id="b">b</div>`)
    const a = el.querySelector('#a') as HTMLElement
    const event = key(a, 'ArrowRight')
    event.preventDefault()
    expect(handleRovingKey(el, event)).toBe(false)
  })

  it('ignores Up and Down (they scroll) and arrows that move the caret inside a text field', () => {
    const el = panel(`<div data-roving id="a">a</div><input data-roving id="i" value="2019-03-14" /><div data-roving id="b">b</div>`)
    const input = el.querySelector('#i') as HTMLInputElement
    expect(handleRovingKey(el, key(el.querySelector('#a') as HTMLElement, 'ArrowDown'))).toBe(false)
    input.setSelectionRange(4, 4)
    expect(handleRovingKey(el, key(input, 'ArrowRight'))).toBe(false)
    expect(handleRovingKey(el, key(input, 'ArrowLeft'))).toBe(false)
    input.setSelectionRange(0, 10)
    expect(handleRovingKey(el, key(input, 'ArrowRight'))).toBe(false)
  })

  // A text field in the item row must not trap the arrows (WCAG 2.1.1): once the caret is at the
  // end, Right moves on to the next item; at the start, Left moves back.
  it('born failing: Right at the end of a text field and Left at its start move to the next item', () => {
    const el = panel(`<div data-roving id="a">a</div><input data-roving id="i" value="2019-03-14" /><div data-roving id="b">b</div>`)
    const input = el.querySelector('#i') as HTMLInputElement
    input.focus()
    input.setSelectionRange(10, 10)
    expect(handleRovingKey(el, key(input, 'ArrowRight'))).toBe(true)
    expect(document.activeElement?.id).toBe('b')
    input.focus()
    input.setSelectionRange(0, 0)
    expect(handleRovingKey(el, key(input, 'ArrowLeft'))).toBe(true)
    expect(document.activeElement?.id).toBe('a')
  })

  it('walks straight through an empty text field', () => {
    const el = panel(`<div data-roving id="a">a</div><input data-roving id="i" /><div data-roving id="b">b</div>`)
    const input = el.querySelector('#i') as HTMLInputElement
    input.focus()
    expect(handleRovingKey(el, key(input, 'ArrowRight'))).toBe(true)
    expect(document.activeElement?.id).toBe('b')
  })

  it('leaves the arrows to a select and to editable content', () => {
    const el = panel(`<div data-roving id="a">a</div><select data-roving id="s"><option>x</option></select><div data-roving id="b">b</div>`)
    expect(handleRovingKey(el, key(el.querySelector('#s') as HTMLElement, 'ArrowRight'))).toBe(false)
  })
})

describe('handleRovingKey on a tab: the ARIA tabs keyboard pattern', () => {
  const html = `
    <div role="tablist">
      <button role="tab" data-roving id="t1">1</button>
      <button role="tab" data-roving id="t2">2</button>
      <button role="tab" data-roving id="t3">3</button>
    </div>
    <button data-roving id="after">after</button>`

  it('born failing: Right on the last tab wraps to the first, never leaving the tablist', () => {
    const el = panel(html)
    const last = el.querySelector('#t3') as HTMLElement
    expect(handleRovingKey(el, key(last, 'ArrowRight'))).toBe(true)
    expect(document.activeElement?.id).toBe('t1')
  })

  it('Left on the first tab wraps to the last', () => {
    const el = panel(html)
    expect(handleRovingKey(el, key(el.querySelector('#t1') as HTMLElement, 'ArrowLeft'))).toBe(true)
    expect(document.activeElement?.id).toBe('t3')
  })

  it('Home and End jump to the first and last tab', () => {
    const el = panel(html)
    expect(handleRovingKey(el, key(el.querySelector('#t2') as HTMLElement, 'End'))).toBe(true)
    expect(document.activeElement?.id).toBe('t3')
    expect(handleRovingKey(el, key(el.querySelector('#t3') as HTMLElement, 'Home'))).toBe(true)
    expect(document.activeElement?.id).toBe('t1')
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['t1'])
  })

  it('Down on a tab moves into the panel content (Tab moves between panels, so this is the way in)', () => {
    const el = panel(html)
    expect(handleRovingKey(el, key(el.querySelector('#t1') as HTMLElement, 'ArrowDown'))).toBe(true)
    expect(document.activeElement?.id).toBe('after')
    // Left from the content goes back to the tabs, as on any roving item.
    expect(handleRovingKey(el, key(el.querySelector('#after') as HTMLElement, 'ArrowLeft'))).toBe(true)
    expect(document.activeElement?.id).toBe('t3')
  })

  it('leaves Home and End alone on an item that is not a tab (it scrolls)', () => {
    const el = panel(html)
    expect(handleRovingKey(el, key(el.querySelector('#after') as HTMLElement, 'Home'))).toBe(false)
  })
})
