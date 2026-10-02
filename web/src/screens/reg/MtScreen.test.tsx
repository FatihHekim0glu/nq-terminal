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

import { resetConnection } from '../../api/connection'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, numberedItems, resetNumbered } from '../../chrome/NumberedActions'
import { describeGlyphScatter } from '../../charts/echarts/glyphScatterModel'
import { describePScatter } from '../../charts/echarts/pScatterModel'
import { stubLayout } from '../../grids/testing'
import { mtScatterInput } from './mtModel'
import { DEFLATED } from '../../copy/deflated'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { MT } from '../../copy/reg'
import { REPLICATION } from '../../copy/replication'
import { SPA } from '../../copy/spa'
import { fillCopy } from '../../copy/workspace'
import { ReplicationBody } from './MtReplication'
import MtScreen from './MtScreen'
import { DEFLATED_REAL } from './deflatedFixtures'
import { EFFECTIVE_N_REAL } from './effectiveN.real.fixtures'
import { MULTIPLE_TESTING, REGISTRY } from './regFixtures'
import { buildReplication, replicationScatter } from './replicationModel'
import { PANEL_ID, backendDown, mountScreen, panelParams, stubApi } from './testHarness'

beforeAll(() => stubLayout(1200))
beforeEach(() => {
  resetNumbered()
  fake.chart.setOption.mockClear()
})
afterEach(() => {
  cleanup()
  resetConnection()
})

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

/** The last option the p-value scatter drew (MT also draws SV3's DSR ladder, which has no BH line). */
function lastOption(): { yAxis: { type: string } } {
  const scatter = fake.chart.setOption.mock.calls
    .map((c) => c[0] as { yAxis: { type: string }; series?: Array<{ id?: string }> })
    .filter((o) => o.series?.some((s) => s.id === 'bh'))
  return scatter[scatter.length - 1]!
}

describe('MT: multiple-testing view', () => {
  it('draws every family p-value against rank, named by the chart summary', async () => {
    stubApi()
    await ready()
    const img = screen.getByRole('img', { name: describePScatter(mtScatterInput(MULTIPLE_TESTING, 'log')) })
    expect(img.getAttribute('aria-label')).toBe(describePScatter(mtScatterInput(MULTIPLE_TESTING, 'log')))
    expect(lastOption().yAxis.type).toBe('log')
  })

  it('says the drawn boundary lines match the API lines, and the family and alpha', async () => {
    stubApi()
    await ready()
    const head = screen.getByRole('region', { name: 'Multiple-testing family' })
    expect(within(head).getByText(/Family k 21, alpha 0.05/)).toBeTruthy()
    expect(within(head).getByText(/Boundary lines match the API at every rank/)).toBeTruthy()
    expect(within(head).getByText('[PRE-REG]')).toBeTruthy()
    expect(within(head).getByText('[POST HOC]')).toBeTruthy()
  })

  it('lists stored adjusted values and the boundaries to four decimals, in rank order', async () => {
    stubApi()
    await ready()
    const first = within(bodyRows()[0]!).getAllByRole('gridcell').map((c) => c.textContent)
    expect(first).toEqual(['1)', '1', 'vt_har_v0', '[OVERLAY]', '0.0002', '0.0024', '0.0024', '0.0024', '0.0042', '0.0042', '0.0042', 'Bonferroni, Holm, BH'])
    const second = within(bodyRows()[1]!).getAllByRole('gridcell').map((c) => c.textContent)
    expect(second).toEqual(['2)', '2', 'eomtsy_v0', 'edge', '0.0010', '0.0024', '0.0025', '0.0048', '0.0203', '0.0194', '0.0102', 'Bonferroni, Holm, BH'])
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
      expect(lines.at(-1)).toEqual({ line: 'eomtsy_v0 DES', newPanel: false })
    } finally {
      stop()
    }
    expect(numberedItems(PANEL_ID).map((i) => i.n)).toEqual(expect.arrayContaining([96, 97]))
  })

  it('reads /api/multiple-testing and the SV3 view /api/analytics/deflated, with GET only', async () => {
    const seen = stubApi()
    await ready()
    await screen.findByRole('region', { name: DEFLATED.label })
    expect(new Set(seen.map((s) => `${s.method} ${s.url}`))).toEqual(new Set(['GET /api/multiple-testing', 'GET /api/analytics/deflated']))
  })

  it('shows the Deflated Sharpe over the registered trials, [POST HOC], with the trial that dominates V and no verdict', async () => {
    stubApi()
    await ready()
    const section = await screen.findByRole('region', { name: DEFLATED.label })
    await waitFor(() => expect(section.textContent).toContain('N 21 registered trials'))
    expect(section.textContent).toContain('[POST HOC]')
    expect(section.textContent).toContain(DEFLATED.extra)
    expect(section.textContent).toContain(DEFLATED_REAL.dominant!)
    const table = within(section).getByRole('table', { name: DEFLATED.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(22)
    const vm = DEFLATED_REAL.rows.find((r) => r.name === 'volmanaged_v0')!
    const row = within(table).getByRole('rowheader', { name: 'volmanaged_v0' }).closest('tr')!
    expect(row.textContent).toContain(vm.dsr!.toFixed(3))
    expect(section.textContent).not.toMatch(/\[(PASS|FAIL)\]/)
  })

  it('names the failure when the family cannot be read', async () => {
    stubApi({ '/api/multiple-testing': 503 })
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/multiple-testing')
    expect(alert.textContent).toBe(fillCopy(MT.failed, { detail: 'stub 503 for /api/multiple-testing' }))
    expect(screen.queryByRole('img')).toBeNull()
  })

  // Backend-down acceptance (roadmap #7): a waiting status while the strip owns the outage alert.
  it('waits for the backend, with no alert, when the family answers 502 while the connection is down', async () => {
    backendDown()
    stubApi({ '/api/multiple-testing': 502 })
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Waiting for the backend: GET /api/multiple-testing answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says the panel is waiting to load, not busy, while the backend is down and the family is pending', () => {
    backendDown()
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Waiting for the backend before loading.')
    expect(status.hasAttribute('aria-busy')).toBe(false)
  })

  it('keeps the loading line busy while the backend is up and the family is pending', () => {
    stubApi()
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(MT.loading)
    expect(status.getAttribute('aria-busy')).toBe('true')
  })

  it('names the Deflated Sharpe failure in an alert inside its own block while the backend is up', async () => {
    stubApi({ '/api/analytics/deflated': 503 })
    await ready()
    const section = screen.getByRole('region', { name: DEFLATED.label })
    const alert = await within(section).findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(DEFLATED.failed, { detail: 'stub 503 for /api/analytics/deflated' }))
  })

  it('waits for the backend in the Deflated Sharpe block, with no alert, while the connection is down', async () => {
    backendDown()
    stubApi({ '/api/analytics/deflated': 502 })
    await ready()
    const section = screen.getByRole('region', { name: DEFLATED.label })
    await waitFor(() =>
      expect(within(section).getByRole('status').textContent).toBe('Waiting for the backend: GET /api/analytics/deflated answered 502.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// MT gets a sub tab strip from 85 (roadmap R8): 85) Family is today's content plus SV3, unchanged;
// 86) Replication draws each sealed confirmation against its parent's registered in-sample p;
// 87) Effective trials reads the daily trials' series and refuses unless it reproduces SV3 (roadmap #19).
function tabs(): HTMLElement {
  return screen.getByRole('tablist', { name: MT.views.label })
}

function pairs(): HTMLElement {
  return screen.getByRole('grid', { name: REPLICATION.gridLabel })
}

function pairRows(): HTMLElement[] {
  return within(pairs()).getAllByRole('row').filter((r) => r.closest('tbody'))
}

function pairCells(): string[] {
  return within(pairRows()[0]!).getAllByRole('gridcell').map((c) => c.textContent ?? '')
}

/** The replication chart's summary, from the fixtures the harness serves. */
function replicationSummary(): string {
  return describeGlyphScatter(replicationScatter(buildReplication(MULTIPLE_TESTING, REGISTRY)))
}

/** Mounts MT, waits for the family, then selects 86) Replication and waits for the registry verdicts. */
async function openReplication(): Promise<void> {
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
  await screen.findByRole('region', { name: REPLICATION.label })
  await waitFor(() => expect(pairCells()[4]).toBe('[FAIL]'))
}

describe('MT: 85) Family and 86) Replication tabs', () => {
  it('shows the sub tab strip with 85) Family selected, 86) Replication, 87) Effective trials and 88) Family test beside it', async () => {
    stubApi()
    await ready()
    const strip = within(tabs())
    expect(strip.getAllByRole('tab').map((t) => t.textContent)).toEqual(['85) Family', '86) Replication', '87) Effective trials', '88) Family test'])
    expect(strip.getByRole('tab', { name: '85) Family' }).getAttribute('aria-selected')).toBe('true')
    expect(strip.getByRole('tab', { name: '86) Replication' }).getAttribute('aria-selected')).toBe('false')
    expect(strip.getByRole('tab', { name: '87) Effective trials' }).getAttribute('aria-selected')).toBe('false')
    expect(strip.getByRole('tab', { name: '88) Family test' }).getAttribute('aria-selected')).toBe('false')
    const panel = screen.getByRole('tabpanel', { name: '85) Family' })
    expect(strip.getByRole('tab', { name: '85) Family' }).getAttribute('aria-controls')).toBe(panel.id)
  })

  it('registers 85, 86, 87 and 88 for Number <GO> beside the red bar and the family rows', async () => {
    stubApi()
    await ready()
    const numbers = numberedItems(PANEL_ID).map((i) => i.n)
    expect(numbers).toEqual(expect.arrayContaining([1, 21, 85, 86, 87, 88, 96, 97]))
    expect(numberedItems(PANEL_ID).find((i) => i.n === 86)!.label).toBe('Replication')
    expect(numberedItems(PANEL_ID).find((i) => i.n === 87)!.label).toBe(EFFECTIVE_N.tab)
    expect(numberedItems(PANEL_ID).find((i) => i.n === 88)!.label).toBe(SPA.tab)
  })

  it('keeps the family view whole under 85: the family line, the scatter, the table, the confirmations and SV3', async () => {
    stubApi()
    await ready()
    const panel = screen.getByRole('tabpanel', { name: '85) Family' })
    expect(within(panel).getByRole('region', { name: 'Multiple-testing family' })).toBeTruthy()
    expect(within(panel).getByRole('grid', { name: /Adjusted p-values/ })).toBeTruthy()
    expect(within(panel).getByRole('region', { name: /Sealed confirmations/ })).toBeTruthy()
    await within(panel).findByRole('region', { name: DEFLATED.label })
    expect(screen.queryByRole('region', { name: REPLICATION.label })).toBeNull()
  })

  it('asks for /api/registry only once 86 is selected, and only with GET', async () => {
    const seen = stubApi()
    await ready()
    await screen.findByRole('region', { name: DEFLATED.label })
    expect(seen.map((s) => s.url)).not.toContain('/api/registry')
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    await waitFor(() => expect(seen.map((s) => s.url)).toContain('/api/registry'))
    expect(seen.filter((s) => s.url === '/api/registry')).toHaveLength(1)
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('opens 86 from the tab and from Number <GO> 86, and 85 brings the family back', async () => {
    stubApi()
    await ready()
    act(() => {
      expect(activateNumbered(PANEL_ID, 86)).toBe(true)
    })
    await screen.findByRole('region', { name: REPLICATION.label })
    expect(screen.getByRole('tab', { name: '86) Replication' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: '86) Replication' })).toBeTruthy()
    expect(screen.queryByRole('grid', { name: /Adjusted p-values/ })).toBeNull()
    expect(screen.queryByRole('region', { name: DEFLATED.label })).toBeNull()
    act(() => {
      expect(activateNumbered(PANEL_ID, 85)).toBe(true)
    })
    await waitFor(() => expect(table()).toBeTruthy())
    expect(screen.queryByRole('region', { name: REPLICATION.label })).toBeNull()
  })

  it('keeps the p axis choice across the tabs', async () => {
    stubApi()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Linear p axis' }))
    await waitFor(() => expect(lastOption().yAxis.type).toBe('value'))
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    await screen.findByRole('region', { name: REPLICATION.label })
    fireEvent.click(screen.getByRole('tab', { name: '85) Family' }))
    await waitFor(() => expect(table()).toBeTruthy())
    await waitFor(() => expect(lastOption().yAxis.type).toBe('value'))
  })

  it('disables 97) Settings on 86) Replication, where the p axis choice changes nothing, and enables it again on 85', async () => {
    stubApi()
    await ready()
    const settings = () => screen.getByRole('button', { name: /97\) Settings/ })
    expect(settings().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    await screen.findByRole('region', { name: REPLICATION.label })
    expect(settings().getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(settings())
    expect(screen.queryByRole('menuitem', { name: 'Linear p axis' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '85) Family' }))
    await waitFor(() => expect(table()).toBeTruthy())
    expect(settings().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(settings())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Linear p axis' }))
    await waitFor(() => expect(lastOption().yAxis.type).toBe('value'))
  })

  it('names the failure when the family cannot be read, with no alert from the tabs', async () => {
    stubApi({ '/api/multiple-testing': 503 })
    mountScreen(<MtScreen params={panelParams('MT')} context={null} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('stub 503 for /api/multiple-testing')
    expect(screen.queryAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByRole('tabpanel')).toBeNull()
  })
})

describe('MT: 86) Replication', () => {
  it('tags the view [SPENT] with the stored-only note, and draws no alert', async () => {
    stubApi()
    await openReplication()
    const view = screen.getByRole('region', { name: REPLICATION.label })
    expect(within(view).getByText('[SPENT]')).toBeTruthy()
    expect(within(view).getByText(REPLICATION.note)).toBeTruthy()
    expect(within(view).getByText(REPLICATION.legend)).toBeTruthy()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('draws one chart named by its data summary: one down triangle for rebal_v0', async () => {
    stubApi()
    await openReplication()
    const img = screen.getByRole('img', { name: replicationSummary() })
    expect(img.getAttribute('aria-label')).toContain('Replication: 1 point')
    expect(img.getAttribute('aria-label')).toContain('1 [FAIL] (triangle down)')
    expect(screen.getAllByRole('img')).toHaveLength(1)
    await act(async () => {
      await Promise.resolve()
    })
    const drawn = fake.chart.setOption.mock.calls
      .map((c) => c[0] as { series?: Array<{ id?: string; data?: Array<{ value?: number[]; symbol?: string; symbolRotate?: number }> }> })
      .filter((o) => o.series?.some((s) => s.id === 'diagonal'))
    const option = drawn[drawn.length - 1]!
    expect(option.series!.map((s) => s.id)).toEqual(['diagonal', 'refs', 'points'])
    const point = option.series!.find((s) => s.id === 'points')!.data![0]!
    expect(point.value).toEqual([0.13004898713256266, 0.3374637034513802])
    expect(point.symbol).toBe('triangle')
    expect(point.symbolRotate).toBe(180)
  })

  it('lists the pair in a numbered grid with the stored p-values, verdicts and window', async () => {
    stubApi()
    await openReplication()
    expect(pairRows()).toHaveLength(1)
    expect(pairCells()).toEqual([
      '1)', 'rebal_v0', 'rebal_v1_confirm', '0.1300', '[FAIL]', '0.3375', '0.05', '[FAIL]', 'spent window, opened 2026-09-26, descriptive only',
    ])
    expect(numberedItems(PANEL_ID).find((i) => i.n === 1)).toBeTruthy()
  })

  it('names the 20 hypotheses never tested in the sealed window, in rank order', async () => {
    stubApi()
    await openReplication()
    const line = screen.getByText(/^Never tested in the sealed window \(20\): /)
    expect(line.textContent).toMatch(/^Never tested in the sealed window \(20\): vt_har_v0, eomtsy_v0, overnight_v0, /)
    expect(line.textContent).toMatch(/, carry_v0, mim_v0\.$/)
    expect(line.textContent).not.toContain('rebal_v0')
    expect(screen.queryByText(/^Not drawn/)).toBeNull()
  })

  it('opens DES for the parent on Enter and on Number <GO> 1', async () => {
    stubApi()
    await openReplication()
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    try {
      act(() => pairs().focus())
      fireEvent.keyDown(pairs(), { key: 'Enter' })
      expect(lines.at(-1)).toEqual({ line: 'rebal_v0 DES', newPanel: false })
      lines.length = 0
      act(() => {
        expect(activateNumbered(PANEL_ID, 1)).toBe(true)
      })
      expect(lines).toEqual([{ line: 'rebal_v0 DES', newPanel: false }])
    } finally {
      stop()
    }
  })

  it('says the in-sample verdicts are unavailable when the registry cannot be read, without an alert', async () => {
    stubApi({ '/api/registry': 503 })
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    const view = await screen.findByRole('region', { name: REPLICATION.label })
    await waitFor(() => expect(view.textContent).toContain('In-sample verdicts are not available: stub 503 for /api/registry'))
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(pairCells()[4]).toBe('--')
    expect(pairCells()[3]).toBe('0.1300')
    expect(pairCells()[7]).toBe('[FAIL]')
  })
})

describe('MT: ReplicationBody', () => {
  const VIEW = buildReplication(MULTIPLE_TESTING, REGISTRY)

  it('says no confirmation tests a registered hypothesis, and draws no chart', () => {
    mountScreen(<ReplicationBody view={buildReplication({ ...MULTIPLE_TESTING, confirmations: [] }, REGISTRY)} registryError={null} />)
    expect(screen.getByText(REPLICATION.empty)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/^Never tested in the sealed window \(21\): /)).toBeTruthy()
  })

  it('lists the confirmations it could not draw, with each reason', () => {
    const list = [
      { ...MULTIPLE_TESTING.confirmations[0]!, name: 'orphan_confirm', parent: null },
      { ...MULTIPLE_TESTING.confirmations[0]!, name: 'ghost_confirm', parent: 'ghost_v0' },
    ]
    mountScreen(<ReplicationBody view={buildReplication({ ...MULTIPLE_TESTING, confirmations: list }, REGISTRY)} registryError={null} />)
    expect(screen.getByText('Not drawn (2): orphan_confirm: no parent recorded; ghost_confirm: parent ghost_v0 is not in the family.')).toBeTruthy()
  })

  it('says which reference lines fall off the axes', () => {
    mountScreen(<ReplicationBody view={{ ...VIEW, alpha: 0 }} registryError={null} />)
    expect(screen.getByText(/^Off the axes: family alpha 0/)).toBeTruthy()
  })

  it('says every hypothesis has a confirmation when none is untested', () => {
    const all = MULTIPLE_TESTING.rows.map((r) => ({ ...MULTIPLE_TESTING.confirmations[0]!, name: `${r.name}_confirm`, parent: r.name }))
    mountScreen(<ReplicationBody view={buildReplication({ ...MULTIPLE_TESTING, confirmations: all }, REGISTRY)} registryError={null} />)
    expect(screen.getByText(REPLICATION.untestedNone)).toBeTruthy()
    expect(pairRows()).toHaveLength(MULTIPLE_TESTING.k)
  })
})

// 87) Effective trials (roadmap #19 slice 2): the trials' own correlations, served by the backend as effective_n on the
// SV3 view (ANALYTICS_CATALOG SV3b). The shared harness answers the SV3 view with the captured real effective_n.
const HYPOTHESIS_PREFIX = '/api/analytics/hypothesis/'

function neffPanel(): HTMLElement {
  return screen.getByRole('tabpanel', { name: '87) Effective trials' })
}

async function openEffectiveTrials(): Promise<void> {
  await ready()
  await screen.findByRole('region', { name: DEFLATED.label })
  fireEvent.click(screen.getByRole('tab', { name: '87) Effective trials' }))
  await screen.findByRole('region', { name: EFFECTIVE_N.label })
}

describe('MT: 87) Effective trials', () => {
  it('has 15 daily trials on the served view, the ones the matrix is drawn for', () => {
    expect(EFFECTIVE_N_REAL.daily).toHaveLength(15)
    expect(EFFECTIVE_N_REAL.daily).toEqual(DEFLATED_REAL.rows.filter((r) => r.periods === 252).map((r) => r.name))
  })

  it('asks for no daily series on 85, on 86 or on 87: the SV3 view carries the numbers', async () => {
    const seen = stubApi()
    await ready()
    await screen.findByRole('region', { name: DEFLATED.label })
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    await screen.findByRole('region', { name: REPLICATION.label })
    fireEvent.click(screen.getByRole('tab', { name: '87) Effective trials' }))
    await screen.findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(seen.filter((s) => s.url.startsWith(HYPOTHESIS_PREFIX))).toEqual([])
    expect(seen.every((s) => s.method === 'GET')).toBe(true)
  })

  it('draws the served estimates, heatmap and DSR table for the real trials, with no alert', async () => {
    stubApi()
    await openEffectiveTrials()
    const table = await within(neffPanel()).findByRole('table', { name: EFFECTIVE_N.estimates.caption })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(within(neffPanel()).getByRole('table', { name: EFFECTIVE_N.dsrCaption })).toBeTruthy()
    expect(within(neffPanel()).getAllByRole('img')).toHaveLength(1)
    expect(neffPanel().textContent).toContain('Common window 2012-01-03 to 2021-12-31: 2,484 sessions')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('gives a served refusal as a status line, with no alert and no chart', async () => {
    stubApi()
    const spy = vi.mocked(globalThis.fetch)
    const answer = spy.getMockImplementation()!
    const refused = { ...EFFECTIVE_N_REAL, refusal: { kind: 'too_few', name: null, sessions: 120 }, window: null, correlation: [], eigenvalues: [], clusters: [], sequence: [], estimates: [], dsr: [] }
    spy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/analytics/deflated'
        ? Promise.resolve(new Response(JSON.stringify({ ...DEFLATED_REAL, effective_n: refused }), { status: 200, headers: { 'content-type': 'application/json' } }))
        : answer(input, init),
    )
    await openEffectiveTrials()
    const status = await within(neffPanel()).findByText('Not computed: only 120 sessions are common to every daily trial (at least 252 are needed).')
    expect(status.getAttribute('role')).toBe('status')
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(within(neffPanel()).queryByRole('img')).toBeNull()
  })

  it('opens from the tab and from Number <GO> 87, names its panel, and 85 brings the family back', async () => {
    stubApi()
    await ready()
    act(() => {
      expect(activateNumbered(PANEL_ID, 87)).toBe(true)
    })
    await screen.findByRole('region', { name: EFFECTIVE_N.label })
    expect(screen.getByRole('tab', { name: '87) Effective trials' }).getAttribute('aria-selected')).toBe('true')
    expect(neffPanel()).toBeTruthy()
    expect(screen.queryByRole('grid', { name: /Adjusted p-values/ })).toBeNull()
    expect(screen.queryByRole('region', { name: DEFLATED.label })).toBeNull()
    act(() => {
      expect(activateNumbered(PANEL_ID, 85)).toBe(true)
    })
    await waitFor(() => expect(table()).toBeTruthy())
    expect(screen.queryByRole('region', { name: EFFECTIVE_N.label })).toBeNull()
  })

  it('disables 97) Settings on 87, where the p axis choice changes nothing', async () => {
    stubApi()
    await openEffectiveTrials()
    const settings = screen.getByRole('button', { name: /97\) Settings/ })
    expect(settings.getAttribute('aria-disabled')).toBe('true')
  })

  it('tags the view [POST HOC] and says it is served by the backend', async () => {
    stubApi()
    await openEffectiveTrials()
    const view = screen.getByRole('region', { name: EFFECTIVE_N.label })
    expect(within(view).getByText('[POST HOC]')).toBeTruthy()
    expect(within(view).getByText(EFFECTIVE_N.source)).toBeTruthy()
    expect(view.textContent).not.toMatch(/computed in the browser/i)
    expect(view.textContent).toContain('the 15 daily trials in the matrix; the 6 monthly books counted as independent trials.')
  })
})

// 88) Family test (SV8): White's Reality Check, the SPA and StepM over the registered family; one GET, only once open.
describe('MT: 88) Family test', () => {
  const SPA_URL = '/api/analytics/spa'

  it('asks for nothing from the SPA route on 85, 86 or 87', async () => {
    const seen = stubApi()
    await ready()
    await screen.findByRole('region', { name: DEFLATED.label })
    fireEvent.click(screen.getByRole('tab', { name: '86) Replication' }))
    await screen.findByRole('region', { name: REPLICATION.label })
    fireEvent.click(screen.getByRole('tab', { name: '87) Effective trials' }))
    await screen.findByRole('region', { name: EFFECTIVE_N.label })
    expect(seen.filter((s) => s.url === SPA_URL)).toEqual([])
  })

  it('opens 88) with one GET to the SPA route and draws the family test region', async () => {
    const seen = stubApi()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '88) Family test' }))
    expect(await screen.findByRole('region', { name: SPA.label })).toBeTruthy()
    const asked = seen.filter((s) => s.url === SPA_URL)
    expect(asked).toEqual([{ url: SPA_URL, method: 'GET' }])
    expect(screen.getByRole('tabpanel', { name: '88) Family test' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '88) Family test' }).getAttribute('aria-selected')).toBe('true')
  })

  it('states a refused SPA read in an alert, with the tab strip still there', async () => {
    stubApi({ [SPA_URL]: 503 })
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: '88) Family test' }))
    expect((await screen.findByRole('alert')).textContent).toContain('stub 503')
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })
})
