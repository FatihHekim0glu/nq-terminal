import { describe, expect, it } from 'vitest'
import { FENCE } from '../copy/lineStack'
import { DEFAULT_CHART_TOKENS } from './theme'
import { FENCE_REACH_SECONDS, FENCE_TIME, drawFence, fenceCanvasX, fencePlugin, fenceStyle, viewMaxWithFence } from './fence'
import { fakePlot } from './LineStack.testUtil'

const DAY = 86_400
const LAST_IS_DAY = Date.UTC(2021, 11, 31) / 1000

describe('the OOS fence (UI_SPEC section 6)', () => {
  it('sits at 2022-01-01 00:00 UTC', () => {
    expect(FENCE_TIME).toBe(1_640_995_200)
    expect(new Date(FENCE_TIME * 1000).toISOString()).toBe('2022-01-01T00:00:00.000Z')
  })

  it('pulls the view out to the fence when the data stops at it, and not for data that stops years before', () => {
    expect(viewMaxWithFence(LAST_IS_DAY)).toBe(FENCE_TIME)
    expect(viewMaxWithFence(FENCE_TIME - FENCE_REACH_SECONDS)).toBe(FENCE_TIME)
    const early = Date.UTC(2015, 5, 30) / 1000
    expect(viewMaxWithFence(early)).toBe(early)
    // Data past the fence (the spent window) keeps its own end.
    expect(viewMaxWithFence(FENCE_TIME + 30 * DAY)).toBe(FENCE_TIME + 30 * DAY)
  })

  it('is in view only when the x scale contains it', () => {
    const inView = fakePlot({ xMin: LAST_IS_DAY - 100 * DAY, xMax: FENCE_TIME })
    expect(fenceCanvasX(inView)).toBeCloseTo(inView.bbox.left + inView.bbox.width, 6)
    const before = fakePlot({ xMin: LAST_IS_DAY - 100 * DAY, xMax: LAST_IS_DAY - DAY })
    expect(fenceCanvasX(before)).toBeNull()
  })

  it('draws a 1px amber dashed line down the whole plot, labelled IS | 2022+ SPENT', () => {
    const u = fakePlot({ xMin: FENCE_TIME - 200 * DAY, xMax: FENCE_TIME + 100 * DAY, pxRatio: 2 })
    const style = fenceStyle(DEFAULT_CHART_TOKENS, FENCE.label)
    const x = drawFence(u, style)
    expect(x).not.toBeNull()
    const calls = u.ctx.calls
    expect(calls).toContainEqual(['setLineDash', [8, 6]])
    expect(calls).toContainEqual(['set:strokeStyle', '#FFA028'])
    expect(calls).toContainEqual(['set:lineWidth', 2])
    const moves = calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')
    expect(moves).toEqual([
      ['moveTo', x, u.bbox.top],
      ['lineTo', x, u.bbox.top + u.bbox.height],
    ])
    expect(calls.find((c) => c[0] === 'fillText')?.[1]).toBe('IS | 2022+ SPENT')
    // The label sits on a black box so a series under it cannot hide it.
    expect(calls).toContainEqual(['set:fillStyle', '#000000'])
    expect(calls[0]).toEqual(['save'])
    expect(calls.at(-1)).toEqual(['restore'])
  })

  it('draws nothing when the fence is outside the view, and can leave the label off', () => {
    const u = fakePlot({ xMin: 0, xMax: 1000 })
    expect(drawFence(u, fenceStyle(DEFAULT_CHART_TOKENS, FENCE.label))).toBeNull()
    expect(u.ctx.calls).toEqual([])
    const v = fakePlot({ xMin: FENCE_TIME - DAY, xMax: FENCE_TIME + DAY })
    drawFence(v, fenceStyle(DEFAULT_CHART_TOKENS, null))
    expect(v.ctx.calls.some((c) => c[0] === 'fillText')).toBe(false)
  })

  it('puts the label right of the line when there is no room on its left', () => {
    const u = fakePlot({ xMin: FENCE_TIME, xMax: FENCE_TIME + 400 * DAY })
    drawFence(u, fenceStyle(DEFAULT_CHART_TOKENS, FENCE.label))
    expect(u.ctx.calls).toContainEqual(['set:textAlign', 'left'])
  })

  it('is a uPlot plugin drawing on the draw hook and reporting where it drew', () => {
    const seen: (number | null)[] = []
    const plugin = fencePlugin(() => fenceStyle(DEFAULT_CHART_TOKENS, FENCE.label), (x) => seen.push(x))
    const u = fakePlot({ xMin: FENCE_TIME - DAY, xMax: FENCE_TIME + DAY })
    plugin.hooks.draw(u)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeCloseTo(u.bbox.width / 2 / u.pxRatio, 6)
  })
})
