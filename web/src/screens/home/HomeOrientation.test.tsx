// @vitest-environment jsdom
// N03 (polish 3): a first-run orientation strip for HOME. Three questions (what passed, what is the evidence,
// where is the audit trail), a pointer to HELP, dismissible with a button or Esc, remembered per viewer in
// storage that may throw, and shown on every load of the demo.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as bus from '../../chrome/CommandLine.bus'
import { findCopyViolations } from '../../copy/copyRules'
import { HOME_ORIENTATION } from '../../copy/home'
import { createSafeStorage, memoryStorage } from '../../state/safeStorage'
import { criteria } from '../reg/regModel'
import { CRITERIA_START } from '../reg/RegParts'
import HomeOrientation, { ORIENTATION_KEY } from './HomeOrientation'

const strip = () => screen.queryByRole('note', { name: HOME_ORIENTATION.label })

function freshStorage() {
  const backing = memoryStorage()
  return { backing, storage: createSafeStorage(() => backing) }
}

beforeEach(() => {
  vi.spyOn(bus, 'requestLine').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('HomeOrientation on a first run', () => {
  it('answers the three questions with command links, and points to HELP', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    const note = strip()
    expect(note).not.toBeNull()
    const text = note?.textContent ?? ''
    expect(text).toContain('New here?')
    expect(text).toContain('54 <GO>')
    expect(text).toContain('<name> DES <GO>')
    for (const line of ['REG', 'OOS', 'HELP']) expect(screen.getByRole('button', { name: `${line} <GO>` })).toBeTruthy()
  })

  it('runs the line of a link through the command line', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'OOS <GO>' }))
    expect(bus.requestLine).toHaveBeenCalledWith('OOS', false)
  })

  it('does not mention the demo outside the demo', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    expect(strip()?.textContent).not.toContain('DEMO DATA')
  })

  it("names REG's Passed own bar by the number it really has", () => {
    const counts = { rows: 22, registered: 21, edges: 3, overlays: 2, passed: 3, passed_edges: 2, failed: 15, checks: 1 }
    const filters = criteria(counts, [], 0.05).filter((c) => c.id !== 'rows')
    const passed = CRITERIA_START + filters.findIndex((c) => c.id === 'passed')
    expect(HOME_ORIENTATION.passed).toContain(`${passed} <GO>`)
  })
})

describe('dismissing', () => {
  it('the button hides the strip and remembers it in storage', () => {
    const { storage, backing } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    fireEvent.click(screen.getByRole('button', { name: HOME_ORIENTATION.dismissLabel }))
    expect(strip()).toBeNull()
    expect(backing.getItem(ORIENTATION_KEY)).toBe('1')
  })

  it('Esc hides it too, without stopping the key for the command line', () => {
    const { storage, backing } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void document.dispatchEvent(event))
    expect(strip()).toBeNull()
    expect(event.defaultPrevented).toBe(false)
    expect(backing.getItem(ORIENTATION_KEY)).toBe('1')
  })

  it('leaves other keys alone', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(strip()).not.toBeNull()
  })

  it('an Esc another handler already took (defaultPrevented) is not ours', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    event.preventDefault()
    act(() => void document.dispatchEvent(event))
    expect(strip()).not.toBeNull()
  })

  it('hears Esc even when the focused input stops the key for itself (the command line does)', () => {
    const { storage } = freshStorage()
    render(
      <>
        <input aria-label="line" onKeyDown={(e) => { e.preventDefault(); e.stopPropagation() }} />
        <HomeOrientation storage={storage} demo={false} />
      </>,
    )
    const line = screen.getByLabelText('line')
    line.focus()
    const bubbled = vi.fn()
    document.addEventListener('keydown', bubbled)
    fireEvent.keyDown(line, { key: 'Escape' })
    document.removeEventListener('keydown', bubbled)
    expect(strip()).toBeNull()
    // We did not stop the key: the input's own handler ran (it stops it there, so nothing bubbled to the document).
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('does not stop or prevent the key it hears', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo={false} />)
    const seen: Array<{ prevented: boolean }> = []
    const after = (e: KeyboardEvent) => seen.push({ prevented: e.defaultPrevented })
    document.addEventListener('keydown', after)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void document.body.dispatchEvent(event))
    document.removeEventListener('keydown', after)
    expect(seen).toEqual([{ prevented: false }])
  })

  it('stops listening once unmounted', () => {
    const { storage } = freshStorage()
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<HomeOrientation storage={storage} demo={false} />)
    const added = add.mock.calls.filter(([type]) => type === 'keydown')
    expect(added).toHaveLength(1)
    unmount()
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown')
    expect(removed).toHaveLength(1)
    expect(removed[0]?.[1]).toBe(added[0]?.[1])
    expect(removed[0]?.[2]).toBe(true)
  })

  it('a viewer who dismissed it does not see it again', () => {
    const { storage } = freshStorage()
    const first = render(<HomeOrientation storage={storage} demo={false} />)
    fireEvent.click(screen.getByRole('button', { name: HOME_ORIENTATION.dismissLabel }))
    first.unmount()
    render(<HomeOrientation storage={storage} demo={false} />)
    expect(strip()).toBeNull()
  })
})

describe('storage that fails (private window, blocked site data)', () => {
  const failing = () => createSafeStorage(() => {
    throw new Error('blocked')
  })

  it('still shows on a first run and dismisses without an error', () => {
    render(<HomeOrientation storage={failing()} demo={false} />)
    expect(strip()).not.toBeNull()
    expect(() => fireEvent.click(screen.getByRole('button', { name: HOME_ORIENTATION.dismissLabel }))).not.toThrow()
    expect(strip()).toBeNull()
  })

  it('a storage whose reads and writes throw is treated as empty', () => {
    const throwing = {
      getItem: () => { throw new Error('read') },
      setItem: () => { throw new Error('write') },
      removeItem: () => { throw new Error('remove') },
    } as unknown as Storage
    render(<HomeOrientation storage={createSafeStorage(() => throwing)} demo={false} />)
    expect(strip()).not.toBeNull()
    expect(() => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))).not.toThrow()
    expect(strip()).toBeNull()
  })
})

describe('in the demo', () => {
  it('shows on every load, even for a viewer who dismissed it before, and says what DEMO DATA means', () => {
    const { storage, backing } = freshStorage()
    backing.setItem(ORIENTATION_KEY, '1')
    render(<HomeOrientation storage={storage} demo />)
    expect(strip()).not.toBeNull()
    expect(strip()?.textContent).toContain('DEMO DATA')
  })

  it('can still be dismissed for the visit', () => {
    const { storage } = freshStorage()
    render(<HomeOrientation storage={storage} demo />)
    fireEvent.click(screen.getByRole('button', { name: HOME_ORIENTATION.dismissLabel }))
    expect(strip()).toBeNull()
  })

  it('reads the demo flag of the page when the prop is not given', () => {
    const { storage, backing } = freshStorage()
    backing.setItem(ORIENTATION_KEY, '1')
    document.documentElement.dataset['demo'] = 'on'
    try {
      render(<HomeOrientation storage={storage} />)
      expect(strip()).not.toBeNull()
    } finally {
      delete document.documentElement.dataset['demo']
    }
  })
})

describe('the orientation copy', () => {
  it('follows the copy rules', () => {
    expect(findCopyViolations({ HOME_ORIENTATION })).toEqual([])
  })
})
