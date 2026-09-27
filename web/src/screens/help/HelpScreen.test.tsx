// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onLineRequest } from '../../chrome/CommandLine.bus'
import { NumberingContext, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { MNEMONICS } from '../../commands/registry'
import { HELP, HELP_KEYS } from '../../copy/help'
import { HELP_TOPIC, HELP_TOPICS } from '../../copy/helpTopics'
import HelpScreen from './HelpScreen'
import { requestHelpTopic, useHelpTopic } from './helpTopic.store'

afterEach(() => {
  cleanup()
  act(() => useHelpTopic.setState({ request: null }))
})

const actions: PanelActions = { panelId: 'help-main', related: () => false, back: () => false, forward: () => false, open: () => false }

function renderHelp(registrar?: (panel: string, items: ReadonlyArray<NumberedItem>) => () => void) {
  const tree = (
    <PanelActionsContext value={actions}>
      <HelpScreen built={new Set(['HELP', 'HOME'])} />
    </PanelActionsContext>
  )
  return render(registrar ? <NumberingContext value={registrar}>{tree}</NumberingContext> : tree)
}

function lastItems(calls: ReadonlyArray<NumberedItem>[]): ReadonlyArray<NumberedItem> {
  return calls.at(-1) ?? []
}

function tocItem(code: string) {
  const toc = screen.getByRole('navigation', { name: HELP.tocLabel })
  const list = within(toc).getByRole('list', { name: HELP.mnemonicsHeading })
  const i = MNEMONICS.findIndex((m) => m.code === code)
  return within(list).getAllByRole('button')[i]!
}

describe('HELP index (spec 7.12): the page the HELP command opens', () => {
  it('keeps the red bar: <Search help> runs HL, 96) Actions and the title Help', () => {
    const seen = vi.fn()
    const off = onLineRequest(seen)
    renderHelp()
    const bar = screen.getByRole('toolbar', { name: `${HELP.title} functions` })
    const field = within(bar).getByRole('textbox', { name: HELP.searchLabel })
    expect(field.getAttribute('placeholder')).toBe(HELP.searchPlaceholder)
    fireEvent.change(field, { target: { value: 'drawdown' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    off()
    expect(seen).toHaveBeenCalledWith({ line: 'HL drawdown', newPanel: false })
    expect(within(bar).getByRole('button', { name: /96\) Actions/ })).toBeTruthy()
  })

  it('lists every mnemonic numbered for <GO>, the keys, the keyboard, link groups and licences', () => {
    renderHelp()
    const index = screen.getByRole('table', { name: HELP.mnemonicsCaption })
    const rows = within(index).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('th')?.textContent)).toEqual(MNEMONICS.map((m) => m.code))
    expect(rows[0]!.textContent).toContain('1)')
    expect(within(screen.getByRole('table', { name: HELP.keysCaption })).getAllByRole('rowheader')).toHaveLength(HELP_KEYS.length)
    expect(screen.getByRole('img', { name: HELP.keyboardLabel })).toBeTruthy()
    expect(screen.getByRole('list', { name: HELP.licencesHeading }).textContent).toContain('PT Mono')
    expect(screen.getByText(HELP.intro)).toBeTruthy()
  })

  it('marks built screens and names the phase of the others', () => {
    renderHelp()
    const index = screen.getByRole('table', { name: HELP.mnemonicsCaption })
    const row = (code: string) => within(index).getAllByRole('row').find((r) => r.querySelector('th')?.textContent === code)!
    expect(row('HOME').getAttribute('data-built')).toBe('true')
    expect(row('VCONE').textContent).toContain(HELP.statusP1)
  })
})

describe('HELP topic pages: one function\'s help in the panel', () => {
  it('opens a topic from the contents rail: breadcrumb, the code large, summary, sections and examples', () => {
    renderHelp()
    fireEvent.click(tocItem('GP'))
    const page = screen.getByRole('region', { name: 'Help for GP' })
    expect(within(page).getByText('Getting started > Help > Help for GP')).toBeTruthy()
    expect(within(page).getByRole('heading', { level: 3 }).textContent).toBe('GP')
    expect(within(page).getByText(HELP_TOPICS.GP!.summary)).toBeTruthy()
    expect(within(page).getByText(HELP_TOPIC.shows)).toBeTruthy()
    for (const s of HELP_TOPICS.GP!.shows) expect(within(page).getByText(s)).toBeTruthy()
    expect(within(page).getByText(HELP_TOPICS.GP!.data)).toBeTruthy()
    expect(within(page).getByText('41)')).toBeTruthy()
    expect(within(page).getByRole('button', { name: 'NQ1 Index GP <GO>' })).toBeTruthy()
    expect(tocItem('GP').getAttribute('aria-current')).toBe('true')
    expect(screen.queryByRole('table', { name: HELP.mnemonicsCaption })).toBeNull()
  })

  it('states the context and argument the function takes, and its status', () => {
    renderHelp()
    fireEvent.click(tocItem('GIP'))
    const page = screen.getByRole('region', { name: 'Help for GIP' })
    expect(page.textContent).toContain('instrument')
    expect(page.textContent).toContain('a date as YYYY-MM-DD')
    expect(page.textContent).toContain('placeholder, phase 7')
  })

  it('runs an example through the command line; a related function shows its own help here', () => {
    const seen = vi.fn()
    const off = onLineRequest(seen)
    renderHelp()
    fireEvent.click(tocItem('GP'))
    fireEvent.click(screen.getByRole('button', { name: 'ZN COMDTY GP 1h <GO>' }))
    expect(seen).toHaveBeenCalledWith({ line: 'ZN COMDTY GP 1h', newPanel: false })
    fireEvent.click(within(screen.getByRole('list', { name: HELP_TOPIC.related })).getByRole('button', { name: /GIP/ }))
    off()
    expect(screen.getByRole('region', { name: 'Help for GIP' })).toBeTruthy()
  })

  it('goes back to the index from a topic', () => {
    renderHelp()
    fireEvent.click(tocItem('REG'))
    fireEvent.click(screen.getByRole('button', { name: HELP_TOPIC.backToIndex }))
    expect(screen.getByRole('table', { name: HELP.mnemonicsCaption })).toBeTruthy()
  })

  it('Number <GO>: N opens topic N; on a topic page 41 runs the first example and 51 opens the first related help', () => {
    const calls: ReadonlyArray<NumberedItem>[] = []
    const registrar = vi.fn((_p: string, items: ReadonlyArray<NumberedItem>) => {
      ;(calls as ReadonlyArray<NumberedItem>[]).push(items)
      return () => {}
    })
    const seen = vi.fn()
    const off = onLineRequest(seen)
    renderHelp(registrar)
    const index = lastItems(calls)
    expect(index.filter((i) => i.n <= MNEMONICS.length).map((i) => i.n)).toEqual(MNEMONICS.map((_, i) => i + 1))
    act(() => index.find((i) => i.n === 2)!.run())
    expect(screen.getByRole('region', { name: 'Help for GP' })).toBeTruthy()
    const page = lastItems(calls)
    act(() => page.find((i) => i.n === 41)!.run())
    expect(seen).toHaveBeenCalledWith({ line: 'NQ1 Index GP', newPanel: false })
    act(() => lastItems(calls).find((i) => i.n === 51)!.run())
    off()
    expect(screen.getByRole('region', { name: 'Help for GIP' })).toBeTruthy()
  })

  it('shows the topic another part of the terminal asks for (MNEM HELP, F1)', () => {
    renderHelp()
    act(() => requestHelpTopic('MON'))
    expect(screen.getByRole('region', { name: 'Help for MON' })).toBeTruthy()
  })
})
