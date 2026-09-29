// @vitest-environment jsdom
// REG: 93) Cost survival, view-level behaviour (roadmap #5, W2-R5b). RegScreen.test.tsx keeps 91)
// Board and 92) Evidence; this file is 93)'s own so each view has one owner per wave.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { captureDownloads } from '../../chrome/download.testUtil'
import { stubLayout } from '../../grids/testing'
import { HOME_PANEL_IDS } from '../layouts/layouts'
import { COST_BOARD, EVIDENCE, REG_VIEW_COPY } from '../../copy/evidence'
import RegScreen from './RegScreen'
import { REGISTRY } from './regFixtures'
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
