// @vitest-environment jsdom
// RET's SV7 card (ANALYTICS_CATALOG SV7): the Sharpe difference tests the screen file stores, drawn as a
// bar ladder with the ECharts set's real accessibility wrapper (name and table view), beside the RET
// statistics, and a note instead of a chart where the series records none. The library itself is mocked
// (jsdom has no canvas), as in charts/echarts/components.test.tsx.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEAR_SV7 } from '../../copy/tear'
import { describeBarLadder } from '../../charts/echarts/barLadderModel'
import { RUN_ANALYTICS } from './tear.fixtures'
import { HYP_ANALYTICS } from './tearP1.fixtures'
import { readSv7, sv7Ladder } from './tearSv7Model'
import type { Analytics } from './tearKpis'
import { TearView } from './TearViews'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../../charts/lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

afterEach(cleanup)

async function showRet(data: Analytics, name: string) {
  const result = render(<TearView tab="RET" data={data} name={name} link="B" />)
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

const LADDER = sv7Ladder(readSv7(HYP_ANALYTICS.validity.sharpe_difference_tests), 'volmanaged_v0')
const card = () => screen.getByRole('group', { name: TEAR_SV7.regionLabel })

function valuesOf(table: HTMLElement, label: string, nth = 0): string[] {
  const row = within(table).getAllByRole('rowheader', { name: label })[nth]!.closest('tr')!
  return within(row).getAllByRole('cell').map((c) => c.textContent ?? '')
}

describe('RET: the Sharpe difference (m - BH) card (SV7)', () => {
  it('draws the Ledoit-Wolf points by cost as a chart named for the file label, beside the statistics', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const img = within(card()).getByRole('img', { name: /Sharpe difference \(m - BH\)/ })
    expect(img.getAttribute('aria-label')).toBe(describeBarLadder(LADDER))
    expect(img.getAttribute('aria-label')).toContain('Whiskers show the 90% interval (Ledoit-Wolf bootstrap).')
    expect(screen.getByRole('table', { name: 'Return statistics' })).toBeTruthy()
    const title = within(card()).getByRole('heading', { level: 3 })
    expect(title.textContent).toBe('Sharpe difference (m - BH)[POST HOC]')
  })

  it('has a table view listing each cost row with its point, interval and sample size', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    fireEvent.click(within(card()).getByRole('button', { name: 'Table' }))
    const table = within(card()).getByRole('table', { name: LADDER.name })
    // The first column is a row header (ChartA11y, D38), the rest are cells.
    const rows = within(table).getAllByRole('row').slice(1).map((r) => [
      ...within(r).getAllByRole('rowheader'), ...within(r).getAllByRole('cell'),
    ].map((c) => c.textContent))
    expect(rows).toEqual([
      ['1 tick', '-0.0032', '-0.2913', '+0.3409', '2686'],
      ['2 ticks', '-0.0061', '-0.2942', '+0.3380', '2686'],
    ])
  })

  it('lists every measure per cost at display precision, signed where the value has a sign', async () => {
    await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const table = within(card()).getByRole('table', { name: 'Sharpe difference (m - BH) by cost, as the screen file records it' })
    const [head, ...bands] = within(table).getAllByRole('rowgroup')
    expect(within(head!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([TEAR_SV7.measure, '1 tick', '2 ticks'])
    expect(bands.flatMap((b) => within(b).queryAllByRole('columnheader').map((h) => h.textContent))).toEqual([
      TEAR_SV7.bands.lw, TEAR_SV7.bands.memmel, TEAR_SV7.bands.provenance,
    ])
    const rowheaderNames = within(table).getAllByRole('rowheader').map((h) => h.textContent)
    expect(new Set(rowheaderNames).size).toBe(rowheaderNames.length)
    expect(valuesOf(table, 'Screen headline')).toEqual(['-0.0032', '-0.0061'])
    expect(valuesOf(table, 'Difference')).toEqual(['-0.0032', '-0.0061'])
    expect(valuesOf(table, '90% low')).toEqual(['-0.29', '-0.29'])
    expect(valuesOf(table, '90% high')).toEqual(['+0.34', '+0.34'])
    expect(valuesOf(table, 'Ledoit-Wolf p')).toEqual(['0.4884', '0.4950'])
    expect(valuesOf(table, 'Memmel z')).toEqual(['-0.02', '-0.03'])
    expect(valuesOf(table, 'Memmel rho')).toEqual(['0.77', '0.77'])
    expect(valuesOf(table, 'Memmel p')).toEqual(['0.5061', '0.5116'])
    expect(valuesOf(table, 'Replications')).toEqual(['4,999', '4,999'])
    expect(valuesOf(table, 'Seed')).toEqual(['20260926', '20260926'])
    expect(valuesOf(table, 'Observations')).toEqual(['2,686', '2,686'])
    expect(card().textContent).toContain(TEAR_SV7.pNote)
  })

  it('RET keeps two columns: the histogram and one scroll box holding the statistics and the SV7 card', async () => {
    const { container } = await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const split = container.querySelector('.tear-split')!
    expect(split.children).toHaveLength(2)
    const stats = screen.getByRole('region', { name: 'Return statistics' })
    expect(within(stats).getByRole('group', { name: TEAR_SV7.regionLabel })).toBeTruthy()
    expect(screen.queryAllByRole('region', { name: TEAR_SV7.regionLabel })).toHaveLength(0)
  })

  it('RET has exactly one keyboard-reachable scroll box, holding the stats and the SV7 card', async () => {
    const { container } = await showRet(HYP_ANALYTICS, 'volmanaged_v0')
    const scrolls = container.querySelectorAll('[data-roving-scroll]')
    expect(scrolls).toHaveLength(1)
    const stats = scrolls[0] as HTMLElement
    expect(stats.getAttribute('aria-label')).toBe('Return statistics')
    expect(stats.tabIndex).toBe(0)
    expect(stats.hasAttribute('data-roving')).toBe(true)
    expect(within(stats).getByRole('group', { name: TEAR_SV7.regionLabel })).toBeTruthy()
    expect(within(stats).getByRole('img', { name: /Sharpe difference \(m - BH\)/ })).toBeTruthy()
  })

  it('says how many entries were left out when the file holds one in another shape', async () => {
    const tests = { ...HYP_ANALYTICS.validity.sharpe_difference_tests, gross: { label: 'Sharpe difference (m - BH)', ledoit_wolf: 'not a test' } }
    await showRet({ ...HYP_ANALYTICS, validity: { ...HYP_ANALYTICS.validity, sharpe_difference_tests: tests } }, 'volmanaged_v0')
    expect(card().textContent).toContain(TEAR_SV7.droppedOne)
  })

  it('shows the not recorded note and no chart for a series without the tests', async () => {
    await showRet(RUN_ANALYTICS, 'nt_volmanaged_v0_fixture_m1')
    expect(screen.queryByRole('group', { name: TEAR_SV7.regionLabel })).toBeNull()
    expect(screen.queryByRole('img', { name: /Sharpe difference/ })).toBeNull()
    const stats = screen.getByRole('region', { name: 'Return statistics' })
    expect(within(stats).getByText(TEAR_SV7.notRecorded)).toBeTruthy()
  })
})
