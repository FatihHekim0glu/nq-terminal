// @vitest-environment jsdom
// REG, the registry board (TASKS 6.1; UI_SPEC 7 "REG and MT"; look spec 7.2): counts from the API,
// every registry row with its verdict badge, the round rail, sealed confirmations in their own block,
// Enter or Number <GO> on a row opening DES, and GET requests only.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConnection } from '../../api/connection'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { activateNumbered, numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { RecordWatchReader, resetRecordWatchBoot, resetRecordWatchView, useRecordWatch, type RecordWatchView } from '../../chrome/RecordWatch.live'
import { captureDownloads } from '../../chrome/download.testUtil'
import type { LineStackProps } from '../../charts/LineStack.types'
import { stubLayout } from '../../grids/testing'
import { gridWidth } from '../../grids/useElementWidth'
import { useRecordWatchStore } from '../../state/recordWatch.store'
import { HOME_PANEL_IDS } from '../layouts/layouts'
import { CONFIRMATIONS, REGISTRY } from './regFixtures'
import { CONFIRM, REG } from '../../copy/reg'
import { DEFLATED } from '../../copy/deflated'
import { EVIDENCE, REG_VIEW_COPY } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import { DEFLATED_REAL } from './deflatedFixtures'
import RegEvidence from './RegEvidence'
import RegScreen from './RegScreen'
import { REG_COLUMNS, REG_COMPACT_COLUMNS, regBoardColumns } from './regColumns'
import type { EvidenceRow } from './evidenceModel'
import { PANEL_ID, backendDown, mountScreen, panelParams, stubApi, type Seen } from './testHarness'

// REG's compare view draws through LineStack (uPlot needs a canvas): a stand-in that records what it was given.
const charts = vi.hoisted(() => ({ props: [] as LineStackProps[] }))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => {
    charts.props.push(props)
    return <div data-testid="linestack" />
  },
}))

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  resetMessage()
  charts.props = []
})
afterEach(() => {
  cleanup()
  resetConnection()
})

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
    // PanelFault puts the message and its Retry button in one alert (W6-R9b added onRetry).
    expect(alert.textContent).toContain(fillCopy(REG.failed, { detail: 'stub 503 for /api/registry' }))
    expect(within(alert).getByRole('button', { name: /Retry/ })).toBeTruthy()
    expect(screen.queryByRole('grid', { name: /Registry board/ })).toBeNull()
  })

  // Backend-down acceptance (roadmap #7): the connection strip owns the outage alert, so a panel on
  // HOME shows a waiting status, never a second role=alert.
  it('waits for the backend, with no alert in the panel, when the registry answers 502 while the connection is down', async () => {
    backendDown()
    stubApi({ '/api/registry': 502 })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Waiting for the backend: GET /api/registry answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('grid', { name: /Registry board/ })).toBeNull()
  })

  it('says the panel is waiting to load, not busy, while the backend is down and the registry is still pending', () => {
    backendDown()
    stubApi()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Waiting for the backend before loading.')
    expect(status.hasAttribute('aria-busy')).toBe(false)
  })

  it('keeps the loading line busy while the backend is up and the registry is pending', () => {
    stubApi()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(REG.loading)
    expect(status.getAttribute('aria-busy')).toBe('true')
  })

  it('names the failure of the sealed confirmations in an alert while the backend is up', async () => {
    stubApi({ '/api/confirmations': 503 })
    await ready()
    const block = screen.getByRole('region', { name: /Sealed confirmations/ })
    const alert = await within(block).findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(CONFIRM.failed, { detail: 'stub 503 for /api/confirmations' }))
  })

  it('waits for the backend in the sealed confirmations block, with no alert, while the connection is down', async () => {
    backendDown()
    stubApi({ '/api/confirmations': 502 })
    await ready()
    const block = screen.getByRole('region', { name: /Sealed confirmations/ })
    await waitFor(() =>
      expect(within(block).getByRole('status').textContent).toBe('Waiting for the backend: GET /api/confirmations answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
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

describe('REG: registry failure and loading through PanelFault and PanelLoading (roadmap #7, W6-R9b)', () => {
  it('shows the registry error as a PanelFault: the same text, a retry, and the reg-msg box', async () => {
    stubApi({ '/api/registry': 503 })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(fillCopy(REG.failed, { detail: 'stub 503 for /api/registry' }))
    expect(alert.classList.contains('reg-msg')).toBe(true)
    expect(alert.classList.contains('panel-fault-failed')).toBe(true)
    expect(within(alert).getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('retries the registry read when the retry button is pressed', async () => {
    const seen = stubApi({ '/api/registry': 503 })
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const alert = await screen.findByRole('alert')
    const before = seen.filter((s) => s.url === '/api/registry').length
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(seen.filter((s) => s.url === '/api/registry').length).toBe(before + 1))
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('shows the loading line as a PanelLoading: busy, the same text, the reg-msg box, then the board', async () => {
    stubApi()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(REG.loading)
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(status.classList.contains('reg-msg')).toBe(true)
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    expect(screen.queryByText(REG.loading)).toBeNull()
  })
})

describe('REG: 95) Compare basket (roadmap #9 phase B, W6-R9b)', () => {
  const SERIES_URL = /^\/api\/hypotheses\/([^/]+)\/series\?cost=(\d)$/

  /** stubApi plus the series GETs: a body for volmanaged_v0 and overnight_v0, a 404 for every other name. */
  function stubWithSeries(): Seen[] {
    const seen = stubApi()
    const spy = vi.spyOn(globalThis, 'fetch')
    const base = spy.getMockImplementation()!
    spy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const m = SERIES_URL.exec(url)
      if (!m) return base(input, init)
      seen.push({ url, method: init?.method ?? 'GET' })
      const name = m[1]!
      const cost = Number(m[2])
      if (name !== 'volmanaged_v0' && name !== 'overnight_v0') {
        return Promise.resolve(new Response(JSON.stringify({ detail: 'not in the demo dataset' }), { status: 404, headers: { 'content-type': 'application/json' } }))
      }
      const body = { basis: 'A', bench_label: null, cost, equity: [1, 2, 3], kind: 'trades', name, r: [1, 1, 1], r_bench: null, source: 'fixture', t: [100, 200, 300], unit: 'points per trade (NQ)' }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    return seen
  }

  /** The grid's active row, which starts on the first: Space acts on it, and the arrows move it. */
  let cursor = 0
  beforeEach(() => {
    cursor = 0
  })

  /** Space on each named row, walking the active row down or up the board (the grid keeps its own cursor). */
  function markWithSpace(names: readonly string[]): void {
    const g = board()
    act(() => g.focus())
    for (const name of names) {
      const target = bodyRows().indexOf(rowOf(name))
      for (; cursor < target; cursor += 1) fireEvent.keyDown(g, { key: 'ArrowDown' })
      for (; cursor > target; cursor -= 1) fireEvent.keyDown(g, { key: 'ArrowUp' })
      fireEvent.keyDown(g, { key: ' ' })
    }
  }

  const compareButton = () => screen.getByRole('button', { name: /^95\) Compare/ })
  const markedNames = () => bodyRows().filter((r) => r.getAttribute('data-marked') === 'true').map((r) => within(r).getAllByRole('gridcell').map((c) => c.textContent).find((t) => /_v\d/.test(t ?? '')))

  it('starts with an empty basket: 95) Compare is disabled and not a numbered action', async () => {
    stubWithSeries()
    await ready()
    expect(compareButton().textContent).toBe('95) Compare')
    expect(compareButton().getAttribute('aria-disabled')).toBe('true')
    expect(numberedItems(PANEL_ID).some((i) => i.n === 95)).toBe(false)
  })

  it('marks a row with Space and counts it on the bar: two rows give 95) Compare 2', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0'])
    expect(compareButton().textContent).toBe('95) Compare 1')
    markWithSpace(['overnight_v0'])
    expect(compareButton().textContent).toBe('95) Compare 2')
    expect(compareButton().getAttribute('aria-disabled')).toBeNull()
    expect(rowOf('volmanaged_v0').getAttribute('data-marked')).toBe('true')
    expect(rowOf('overnight_v0').getAttribute('data-marked')).toBe('true')
    expect(bodyRows().filter((r) => r.getAttribute('data-marked') === 'true')).toHaveLength(2)
    expect(numberedItems(PANEL_ID).some((i) => i.n === 95 && i.label === 'Compare 2')).toBe(true)
  })

  it('unmarks a marked row when Space is pressed on it again', async () => {
    stubWithSeries()
    await ready()
    const g = board()
    act(() => g.focus())
    const at = bodyRows().indexOf(rowOf('volmanaged_v0'))
    for (let i = 0; i < at; i += 1) fireEvent.keyDown(g, { key: 'ArrowDown' })
    fireEvent.keyDown(g, { key: ' ' })
    expect(compareButton().textContent).toBe('95) Compare 1')
    fireEvent.keyDown(g, { key: ' ' })
    expect(compareButton().textContent).toBe('95) Compare')
    expect(bodyRows().some((r) => r.hasAttribute('data-marked'))).toBe(false)
  })

  it('refuses a ninth hypothesis with the message line, and keeps the eight', async () => {
    stubWithSeries()
    await ready()
    const names = REGISTRY.rows.map((r) => r.name).filter((n) => !n.endsWith('_confirm')).slice(0, 9)
    markWithSpace(names)
    expect(compareButton().textContent).toBe('95) Compare 8')
    expect(useMessage.getState().text).toBe(REG.compare.full)
    expect(useMessage.getState().tone).toBe('error')
    expect(bodyRows().filter((r) => r.getAttribute('data-marked') === 'true')).toHaveLength(8)
    // Unmarking one is always allowed, and then the ninth fits.
    markWithSpace([names[0]!])
    expect(compareButton().textContent).toBe('95) Compare 7')
  })

  it('keeps the basket when the board is filtered, so a marked row that is hidden still counts', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0', 'overnight_v0'])
    fireEvent.change(screen.getByRole('textbox', { name: REG.filterLabel }), { target: { value: 'zzz_no_such' } })
    await screen.findByText(REG.empty)
    expect(compareButton().textContent).toBe('95) Compare 2')
    fireEvent.change(screen.getByRole('textbox', { name: REG.filterLabel }), { target: { value: '' } })
    await waitFor(() => expect(bodyRows()).toHaveLength(REGISTRY.counts.rows))
    expect(rowOf('volmanaged_v0').getAttribute('data-marked')).toBe('true')
  })

  it('95 <GO> replaces the board with the compare view, hides the tab strip, and reads each series at 1 tick', async () => {
    const seen = stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0', 'overnight_v0'])
    act(() => {
      activateNumbered(PANEL_ID, 95)
    })
    await screen.findByRole('region', { name: fillCopy(REG.compare.chartTitle, { n: 2 }) })
    expect(screen.getByText(fillCopy(REG.compare.note, { cost: REG.compare.costs['1'] }))).toBeTruthy()
    expect(screen.queryByRole('grid', { name: /Registry board/ })).toBeNull()
    expect(screen.queryByRole('tablist', { name: REG_VIEW_COPY.label })).toBeNull()
    expect(screen.queryByRole('tabpanel')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Rounds' })).toBeNull()
    expect(screen.getByRole('combobox', { name: REG.compare.costLabel })).toBeTruthy()
    await waitFor(() => expect(charts.props.at(-1)?.panes[0]?.series.map((s) => s.name)).toEqual(['volmanaged_v0 (1 tick)', 'overnight_v0 (1 tick)']))
    const series = seen.filter((s) => SERIES_URL.test(s.url))
    expect(new Set(series.map((s) => s.url))).toEqual(new Set(['/api/hypotheses/volmanaged_v0/series?cost=1', '/api/hypotheses/overnight_v0/series?cost=1']))
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('opens the compare view from a click on 95) Compare as well, and hands the panel link group to the chart', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0'])
    fireEvent.click(compareButton())
    await screen.findByRole('region', { name: REG.compare.chartTitleOne })
    await waitFor(() => expect(charts.props.at(-1)?.link).toBe('-'))
  })

  it('lists a hypothesis the API cannot answer next to the drawn ones, with no alert', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0', 'za_v0'])
    act(() => {
      activateNumbered(PANEL_ID, 95)
    })
    await screen.findByText(fillCopy(REG.compare.failed, { name: 'za_v0', detail: 'not in the demo dataset' }))
    await waitFor(() => expect(charts.props.at(-1)?.panes[0]?.series.map((s) => s.name)).toEqual(['volmanaged_v0 (1 tick)']))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('Back returns to the board with the tab strip and the same basket', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0', 'overnight_v0'])
    act(() => {
      activateNumbered(PANEL_ID, 95)
    })
    fireEvent.click(await screen.findByRole('button', { name: REG.compare.back }))
    expect(board()).toBeTruthy()
    expect(screen.getByRole('tablist', { name: REG_VIEW_COPY.label })).toBeTruthy()
    expect(screen.queryByRole('region', { name: fillCopy(REG.compare.chartTitle, { n: 2 }) })).toBeNull()
    expect(compareButton().textContent).toBe('95) Compare 2')
    expect(rowOf('volmanaged_v0').getAttribute('data-marked')).toBe('true')
  })

  it('97) Settings > Clear the basket empties it and, while comparing, returns to the board', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0', 'overnight_v0'])
    act(() => {
      activateNumbered(PANEL_ID, 95)
    })
    await screen.findByRole('region', { name: fillCopy(REG.compare.chartTitle, { n: 2 }) })
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: REG.compare.clear }))
    expect(await screen.findByRole('grid', { name: /Registry board/ })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Screen series/ })).toBeNull()
    expect(compareButton().textContent).toBe('95) Compare')
    expect(compareButton().getAttribute('aria-disabled')).toBe('true')
    expect(bodyRows().some((r) => r.hasAttribute('data-marked'))).toBe(false)
  })

  it('Clear the basket also unmarks the rows on the board itself, and Clear filters leaves the basket alone', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0'])
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: REG.settings.clear }))
    expect(compareButton().textContent).toBe('95) Compare 1')
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: REG.compare.clear }))
    expect(compareButton().textContent).toBe('95) Compare')
    expect(markedNames()).toEqual([])
  })

  it("marks and compares inside HOME's REG cell too, where the tab strip never shows", async () => {
    stubWithSeries()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />, { panelId: HOME_PANEL_IDS.reg })
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    markWithSpace(['volmanaged_v0', 'overnight_v0'])
    expect(compareButton().textContent).toBe('95) Compare 2')
    fireEvent.click(compareButton())
    await screen.findByRole('region', { name: fillCopy(REG.compare.chartTitle, { n: 2 }) })
    expect(screen.queryByRole('grid', { name: /Registry board/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: REG.compare.back }))
    expect(board()).toBeTruthy()
  })

  it('shows no p value, verdict or statistic in the compare view', async () => {
    stubWithSeries()
    await ready()
    markWithSpace(['volmanaged_v0', 'overnight_v0'])
    act(() => {
      activateNumbered(PANEL_ID, 95)
    })
    const region = await screen.findByRole('region', { name: fillCopy(REG.compare.chartTitle, { n: 2 }) })
    await waitFor(() => expect(charts.props.length).toBeGreaterThan(0))
    const text = (region.textContent ?? '').replace(fillCopy(REG.compare.note, { cost: REG.compare.costs['1'] }), '')
    expect(text).not.toMatch(/\[(PASS|FAIL|CHECK)\]|\bp\s*[=<]|Sharpe|DSR|Holm|BH q/i)
  })
})

// The Seen column (roadmap 16, slice 3): the record watch marks a registry row NEW when it is not in this
// browser's checkpoint and CHG when a field that should never move was rewritten. The marks come through
// the real watch (RecordWatchReader over a seeded checkpoint), so the key the column reads is the key the
// watch writes.
describe('REG: the Seen column from the record watch', () => {
  let watch: RecordWatchView | undefined

  function WatchProbe() {
    watch = useRecordWatch()
    return null
  }

  beforeEach(() => {
    localStorage.clear()
    useRecordWatchStore.setState({ checkpoint: null })
    resetRecordWatchView()
    resetRecordWatchBoot()
    watch = undefined
  })
  afterEach(() => {
    resetRecordWatchView()
    resetRecordWatchBoot()
    useRecordWatchStore.setState({ checkpoint: null })
  })

  type Loose = { sources: { registry: { records: Record<string, Record<string, unknown>> } } }

  /** A checkpoint of the fixtures, edited by `change`, so the watch finds the difference. */
  async function seed(change: (s: Loose) => void = () => undefined): Promise<void> {
    const lazy = await import('../../chrome/RecordWatch.lazy')
    const snapshot = JSON.parse(JSON.stringify(lazy.snapshotOf({ registry: REGISTRY, confirmations: CONFIRMATIONS }, Date.UTC(2026, 8, 20, 14, 0)))) as Loose
    change(snapshot)
    expect(useRecordWatchStore.getState().setCheckpoint(snapshot as unknown as Parameters<typeof lazy.diffWatch>[0])).toBe(true)
  }

  async function mountWatched() {
    const seen = stubApi()
    mountScreen(
      <>
        <RecordWatchReader />
        <WatchProbe />
        <RegScreen params={panelParams('REG')} context={null} />
      </>,
    )
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    return seen
  }

  const heads = () => within(board()).getAllByRole('columnheader').map((h) => h.textContent)
  const seenOf = (name: string) => within(rowOf(name)).getAllByRole('gridcell')[heads().indexOf('Seen')]

  /** REG's measured width (jsdom lays nothing out) for the main column only. */
  function stubMainWidth(width: number) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.classList.contains('reg-main') ? width : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
  }

  it('adds no column when the watch has nothing to mark', async () => {
    stubApi()
    await ready()
    expect(heads()).not.toContain('Seen')
    expect(heads()[1]).toBe('Name')
  })

  it('adds no column when the checkpoint matches the records', async () => {
    await seed()
    await mountWatched()
    await waitFor(() => expect(watch?.state).toBe('clean'))
    expect(heads()).not.toContain('Seen')
  })

  it('shows CHG on the row whose frozen field was rewritten (volmanaged_v0, p), first after the number', async () => {
    await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.123456))
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    expect(heads().slice(1, 3)).toEqual(['Seen', 'Name'])
    expect(seenOf('volmanaged_v0')?.textContent).toBe('CHG')
    expect(seenOf('overnight_v0')?.textContent).toBe('')
    expect(within(board()).getAllByText('CHG')).toHaveLength(1)
    expect(within(board()).queryByText('NEW')).toBeNull()
  })

  it('shows NEW, toned muted, on a row the checkpoint does not know', async () => {
    await seed((s) => void delete s.sources.registry.records['rebal_v0'])
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    expect(seenOf('rebal_v0')?.textContent).toBe('NEW')
    expect(seenOf('rebal_v0')?.classList.contains('muted')).toBe(true)
    expect(seenOf('za_v0')?.textContent).toBe('')
  })

  it('shows NEW and CHG side by side on their own rows', async () => {
    await seed((s) => {
      delete s.sources.registry.records['rebal_v0']
      s.sources.registry.records['volmanaged_v0']!['p'] = 0.5
    })
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    expect(seenOf('rebal_v0')?.textContent).toBe('NEW')
    expect(seenOf('volmanaged_v0')?.textContent).toBe('CHG')
  })

  it('keeps the registry name as the Number <GO> label and opens DES for the picked row', async () => {
    await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.5))
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    const labels = numberedItems(PANEL_ID).map((i) => i.label)
    expect(labels).toEqual(expect.arrayContaining(['volmanaged_v0', 'eomtsy_v0']))
    expect(labels).not.toContain('CHG')
    expect(labels).not.toContain('')
    const { lines, stop } = captureLines()
    try {
      const item = numberedItems(PANEL_ID).find((i) => i.label === 'eomtsy_v0')
      act(() => {
        activateNumbered(PANEL_ID, item!.n)
      })
      expect(lines.at(-1)).toEqual({ line: 'eomtsy_v0 DES', newPanel: false })
    } finally {
      stop()
    }
  })

  it('leaves the sealed confirmations block and the CSV export alone', async () => {
    await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.5))
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    const block = screen.getByRole('region', { name: /Sealed confirmations/ })
    expect(within(block).queryByText('CHG')).toBeNull()
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /^98\) Export/ }))
      fireEvent.click(await screen.findByRole('menuitem', { name: REG.export.csv }))
      const header = (await saved.text(REG.export.fileName)).split('\r\n')[0]
      expect(header).not.toContain('Seen')
    } finally {
      saved.restore()
    }
  })

  it('still marks a row for the compare basket with Space while the column shows', async () => {
    await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.5))
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    const g = board()
    act(() => g.focus())
    const target = bodyRows().indexOf(rowOf('volmanaged_v0'))
    for (let i = 0; i < target; i += 1) fireEvent.keyDown(g, { key: 'ArrowDown' })
    fireEvent.keyDown(g, { key: ' ' })
    expect(rowOf('volmanaged_v0').getAttribute('data-marked')).toBe('true')
    expect(screen.getByRole('button', { name: /^95\) Compare 1$/ })).toBeTruthy()
  })

  it('drops the column again once WATCH SEEN has marked everything as seen', async () => {
    await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.5))
    await mountWatched()
    await waitFor(() => expect(heads()).toContain('Seen'))
    act(() => void watch?.accept())
    await waitFor(() => expect(heads()).not.toContain('Seen'))
    expect(within(board()).queryByText('CHG')).toBeNull()
  })

  it('moves the narrow-panel threshold by the 44 px column only while the watch has marks', async () => {
    const between = gridWidth(REG_COLUMNS) + 10
    const rect = stubMainWidth(between)
    try {
      stubApi()
      await ready()
      // Clean: the full set fits, exactly as before the column existed.
      expect(heads()).toContain('Bonf')
      expect(screen.queryByText(/Columns hidden here/)).toBeNull()
      cleanup()
      resetRecordWatchView()
      await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.5))
      await mountWatched()
      // Marked: the full set plus Seen no longer fits, so the narrow set shows and says so.
      await waitFor(() => expect(heads()).toContain('Seen'))
      expect(heads()).not.toContain('Bonf')
      expect(screen.getByText(/Columns hidden here/)).toBeTruthy()
    } finally {
      rect.mockRestore()
    }
  })

  it('in a narrow panel the Seen column is added to the narrow set, which keeps Amend, and the note is the plain one', async () => {
    const rect = stubMainWidth(660)
    try {
      await seed((s) => void (s.sources.registry.records['volmanaged_v0']!['p'] = 0.5))
      await mountWatched()
      await waitFor(() => expect(heads()).toContain('Seen'))
      expect(heads().slice(0, 2)).toEqual(['Number', 'Seen'])
      expect(heads()).toEqual(expect.arrayContaining(['Seen', 'Name', 'Tag', 'Verdict', 'p', 'Holm', 'BH q', 'Hash ok', 'Amend']))
      expect(heads()).not.toContain('Bonf')
      expect(seenOf('volmanaged_v0')?.textContent).toBe('CHG')
      expect(screen.queryByText(/Seen column replaces Amend/)).toBeNull()
      expect(screen.getByText(REG.compactNote)).toBeTruthy()
    } finally {
      rect.mockRestore()
    }
  })
})

describe('regBoardColumns: the board columns for a set of watch marks', () => {
  const NONE = new Map<string, 'new' | 'changed'>()
  const SOME = new Map<string, 'new' | 'changed'>([['volmanaged_v0', 'changed']])

  it('is the plain module arrays for a clean watch, so nothing about the board changes', () => {
    expect(regBoardColumns(NONE, false)).toBe(REG_COLUMNS)
    expect(regBoardColumns(NONE, true)).toBe(REG_COMPACT_COLUMNS)
  })

  it('puts Seen first on the full set and leaves every other column in place', () => {
    const cols = regBoardColumns(SOME, false)
    expect(cols.map((c) => c.id)).toEqual(['watch', ...REG_COLUMNS.map((c) => c.id)])
  })

  it('puts Seen first on the narrow set, keeps Amend, and makes the narrow grid the 44 px column wider', () => {
    const cols = regBoardColumns(SOME, true)
    expect(cols.map((c) => c.id)).toEqual(['watch', ...REG_COMPACT_COLUMNS.map((c) => c.id)])
    expect(cols.map((c) => c.id)).toContain('amend')
    expect(gridWidth(cols)).toBe(gridWidth(REG_COMPACT_COLUMNS) + 44)
  })

  it('keys the column by the registry name', () => {
    const watch = regBoardColumns(SOME, false)[0]!
    const row = (name: string) => ({ name }) as Parameters<typeof watch.value>[0]
    expect(watch.value(row('volmanaged_v0'))).toBe('CHG')
    expect(watch.value(row('overnight_v0'))).toBeNull()
  })
})
