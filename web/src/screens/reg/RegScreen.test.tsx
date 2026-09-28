// @vitest-environment jsdom
// REG, the registry board (TASKS 6.1; UI_SPEC 7 "REG and MT"; look spec 7.2): counts from the API,
// every registry row with its verdict badge, the round rail, sealed confirmations in their own block,
// Enter or Number <GO> on a row opening DES, and GET requests only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { captureDownloads } from '../../chrome/download.testUtil'
import { stubLayout } from '../../grids/testing'
import { HOME_PANEL_IDS } from '../layouts/layouts'
import { REGISTRY } from './regFixtures'
import { CONFIRM, REG } from '../../copy/reg'
import { DEFLATED } from '../../copy/deflated'
import { EVIDENCE, REG_VIEW_COPY } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import { DEFLATED_REAL } from './deflatedFixtures'
import RegEvidence from './RegEvidence'
import RegScreen from './RegScreen'
import type { EvidenceRow } from './evidenceModel'
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
    expect(count('Registered hypotheses')).toMatch(/21$/)
    expect(count('Edge hypotheses')).toMatch(/20$/)
    expect(count('Risk overlays \\(in the family, not edges\\)')).toMatch(/1$/)
    expect(count('Passed own bar')).toMatch(/3$/)
    expect(count('Edges that passed their bar')).toMatch(/2$/)
    expect(count('Failed own bar')).toMatch(/18$/)
    expect(count('Check rows, no own bar')).toMatch(/1$/)
    expect(count('BH q below 0.05')).toMatch(/3$/)
    expect(within(counts).getByText('Registry rows')).toBeTruthy()
    expect(within(counts).getByText('[PRE-REG]')).toBeTruthy()
  })

  it('shows overnight_v0 as PASS in text, the check row as CHECK and the stored values to four decimals', async () => {
    stubApi()
    await ready()
    const overnight = within(rowOf('overnight_v0')).getAllByRole('gridcell').map((c) => c.textContent)
    expect(overnight).toContain('[PASS]')
    expect(overnight).toContain('0.0027')
    expect(overnight).toContain('0.0568')
    expect(overnight).toContain('0.0514')
    expect(overnight).toContain('0.0189')
    expect(overnight).toContain('edge')
    expect(overnight).toContain('a3d6..8b19')
    expect(overnight).toContain('2,825')
    const pass = within(rowOf('overnight_v0')).getByText('[PASS]')
    expect(pass.closest('td')?.classList.contains('up')).toBe(true)
    expect(within(rowOf('za_v0_C3_gao_momentum')).getByText('[CHECK]')).toBeTruthy()
    expect(within(rowOf('za_v0')).getByText('[FAIL]').closest('td')?.classList.contains('down')).toBe(true)
    const notes = screen.getByRole('list', { name: 'Verdict notes' })
    expect(within(notes).getByText('multi-asset universe: 27 CME futures, not NQ')).toBeTruthy()
    // Eight rows carry a verdict note, and the overlay line says what [OVERLAY] means.
    expect(within(notes).getAllByRole('listitem')).toHaveLength(9)
    expect(within(rowOf('vt_har_v0')).getByText('[OVERLAY]')).toBeTruthy()
    expect(within(rowOf('vt_har_v0')).getByText('2 ok')).toBeTruthy()
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
    // The panel body scrolls the confirmations as one with the grid (nqt-grid-scroll--panel, grid.css); no
    // tabindex of its own, so the roving model does not fight it for the panel's one Tab stop.
    const scroll = block.querySelector('.reg-confirm-scroll')!
    expect(scroll.classList.contains('nqt-grid-scroll--panel')).toBe(true)
    expect(scroll.hasAttribute('tabindex')).toBe(false)
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
    fireEvent.click(within(rail).getByRole('button', { name: /All rounds \(22\)/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter hypotheses by name' }), { target: { value: 'fomc' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
  })

  it('filters by a criterion and clears it when pressed again', async () => {
    stubApi()
    await ready()
    const passed = screen.getByRole('button', { name: /Passed own bar 3/ })
    fireEvent.click(passed)
    await waitFor(() => expect(bodyRows()).toHaveLength(3))
    expect(passed.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(passed)
    await waitFor(() => expect(bodyRows()).toHaveLength(REGISTRY.counts.rows))
  })

  it('reads the four research endpoints with GET and nothing else', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1400, height: 600, x: 0, y: 0, top: 0, left: 0, right: 1400, bottom: 600, toJSON: () => ({}) } as DOMRect)
    const seen = stubApi()
    await ready()
    await waitFor(() => expect(screen.getByRole('region', { name: /Sealed confirmations/ })).toBeTruthy())
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
    expect(new Set(seen.map((s) => s.url))).toEqual(new Set(['/api/registry', '/api/hypotheses', '/api/multiple-testing', '/api/confirmations', '/api/analytics/deflated']))
  })

  /** REG's measured width (jsdom lays nothing out): full width shows every column, a HOME cell the narrow set. */
  function stubWidth(width: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width, height: 600, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 600, toJSON: () => ({}) } as DOMRect)
  }

  it('born failing: a narrow REG (the HOME cell) never asks for SV3, since it shows no DSR column', async () => {
    stubWidth(682)
    const seen = stubApi()
    await ready()
    await waitFor(() => expect(screen.getByText(/Columns hidden here/)).toBeTruthy())
    await new Promise((r) => setTimeout(r, 50))
    expect(seen.some((s) => s.url === '/api/analytics/deflated')).toBe(false)
  })

  it('shows the DSR of each registered trial ([POST HOC]) in its own column, and none for a check row', async () => {
    stubWidth(1400)
    stubApi()
    await ready()
    await waitFor(() => expect(screen.getByText(fillCopy(DEFLATED.regNote, { n: 21 }))).toBeTruthy())
    const grid = screen.getByRole('grid', { name: /Registry board/ })
    const headers = within(grid).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toContain(DEFLATED.regColumn)
    const vm = DEFLATED_REAL.rows.find((r) => r.name === 'volmanaged_v0')!
    const vmRow = within(grid).getByText('volmanaged_v0').closest('[role="row"]')!
    // REG's column is the DSR under V0 (under V every real trial is below 1e-30, SV3a step 5).
    expect(vmRow.textContent).toContain(vm.dsr_null!.toFixed(3))
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

  it('lists the accepted amendments, each re-hashed now, all unchanged', async () => {
    stubApi()
    await ready()
    const block = screen.getByRole('region', { name: 'Accepted amendments' })
    expect(within(block).getByText(/Accepted 2026-09-27T03:20:09Z from results\/amendment_acceptances.md: 4 amendments, all unchanged\./)).toBeTruthy()
    expect(within(block).getAllByRole('row')).toHaveLength(5)
    expect(within(block).getByText('experiments/vt_har_v0_amend2.json')).toBeTruthy()
    const scroll = block.querySelector('.reg-confirm-scroll')!
    expect(scroll.classList.contains('nqt-grid-scroll--panel')).toBe(true)
    expect(scroll.hasAttribute('tabindex')).toBe(false)
  })

  it('keeps the grid inside a narrow panel (a 682px HOME cell): the lower-priority columns drop, and it says so', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains('reg-main') ? 660 : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    try {
      stubApi()
      await ready()
      const heads = within(board()).getAllByRole('columnheader').map((h) => h.textContent)
      expect(heads).not.toContain('Bonf')
      expect(heads).not.toContain('Spec sha')
      expect(heads).toEqual(expect.arrayContaining(['Name', 'Tag', 'Verdict', 'p', 'Holm', 'BH q', 'Hash ok', 'Amend']))
      expect(screen.getByText(/Columns hidden here/)).toBeTruthy()
    } finally {
      rect.mockRestore()
    }
  })

  it('puts the red function bar actions on 96, 97 and 98', async () => {
    stubApi()
    await ready()
    const labels = numberedItems(PANEL_ID).map((i) => `${i.n} ${i.label}`)
    expect(labels).toEqual(expect.arrayContaining(['96 Actions', '97 Settings', '98 Export']))
    expect(screen.getByRole('toolbar', { name: 'Registry board functions' })).toBeTruthy()
  })
})

describe('REG: 92) Evidence (roadmap #5, W1-R5a)', () => {
  function rowsOf(grid: HTMLElement): HTMLElement[] {
    return within(grid).getAllByRole('row').filter((r) => r.closest('tbody'))
  }

  /** Mounts REG, waits for the board, then switches to 92) Evidence and waits for its grid. */
  async function openEvidence(): Promise<HTMLElement> {
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    fireEvent.click(screen.getByRole('tab', { name: '92) Evidence' }))
    const grid = await screen.findByRole('grid', { name: EVIDENCE.gridLabel })
    await waitFor(() => expect(rowsOf(grid).length).toBe(REGISTRY.counts.rows))
    return grid
  }

  it('shows 91) Board (selected) and 92) Evidence outside HOME', async () => {
    stubApi()
    await ready()
    const tabs = screen.getByRole('tablist', { name: REG_VIEW_COPY.label })
    const board = within(tabs).getByRole('tab', { name: '91) Board' })
    expect(board.getAttribute('aria-selected')).toBe('true')
    expect(within(tabs).getByRole('tab', { name: '92) Evidence' })).toBeTruthy()
  })

  it('lists every registry row, fanned out as one GET per row, GET only', async () => {
    const seen = stubApi()
    await openEvidence()
    await waitFor(() => expect(seen.filter((s) => s.url.startsWith('/api/hypotheses/')).length).toBe(REGISTRY.counts.rows))
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('names the rows whose detail was not read, and raises no alert for it', async () => {
    stubApi()
    await openEvidence()
    await screen.findByText(fillCopy(EVIDENCE.failed, { n: 17, name: 'tom_v0', detail: 'not found' }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('shows the legend tags for pre-registered, sealed and post-hoc evidence, and that there is no score', async () => {
    stubApi()
    await openEvidence()
    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toContain(EVIDENCE.legendPreReg)
    expect(panel.textContent).toContain(EVIDENCE.legendSpent)
    expect(panel.textContent).toContain(EVIDENCE.legendPostHoc)
    expect(panel.textContent).toContain(EVIDENCE.noScore)
    expect(panel.textContent).toContain(EVIDENCE.tNote)
    expect(panel.textContent).toContain('[PRE-REG]')
    expect(panel.textContent).toContain(`[${CONFIRM.spent}]`)
    expect(panel.textContent).toContain('[POST HOC]')
  })

  it('shows volmanaged_v0 with 2/3 blocks positive and its break-even, and rebal_v0 as [FAIL] SPENT', async () => {
    stubApi()
    const grid = await openEvidence()
    const vm = rowsOf(grid).find((r) => within(r).queryByText('volmanaged_v0') !== null)!
    expect(within(vm).getByText('2/3')).toBeTruthy()
    expect(within(vm).getByText('66.11')).toBeTruthy()
    const rebal = rowsOf(grid).find((r) => within(r).queryByText('rebal_v0') !== null)!
    expect(within(rebal).getByText('[FAIL] SPENT')).toBeTruthy()
  })

  it('opens DES for a row on Enter', async () => {
    stubApi()
    const grid = await openEvidence()
    const { lines, stop } = captureLines()
    try {
      act(() => grid.focus())
      fireEvent.keyDown(grid, { key: 'Enter' })
      expect(lines.at(-1)?.line).toMatch(/ DES$/)
    } finally {
      stop()
    }
  })

  it("HOME's REG cell shows no tab strip and asks for no hypothesis detail", async () => {
    const seen = stubApi()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />, { panelId: HOME_PANEL_IDS.reg })
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    expect(screen.queryByRole('tablist', { name: REG_VIEW_COPY.label })).toBeNull()
    await new Promise((r) => setTimeout(r, 20))
    expect(seen.some((s) => /\/api\/hypotheses\/[^/]+$/.test(s.url))).toBe(false)
  })

  it('#14: follows the board filters, so typing in the amber field narrows the evidence grid too, with no extra fan-out', async () => {
    const seen = stubApi()
    const grid = await openEvidence()
    const before = seen.filter((s) => s.url.startsWith('/api/hypotheses/')).length
    fireEvent.change(screen.getByRole('textbox', { name: REG.filterLabel }), { target: { value: 'vol' } })
    const expected = REGISTRY.rows.filter((r) => r.name.toLowerCase().includes('vol')).map((r) => r.name)
    expect(expected.length).toBeGreaterThan(0)
    await waitFor(() => expect(rowsOf(grid).length).toBe(expected.length))
    for (const name of expected) expect(within(grid).getByText(name)).toBeTruthy()
    expect(seen.filter((s) => s.url.startsWith('/api/hypotheses/')).length).toBe(before)
  })

  it('#13/#23: 98) Export offers the evidence matrix as CSV here, and saves every column', async () => {
    stubApi()
    await openEvidence()
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: EVIDENCE.export.csv }))
      const text = await saved.text('evidence_matrix.csv')
      const [head] = text.split('\r\n')
      expect(head).toBe(EVIDENCE.csvHead.join(','))
    } finally {
      saved.restore()
    }
  })

  it('#13/#23: on 91) Board the evidence CSV menu item is absent', async () => {
    stubApi()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    expect(screen.getByRole('menuitem', { name: REG.export.csv })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: EVIDENCE.export.csv })).toBeNull()
  })

  it('#22: every tab points aria-controls at the tabpanel it actually controls', async () => {
    stubApi()
    await ready()
    const panel = screen.getByRole('tabpanel')
    for (const tab of screen.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe(panel.id)
  })

  it('#22: the tabs carry no aria-controls while the registry cannot be read', async () => {
    stubApi({ '/api/registry': 503 })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    await screen.findByRole('alert')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(0)
    for (const tab of tabs) expect(tab.hasAttribute('aria-controls')).toBe(false)
  })
})

describe('RegEvidence: #21 the status line is one stable role=status node', () => {
  function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
    return {
      name: 'x_v0', registered: true, tag: 'edge', badge: 'PASS', t: null, tLabel: null, holm: null,
      blocksPositive: null, blocksTotal: null, blocksUnit: null, breakEven: null, sealed: null,
      sharpe: null, years: null, dsr: null, detail: 'ok', detailError: null, ...overrides,
    }
  }

  it('mounts empty (never role=alert) and keeps the same node once a row fails', () => {
    const { rerender } = render(<RegEvidence rows={[evidenceRow()]} width={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    rerender(<RegEvidence rows={[evidenceRow({ name: 'y_v0', detail: 'failed', detailError: 'not found' })]} width={null} />)
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe(fillCopy(EVIDENCE.failed, { n: 1, name: 'y_v0', detail: 'not found' }))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })
})
