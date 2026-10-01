// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ROVING_OVERLAY_ATTR, ROVING_SCROLL_ATTR, focusAfterOverlay, handleRovingKey, panelTabStops, syncRoving, usePanelRoving } from './WorkspaceFocus'

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

  // axe scrollable-region-focusable (WCAG 2.1.1): the overlay takes the Tab stop, so a body that scrolls
  // on its own is left at tabindex -1 under the dim. Marking it inert takes it out of the page for
  // keyboard, pointer and the accessibility tree while the overlay is open, so it is not a scroll region
  // that no key reaches; the mark goes again when the overlay closes.
  it('born failing: an open overlay makes the panel body inert, and closing it makes it live again', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default id="body" tabindex="0">x</div>
      <div ${ROVING_OVERLAY_ATTR} data-roving id="menu"><button id="cancel">c</button></div>`)
    const body = el.querySelector('#body') as HTMLElement
    const bar = el.querySelector('#bar') as HTMLElement
    syncRoving(el)
    expect(body.hasAttribute('inert')).toBe(true)
    expect(bar.hasAttribute('inert')).toBe(false)
    expect(el.querySelector('#menu')?.hasAttribute('inert')).toBe(false)
    el.querySelector('#menu')?.remove()
    syncRoving(el)
    expect(body.hasAttribute('inert')).toBe(false)
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

  // After a panel menu or dropdown closes, an unrelated resync (the MutationObserver, no explicit
  // `prefer`) must not leave the overflowing body with no Tab stop of its own (axe
  // scrollable-region-focusable, G21). Arrow-key roving onto the control (an explicit `prefer`) is
  // untouched, so normal title-bar navigation still keeps its stop.
  it('gives an overflowing body back its Tab stop once a title-bar control is no longer preferred', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default id="body">x</div>`)
    const body = el.querySelector('#body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true })
    const bar = el.querySelector('#bar') as HTMLElement
    syncRoving(el, bar)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['bar'])
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['body'])
  })

  // REG's grid is wider than a HOME quadrant: the body scrolls sideways only, and axe counts that too.
  it('born failing: a body that overflows sideways only gets its Tab stop back as well', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default id="body">x</div>`)
    const body = el.querySelector('#body') as HTMLElement
    Object.defineProperty(body, 'scrollWidth', { value: 983, configurable: true })
    Object.defineProperty(body, 'clientWidth', { value: 959, configurable: true })
    syncRoving(el, el.querySelector('#bar') as HTMLElement)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['body'])
  })

  // JOBS' log tail is a scroll box of its own beside a body that does not scroll: it needs a Tab stop too.
  it('born failing: an overflowing scroll box (a log tail) gets the Tab stop back from a title-bar control', () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default id="body"><pre data-roving ${ROVING_SCROLL_ATTR} id="log">x</pre></div>`)
    const log = el.querySelector('#log') as HTMLElement
    Object.defineProperty(log, 'scrollHeight', { value: 400, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 200, configurable: true })
    syncRoving(el, el.querySelector('#bar') as HTMLElement)
    syncRoving(el)
    expect(panelTabStops(el).map((n) => n.id)).toEqual(['log'])
  })

  it('born failing: focusAfterOverlay clears the inert mark so the body takes focus in the same handler', () => {
    const el = panel(`<div data-roving data-roving-default tabindex="-1" inert id="body">x</div>`)
    const body = el.querySelector('#body') as HTMLElement
    focusAfterOverlay(body)
    expect(body.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(body)
    expect(() => focusAfterOverlay(null)).not.toThrow()
  })

  it('leaves a non-overflowing body off the Tab stop, so a title-bar control stays sticky', () => {
    const el = panel(`<button data-roving id="bar">b</button><div data-roving data-roving-default id="body">x</div>`)
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

// G21 characterization (not a fix: usePanelRoving's docstring claim was false, the behaviour is kept
// on purpose; see WorkspaceFocus.ts's keepBodyReachable and syncRoving docstrings). usePanelRoving's
// own MutationObserver echoes every tabindex write it sees as an ambient resync (no explicit
// `prefer`), including the write a deliberate arrow move onto a title-bar control just made, so
// within a microtask the Tab stop is handed back to an overflowing body even though the title-bar
// control still holds real DOM focus. Tab from that control therefore lands on the same panel's body
// (one extra Tab), deliberately, so the panel's one scrolling region stays reachable (axe
// scrollable-region-focusable).
describe('usePanelRoving + its own live MutationObserver: the title-bar echo (G21)', () => {
  it('hands the Tab stop back to an overflowing body within a microtask, even while the title-bar control still holds focus', async () => {
    const el = panel(`
      <button data-roving id="bar">b</button>
      <div data-roving data-roving-default id="body" tabindex="0">x</div>`)
    const body = el.querySelector('#body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 400, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true })
    const bar = el.querySelector('#bar') as HTMLElement

    const ref = { current: el } as RefObject<HTMLElement | null>
    const { result } = renderHook(() => usePanelRoving(ref))
    body.focus()
    expect(document.activeElement).toBe(body)

    act(() => {
      const fake = { target: body, nativeEvent: key(body, 'ArrowLeft') } as unknown as ReactKeyboardEvent<HTMLElement>
      result.current(fake)
    })
    // The deliberate move: ArrowLeft from the overflowing body onto the title-bar control.
    expect(document.activeElement).toBe(bar)

    // Let the live MutationObserver's queued callback (the ambient echo) run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.activeElement).toBe(bar)
    expect(body.getAttribute('tabindex')).toBe('0')
    expect(bar.getAttribute('tabindex')).toBe('-1')
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

  // MON's 'Vol-normalised' checkbox trapped Left and Right: a checkbox has no caret, so it must join
  // the roving walk rather than being treated as a text field (G11).
  it('a checkbox joins the roving walk instead of trapping the arrows', () => {
    const el = panel(`<input type="checkbox" data-roving id="c" /><button data-roving id="b">b</button>`)
    const checkbox = el.querySelector('#c') as HTMLElement
    expect(handleRovingKey(el, key(checkbox, 'ArrowRight'))).toBe(true)
    expect(document.activeElement?.id).toBe('b')
  })

  it('keeps a radio input native, like a select', () => {
    const el = panel(`<div data-roving id="a">a</div><input type="radio" data-roving id="r" /><div data-roving id="b">b</div>`)
    expect(handleRovingKey(el, key(el.querySelector('#r') as HTMLElement, 'ArrowRight'))).toBe(false)
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

describe('handleRovingKey in a text area', () => {
  const html = `<button data-roving id="a">a</button><textarea data-roving id="t">one\ntwo</textarea><button data-roving id="b">b</button>`

  it('born failing: Right at the end of the text, or Left at the start, moves on, so a text area is not a keyboard trap', () => {
    const el = panel(html)
    const area = el.querySelector('#t') as HTMLTextAreaElement
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
    expect(handleRovingKey(el, key(area, 'ArrowRight'))).toBe(true)
    expect(document.activeElement?.id).toBe('b')
    area.focus()
    area.setSelectionRange(0, 0)
    expect(handleRovingKey(el, key(area, 'ArrowLeft'))).toBe(true)
    expect(document.activeElement?.id).toBe('a')
  })

  it('keeps the arrows inside the text while the caret has room to move', () => {
    const el = panel(html)
    const area = el.querySelector('#t') as HTMLTextAreaElement
    area.focus()
    area.setSelectionRange(2, 2)
    expect(handleRovingKey(el, key(area, 'ArrowRight'))).toBe(false)
    expect(handleRovingKey(el, key(area, 'ArrowLeft'))).toBe(false)
  })
})
