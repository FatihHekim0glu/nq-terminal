// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MNEMONICS } from '../commands/registry'
import { parseLine } from '../commands/line'
import { HELP, HELP_KEYS } from '../copy/help'
import { onLineRequest } from './CommandLine.bus'
import HelpScreen from './HelpScreen'

afterEach(cleanup)

function mnemonicTable() {
  return screen.getByRole('table', { name: HELP.mnemonicsCaption })
}

/** Every cell of a row, header cells included. */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>('th, td'))
}

describe('HelpScreen, generated from the command registry (spec 7.12)', () => {
  it('heads each row with its mnemonic or key, so screen readers name the row (1.3.1)', () => {
    render(<HelpScreen built={new Set(['HELP'])} />)
    const headers = within(mnemonicTable()).getAllByRole('rowheader').map((h) => h.textContent)
    expect(headers).toEqual(MNEMONICS.map((m) => m.code))
    const keys = screen.getByRole('table', { name: HELP.keysCaption })
    expect(within(keys).getAllByRole('rowheader')).toHaveLength(HELP_KEYS.length)
  })

  it('numbers the mnemonic index 1) 2) 3) as hot-link numbers', () => {
    render(<HelpScreen built={new Set(['HELP'])} />)
    const rows = within(mnemonicTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(MNEMONICS.length)
    MNEMONICS.forEach((m, i) => {
      const cells = cellsOf(rows[i]!).map((c) => c.textContent)
      expect(cells.slice(0, 5)).toEqual([`${i + 1})`, m.code, m.screen, m.context, m.priority])
    })
  })

  it('born failing: the index follows the list it is given, so it cannot drift from the registry', () => {
    const shortList = MNEMONICS.filter((m) => m.code !== 'MT')
    render(<HelpScreen built={new Set()} mnemonics={shortList} />)
    const listed = within(mnemonicTable()).getAllByRole('row').slice(1).map((r) => cellsOf(r)[1]?.textContent)
    expect(listed).not.toContain('MT')
    expect(listed).toEqual(shortList.map((m) => m.code))
  })

  it('marks each screen built or placeholder, naming the phase or the priority', () => {
    render(<HelpScreen built={new Set(['HELP'])} />)
    const rows = within(mnemonicTable()).getAllByRole('row').slice(1)
    const status = (code: string) => {
      const row = rows.find((r) => cellsOf(r)[1]?.textContent === code)
      return row ? cellsOf(row)[5]?.textContent : undefined
    }
    expect(status('HELP')).toBe(HELP.statusBuilt)
    expect(status('REG')).toBe('placeholder, phase 6')
    expect(status('VCONE')).toBe(HELP.statusP1)
    expect(status('JOBS')).toBe(HELP.statusP2)
  })

  // Changed after the visual review (spec 7.12): the contents rail groups white headings with counts
  // and lists the mnemonics under their heading as numbered amber items, not a flat list of five.
  it('has a table of contents: white group headings with counts, numbered mnemonic items under the first', () => {
    render(<HelpScreen built={new Set()} />)
    const toc = screen.getByRole('navigation', { name: HELP.tocLabel })
    const headings = Array.from(toc.querySelectorAll<HTMLElement>('.toc-group > button')).map((b) => b.textContent)
    expect(headings).toEqual([
      `${HELP.mnemonicsHeading}${MNEMONICS.length}`,
      `${HELP.keysHeading}${HELP_KEYS.length}`,
      `${HELP.linkHeading}3`,
      HELP.keyboardHeading,
      expect.stringMatching(new RegExp(`^${HELP.licencesHeading}\\d+$`)),
    ])
    const items = within(toc).getByRole('list', { name: HELP.mnemonicsHeading })
    const rows = within(items).getAllByRole('button')
    expect(rows.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual(MNEMONICS.map((m, i) => `${i + 1}) ${m.code}`))
    expect(rows[0]?.querySelector('.hot')?.textContent).toBe('1)')
  })

  it('marks the selected contents entry; a mnemonic item runs its help like Number <GO>', () => {
    const seen = vi.fn()
    const stop = onLineRequest(seen)
    render(<HelpScreen built={new Set()} />)
    const toc = screen.getByRole('navigation', { name: HELP.tocLabel })
    const headings = Array.from(toc.querySelectorAll<HTMLElement>('.toc-group > button'))
    expect(headings[0]?.getAttribute('aria-current')).toBe('true')
    fireEvent.click(headings[1]!)
    expect(headings[1]?.getAttribute('aria-current')).toBe('true')
    expect(headings[0]?.getAttribute('aria-current')).toBeNull()
    const gp = within(toc).getByRole('button', { name: /^2\)\s*GP$/ })
    fireEvent.click(gp)
    expect(gp.getAttribute('aria-current')).toBe('true')
    expect(headings[1]?.getAttribute('aria-current')).toBeNull()
    expect(seen).toHaveBeenCalledWith({ line: 'GP HELP', newPanel: false })
    stop()
  })

  it('carries the red function bar: <Search help> field, 96) Actions and the title Help (spec 7.12)', () => {
    const seen = vi.fn()
    const stop = onLineRequest(seen)
    render(<HelpScreen built={new Set()} />)
    const bar = screen.getByRole('toolbar', { name: 'Help functions' })
    expect(bar.className).toContain('fn-bar')
    expect(within(bar).getByText('Help').className).toContain('fn-title')
    expect(within(bar).getByRole('button', { name: /96\)\s*Actions/ }).getAttribute('aria-haspopup')).toBe('menu')
    const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
    expect(search.getAttribute('placeholder')).toBe('<Search help>')
    fireEvent.change(search, { target: { value: 'drawdown' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(seen).toHaveBeenCalledWith({ line: 'HL drawdown', newPanel: false })
    stop()
  })

  // The HL popover used to be the command line's own, anchored under it and covering HELP's own
  // field until Esc; results for HELP's own field now render inside the HELP panel as the user
  // types, so the field itself is never covered and there is no page-level overlay to intercept
  // clicks (U19).
  it('shows live search results inside the HELP panel as the user types, not only after Enter', () => {
    render(<HelpScreen built={new Set()} />)
    const bar = screen.getByRole('toolbar', { name: 'Help functions' })
    const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(search, { target: { value: 'GP' } })
    const list = screen.getByRole('listbox')
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(0)
    expect(within(list).getByText('GP')).toBeTruthy()
  })

  it('clicking a live result runs its line and closes the results, without covering the field', () => {
    const seen = vi.fn()
    const stop = onLineRequest(seen)
    render(<HelpScreen built={new Set()} />)
    const bar = screen.getByRole('toolbar', { name: 'Help functions' })
    const search = within(bar).getByRole('combobox', { name: HELP.searchLabel }) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'HOME' } })
    const list = screen.getByRole('listbox')
    fireEvent.click(within(list).getByText('HOME'))
    expect(seen).toHaveBeenCalledWith({ line: 'HOME', newPanel: false })
    expect(screen.queryByRole('listbox')).toBeNull()
    stop()
  })

  it('clears the live results once the field is emptied', () => {
    render(<HelpScreen built={new Set()} />)
    const bar = screen.getByRole('toolbar', { name: 'Help functions' })
    const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
    fireEvent.change(search, { target: { value: 'GP' } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // U19: the in-panel results used to be reachable only by mouse; the field is now a combobox that
  // owns its own listbox, so keyboard and screen reader users can reach, pick and dismiss a result.
  describe('the in-panel search results are keyboard- and screen-reader-reachable (U19)', () => {
    it('names its (collapsed) listbox and expands aria-expanded/aria-controls once results show', () => {
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
      expect(search.getAttribute('aria-expanded')).toBe('false')
      expect(search.getAttribute('aria-controls')).toBeNull()
      fireEvent.change(search, { target: { value: 'GP' } })
      const list = screen.getByRole('listbox')
      expect(search.getAttribute('aria-expanded')).toBe('true')
      expect(search.getAttribute('aria-controls')).toBe(list.id)
    })

    it('ArrowDown highlights the first option, reported through aria-activedescendant', () => {
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
      fireEvent.change(search, { target: { value: 'GP' } })
      const list = screen.getByRole('listbox')
      const first = within(list).getAllByRole('option')[0]!
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      expect(search.getAttribute('aria-activedescendant')).toBe(first.id)
    })

    it('Enter with a highlighted result chooses it, with no HL request (U19, #13)', () => {
      const seen = vi.fn()
      const stop = onLineRequest(seen)
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
      fireEvent.change(search, { target: { value: 'GP' } })
      const list = screen.getByRole('listbox')
      const first = within(list).getAllByRole('option')[0]!
      const chosen = first.textContent
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      fireEvent.keyDown(search, { key: 'Enter' })
      expect(seen).toHaveBeenCalledTimes(1)
      const line = seen.mock.calls[0]?.[0]?.line as string
      expect(line).not.toMatch(/^HL /)
      expect(chosen).toContain(line.replace(/ HELP$/, ''))
      expect(screen.queryByRole('listbox')).toBeNull()
      stop()
    })

    it('Escape with text in the field clears the field and the listbox, defaultPrevented', () => {
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel }) as HTMLInputElement
      fireEvent.change(search, { target: { value: 'GP' } })
      expect(screen.getByRole('listbox')).toBeTruthy()
      const notPrevented = fireEvent.keyDown(search, { key: 'Escape' })
      expect(notPrevented).toBe(false)
      expect(search.value).toBe('')
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('D14 is unchanged: Enter with no highlighted row still requests HL <query>', () => {
      const seen = vi.fn()
      const stop = onLineRequest(seen)
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
      fireEvent.change(search, { target: { value: 'drawdown' } })
      fireEvent.keyDown(search, { key: 'Enter' })
      expect(seen).toHaveBeenCalledWith({ line: 'HL drawdown', newPanel: false })
      stop()
    })
  })

  // A context-taking mnemonic used to loop back to the same search results and never open anything:
  // chooseSearchResult's setQuery(item.act.line) just re-ran the same search (HelpScreen.tsx:239).
  describe('choosing a context-taking function or a chrome word actually opens it', () => {
    it('clicking a context-taking function (EQ) opens its help, the same as the contents rail', () => {
      const seen = vi.fn()
      const stop = onLineRequest(seen)
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel }) as HTMLInputElement
      fireEvent.change(search, { target: { value: 'equity' } })
      const list = screen.getByRole('listbox')
      fireEvent.click(within(list).getByText('EQ'))
      expect(seen).toHaveBeenCalledWith({ line: 'EQ HELP', newPanel: false })
      expect(search.value).toBe('')
      expect(screen.queryByRole('listbox')).toBeNull()
      stop()
    })

    it('clicking a chrome word (NXTW) runs its line directly, not a re-search', () => {
      const seen = vi.fn()
      const stop = onLineRequest(seen)
      render(<HelpScreen built={new Set()} />)
      const bar = screen.getByRole('toolbar', { name: 'Help functions' })
      const search = within(bar).getByRole('combobox', { name: HELP.searchLabel }) as HTMLInputElement
      fireEvent.change(search, { target: { value: 'NXTW' } })
      const list = screen.getByRole('listbox')
      fireEvent.click(within(list).getByText('NXTW'))
      expect(seen).toHaveBeenCalledWith({ line: 'NXTW', newPanel: false })
      expect(search.value).toBe('')
      stop()
    })
  })

  it('born failing (D14): a query with punctuation, including a screen title itself, still parses as a search', () => {
    const seen = vi.fn()
    const stop = onLineRequest(seen)
    render(<HelpScreen built={new Set()} />)
    const bar = screen.getByRole('toolbar', { name: 'Help functions' })
    const search = within(bar).getByRole('combobox', { name: HELP.searchLabel })
    for (const query of ['Analytics: equity', 'P&L', '[POST HOC]']) {
      fireEvent.change(search, { target: { value: query } })
      fireEvent.keyDown(search, { key: 'Enter' })
      const line = seen.mock.calls.at(-1)?.[0]?.line as string
      expect(line).toBe(`HL ${query}`)
      const result = parseLine(line, { index: null, fallbackContext: null })
      expect(result).toEqual({ ok: true, action: { kind: 'search', query } })
    }
    stop()
  })

  it('says what to type when the browser keeps F1, F10 or F11 for itself (spec 5.2)', () => {
    const row = (key: string) => HELP_KEYS.find(([k]) => k === key)?.[1] ?? ''
    expect(row('F1')).toMatch(/type HELP/)
    expect(row('F10')).toMatch(/type INDEX/)
    expect(row('F11')).toMatch(/type CURNCY/)
  })

  it('lists the keys of spec 5.2, including Esc, F10, End, Alt+K and Ctrl+K', () => {
    render(<HelpScreen built={new Set()} />)
    const keys = screen.getByRole('table', { name: HELP.keysCaption })
    expect(within(keys).getAllByRole('row')).toHaveLength(HELP_KEYS.length + 1)
    for (const k of ['Esc', 'F1', 'F10', 'End', 'Alt+1 to Alt+9', 'Alt+K', 'Ctrl+K']) expect(within(keys).getByText(k)).toBeTruthy()
  })

  it('draws the keyboard as an image with a text alternative, beside the key table', () => {
    render(<HelpScreen built={new Set()} />)
    const board = screen.getByRole('img', { name: HELP.keyboardLabel })
    expect(board.querySelector('[data-key="Esc"]')?.textContent).toContain('CANCEL')
    expect(board.querySelector('[data-key="F10"]')?.getAttribute('data-colour')).toBe('sector')
  })

  it('renders {... <GO>} examples as command links that run the line', () => {
    const seen = vi.fn()
    const stop = onLineRequest(seen)
    render(<HelpScreen built={new Set()} />)
    fireEvent.click(screen.getByRole('button', { name: 'NQ1 Index GP <GO>' }))
    expect(seen).toHaveBeenCalledWith({ line: 'NQ1 Index GP', newPanel: false })
    stop()
  })

  it('lists the open font licences and carries the TradingView notice with a safe outbound link', () => {
    render(<HelpScreen built={new Set()} />)
    const licences = screen.getByRole('list', { name: HELP.licencesHeading })
    expect(licences.textContent).toContain('Source Sans 3')
    expect(licences.textContent).toContain('PT Mono')
    expect(licences.textContent).not.toMatch(/Inter|JetBrains|Space Grotesk/)
    expect(screen.getByText(HELP.tradingView)).toBeTruthy()
    const link = screen.getByRole('link', { name: `${HELP.tradingViewLink} ${HELP.newTab}` })
    expect(link.getAttribute('href')).toBe('https://www.tradingview.com/')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('uses no uppercase eyebrow labels (spec 3.3)', () => {
    const { container } = render(<HelpScreen built={new Set()} />)
    expect(container.querySelector('.eyebrow')).toBeNull()
  })
})
