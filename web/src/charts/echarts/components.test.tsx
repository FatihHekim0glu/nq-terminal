// @vitest-environment jsdom
// The five ECharts components: each is role="img" named by its data summary, has a table view with
// the same numbers, and hands its option to the shared host. The library itself is mocked (jsdom has
// no canvas); the gallery E2E run draws them for real.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('../lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { BarLadder } from './BarLadder'
import { describeBarLadder, type BarLadderInput } from './barLadderModel'
import { Distribution } from './Distribution'
import { describeDistribution, type DistributionInput } from './distributionModel'
import { Heatmap } from './Heatmap'
import { describeHeatmap, type HeatmapInput } from './heatmapModel'
import { PScatter } from './PScatter'
import { describePScatter, type PScatterInput } from './pScatterModel'
import { Swimlane } from './Swimlane'
import { describeSwimlane, type SwimlaneInput } from './swimlaneModel'

afterEach(cleanup)

const heat: HeatmapInput = {
  kind: 'mret', name: 'Monthly returns', unit: '%', columns: ['Jan', 'Feb'], rows: ['2021', '2020'], values: [[1, -2], [null, 3]],
}
const dist: DistributionInput = {
  name: 'Daily returns', unit: '%', edges: [-1, 0, 1], counts: [3, 5], normal: [3.1, 4.9], mean: 0.1, sd: 0.8,
  risk: { var95: 0.9, cvar95: 1, var99: 1, cvar99: 1 },
}
const ladder: BarLadderInput = { name: 'Blocks', unit: 'R', bars: [{ label: 'a', value: 0.1, lo: 0, hi: 0.2 }, { label: 'b', value: -0.1 }] }
const scatter: PScatterInput = { name: 'p-values', alpha: 0.05, points: [{ label: 'x', p: 0.01 }, { label: 'y', p: 0.5 }] }
const lanes: SwimlaneInput = { name: 'Reads', reads: [{ caller: 'terminal', start: 1262304000, end: 1293840000 }] }

const cases = [
  { name: 'Heatmap', ui: <Heatmap data={heat} />, label: describeHeatmap(heat), rows: 2 },
  { name: 'Distribution', ui: <Distribution data={dist} />, label: describeDistribution(dist), rows: 2 },
  { name: 'BarLadder', ui: <BarLadder data={ladder} />, label: describeBarLadder(ladder), rows: 2 },
  { name: 'PScatter', ui: <PScatter data={scatter} />, label: describePScatter(scatter), rows: 2 },
  { name: 'Swimlane', ui: <Swimlane data={lanes} />, label: describeSwimlane(lanes), rows: 1 },
] as const

describe.each(cases)('$name', ({ ui, label, rows }) => {
  it('is an image named by its data summary, and draws through the ECharts host', async () => {
    fake.chart.setOption.mockClear()
    render(ui)
    await act(async () => {
      await Promise.resolve()
    })
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(label)
    expect(img.querySelector('[data-chart-lib="echarts"]')?.getAttribute('aria-busy')).toBe('false')
    expect(fake.chart.setOption).toHaveBeenCalledTimes(1)
  })

  it('has a table view with the same numbers, toggled by the Table button and by T', async () => {
    render(ui)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(rows + 1)
    fireEvent.keyDown(screen.getByRole('region'), { key: 't' })
    expect(screen.getByRole('img')).toBeTruthy()
  })
})

describe('Heatmap scale legend', () => {
  it('shows the CORR steps with the ends labelled', () => {
    const corr: HeatmapInput = { kind: 'corr', name: 'Correlation', columns: ['NQ', 'ES'], rows: ['NQ', 'ES'], values: [[1, 0.9], [0.9, 1]] }
    render(<Heatmap data={corr} />)
    const scale = document.querySelector('.echarts-scale')!
    expect(scale.textContent).toContain('-1.00')
    expect(scale.textContent).toContain('+1.00')
    expect(scale.querySelectorAll('.echarts-scale-step')).toHaveLength(5)
  })

  it('shows the MRET ramp labelled min at the left and max at the right', () => {
    render(<Heatmap data={heat} />)
    const ends = [...document.querySelectorAll('.echarts-scale-end')].map((e) => e.textContent)
    expect(ends).toEqual(['-2.00', '+3.00'])
  })
})
