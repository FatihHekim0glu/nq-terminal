import { describe, expect, it } from 'vitest'
import { renderCustom, seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'
import { FENCE_SECONDS } from './shared'
import { describeSwimlane, laneStats, swimlaneOption, swimlaneTable, type SwimlaneInput } from './swimlaneModel'

const T = uniqueTokens()
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

const input: SwimlaneInput = {
  name: 'Gate reads',
  reads: [
    { caller: 'za_screen', start: day('2010-09-28'), end: day('2022-01-01') },
    { caller: 'run_base', start: day('2015-01-01'), end: day('2015-02-01') },
    { caller: 'za_screen', start: day('2010-09-28'), end: day('2022-01-01') },
    { caller: 'serve_sealed', start: day('2022-01-01'), end: day('2026-09-01'), sealed: true },
  ],
}

const byId = (option: unknown, id: string) => seriesOf(option).find((s) => s.id === id) as Record<string, any>

describe('laneStats', () => {
  it('keeps lanes in order of first appearance, with counts and the window extremes', () => {
    expect(laneStats(input)).toEqual([
      { caller: 'za_screen', reads: 2, sealed: 0, start: day('2010-09-28'), end: day('2022-01-01') },
      { caller: 'run_base', reads: 1, sealed: 0, start: day('2015-01-01'), end: day('2015-02-01') },
      { caller: 'serve_sealed', reads: 1, sealed: 1, start: day('2022-01-01'), end: day('2026-09-01') },
    ])
  })

  it('follows a given lane order and keeps unknown callers after it', () => {
    expect(laneStats({ ...input, lanes: ['serve_sealed', 'run_base'] }).map((l) => l.caller)).toEqual([
      'serve_sealed', 'run_base', 'za_screen',
    ])
  })

  it('refuses a read whose window ends before it starts', () => {
    expect(() => laneStats({ ...input, reads: [{ caller: 'x', start: 10, end: 5 }] })).toThrow(/window/)
  })
})

describe('swimlaneOption (look spec 6.3 and 7.10 Swimlane)', () => {
  it('puts one lane per caller, labels amber at the left and read counts at the right', () => {
    const option = swimlaneOption(input, T) as Record<string, any>
    const [lanes, counts] = option.yAxis
    expect(lanes).toMatchObject({ type: 'category', inverse: true, position: 'left', data: ['za_screen', 'run_base', 'serve_sealed'] })
    expect(lanes.axisLabel.color).toBe(T.color.data)
    expect(counts).toMatchObject({ type: 'category', inverse: true, position: 'right', data: ['2', '1', '1'] })
  })

  it('draws each read window as a span on a time axis, sealed reads taller and in the marker yellow', () => {
    const option = swimlaneOption(input, T)
    const reads = byId(option, 'reads')
    expect(reads.type).toBe('custom')
    expect(reads.data[0]).toEqual([day('2010-09-28') * 1000, day('2022-01-01') * 1000, 0, 0])
    expect(reads.data[3]).toEqual([day('2022-01-01') * 1000, day('2026-09-01') * 1000, 2, 1])
    const drawn = renderCustom(reads, 4) as { type: string; shape: Record<string, number>; style: { fill: string } }[]
    expect(drawn[0]!.type).toBe('rect')
    expect(drawn[0]!.style.fill).toBe(T.color.chartS1)
    expect(drawn[3]!.style.fill).toBe(T.color.marker)
    expect(drawn[3]!.shape.height!).toBeGreaterThan(drawn[0]!.shape.height!)
  })

  it('puts every span edge on a whole pixel, so spans have no blended fringe', () => {
    const drawn = renderCustom(byId(swimlaneOption(input, T), 'reads'), 4) as { shape: Record<string, number> }[]
    for (const d of drawn) {
      for (const k of ['x', 'y', 'width', 'height']) expect(Number.isInteger(d.shape[k]), k).toBe(true)
    }
  })

  it('draws the fence amber and dashed with its honesty label', () => {
    const reads = byId(swimlaneOption(input, T), 'reads')
    const [fence] = reads.markLine.data as { xAxis: number; name: string; lineStyle: { color: string; type: number[] }; label: { color: string } }[]
    expect(fence!.xAxis).toBe(FENCE_SECONDS * 1000)
    expect(fence!.name).toBe('IS | 2022+ SPENT')
    expect(fence!.lineStyle.color).toBe(T.color.fence)
    expect(fence!.lineStyle.type).toEqual([4, 3])
    // The lane axis is inverted, so the line starts at the top: the label goes at its start.
    expect(fence!.label).toMatchObject({ color: T.color.fence, position: 'start' })
  })

  it('always shows the fence, even when every read is in-sample', () => {
    const option = swimlaneOption({ ...input, reads: input.reads.slice(0, 2) }, T) as Record<string, any>
    expect(option.xAxis.max).toBeGreaterThan(FENCE_SECONDS * 1000)
    expect(option.xAxis.min).toBe(day('2010-01-01') * 1000)
  })

  it('takes every colour from the tokens', () => {
    const option = swimlaneOption(input, T)
    const allowed = tokenValues(T)
    expect(strayColours(option, allowed)).toEqual([])
    expect(strayColours(renderCustom(byId(option, 'reads'), 4), allowed)).toEqual([])
  })
})

describe('describeSwimlane and swimlaneTable', () => {
  it('summarises reads, callers, the window span and the sealed reads', () => {
    expect(describeSwimlane(input)).toBe(
      'Gate reads: 4 reads by 3 callers; windows from 2010-09-28 to 2026-09-01; 1 sealed reads past the fence.',
    )
  })

  it('handles an empty log', () => {
    expect(describeSwimlane({ ...input, reads: [] })).toBe('Gate reads: no reads.')
  })

  it('gives one row per caller', () => {
    const table = swimlaneTable(input)
    expect(table.caption).toBe('Gate reads: reads by caller')
    expect(table.columns.map((c) => c.label)).toEqual(['Caller', 'Reads', 'Sealed reads', 'Earliest start', 'Latest end'])
    expect(table.rows[2]).toEqual({ caller: 'serve_sealed', reads: 1, sealed: 1, start: '2022-01-01', end: '2026-09-01' })
  })
})
