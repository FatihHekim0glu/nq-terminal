// @vitest-environment jsdom
// REG: view-level behaviour of 93) Cost survival (roadmap #5, W2-R5b) and 94) Effect map with 92)'s power
// columns (W8-R5c). RegScreen.test.tsx keeps 91) Board and 92) Evidence; this file holds the later views so
// each has one owner per wave. The ECharts library is mocked (jsdom has no canvas): the gallery run draws it.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../../charts/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { captureDownloads } from '../../chrome/download.testUtil'
import { stubLayout } from '../../grids/testing'
import { HOME_PANEL_IDS } from '../layouts/layouts'
import { COST_BOARD, EVIDENCE, EVIDENCE_MAP, REG_VIEW_COPY } from '../../copy/evidence'
import { REG } from '../../copy/reg'
import { EVIDENCE_COLUMNS, EVIDENCE_COMPACT_COLUMNS } from './evidenceColumns'
import RegScreen from './RegScreen'
import { REGISTRY } from './regFixtures'
import { ANSWERS, PANEL_ID, mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => resetNumbered())
afterEach(() => cleanup())

function board(): HTMLElement {
  return screen.getByRole('grid', { name: /Registry board/ })
}

function bodyRows(): HTMLElement[] {
  return within(board()).getAllByRole('row').filter((r) => r.closest('tbody'))
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

/** Mounts REG, waits for the board, then switches to 93) Cost survival and waits for its tiles. */
async function openCosts(): Promise<void> {
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: '93) Cost survival' }))
  await waitFor(() => expect(document.querySelectorAll('.reg-cost-tile').length).toBeGreaterThan(0))
}

describe('REG: 93) Cost survival (roadmap #5, W2-R5b)', () => {
  it('shows 93) Cost survival in the tab strip, outside HOME', async () => {
    stubApi()
    await ready()
    const tabs = screen.getByRole('tablist', { name: REG_VIEW_COPY.label })
    expect(within(tabs).getByRole('tab', { name: '93) Cost survival' })).toBeTruthy()
  })

  it('draws 4 tiles, a failed status line for the names the harness 404s, and "No ladder" only for the one stubbed name without one, with no alert', async () => {
    stubApi()
    await openCosts()
    expect(document.querySelectorAll('.reg-cost-tile')).toHaveLength(4)
    expect(screen.getAllByText(/^own scale /)).toHaveLength(4)
    // The harness stubs 5 hypothesis names; the other 17 registry rows 404 with 'not found'.
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Records not read for 17 hypotheses \(first .+: not found\); they draw no tile\.$/))
    expect(screen.getByText('No ladder (1): za_v0_C3_gao_momentum.')).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('sorts volmanaged_v0 first (its break-even 66.11 leads) with its own scale and a break-even note', async () => {
    stubApi()
    await openCosts()
    const first = document.querySelectorAll('.reg-cost-tile')[0]!
    expect(first.textContent).toContain('volmanaged_v0')
    expect(first.textContent).toContain('66.11')
  })

  it('Number <GO> 1 opens volmanaged_v0 COST', async () => {
    stubApi()
    await openCosts()
    const { lines, stop } = captureLines()
    try {
      act(() => {
        expect(activateNumbered(PANEL_ID, 1)).toBe(true)
      })
      expect(lines.at(-1)).toEqual({ line: 'volmanaged_v0 COST', newPanel: false })
    } finally {
      stop()
    }
  })

  it('98) Export lists the evidence matrix as CSV only on 92) Evidence, never on 91) Board or 93) Cost survival', async () => {
    stubApi()
    await openCosts()
    fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    expect(screen.queryByRole('menuitem', { name: EVIDENCE.export.csv })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '91) Board' }))
    fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    expect(screen.queryByRole('menuitem', { name: EVIDENCE.export.csv })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '92) Evidence' }))
    await screen.findByRole('grid', { name: EVIDENCE.gridLabel })
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

  it("HOME's REG cell shows no tab strip, so 93) Cost survival never appears there", async () => {
    stubApi()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />, { panelId: HOME_PANEL_IDS.reg })
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    expect(screen.queryByRole('tablist', { name: REG_VIEW_COPY.label })).toBeNull()
    expect(document.querySelector('.reg-cost-tile')).toBeNull()
  })

  it('follows the board note copy, so the tile text never claims bar heights compare across tiles', async () => {
    stubApi()
    await openCosts()
    expect(screen.getByText(COST_BOARD.note)).toBeTruthy()
  })
})

/** Mounts REG, waits for the board, switches to 94) Effect map and waits for its figure. */
async function openMap(): Promise<HTMLElement> {
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: '94) Effect map' }))
  return screen.findByRole('img', { name: new RegExp(EVIDENCE_MAP.name) })
}

/** The registry's own 1-based place of a name: the number 91) Board and 92) Evidence print by default. */
const registryNumber = (name: string): number => 1 + REGISTRY.rows.findIndex((r) => r.name === name)

describe('REG: 94) Effect map (roadmap #5, W8-R5c)', () => {
  it('appends 94) Effect map to the tab strip after 93) Cost survival, outside HOME', async () => {
    stubApi()
    await ready()
    const tabs = within(screen.getByRole('tablist', { name: REG_VIEW_COPY.label })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['91) Board', '92) Evidence', '93) Cost survival', '94) Effect map'])
  })

  it('shows the map as an image named by its summary: 21 points, the years and Sharpe ranges, hollow and pinned counts', async () => {
    stubApi()
    const img = await openMap()
    const label = img.getAttribute('aria-label')!
    expect(label).toContain(EVIDENCE_MAP.name)
    expect(label).toContain('21 points')
    expect(label).toContain('1 hollow')
    expect(label).toContain('1 outside the axis range')
    // SR0 under V (5.09) is off the axes and named, so nobody reads its absence as a missing line.
    expect(label).toContain('SR0 under V 5.09')
  })

  it('tags the map [POST HOC] with its basis, states the marks rule, the axis rule and the off-axis line, and raises no alert', async () => {
    stubApi()
    await openMap()
    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toContain('[POST HOC]')
    expect(panel.textContent).toContain(EVIDENCE_MAP.basis)
    expect(screen.getByText(EVIDENCE_MAP.marks)).toBeTruthy()
    expect(panel.textContent).toContain('is linear')
    expect(panel.textContent).toContain('Off the axes: SR0 under V 5.09.')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('reads no hypothesis detail for the map, and only ever issues GETs', async () => {
    const seen = stubApi()
    await openMap()
    await new Promise((r) => setTimeout(r, 20))
    expect(seen.some((s) => /\/api\/hypotheses\/[^/]+$/.test(s.url))).toBe(false)
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('has its table view with one row per point, the mark being the registry row number', async () => {
    stubApi()
    await openMap()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(22)
    const mim = within(table).getByText('mim_v0').closest('tr')!
    expect(within(mim).getAllByRole('cell')[0]!.textContent).toBe(String(registryNumber('mim_v0')))
  })

  it('Number <GO> n on the map requests the DES of registry row n, in the board\'s served numbering', async () => {
    stubApi()
    await openMap()
    const { lines, stop } = captureLines()
    try {
      for (const name of ['mim_v0', 'overnight_v0', 'za_v0', 'vt_har_v0']) {
        act(() => {
          expect(activateNumbered(PANEL_ID, registryNumber(name))).toBe(true)
        })
        expect(lines.at(-1)).toEqual({ line: `${name} DES`, newPanel: false })
      }
      expect(registryNumber('mim_v0')).toBe(17)
    } finally {
      stop()
    }
  })

  it('does nothing on the registry number of a row with no SV3a trial (row 2), rather than opening another point', async () => {
    stubApi()
    await openMap()
    const { lines, stop } = captureLines()
    try {
      act(() => {
        expect(activateNumbered(PANEL_ID, 2)).toBe(false)
      })
      expect(lines).toHaveLength(0)
    } finally {
      stop()
    }
  })

  it('follows the board filters: after typing "vol" the one kept row is number 1 and the other points are marked "-"', async () => {
    stubApi()
    await openMap()
    fireEvent.change(screen.getByRole('textbox', { name: REG.filterLabel }), { target: { value: 'vol' } })
    const { lines, stop } = captureLines()
    try {
      await waitFor(() => expect(activateNumbered(PANEL_ID, 1)).toBe(true))
      expect(lines.at(-1)).toEqual({ line: 'volmanaged_v0 DES', newPanel: false })
      expect(activateNumbered(PANEL_ID, registryNumber('mim_v0'))).toBe(false)
      expect(screen.getByRole('tabpanel').textContent).toContain('Marked "-"')
    } finally {
      stop()
    }
  })

  it('says it is reading the Deflated Sharpe view while that GET is pending: a status line, no image, no alert', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/analytics/deflated') return new Promise<Response>(() => {})
      const body = ANSWERS[url]
      const status = body === undefined ? 404 : 200
      return Promise.resolve(new Response(JSON.stringify(body ?? { detail: 'not found' }), { status, headers: { 'content-type': 'application/json' } }))
    })
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '94) Effect map' }))
    const line = await screen.findByText(EVIDENCE_MAP.loading)
    expect(line.getAttribute('role')).toBe('status')
    expect(screen.queryByRole('img', { name: new RegExp(EVIDENCE_MAP.name) })).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('says the Deflated Sharpe view could not be read, with the API detail as an alert, when that GET fails', async () => {
    stubApi({ '/api/analytics/deflated': 503 })
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '94) Effect map' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('could not be read')
    expect(alert.textContent).toContain('stub 503')
    expect(screen.queryByRole('img', { name: new RegExp(EVIDENCE_MAP.name) })).toBeNull()
  })

  it("HOME's REG cell shows no tab strip, so 94) Effect map never appears there", async () => {
    stubApi()
    mountScreen(<RegScreen params={panelParams('REG')} context={null} />, { panelId: HOME_PANEL_IDS.reg })
    await waitFor(() => expect(bodyRows().length).toBe(REGISTRY.counts.rows))
    expect(screen.queryByRole('tab', { name: '94) Effect map' })).toBeNull()
    expect(screen.queryByRole('img', { name: new RegExp(EVIDENCE_MAP.name) })).toBeNull()
  })

  it('98) Export offers no evidence CSV on the map', async () => {
    stubApi()
    await openMap()
    fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    expect(screen.queryByRole('menuitem', { name: EVIDENCE.export.csv })).toBeNull()
  })
})

/** jsdom lays nothing out, so REG measures no width and never asks for SV3 by itself: give the panel one. */
function measurePanel(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { width, height: 600, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 600, toJSON: () => ({}) } as DOMRect,
  )
}

describe('REG: 92) Evidence power columns (roadmap #11 on the evidence matrix, W8-R5c)', () => {
  it('shows MDE alpha/k and Sharpe/MDE beside the DSR column, with the figures powerView gives volmanaged_v0', async () => {
    stubApi()
    measurePanel(1400)
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '92) Evidence' }))
    const grid = await screen.findByRole('grid', { name: EVIDENCE.gridLabel })
    expect(within(grid).getByRole('columnheader', { name: /MDE alpha\/k/ })).toBeTruthy()
    expect(within(grid).getByRole('columnheader', { name: /Sharpe\/MDE/ })).toBeTruthy()
    // The deflated view and the family arrive after the grid first draws: wait for the cells, not the grid.
    await waitFor(() => {
      const rows = within(grid).getAllByRole('row').filter((r) => r.closest('tbody'))
      const vm = rows.find((r) => within(r).queryByText('volmanaged_v0') !== null)!
      expect(within(vm).getByText('1.12')).toBeTruthy()
      expect(within(vm).getByText('0.88')).toBeTruthy()
    })
  })

  it('names the two columns in the [POST HOC] legend as computed in the browser', async () => {
    stubApi()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '92) Evidence' }))
    await screen.findByRole('grid', { name: EVIDENCE.gridLabel })
    const text = screen.getByRole('tabpanel').textContent!
    expect(text).toContain(EVIDENCE.legendPostHoc)
    expect(EVIDENCE.legendPostHoc).toContain(EVIDENCE.cols.mde)
    expect(EVIDENCE.legendPostHoc).toContain(EVIDENCE.cols.ratio)
    expect(EVIDENCE.legendPostHoc).toContain('computed in the browser')
  })

  it('makes the request for the family once: the multiple-testing GET is shared with the board, not repeated', async () => {
    const seen = stubApi()
    measurePanel(1400)
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '92) Evidence' }))
    await screen.findByRole('grid', { name: EVIDENCE.gridLabel })
    expect(seen.filter((s) => s.url === '/api/multiple-testing')).toHaveLength(1)
  })

  it('drops both columns and says so in a narrow panel, where the years and sealed test columns also go', async () => {
    stubApi()
    measurePanel(600)
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '92) Evidence' }))
    const grid = await screen.findByRole('grid', { name: EVIDENCE.gridLabel })
    expect(within(grid).queryByRole('columnheader', { name: /MDE alpha\/k/ })).toBeNull()
    expect(within(grid).queryByRole('columnheader', { name: /Sharpe\/MDE/ })).toBeNull()
    expect(screen.getByText(EVIDENCE.compactNote)).toBeTruthy()
  })

  it('keeps the two columns last and leaves them out of the compact set', () => {
    const ids = (cols: readonly { id: string }[]) => cols.map((c) => c.id)
    expect(ids(EVIDENCE_COLUMNS)).toEqual(expect.arrayContaining(['mde', 'ratio']))
    expect(ids(EVIDENCE_COMPACT_COLUMNS)).not.toContain('mde')
    expect(ids(EVIDENCE_COMPACT_COLUMNS)).not.toContain('ratio')
    expect(ids(EVIDENCE_COLUMNS).slice(-2)).toEqual(['mde', 'ratio'])
  })
})
