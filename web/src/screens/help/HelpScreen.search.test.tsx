// @vitest-environment jsdom
// U03 (polish 3): HELP's own search field reads the lazy search index too, so a word that only the help text holds
// (Holm, TWS, fence, verdict: the glossary sits on HELP's own page) lists a match instead of "Nothing matches".
// Until the index has arrived the field lists today's functions and words and says the rest is loading; the list is
// drawn again when the index lands, with no further keystroke. This file is the only one that runs HELP against a
// cold index (the shared loader is one per module graph), so its first test must stay first.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onLineRequest } from '../../chrome/CommandLine.bus'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { withValue } from '../../commands/messages'
import { loadSearchIndex, loadedSearchIndex } from '../../commands/searchIndexLoader'
import { COMMAND_LINE } from '../../copy/commands'
import { HELP } from '../../copy/help'
import { SEARCH } from '../../copy/search'
import HelpScreen from './HelpScreen'
import { useHelpTopic } from './helpTopic.store'

afterEach(() => {
  cleanup()
  act(() => useHelpTopic.setState({ request: null }))
})

const actions: PanelActions = { panelId: 'help-main', related: () => false, back: () => false, forward: () => false, open: () => false }

function renderHelp() {
  return render(
    <PanelActionsContext value={actions}>
      <HelpScreen built={new Set(['HELP', 'HOME'])} />
    </PanelActionsContext>,
  )
}

function searchField(): HTMLInputElement {
  const bar = screen.getByRole('toolbar', { name: `${HELP.title} functions` })
  return within(bar).getByRole('combobox', { name: HELP.searchLabel }) as HTMLInputElement
}

const nothing = (word: string) => withValue(COMMAND_LINE.searchNone, word)

describe('HELP search before and after the search index has loaded', () => {
  it('lists today\'s rows and says the help text is loading, then draws the help text matches when the index arrives', async () => {
    expect(loadedSearchIndex()).toBeNull()
    renderHelp()
    const field = searchField()
    fireEvent.change(field, { target: { value: 'Holm' } })
    expect(screen.getByText(SEARCH.loading)).toBeTruthy()
    // No keystroke after this: the list is drawn again by itself once the index has loaded.
    await waitFor(() => expect(loadedSearchIndex()).not.toBeNull())
    await waitFor(() => expect(screen.queryByText(SEARCH.loading)).toBeNull())
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    expect(screen.queryByText(nothing('Holm'))).toBeNull()
  })
})

describe('HELP search once the index has loaded (U03)', () => {
  it.each(['Holm', 'TWS', 'fence', 'verdict'])('typing %s lists at least one match and not "Nothing matches"', async (word) => {
    await loadSearchIndex()
    renderHelp()
    fireEvent.change(searchField(), { target: { value: word } })
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    expect(screen.queryByText(nothing(word))).toBeNull()
    expect(screen.queryByText(SEARCH.loading)).toBeNull()
  })

  it('still says "Nothing matches" for a word that nothing holds', async () => {
    await loadSearchIndex()
    renderHelp()
    fireEvent.change(searchField(), { target: { value: 'qzxwv' } })
    expect(screen.getByText(nothing('qzxwv'))).toBeTruthy()
  })

  it('a help text hit runs its "<CODE> HELP" line, which opens that topic', async () => {
    await loadSearchIndex()
    const seen = vi.fn()
    const off = onLineRequest(seen)
    renderHelp()
    fireEvent.change(searchField(), { target: { value: 'Holm' } })
    const hit = within(screen.getByRole('listbox')).getAllByRole('option').find((o) => / HELP/.test(o.textContent ?? '') && o.textContent?.includes(SEARCH.groups.help))
    expect(hit).toBeTruthy()
    fireEvent.click(hit!)
    off()
    const line = seen.mock.calls.at(-1)?.[0] as { line: string; newPanel: boolean }
    expect(line.line).toMatch(/^[A-Z0-9]+ HELP$/)
    expect(line.newPanel).toBe(false)
    expect(searchField().value).toBe('')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('a function that takes a context still opens its help page here, with no request', async () => {
    await loadSearchIndex()
    const seen = vi.fn()
    const off = onLineRequest(seen)
    renderHelp()
    fireEvent.change(searchField(), { target: { value: 'GP' } })
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0]
    expect(first?.textContent).toContain('GP')
    fireEvent.click(first!)
    off()
    expect(seen).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Help for GP' })).toBeTruthy()
  })

  it('an instrument hit loads that instrument on the command line, since it has no help page to open', async () => {
    await loadSearchIndex()
    const seen = vi.fn()
    const off = onLineRequest(seen)
    renderHelp()
    fireEvent.change(searchField(), { target: { value: 'nasdaq' } })
    const hit = within(screen.getByRole('listbox')).getAllByRole('option').find((o) => o.textContent?.includes(SEARCH.groups.instrument))
    expect(hit).toBeTruthy()
    fireEvent.click(hit!)
    off()
    expect(seen).toHaveBeenLastCalledWith({ line: 'NQ', newPanel: false })
  })
})
