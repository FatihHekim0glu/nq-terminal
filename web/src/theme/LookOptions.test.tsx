// @vitest-environment jsdom
// The theme group for the frame strip's Options list, and the hook that applies and keeps the choice.
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_OPTIONS } from '../copy/amberClassic'
import { createSafeStorage, memoryStorage } from '../state/safeStorage'
import { LookOptions } from './LookOptions'
import { LOOK_KEY, type Look } from './look'
import { useLook } from './useLook'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

describe('LookOptions', () => {
  it('is a labelled group of two toggle buttons, the current one pressed', () => {
    render(<LookOptions look="standard" onLook={vi.fn()} />)
    const group = screen.getByRole('group', { name: THEME_OPTIONS.label })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([THEME_OPTIONS.themes.standard, THEME_OPTIONS.themes['amber-classic']])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    for (const b of buttons) expect(b.getAttribute('type')).toBe('button')
  })

  it('reports the chosen theme', () => {
    const onLook = vi.fn()
    render(<LookOptions look="standard" onLook={onLook} />)
    fireEvent.click(screen.getByRole('button', { name: THEME_OPTIONS.themes['amber-classic'] }))
    expect(onLook).toHaveBeenCalledWith('amber-classic')
  })

  it('reaches both buttons by keyboard (native buttons, no tabindex tricks)', () => {
    render(<LookOptions look="amber-classic" onLook={vi.fn()} />)
    for (const b of screen.getAllByRole('button')) expect(b.hasAttribute('tabindex')).toBe(false)
    expect(screen.getByRole('button', { name: THEME_OPTIONS.themes['amber-classic'] }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('useLook', () => {
  it('starts from the stored theme and applies it to the root element', () => {
    const shared = memoryStorage()
    shared.setItem(LOOK_KEY, 'amber-classic')
    const { result } = renderHook(() => useLook(undefined, createSafeStorage(() => shared)))
    expect(result.current.look).toBe('amber-classic')
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber-classic')
  })

  it('applies, stores and announces a new choice', () => {
    const shared = memoryStorage()
    const onChange = vi.fn()
    const { result } = renderHook(() => useLook(onChange, createSafeStorage(() => shared)))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    act(() => result.current.choose('amber-classic'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber-classic')
    expect(shared.getItem(LOOK_KEY)).toBe('amber-classic')
    expect(onChange).toHaveBeenCalledWith('amber-classic')
    act(() => result.current.choose('standard'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(shared.getItem(LOOK_KEY)).toBe('standard')
  })

  it('still applies the theme for this page view when storage is blocked', () => {
    const blocked = createSafeStorage(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useLook(undefined, blocked))
    expect(result.current.look).toBe('standard')
    act(() => result.current.choose('amber-classic'))
    expect(result.current.look).toBe('amber-classic')
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber-classic')
  })
})

describe('useLook in the shell', () => {
  it('keeps one stable choose function while the notice callback is a new arrow every render', () => {
    const shared = memoryStorage()
    const storage = createSafeStorage(() => shared)
    const seen: Array<readonly [Look, number]> = []
    const { result, rerender } = renderHook(({ n }: { n: number }) => useLook((look) => void seen.push([look, n]), storage), { initialProps: { n: 1 } })
    const first = result.current.choose
    rerender({ n: 2 })
    expect(result.current.choose).toBe(first)
    act(() => result.current.choose('amber-classic'))
    expect(seen).toEqual([['amber-classic', 2]])
  })

  it('follows another window: a storage event for the theme key changes the look here, and others do not', () => {
    const shared = memoryStorage()
    const storage = createSafeStorage(() => shared)
    const { result } = renderHook(() => useLook(undefined, storage))
    shared.setItem(LOOK_KEY, 'amber-classic')
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: LOOK_KEY, newValue: 'amber-classic' })))
    expect(result.current.look).toBe('amber-classic')
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber-classic')
    shared.setItem(LOOK_KEY, 'standard')
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'nqt.layouts', newValue: '{}' })))
    expect(result.current.look).toBe('amber-classic')
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: null })))
    expect(result.current.look).toBe('standard')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('treats a tampered value from another window as the standard theme', () => {
    const shared = memoryStorage()
    const storage = createSafeStorage(() => shared)
    const { result } = renderHook(() => useLook(undefined, storage))
    act(() => result.current.choose('amber-classic'))
    shared.setItem(LOOK_KEY, 'javascript:alert(1)')
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: LOOK_KEY })))
    expect(result.current.look).toBe('standard')
  })

  it('stops listening when the shell unmounts', () => {
    const shared = memoryStorage()
    const storage = createSafeStorage(() => shared)
    const { result, unmount } = renderHook(() => useLook(undefined, storage))
    unmount()
    shared.setItem(LOOK_KEY, 'amber-classic')
    window.dispatchEvent(new StorageEvent('storage', { key: LOOK_KEY }))
    expect(result.current.look).toBe('standard')
  })

  it('does not touch the layouts or the workspaces the viewer saved', () => {
    const shared = memoryStorage()
    shared.setItem('nqt.layouts', '{"version":1}')
    shared.setItem('nqt.workspaces', '{"version":1,"list":[]}')
    const { result } = renderHook(() => useLook(undefined, createSafeStorage(() => shared)))
    act(() => result.current.choose('amber-classic'))
    expect(shared.getItem('nqt.layouts')).toBe('{"version":1}')
    expect(shared.getItem('nqt.workspaces')).toBe('{"version":1,"list":[]}')
  })
})
