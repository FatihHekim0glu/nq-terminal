// @vitest-environment jsdom
// U16: HOME at 1366x768, the equity panel's KPI tiles wrap to two rows but the chart kept its fixed
// short-panel height (home.css), so the time axis, the underwater tag and the notes fell below the
// fold (a11y-visual crop-HOME-EQ-1366.png: body scrollHeight 350 vs clientHeight 253). The chart now
// sizes itself from the panel body's actual remaining height (ResizeObserver), so its own bottom (the
// time axis and the last pane's legend) always stays inside the visible body; only the notes below it
// are left to scroll, as home.css's short-panel comment already intends.
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { UplotConstructor } from '../../charts/lazy'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import type { ResolvedContext } from '../../commands/types'
import HomeEquityPanel, { fitChartHeight, HOME_EQ_CHART_MIN_HEIGHT, HOME_EQ_SHORT_PANEL } from './HomeEquityPanel'
import { PANEL_A } from './homeEquity.fixtures'

function stubRectTop(el: HTMLElement, top: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }) })
}

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

const pending: () => Promise<UplotConstructor> = () => new Promise(() => {})

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  TestResizeObserver.instances = []
  fetchSpy = vi.fn(async () => new Response(JSON.stringify(PANEL_A), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function props(context: ResolvedContext | null): ScreenProps {
  return { params: { code: 'EQ', context, args: {}, group: 'B' }, context }
}

describe('fitChartHeight (U16 pure calc)', () => {
  it('fills the space left under the tag and the KPI tiles, down to the container foot', () => {
    expect(fitChartHeight(253, 60, 2)).toBe(191)
  })

  it('never goes under the chart minimum, so the axis and the legend stay legible', () => {
    expect(fitChartHeight(200, 90, 2)).toBe(HOME_EQ_CHART_MIN_HEIGHT)
  })

  it('rounds a fractional measurement to a whole pixel', () => {
    expect(fitChartHeight(253.4, 60.2, 2)).toBe(191)
  })

  it('grows with a tall container: the notes need not scroll away', () => {
    expect(fitChartHeight(800, 60, 2)).toBe(738)
  })
})

describe('HomeEquityPanel: the chart fits the panel body (U16)', () => {
  it('sets the chart height from getBoundingClientRect (scroll-invariant), not the misleading offsetTop', async () => {
    render(
      <ApiProvider client={client()}>
        <HomeEquityPanel {...props({ kind: 'hypothesis', value: 'volmanaged_v0' })} loader={pending} />
      </ApiProvider>,
    )
    await screen.findByRole('list', { name: /Key figures/ })
    const container = document.querySelector<HTMLElement>('.home-eq')
    const chart = document.querySelector<HTMLElement>('.home-eq-chart')
    expect(container).toBeTruthy()
    expect(chart).toBeTruthy()
    Object.defineProperty(container!, 'clientHeight', { value: 253, configurable: true })
    stubRectTop(container!, 100)
    stubRectTop(chart!, 176)
    // A misleading offsetTop (.pstage, not .home-eq, is the offsetParent) must not be used.
    Object.defineProperty(chart!, 'offsetTop', { value: 98, configurable: true })
    expect(TestResizeObserver.instances.length).toBeGreaterThan(0)
    act(() => {
      TestResizeObserver.instances.forEach((o) => o.trigger())
    })
    expect(chart!.style.height).toBe('175px')
  })

  it('leaves the chart height to CSS (the container query) once the panel is tall, not only short', async () => {
    render(
      <ApiProvider client={client()}>
        <HomeEquityPanel {...props({ kind: 'hypothesis', value: 'volmanaged_v0' })} loader={pending} />
      </ApiProvider>,
    )
    await screen.findByRole('list', { name: /Key figures/ })
    const container = document.querySelector<HTMLElement>('.home-eq')
    const chart = document.querySelector<HTMLElement>('.home-eq-chart')
    Object.defineProperty(container!, 'clientHeight', { value: 600, configurable: true })
    expect(600).toBeGreaterThan(HOME_EQ_SHORT_PANEL)
    stubRectTop(container!, 100)
    stubRectTop(chart!, 176)
    act(() => {
      TestResizeObserver.instances.forEach((o) => o.trigger())
    })
    expect(chart!.style.height).toBe('')
  })

  it('leaves the chart unstyled (CSS decides) until a real measurement arrives', async () => {
    render(
      <ApiProvider client={client()}>
        <HomeEquityPanel {...props({ kind: 'hypothesis', value: 'volmanaged_v0' })} loader={pending} />
      </ApiProvider>,
    )
    await screen.findByRole('list', { name: /Key figures/ })
    const chart = document.querySelector<HTMLElement>('.home-eq-chart')
    // jsdom never lays out, so clientHeight stays 0: no inline height is forced over the CSS rules.
    expect(chart!.style.height).toBe('')
  })
})
