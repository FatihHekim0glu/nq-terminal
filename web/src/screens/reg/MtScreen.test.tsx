// @vitest-environment jsdom
// MT, the multiple-testing view (TASKS 6.1; UI_SPEC 7; ANALYTICS_CATALOG SV4): sorted p against rank
// with the Bonferroni, Holm and BH lines, a check that those lines are the API's, the table of stored
// adjusted values, and sealed confirmations listed apart with their own alpha.
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
import { numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { describePScatter } from '../../charts/echarts/pScatterModel'
import { stubLayout } from '../../grids/testing'
import { mtScatterInput } from './mtModel'
import MtScreen from './MtScreen'
import { MULTIPLE_TESTING } from './regFixtures'
import { PANEL_ID, mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  fake.chart.setOption.mockClear()
})
afterEach(() => cleanup())

function table(): HTMLElement {
  return screen.getByRole('grid', { name: /Adjusted p-values/ })
}

function bodyRows(): HTMLElement[] {
  return within(table()).getAllByRole('row').filter((r) => r.closest('tbody'))
}

async function ready() {
  mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
  await waitFor(() => expect(bodyRows()).toHaveLength(MULTIPLE_TESTING.k))
  await act(async () => {
    await Promise.resolve()
  })
}

function lastOption(): { yAxis: { type: string } } {
  const calls = fake.chart.setOption.mock.calls
  return calls[calls.length - 1]![0] as { yAxis: { type: string } }
}

describe('MT: multiple-testing view', () => {
  it('draws every family p-value against rank, named by the chart summary', async () => {
    stubApi()
    await ready()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(describePScatter(mtScatterInput(MULTIPLE_TESTING, 'log')))
    expect(lastOption().yAxis.type).toBe('log')
  })

  it('says the drawn boundary lines match the API lines, and the family and alpha', async () => {
    stubApi()
    await ready()
    const head = screen.getByRole('region', { name: 'Multiple-testing family' })
    expect(within(head).getByText(/Family k 18, alpha 0.05/)).toBeTruthy()
    expect(within(head).getByText(/Boundary lines match the API at every rank/)).toBeTruthy()
    expect(within(head).getByText('[PRE-REG]')).toBeTruthy()
    expect(within(head).getByText('[POST HOC]')).toBeTruthy()
  })

  it('lists stored adjusted values and the boundaries to four decimals, in rank order', async () => {
    stubApi()
    await ready()
    const first = within(bodyRows()[0]!).getAllByRole('gridcell').map((c) => c.textContent)
    expect(first).toEqual(['1)', '1', 'eomtsy_v0', '0.0010', '0.0028', '0.0028', '0.0028', '0.0174', '0.0174', '0.0174', 'Bonferroni, Holm, BH'])
    const second = within(bodyRows()[1]!).getAllByRole('gridcell').map((c) => c.textContent)
    expect(second).toEqual(['2)', '2', 'overnight_v0', '0.0027', '0.0028', '0.0029', '0.0056', '0.0487', '0.0460', '0.0244', 'Bonferroni, Holm, BH'])
  })

  it('lists sealed confirmations apart, with their own alpha and the spent label', async () => {
    stubApi()
    await ready()
    const block = screen.getByRole('region', { name: /Sealed confirmations/ })
    expect(within(block).getByText('rebal_v1_confirm')).toBeTruthy()
    expect(within(block).getByText(/own alpha 0.05/)).toBeTruthy()
    expect(within(block).getByText('[SPENT]')).toBeTruthy()
    expect(within(table()).queryByText('rebal_v1_confirm')).toBeNull()
  })

  it('switches the p axis to linear from 97) Settings', async () => {
    stubApi()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Linear p axis' }))
    await waitFor(() => expect(lastOption().yAxis.type).toBe('value'))
  })

  it('opens DES for a row on Enter', async () => {
    stubApi()
    await ready()
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    try {
      act(() => table().focus())
      fireEvent.keyDown(table(), { key: 'ArrowDown' })
      fireEvent.keyDown(table(), { key: 'Enter' })
      expect(lines.at(-1)).toEqual({ line: 'overnight_v0 DES', newPanel: false })
    } finally {
      stop()
    }
    expect(numberedItems(PANEL_ID).map((i) => i.n)).toEqual(expect.arrayContaining([96, 97]))
  })

  it('reads only /api/multiple-testing, with GET', async () => {
    const seen = stubApi()
    await ready()
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /api/multiple-testing'])
  })

  it('names the failure when the family cannot be read', async () => {
    stubApi({ '/api/multiple-testing': 503 })
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/multiple-testing')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
