// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NumberingContext, type NumberedItem } from './PanelChrome.numbers'
import TabStrip from './TabStrip'

afterEach(cleanup)

const TABS = [
  { id: 'eq', label: 'Equity' },
  { id: 'dd', label: 'Drawdown' },
  { id: 'ret', label: 'Returns' },
]

describe('TabStrip: trapezoid tabs and the sub-tab strip (look spec 4.4)', () => {
  it('is a tablist of numbered tabs with aria-selected on the active one', () => {
    render(<TabStrip panelId="p" label="Performance views" tabs={TABS} selected="dd" onSelect={() => {}} />)
    expect(screen.getByRole('tablist', { name: 'Performance views' })).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['1) Equity', '2) Drawdown', '3) Returns'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  })

  it('starts numbering where the screen says (sub-tabs such as 85) All)', () => {
    render(<TabStrip panelId="p" label="Run sets" variant="sub" tabs={TABS} selected="eq" onSelect={() => {}} start={85} />)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['85) Equity', '86) Drawdown', '87) Returns'])
  })

  it('selects a tab on click and on Enter', () => {
    const onSelect = vi.fn()
    render(<TabStrip panelId="p" label="Views" tabs={TABS} selected="eq" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('tab', { name: '3) Returns' }))
    expect(onSelect).toHaveBeenLastCalledWith('ret')
    const second = screen.getByRole('tab', { name: '2) Drawdown' })
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith('dd')
  })

  it('points each tab at the panel it controls when an id base is given', () => {
    render(<TabStrip panelId="p" label="Views" tabs={TABS} selected="eq" onSelect={() => {}} controls="perf-body" />)
    expect(screen.getByRole('tab', { name: '1) Equity' }).getAttribute('aria-controls')).toBe('perf-body')
  })

  it('draws the top strip as trapezoids and the sub strip as flat tabs', () => {
    const { container, rerender } = render(<TabStrip panelId="p" label="Views" tabs={TABS} selected="eq" onSelect={() => {}} />)
    expect(container.querySelector('[role="tablist"]')?.className).toContain('tabs-top')
    rerender(<TabStrip panelId="p" label="Views" variant="sub" tabs={TABS} selected="eq" onSelect={() => {}} />)
    expect(container.querySelector('[role="tablist"]')?.className).toContain('tabs-sub')
  })

  it('registers each tab as a numbered item that selects it', () => {
    const onSelect = vi.fn()
    let last: NumberedItem[] = []
    render(
      <NumberingContext value={(_id, list) => { last = [...list]; return () => {} }}>
        <TabStrip panelId="p" label="Views" tabs={TABS} selected="eq" onSelect={onSelect} />
      </NumberingContext>,
    )
    expect(last.map((i) => i.n)).toEqual([1, 2, 3])
    last[2]?.run()
    expect(onSelect).toHaveBeenCalledWith('ret')
  })

  it('makes every tab a roving item, so Left and Right move between tabs inside the panel', () => {
    render(<TabStrip panelId="p" label="Views" tabs={TABS} selected="eq" onSelect={() => {}} />)
    for (const tab of screen.getAllByRole('tab')) expect(tab.hasAttribute('data-roving')).toBe(true)
  })
})
