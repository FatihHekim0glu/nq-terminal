// @vitest-environment jsdom
// GlyphScatter: role="img" named by the data summary, a table view with the same numbers, and the
// model's option handed to the shared ECharts host. The library is mocked (jsdom has no canvas); the
// gallery run draws it for real.
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

import { GlyphScatter } from './GlyphScatter'
import { describeGlyphScatter, type GlyphScatterInput } from './glyphScatterModel'

afterEach(cleanup)

const DATA: GlyphScatterInput = {
  name: 'Deflation',
  x: { label: 'p before', scale: 'log', format: 'p', inverse: true },
  y: { label: 'p after', scale: 'log', format: 'p', inverse: true },
  points: [
    { label: 'Strategy A', tag: 'A', x: 0.001, y: 0.004, glyph: 'up', kind: 'holds' },
    { label: 'Strategy B', tag: 'B', x: 0.03, y: 0.2, glyph: 'down', kind: 'lost' },
  ],
  diagonal: 'y = x',
}

describe('GlyphScatter', () => {
  it('is an image named by its data summary, and draws through the ECharts host', async () => {
    fake.chart.setOption.mockClear()
    render(<GlyphScatter data={DATA} chartId="glyph" />)
    await act(async () => {
      await Promise.resolve()
    })
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe(describeGlyphScatter(DATA))
    expect(img.querySelector('[data-chart-lib="echarts"]')?.getAttribute('data-chart-id')).toBe('glyph')
    expect(img.querySelector('[data-chart-lib="echarts"]')?.getAttribute('aria-busy')).toBe('false')
    expect(fake.chart.setOption).toHaveBeenCalledTimes(1)
    const drawn = fake.chart.setOption.mock.calls[0]![0] as { series: { id: string }[] }
    expect(drawn.series.map((s) => s.id)).toEqual(['diagonal', 'points'])
  })

  it('has a table view with one row per point, toggled by the Table button and by T', () => {
    render(<GlyphScatter data={DATA} chartId="glyph-table" />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('Strategy B')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('region'), { key: 't' })
    expect(screen.getByRole('img')).toBeTruthy()
  })
})
