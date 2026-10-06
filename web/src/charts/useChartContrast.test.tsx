// @vitest-environment jsdom
// Charts follow the contrast settings while mounted: a forced-colours or prefers-contrast change makes
// the ECharts set redraw with freshly resolved tokens (theme/chartContrast.ts). The library is mocked.
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
  return { chart, lib: { init: vi.fn(() => chart), graphic: {} } }
})

vi.mock('./lazy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lazy')>()
  return { ...actual, loadEcharts: () => Promise.resolve(fake.lib) }
})

import { BarLadder } from './echarts/BarLadder'
import type { BarLadderInput } from './echarts/barLadderModel'
import { useChartTokens } from './echarts/EchartsChart'
import { DEFAULT_CHART_TOKENS, FORCED_COLOURS_QUERY, MORE_CONTRAST_QUERY, readSystemColours } from './theme'
import { fakeMedia } from './theme/themeTestUtil'
import { useChartContrastVersion, useLiveChartTokens } from './useChartContrast'

let uninstall: (() => void) | null = null
afterEach(() => {
  cleanup()
  uninstall?.()
  uninstall = null
})

const ladder: BarLadderInput = { name: 'Blocks', unit: 'R', bars: [{ label: 'a', value: 0.1, lo: 0, hi: 0.2 }, { label: 'b', value: -0.1 }] }

describe('useChartContrastVersion', () => {
  it('counts each contrast change and stops listening on unmount', () => {
    const media = fakeMedia()
    const { result, unmount } = renderHook(() => useChartContrastVersion(media.match))
    expect(result.current).toBe(0)
    act(() => media.set(FORCED_COLOURS_QUERY, true))
    expect(result.current).toBe(1)
    act(() => media.set(MORE_CONTRAST_QUERY, true))
    expect(result.current).toBe(2)
    unmount()
    expect(media.listeners()).toBe(0)
  })

  it('counts a change of the system colours when the media query results stay the same', () => {
    const media = fakeMedia({ [FORCED_COLOURS_QUERY]: true })
    let canvas = 'rgb(255, 250, 239)'
    const read = (keywords: readonly string[]) => keywords.map((k) => (k === 'Canvas' ? canvas : 'rgb(61, 61, 61)'))
    const { result, unmount } = renderHook(() => useChartContrastVersion(media.match, read))
    expect(result.current).toBe(0)
    canvas = 'rgb(0, 0, 0)'
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toBe(1)
    unmount()
  })

  it('stays at 0 with no matchMedia', () => {
    const { result } = renderHook(() => useChartContrastVersion(null))
    expect(result.current).toBe(0)
  })
})

describe('useLiveChartTokens and useChartTokens', () => {
  it('start from the default palette and switch to system colours when forced colours turn on', () => {
    const media = fakeMedia()
    uninstall = media.install()
    const live = renderHook(() => useLiveChartTokens())
    const echarts = renderHook(() => useChartTokens())
    expect(live.result.current).toEqual(DEFAULT_CHART_TOKENS)
    expect(echarts.result.current).toEqual(DEFAULT_CHART_TOKENS)
    const before = live.result.current
    act(() => media.set(FORCED_COLOURS_QUERY, true))
    // jsdom resolves the system colour keywords (a light theme), so the probe's values are the expected ones.
    expect(live.result.current.contrast).toBe('forced')
    expect(live.result.current.color.bg).toBe(readSystemColours().canvas)
    expect(echarts.result.current.contrast).toBe('forced')
    expect(live.result.current).not.toBe(before)
    act(() => media.set(FORCED_COLOURS_QUERY, false))
    expect(live.result.current).toEqual(DEFAULT_CHART_TOKENS)
  })

  it('keep the same object across renders while nothing changes', () => {
    uninstall = fakeMedia().install()
    const { result, rerender } = renderHook(() => useLiveChartTokens())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('an ECharts chart on a contrast change', () => {
  it('redraws with the forced palette, and again when it turns off', async () => {
    const media = fakeMedia()
    uninstall = media.install()
    fake.chart.setOption.mockClear()
    render(<BarLadder data={ladder} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(fake.chart.setOption).toHaveBeenCalledTimes(1)
    const first = fake.chart.setOption.mock.calls[0]![0] as { backgroundColor: string }
    expect(first.backgroundColor).toBe(DEFAULT_CHART_TOKENS.color.bg)
    act(() => media.set(FORCED_COLOURS_QUERY, true))
    expect(fake.chart.setOption).toHaveBeenCalledTimes(2)
    const forced = fake.chart.setOption.mock.calls[1]![0] as { backgroundColor: string }
    expect(forced.backgroundColor).toBe(readSystemColours().canvas)
    act(() => media.set(FORCED_COLOURS_QUERY, false))
    expect(fake.chart.setOption).toHaveBeenCalledTimes(3)
  })
})
