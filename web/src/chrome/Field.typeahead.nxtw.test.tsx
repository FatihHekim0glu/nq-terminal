// @vitest-environment jsdom
// U13 (CORR pair selection by keyboard, keyboard-power/11-corr-pickers.json): typing 'es' in an open
// picker left the highlight on NQ, and reaching CL took about 13 ArrowDowns. DropdownField's open
// listbox now supports the standard listbox type-ahead (ARIA APG): printable keys build a buffer
// (reset after a short idle) and move the highlight to the first option whose label starts with it;
// repeating one letter cycles through every option that starts with it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DropdownField } from './Field'

const UNIVERSE = [
  { value: 'ES', label: 'ES' },
  { value: 'NQ', label: 'NQ' },
  { value: 'YM', label: 'YM' },
  { value: 'CL', label: 'CL' },
  { value: 'GC', label: 'GC' },
]

const activeLabel = (field: HTMLElement) => {
  const id = field.getAttribute('aria-activedescendant')
  return document.getElementById(id ?? '')?.textContent
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("DropdownField type-ahead in the open listbox (U13)", () => {
  it("typing 'e' jumps the highlight to ES, not the 13 ArrowDowns CL used to take", () => {
    render(<DropdownField label="Pair" value="NQ" options={UNIVERSE} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(activeLabel(field)).toBe('NQ')
    fireEvent.keyDown(field, { key: 'e' })
    expect(activeLabel(field)).toBe('ES')
  })

  it('reaches CL directly instead of by repeated ArrowDown', () => {
    render(<DropdownField label="Pair" value="ES" options={UNIVERSE} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'c' })
    expect(activeLabel(field)).toBe('CL')
  })

  it('is case insensitive', () => {
    render(<DropdownField label="Pair" value="ES" options={UNIVERSE} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'g' })
    expect(activeLabel(field)).toBe('GC')
  })

  it('builds a multi-character buffer from keys typed close together', () => {
    const many = [...UNIVERSE, { value: 'CB', label: 'CB' }]
    render(<DropdownField label="Pair" value="ES" options={many} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'c' })
    expect(activeLabel(field)).toBe('CL')
    vi.advanceTimersByTime(200)
    fireEvent.keyDown(field, { key: 'b' })
    expect(activeLabel(field)).toBe('CB')
  })

  it('resets the buffer once the idle timeout passes, so a later key starts a fresh search', () => {
    const many = [...UNIVERSE, { value: 'CB', label: 'CB' }]
    render(<DropdownField label="Pair" value="ES" options={many} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'c' })
    expect(activeLabel(field)).toBe('CL')
    vi.advanceTimersByTime(1000)
    fireEvent.keyDown(field, { key: 'g' })
    expect(activeLabel(field)).toBe('GC')
  })

  it('repeating the same letter in rapid succession cycles through its matches, rather than failing to match a two-letter buffer', () => {
    const twoCs = [
      { value: 'a', label: 'Alpha' },
      { value: 'c1', label: 'Charlie One' },
      { value: 'c2', label: 'Charlie Two' },
    ]
    render(<DropdownField label="Pair" value="a" options={twoCs} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(activeLabel(field)).toBe('Alpha')
    fireEvent.keyDown(field, { key: 'c' })
    expect(activeLabel(field)).toBe('Charlie One')
    vi.advanceTimersByTime(200)
    fireEvent.keyDown(field, { key: 'c' })
    expect(activeLabel(field)).toBe('Charlie Two')
    vi.advanceTimersByTime(200)
    fireEvent.keyDown(field, { key: 'c' })
    expect(activeLabel(field)).toBe('Charlie One')
  })

  it('leaves the highlight alone when nothing matches', () => {
    render(<DropdownField label="Pair" value="NQ" options={UNIVERSE} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'z' })
    expect(activeLabel(field)).toBe('NQ')
  })

  it('opens the closed list and searches on the first typed letter', () => {
    const onChange = vi.fn()
    render(<DropdownField label="Pair" value="NQ" options={UNIVERSE} onChange={onChange} />)
    const field = screen.getByRole('combobox', { name: 'Pair' })
    fireEvent.keyDown(field, { key: 'c' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(activeLabel(field)).toBe('CL')
    expect(onChange).not.toHaveBeenCalled()
  })
})
