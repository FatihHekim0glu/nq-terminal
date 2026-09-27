// @vitest-environment jsdom
// REG, the registry board (TASKS 6.1; UI_SPEC 7 "REG and MT"; look spec 7.2): counts from the API,
// every registry row with its verdict badge, the round rail, sealed confirmations in their own block,
// Enter or Number <GO> on a row opening DES, and GET requests only.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import { REGISTRY } from './regFixtures'
import RegScreen from './RegScreen'
import { PANEL_ID, mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => resetNumbered())
afterEach(() => cleanup())

function board(): HTMLElement {
  return screen.getByRole('grid', { name: /Registry board/ })
}

function bodyRows(): HTMLElement[] {
  return within(board()).getAllByRole('row').filter((r) => r.closest('tbody'))
}

function rowOf(name: string): HTMLElement {
  const row = bodyRows().find((r) => within(r).queryByText(name) !== null)
  if (!row) throw new Error(`no row ${name}`)
  return row
}

async function ready() {
  mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
  await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
}

function captureLines(): { lines: LineRequest[]; stop: () => void } {
  const lines: LineRequest[] = []
  const stop = onLineRequest((r) => lines.push(r))
  return { lines, stop }
}

describe('REG: registry board', () => {
  it('lists every registry row, registered and check rows, with the counts from the API', async () => {
    stubApi()
    await ready()
    const counts = screen.getByRole('region', { name: 'Screening criteria' })
    const count = (label: string) => within(counts).getByRole('button', { name: new RegExp(`^\\d+\\) ${label} \\d+`) }).textContent
    expect(count('Registered hypotheses')).toMatch(/18$/)
    expect(count('Passed own bar')).toMatch(/2$/)
    expect(count('Failed own bar')).toMatch(/16$/)
    expect(count('Check rows, no own bar')).toMatch(/1$/)
    expect(count('BH q below 0.05')).toMatch(/2$/)
    expect(within(counts).getByText('Registry rows')).toBeTruthy()
    expect(within(counts).getByText('[PRE-REG]')).toBeTruthy()
  })

  it('shows overnight_v0 as PASS in text, the check row as CHECK and the stored values to four decimals', async () => {
    stubApi()
    await ready()
    const overnight = within(rowOf('overnight_v0')).getAllByRole('gridcell').map((c) => c.textContent)
    expect(overnight).toContain('[PASS]')
    expect(overnight).toContain('0.0027')
    expect(overnight).toContain('0.0487')
    expect(overnight).toContain('0.0460')
    expect(overnight).toContain('0.0244')
    expect(overnight).toContain('a3d6..8b19')
    expect(overnight).toContain('2,825')
    const pass = within(rowOf('overnight_v0')).getByText('[PASS]')
    expect(pass.closest('td')?.classList.contains('up')).toBe(true)
    expect(within(rowOf('za_v0_C3_gao_momentum')).getByText('[CHECK]')).toBeTruthy()
    expect(within(rowOf('za_v0')).getByText('[FAIL]').closest('td')?.classList.contains('down')).toBe(true)
    const notes = screen.getByRole('list', { name: 'Verdict notes' })
    expect(within(notes).getByText('multi-asset universe: 27 CME futures, not NQ')).toBeTruthy()
    expect(within(notes).getAllByRole('listitem')).toHaveLength(5)
  })

  it('keeps sealed confirmations out of the family grid, in their own block with their own alpha', async () => {
    stubApi()
    await ready()
    expect(within(board()).queryByText('rebal_v1_confirm')).toBeNull()
    const block = screen.getByRole('region', { name: /Sealed confirmations/ })
    const row = within(block).getByRole('row', { name: /rebal_v1_confirm/ })
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(expect.arrayContaining(['rebal_v0', '54', '0.3375', '0.05', '[FAIL]', '64bf..0f33', 'ok', 'CLOSED']))
    expect(within(block).getByText('[SPENT]')).toBeTruthy()
    expect(within(block).getByText(/spent window, opened 2026-09-26, descriptive only/)).toBeTruthy()
  })

  it('opens DES for a row on Enter and on Number <GO>', async () => {
    stubApi()
    await ready()
    const { lines, stop } = captureLines()
    try {
      const g = board()
      act(() => g.focus())
      const index = bodyRows().indexOf(rowOf('overnight_v0'))
      for (let i = 0; i < index; i += 1) fireEvent.keyDown(g, { key: 'ArrowDown' })
      fireEvent.keyDown(g, { key: 'Enter' })
      expect(lines.at(-1)).toEqual({ line: 'overnight_v0 DES', newPanel: false })
      const item = numberedItems(PANEL_ID).find((i) => i.label === 'eomtsy_v0')
      expect(item).toBeDefined()
      act(() => {
        activateNumbered(PANEL_ID, item!.n)
      })
      expect(lines.at(-1)).toEqual({ line: 'eomtsy_v0 DES', newPanel: false })
    } finally {
      stop()
    }
  })

  it('opens DES for a sealed confirmation from its block', async () => {
    stubApi()
    await ready()
    const { lines, stop } = captureLines()
    try {
      fireEvent.click(screen.getByRole('button', { name: /Open rebal_v1_confirm DES/ }))
      expect(lines.at(-1)).toEqual({ line: 'rebal_v1_confirm DES', newPanel: false })
    } finally {
      stop()
    }
  })

  it('filters by round from the rail and by text from the amber field', async () => {
    stubApi()
    await ready()
    const rail = screen.getByRole('navigation', { name: 'Rounds' })
    fireEvent.click(within(rail).getByRole('button', { name: /Round 1 \(4\)/ }))
    await waitFor(() => expect(bodyRows()).toHaveLength(4))
    expect(within(rail).getByRole('button', { name: /Round 1 \(4\)/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(rail).getByRole('button', { name: /All rounds \(19\)/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter hypotheses by name' }), { target: { value: 'fomc' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
  })

  it('filters by a criterion and clears it when pressed again', async () => {
    stubApi()
    await ready()
    const passed = screen.getByRole('button', { name: /Passed own bar 2/ })
    fireEvent.click(passed)
    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(passed.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(passed)
    await waitFor(() => expect(bodyRows()).toHaveLength(REGISTRY.counts.rows))
  })

  it('reads the four research endpoints with GET and nothing else', async () => {
    const seen = stubApi()
    await ready()
    await waitFor(() => expect(screen.getByRole('region', { name: /Sealed confirmations/ })).toBeTruthy())
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
    expect(new Set(seen.map((s) => s.url))).toEqual(new Set(['/api/registry', '/api/hypotheses', '/api/multiple-testing', '/api/confirmations']))
  })

  it('names the failure when the registry cannot be read, and shows no rows', async () => {
    stubApi({ '/api/registry': 503 })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/registry')
    expect(screen.queryByRole('grid', { name: /Registry board/ })).toBeNull()
  })

  it('still lists the registry when the hypothesis cards fail, with verdicts from the registry text and a note', async () => {
    stubApi({ '/api/hypotheses': 503 })
    await ready()
    expect(within(rowOf('overnight_v0')).getByText('[PASS]')).toBeTruthy()
    expect(within(rowOf('dtsmom_v0')).getByText('[FAIL]')).toBeTruthy()
    expect(screen.getByText(/hypothesis cards could not be read \(stub 503 for \/api\/hypotheses\)/)).toBeTruthy()
  })

  it('puts the red function bar actions on 96, 97 and 98', async () => {
    stubApi()
    await ready()
    const labels = numberedItems(PANEL_ID).map((i) => `${i.n} ${i.label}`)
    expect(labels).toEqual(expect.arrayContaining(['96 Actions', '97 Settings', '98 Export']))
    expect(screen.getByRole('toolbar', { name: 'Registry board functions' })).toBeTruthy()
  })
})
