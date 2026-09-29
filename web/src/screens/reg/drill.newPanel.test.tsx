// @vitest-environment jsdom
// G20 on the drill sites RegScreen.newPanel.test.tsx and RunsScreen.newPanel.test.tsx do not reach: the MT family
// grid, MT 86) Replication's pair grid and REG 92) Evidence's grid. MonitorGrid passes { newPanel: true } on
// Shift+Enter, and each site must hand it on to the command line as newPanel; a plain Enter still asks for false.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../../charts/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { resetConnection } from '../../api/connection'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetNumbered } from '../../chrome/NumberedActions'
import { EVIDENCE } from '../../copy/evidence'
import { REPLICATION } from '../../copy/replication'
import { stubLayout } from '../../grids/testing'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import { DEFLATED_REAL } from './deflatedFixtures'
import { buildEvidenceRows } from './evidenceModel'
import MtScreen from './MtScreen'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import { buildRegRows } from './regModel'
import RegEvidence from './RegEvidence'
import type { HypothesisDetails } from './useHypothesisDetails'
import { mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => resetNumbered())
afterEach(() => {
  cleanup()
  resetConnection()
})

function captured(): { lines: LineRequest[]; stop: () => void } {
  const lines: LineRequest[] = []
  return { lines, stop: onLineRequest((r) => lines.push(r)) }
}

/** The hypothesis name in the first data row: the first cell whose whole text is one of `names`. */
function firstName(grid: HTMLElement, names: readonly string[]): string {
  const cells = Array.from(within(grid).getAllByRole('row')[1]!.querySelectorAll('td')).map((td) => td.textContent ?? '')
  const found = cells.find((text) => names.includes(text))
  if (found === undefined) throw new Error(`no hypothesis name in ${JSON.stringify(cells)}`)
  return found
}

describe('MT family grid: Shift+Enter opens DES in a new panel (G20)', () => {
  it('Shift+Enter requests "<name> DES" with newPanel true, and a plain Enter with false', async () => {
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const grid = await screen.findByRole('grid', { name: /Adjusted p-values/ })
    await waitFor(() => expect(within(grid).getAllByRole('row').length - 1).toBe(MULTIPLE_TESTING.k))
    const { lines, stop } = captured()
    act(() => grid.focus())
    fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    const name = firstName(grid, MULTIPLE_TESTING.rows.map((r) => r.name))
    expect(lines).toEqual([
      { line: `${name} DES`, newPanel: true },
      { line: `${name} DES`, newPanel: false },
    ])
  })
})

describe('MT 86) Replication pair grid: Shift+Enter opens the parent DES in a new panel (G20)', () => {
  it('Shift+Enter requests "<parent> DES" with newPanel true, and a plain Enter with false', async () => {
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    await screen.findByRole('grid', { name: /Adjusted p-values/ })
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    const pairs = await screen.findByRole('grid', { name: REPLICATION.gridLabel })
    await waitFor(() => expect(within(pairs).getAllByRole('gridcell').map((c) => c.textContent)).toContain('[FAIL]'))
    const { lines, stop } = captured()
    act(() => pairs.focus())
    fireEvent.keyDown(pairs, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(pairs, { key: 'Enter' })
    stop()
    expect(lines).toEqual([
      { line: 'rebal_v0 DES', newPanel: true },
      { line: 'rebal_v0 DES', newPanel: false },
    ])
  })
})

describe('REG 92) Evidence grid: Shift+Enter opens DES in a new panel (G20)', () => {
  const DETAILS: HypothesisDetails = {
    byName: new Map([
      ['overnight_v0', OVERNIGHT],
      ['volmanaged_v0', VOLMANAGED],
      ['rebal_v0', REBAL],
      ['za_v0', ZA],
      ['za_v0_C3_gao_momentum', ZA_C3],
    ]),
    failed: new Map(),
    pending: 0,
  }
  const ROWS = buildEvidenceRows({
    rows: buildRegRows(REGISTRY, HYPOTHESES),
    cards: HYPOTHESES,
    confirmations: CONFIRMATIONS,
    deflated: DEFLATED_REAL,
    details: DETAILS,
    family: { alpha: MULTIPLE_TESTING.alpha, k: MULTIPLE_TESTING.k },
  })

  it('Shift+Enter requests "<name> DES" with newPanel true, and a plain Enter with false', () => {
    render(<RegEvidence rows={ROWS} width={null} />)
    const grid = screen.getByRole('grid', { name: EVIDENCE.gridLabel })
    const { lines, stop } = captured()
    act(() => grid.focus())
    fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    const name = firstName(grid, ROWS.map((r) => r.name))
    expect(lines).toEqual([
      { line: `${name} DES`, newPanel: true },
      { line: `${name} DES`, newPanel: false },
    ])
  })
})
