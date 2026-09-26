// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MNEMONICS, screenNumber } from '../commands/registry'
import { HELP, HELP_KEYS } from '../copy/help'
import HelpScreen from './HelpScreen'

afterEach(cleanup)

function mnemonicTable() {
  return screen.getByRole('table', { name: HELP.mnemonicsCaption })
}

/** Every cell of a row, header cells included. */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>('th, td'))
}

describe('HelpScreen, generated from the command registry', () => {
  it('heads each row with its mnemonic or key, so screen readers name the row (1.3.1)', () => {
    render(<HelpScreen built={new Set(['HELP'])} />)
    const headers = within(mnemonicTable()).getAllByRole('rowheader').map((h) => h.textContent)
    expect(headers).toEqual(MNEMONICS.map((m) => m.code))
    const keys = screen.getByRole('table', { name: HELP.keysCaption })
    expect(within(keys).getAllByRole('rowheader')).toHaveLength(HELP_KEYS.length)
  })

  it('lists every registry mnemonic once, numbered as on the status bar', () => {
    render(<HelpScreen built={new Set(['HELP'])} />)
    const rows = within(mnemonicTable()).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(MNEMONICS.length)
    MNEMONICS.forEach((m, i) => {
      const cells = cellsOf(rows[i]!).map((c) => c.textContent)
      expect(cells.slice(0, 5)).toEqual([screenNumber(m.code), m.code, m.screen, m.context, m.priority])
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
    expect(status('GP')).toBe('placeholder, phase 7')
    expect(status('VCONE')).toBe(HELP.statusP1)
    expect(status('JOBS')).toBe(HELP.statusP2)
  })

  it('lists the keys, including Esc and Ctrl+K', () => {
    render(<HelpScreen built={new Set()} />)
    const keys = screen.getByRole('table', { name: HELP.keysCaption })
    expect(within(keys).getAllByRole('row')).toHaveLength(HELP_KEYS.length + 1)
    expect(within(keys).getByText('Esc')).toBeTruthy()
    expect(within(keys).getByText('Ctrl+K')).toBeTruthy()
  })

  it('carries the TradingView notice and a safe outbound link', () => {
    render(<HelpScreen built={new Set()} />)
    expect(screen.getByText(HELP.tradingView)).toBeTruthy()
    const link = screen.getByRole('link', { name: `${HELP.tradingViewLink} ${HELP.newTab}` })
    expect(link.getAttribute('href')).toBe('https://www.tradingview.com/')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})
