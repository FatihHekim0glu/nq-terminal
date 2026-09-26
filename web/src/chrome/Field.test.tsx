// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AmberField, DropdownField, ParamRow, ReadOnlyValue } from './Field'
import { GreyButton, ToggleGroup } from './Field.buttons'

afterEach(cleanup)

const FREQ = [
  { value: 'd', label: 'Daily' },
  { value: 'w', label: 'Weekly' },
  { value: 'm', label: 'Monthly' },
]

describe('AmberField (look spec 4.5)', () => {
  it('is a labelled text input with an angle-bracket placeholder', () => {
    const onChange = vi.fn()
    render(<AmberField label="Filter" placeholder="<Enter filter>" value="" onChange={onChange} />)
    const input = screen.getByRole('textbox', { name: 'Filter' })
    expect(input.getAttribute('placeholder')).toBe('<Enter filter>')
    expect(input.className).toContain('field')
    fireEvent.change(input, { target: { value: 'za' } })
    expect(onChange).toHaveBeenCalledWith('za')
  })

  it('runs onSubmit with the typed value on Enter, and nothing on other keys', () => {
    const onSubmit = vi.fn()
    render(<AmberField label="Search help" placeholder="<Search help>" value="cost" onChange={() => {}} onSubmit={onSubmit} />)
    const input = screen.getByRole('textbox', { name: 'Search help' })
    fireEvent.keyDown(input, { key: 'a' })
    expect(onSubmit).not.toHaveBeenCalled()
    const notPrevented = fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('cost')
    expect(notPrevented).toBe(false)
  })

  it('shows a disabled field as disabled', () => {
    render(<AmberField label="Filter" value="x" onChange={() => {}} disabled />)
    expect((screen.getByRole('textbox', { name: 'Filter' }) as HTMLInputElement).disabled).toBe(true)
  })
})

describe('DropdownField and its amber list', () => {
  it('shows the value with a ▾ box and opens a listbox with the current item selected', () => {
    render(<DropdownField label="Freq" value="w" options={FREQ} onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Freq' })
    expect(field.textContent).toContain('Weekly')
    expect(field.querySelector('.field-btn')?.getAttribute('aria-hidden')).toBe('true')
    expect(field.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(field)
    expect(field.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('listbox', { name: 'Freq choices' })
    expect(list.className).toContain('field-list')
    const current = within(list).getByRole('option', { name: 'Weekly' })
    expect(current.getAttribute('aria-selected')).toBe('true')
    expect(field.getAttribute('aria-activedescendant')).toBe(current.id)
  })

  it('moves the active item with the arrows and chooses it with Enter', () => {
    const onChange = vi.fn()
    render(<DropdownField label="Freq" value="d" options={FREQ} onChange={onChange} />)
    const field = screen.getByRole('combobox', { name: 'Freq' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('w')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes on Escape without choosing, and chooses on click', () => {
    const onChange = vi.fn()
    render(<DropdownField label="Freq" value="d" options={FREQ} onChange={onChange} />)
    const field = screen.getByRole('combobox', { name: 'Freq' })
    fireEvent.click(field)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(field)
    fireEvent.click(screen.getByRole('option', { name: 'Monthly' }))
    expect(onChange).toHaveBeenCalledWith('m')
  })

  it('is disabled with aria-disabled and does not open', () => {
    render(<DropdownField label="Freq" value="d" options={FREQ} onChange={() => {}} disabled />)
    const field = screen.getByRole('combobox', { name: 'Freq' })
    expect(field.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(field)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('ParamRow and read-only values', () => {
  it('lays amber labels and fields in one row', () => {
    render(
      <ParamRow label="Parameters">
        <DropdownField label="Freq" value="d" options={FREQ} onChange={() => {}} />
      </ParamRow>,
    )
    const row = screen.getByRole('group', { name: 'Parameters' })
    expect(row.className).toContain('param-row')
    expect(within(row).getByText('Freq').className).toContain('param-label')
  })

  it('never fills a read-only value amber', () => {
    render(<ReadOnlyValue label="Cost">1 tick</ReadOnlyValue>)
    const value = screen.getByText('1 tick')
    expect(value.className).toContain('field-ro')
    expect(value.classList.contains('field')).toBe(false)
  })
})

describe('Grey buttons and toggle groups', () => {
  it('renders a grey button that runs on click', () => {
    const onClick = vi.fn()
    render(<GreyButton onClick={onClick}>Reset</GreyButton>)
    const b = screen.getByRole('button', { name: 'Reset' })
    expect(b.className).toContain('btn-grey')
    fireEvent.click(b)
    expect(onClick).toHaveBeenCalled()
  })

  it('shows one pressed toggle, bold as well as blue, and reports the change', () => {
    const onChange = vi.fn()
    render(<ToggleGroup label="Range" options={[{ value: '1M', label: '1M' }, { value: 'Max', label: 'Max' }]} value="Max" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Range' })
    const [oneMonth, max] = within(group).getAllByRole('button')
    expect(max?.getAttribute('aria-pressed')).toBe('true')
    expect(oneMonth?.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(oneMonth as HTMLElement)
    expect(onChange).toHaveBeenCalledWith('1M')
  })
})
