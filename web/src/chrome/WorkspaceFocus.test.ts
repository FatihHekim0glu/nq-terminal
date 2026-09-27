// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ROVING_OVERLAY_ATTR, handleRovingKey, panelTabStops, syncRoving } from './WorkspaceFocus'

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

  it('ignores Up and Down (they scroll) and keys typed into a text field', () => {
    const el = panel(`<div data-roving id="a">a</div><input data-roving id="i" /><div data-roving id="b">b</div>`)
    expect(handleRovingKey(el, key(el.querySelector('#a') as HTMLElement, 'ArrowDown'))).toBe(false)
    expect(handleRovingKey(el, key(el.querySelector('#i') as HTMLElement, 'ArrowRight'))).toBe(false)
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
