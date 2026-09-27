import { describe, expect, it, vi } from 'vitest'
import {
  crosshairSyncKey,
  createCrosshairBus,
  lwcCrosshairSync,
  uplotCrosshairSync,
  type CrosshairMove,
  type LwcSyncChart,
  type UplotSyncPlot,
} from './sync'

/** A stand-in for a uPlot instance: x values are epoch seconds, 10px per second from t=1000. */
function fakePlot(times: number[]): UplotSyncPlot & { cursorCalls: Array<[{ left: number; top: number }, boolean?, boolean?]> } {
  const cursorCalls: Array<[{ left: number; top: number }, boolean?, boolean?]> = []
  return {
    data: [times],
    over: { clientHeight: 200 },
    valToPos: (v: number) => (v - 1000) * 10,
    setCursor: (opts: { left: number; top: number }, fire?: boolean, pub?: boolean) => {
      cursorCalls.push([opts, fire, pub])
    },
    cursorCalls,
  }
}

type MoveHandler = Parameters<LwcSyncChart['subscribeCrosshairMove']>[0]

function fakeChart() {
  let handler: MoveHandler | null = null
  const chart = {
    subscribeCrosshairMove: vi.fn((h: MoveHandler) => {
      handler = h
    }),
    unsubscribeCrosshairMove: vi.fn(() => {
      handler = null
    }),
    setCrosshairPosition: vi.fn(),
    clearCrosshairPosition: vi.fn(),
  }
  return { chart, move: (time: number | undefined) => handler?.({ time }) }
}

describe('crosshairSyncKey', () => {
  it('gives each link group its own key and unlinked panels none', () => {
    expect(crosshairSyncKey('A')).toBe('nqt-link-A')
    expect(crosshairSyncKey('B')).not.toBe(crosshairSyncKey('C'))
    expect(crosshairSyncKey('-')).toBeNull()
  })
})

describe('createCrosshairBus', () => {
  it('delivers a move to every other listener of the same group only', () => {
    const bus = createCrosshairBus()
    const a1 = vi.fn()
    const a2 = vi.fn()
    const b = vi.fn()
    bus.subscribe('A', 'one', a1)
    bus.subscribe('A', 'two', a2)
    bus.subscribe('B', 'three', b)
    const move: CrosshairMove = { sourceId: 'one', library: 'uplot', time: 1_600_000_000 }
    bus.publish('A', move)
    expect(a1).not.toHaveBeenCalled()
    expect(a2).toHaveBeenCalledWith(move)
    expect(b).not.toHaveBeenCalled()
    expect(bus.last('A')).toEqual(move)
    expect(bus.last('B')).toBeNull()
  })

  it('stops delivering after unsubscribe, and drops a repeat of the same time', () => {
    const bus = createCrosshairBus()
    const fn = vi.fn()
    const off = bus.subscribe('C', 'x', fn)
    bus.publish('C', { sourceId: 'y', library: 'lwc', time: 5 })
    bus.publish('C', { sourceId: 'y', library: 'lwc', time: 5 })
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    bus.publish('C', { sourceId: 'y', library: 'lwc', time: 6 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('keeps delivering when one listener throws, and reports the error', () => {
    const onError = vi.fn()
    const bus = createCrosshairBus(onError)
    const good = vi.fn()
    const broken = new Error('broken chart')
    bus.subscribe('A', 'bad', () => {
      throw broken
    })
    bus.subscribe('A', 'good', good)
    expect(() => bus.publish('A', { sourceId: 'z', library: 'uplot', time: 1 })).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(broken)
  })
})

describe('uplotCrosshairSync', () => {
  it('returns no sync options and a no-op plugin for an unlinked panel', () => {
    const bus = createCrosshairBus()
    const sync = uplotCrosshairSync('-', 'p1', bus)
    expect(sync.cursorSync).toBeUndefined()
    const plot = fakePlot([1000])
    sync.plugin.hooks.init?.(plot)
    bus.publish('A', { sourceId: 'lwc1', library: 'lwc', time: 1000 })
    expect(plot.cursorCalls).toEqual([])
  })

  it('uses the group key for uPlot cursor.sync and publishes the time of its own moves', () => {
    const bus = createCrosshairBus()
    const heard = vi.fn()
    bus.subscribe('A', 'listener', heard)
    const sync = uplotCrosshairSync('A', 'p1', bus)
    expect(sync.cursorSync?.key).toBe('nqt-link-A')
    expect(sync.cursorSync?.scales).toEqual(['x', null])
    const plot = fakePlot([1000, 1060, 1120])
    // uPlot calls filters.pub(type, self, x, y, w, h, idx) when this plot publishes its cursor.
    expect(sync.cursorSync?.filters.pub('mousemove', plot, 0, 0, 100, 100, 1)).toBe(true)
    expect(heard).toHaveBeenLastCalledWith({ sourceId: 'p1', library: 'uplot', time: 1060 })
    sync.cursorSync?.filters.pub('mouseleave', plot, -10, -10, 100, 100, null)
    expect(heard).toHaveBeenLastCalledWith({ sourceId: 'p1', library: 'uplot', time: null })
    // Other event types (drag, click) pass through to uPlot and are not sent to the bus.
    expect(sync.cursorSync?.filters.pub('mousedown', plot, 0, 0, 100, 100, 1)).toBe(true)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('moves its cursor for a lightweight-charts move without re-publishing it', () => {
    const bus = createCrosshairBus()
    const sync = uplotCrosshairSync('A', 'p1', bus)
    const plot = fakePlot([1000, 1060])
    sync.plugin.hooks.init?.(plot)
    bus.publish('A', { sourceId: 'lwc1', library: 'lwc', time: 1060 })
    expect(plot.cursorCalls).toEqual([[{ left: 600, top: 100 }, true, false]])
    bus.publish('A', { sourceId: 'lwc1', library: 'lwc', time: null })
    expect(plot.cursorCalls[1]).toEqual([{ left: -10, top: -10 }, true, false])
  })

  it('leaves uPlot to uPlot moves to the native cursor.sync (no double move)', () => {
    const bus = createCrosshairBus()
    const sync = uplotCrosshairSync('A', 'p1', bus)
    const plot = fakePlot([1000])
    sync.plugin.hooks.init?.(plot)
    bus.publish('A', { sourceId: 'p2', library: 'uplot', time: 1000 })
    expect(plot.cursorCalls).toEqual([])
  })

  it('unsubscribes on destroy', () => {
    const bus = createCrosshairBus()
    const sync = uplotCrosshairSync('B', 'p1', bus)
    const plot = fakePlot([1000])
    sync.plugin.hooks.init?.(plot)
    sync.plugin.hooks.destroy?.(plot)
    bus.publish('B', { sourceId: 'lwc1', library: 'lwc', time: 1000 })
    expect(plot.cursorCalls).toEqual([])
  })
})

describe('lwcCrosshairSync', () => {
  it('publishes the time of pointer moves on the chart', () => {
    const bus = createCrosshairBus()
    const heard = vi.fn()
    bus.subscribe('A', 'listener', heard)
    const { chart, move } = fakeChart()
    lwcCrosshairSync({ chart, series: {}, link: 'A', sourceId: 'c1', priceAt: () => 1, bus })
    move(1_600_000_000)
    expect(heard).toHaveBeenLastCalledWith({ sourceId: 'c1', library: 'lwc', time: 1_600_000_000 })
    move(undefined)
    expect(heard).toHaveBeenLastCalledWith({ sourceId: 'c1', library: 'lwc', time: null })
  })

  it('sets its crosshair from any other chart in the group, and clears it', () => {
    const bus = createCrosshairBus()
    const { chart } = fakeChart()
    const series = { id: 'candles' }
    lwcCrosshairSync({ chart, series, link: 'A', sourceId: 'c1', priceAt: (t) => (t === 1000 ? 42.5 : null), bus })
    bus.publish('A', { sourceId: 'p1', library: 'uplot', time: 1000 })
    expect(chart.setCrosshairPosition).toHaveBeenCalledWith(42.5, 1000, series)
    // A time with no bar clears rather than guessing a price.
    bus.publish('A', { sourceId: 'p1', library: 'uplot', time: 2000 })
    bus.publish('A', { sourceId: 'p1', library: 'uplot', time: null })
    expect(chart.clearCrosshairPosition).toHaveBeenCalledTimes(2)
  })

  it('publishes keyboard moves through publish() and stops on dispose', () => {
    const bus = createCrosshairBus()
    const heard = vi.fn()
    bus.subscribe('B', 'listener', heard)
    const { chart } = fakeChart()
    const sync = lwcCrosshairSync({ chart, series: {}, link: 'B', sourceId: 'c1', priceAt: () => 1, bus })
    sync.publish(1234)
    expect(heard).toHaveBeenCalledWith({ sourceId: 'c1', library: 'lwc', time: 1234 })
    sync.dispose()
    expect(chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1)
    bus.publish('B', { sourceId: 'p1', library: 'uplot', time: 1 })
    expect(chart.setCrosshairPosition).not.toHaveBeenCalled()
  })

  it('does nothing for an unlinked panel', () => {
    const bus = createCrosshairBus()
    const { chart } = fakeChart()
    const sync = lwcCrosshairSync({ chart, series: {}, link: '-', sourceId: 'c1', priceAt: () => 1, bus })
    expect(chart.subscribeCrosshairMove).not.toHaveBeenCalled()
    sync.publish(1)
    sync.dispose()
  })
})
