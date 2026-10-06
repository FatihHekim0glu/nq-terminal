// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../../theme/contrast'
import {
  FORCED_COLOURS_QUERY,
  FORCED_DASHES,
  MORE_CONTRAST_QUERY,
  COLOUR_SCHEME_QUERY,
  computedToHex,
  forcedChartTokens,
  forcedDash,
  moreContrastTokens,
  probeKeywords,
  readChartContrast,
  readLiveChartTokens,
  readSystemColours,
  subscribeChartContrast,
  type ContrastMediaList,
} from './chartContrast'
import { DEFAULT_CHART_TOKENS, SYSTEM_COLOUR_FALLBACK, readChartTokens, type ChartTokens, type SystemColours } from './chartTokens'
import { CHART_GEOMETRY } from './geometry'
import { fakeMedia } from './themeTestUtil'

// A light contrast theme ("Desert"-like), so a test can tell the probe's colours from the fallback.
const DESERT: SystemColours = {
  canvas: '#FFFAEF',
  canvasText: '#3D3D3D',
  highlight: '#903909',
  grayText: '#676767',
  linkText: '#1C5E75',
}
const NO_STYLE = null

function forced(system: SystemColours = DESERT): ChartTokens {
  return readLiveChartTokens({ match: fakeMedia({ [FORCED_COLOURS_QUERY]: true }).match, style: NO_STYLE, keywords: () => [
    `rgb(${hexToRgb(system.canvas)})`, `rgb(${hexToRgb(system.canvasText)})`, `rgb(${hexToRgb(system.highlight)})`,
    `rgb(${hexToRgb(system.grayText)})`, `rgb(${hexToRgb(system.linkText)})`,
  ] })
}

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`
}

/** The dash patterns in `list` that repeat an earlier one or a structural dash (grid, fence, day divider). */
function clashingDashes(list: readonly (readonly number[])[]): string[] {
  const reserved = [CHART_GEOMETRY.gridDash, CHART_GEOMETRY.fenceDash, CHART_GEOMETRY.dayDash].map((d) => d.join(','))
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of list) {
    const key = d.join(',')
    if (seen.has(key) || reserved.includes(key)) out.push(key)
    seen.add(key)
  }
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readChartContrast', () => {
  it('is the default (undefined) with no matchMedia and when nothing matches', () => {
    expect(readChartContrast(null)).toBeUndefined()
    expect(readChartContrast(fakeMedia().match)).toBeUndefined()
  })

  it('reads forced colours, and lets them win over prefers-contrast more', () => {
    expect(readChartContrast(fakeMedia({ [FORCED_COLOURS_QUERY]: true }).match)).toBe('forced')
    expect(readChartContrast(fakeMedia({ [MORE_CONTRAST_QUERY]: true }).match)).toBe('more')
    expect(readChartContrast(fakeMedia({ [FORCED_COLOURS_QUERY]: true, [MORE_CONTRAST_QUERY]: true }).match)).toBe('forced')
  })

  it('treats a matcher that throws as the default', () => {
    expect(readChartContrast(() => { throw new Error('bad query') })).toBeUndefined()
  })
})

describe('system colours through the probe', () => {
  it('turns computed colours into upper-case hex, refusing keywords and transparent values', () => {
    expect(computedToHex('rgb(26, 235, 255)')).toBe('#1AEBFF')
    expect(computedToHex('rgba(0, 0, 0, 1)')).toBe('#000000')
    expect(computedToHex('rgb(255 250 239 / 100%)')).toBe('#FFFAEF')
    expect(computedToHex(' #fff ')).toBe('#FFFFFF')
    expect(computedToHex('rgba(0, 0, 0, 0)')).toBeNull()
    expect(computedToHex('canvastext')).toBeNull()
    expect(computedToHex('')).toBeNull()
  })

  it('maps the five keywords in order and falls back one colour at a time', () => {
    const read = vi.fn(() => ['rgb(255, 250, 239)', 'CanvasText', '', 'rgb(103, 103, 103)', 'rgb(28, 94, 117)'])
    const s = readSystemColours(read)
    expect(read).toHaveBeenCalledWith(['Canvas', 'CanvasText', 'Highlight', 'GrayText', 'LinkText'])
    expect(s).toEqual({
      canvas: '#FFFAEF',
      canvasText: SYSTEM_COLOUR_FALLBACK.canvasText,
      highlight: SYSTEM_COLOUR_FALLBACK.highlight,
      grayText: '#676767',
      linkText: '#1C5E75',
    })
  })

  it('uses the whole fallback when the reader throws', () => {
    expect(readSystemColours(() => { throw new Error('no DOM') })).toEqual(SYSTEM_COLOUR_FALLBACK)
  })

  it('reads each keyword from a hidden probe that opts out of forced colours, then removes it', () => {
    const seen: { colour: string; adjust: string; visibility: string; hidden: string | null }[] = []
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const probe = el as HTMLElement
      seen.push({
        colour: probe.style.color,
        adjust: probe.style.getPropertyValue('forced-color-adjust'),
        visibility: probe.style.visibility,
        hidden: probe.getAttribute('aria-hidden'),
      })
      return { color: 'rgb(1, 2, 3)' } as CSSStyleDeclaration
    })
    const before = document.body.childElementCount
    const out = probeKeywords(['Canvas', 'Highlight'])
    expect(document.body.childElementCount).toBe(before)
    // jsdom may not know the system colour keywords; when it refuses one the probe reports '' (fallback).
    expect(out.every((v) => v === 'rgb(1, 2, 3)' || v === '')).toBe(true)
    for (const s of seen) expect(s).toMatchObject({ visibility: 'hidden', hidden: 'true' })
  })
})

describe('forced colours', () => {
  it('draws every chart colour with one of the five system colours, keeping the font', () => {
    const t = forced()
    const system = new Set(Object.values(DESERT))
    expect(t.contrast).toBe('forced')
    for (const [key, value] of Object.entries(t.color)) expect(system.has(value), key).toBe(true)
    expect(t.color.bg).toBe(DESERT.canvas)
    expect(t.color.chartAxis).toBe(DESERT.canvasText)
    expect(t.color.chartS1).toBe(DESERT.canvasText)
    expect(t.color.chartGrid).toBe(DESERT.grayText)
    expect(t.font).toEqual(DEFAULT_CHART_TOKENS.font)
  })

  it('keeps the lead series and the axis readable on the canvas (WCAG 1.4.11)', () => {
    const t = forced()
    expect(contrastRatio(t.color.chartS1, t.color.bg)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(t.color.chartAxis, t.color.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to a black contrast theme when the probe resolves nothing', () => {
    const t = readLiveChartTokens({ match: fakeMedia({ [FORCED_COLOURS_QUERY]: true }).match, style: NO_STYLE, keywords: () => [] })
    expect(t.color.bg).toBe(SYSTEM_COLOUR_FALLBACK.canvas)
    expect(t.color.text).toBe(SYSTEM_COLOUR_FALLBACK.canvasText)
  })

  it('gives every series position a distinct dash, none equal to a grid, fence or divider dash', () => {
    expect(FORCED_DASHES).toHaveLength(8)
    expect(FORCED_DASHES[0]).toEqual([])
    expect(clashingDashes(FORCED_DASHES)).toEqual([])
  })

  it('born failing: the dash check flags a repeated dash and a fence-like one', () => {
    expect(clashingDashes([[], [10, 4], [10, 4], [...CHART_GEOMETRY.fenceDash]])).toEqual(['10,4', '4,3'])
  })

  it('hands out dashes only under forced colours', () => {
    expect(forcedDash(DEFAULT_CHART_TOKENS, 3)).toBeUndefined()
    expect(forcedDash(moreContrastTokens(DEFAULT_CHART_TOKENS), 3)).toBeUndefined()
    expect(forcedDash(forced(), 3)).toEqual([10, 3, 2, 3])
    expect(forcedDash(forced(), 9)).toEqual([10, 4])
  })

  it('maps from any base palette (a CVD theme changes nothing under forced colours)', () => {
    const deut = readChartTokens({ getPropertyValue: (n) => (n === '--c-up' ? '#3399FF' : '') })
    expect(forcedChartTokens(DESERT, deut).color).toEqual(forced().color)
  })
})

describe('prefers-contrast more', () => {
  const more = () => readLiveChartTokens({ match: fakeMedia({ [MORE_CONTRAST_QUERY]: true }).match, style: NO_STYLE })

  it('born failing: the default gridline is below text contrast on black', () => {
    expect(contrastRatio(DEFAULT_CHART_TOKENS.color.chartGrid, DEFAULT_CHART_TOKENS.color.bg)).toBeLessThan(4.5)
  })

  it('strengthens gridlines, zero lines and dividers to 4.5:1 and separators to 3:1', () => {
    const t = more()
    const c = t.color
    expect(t.contrast).toBe('more')
    expect(contrastRatio(c.chartGrid, c.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(c.zeroLine, c.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(c.chartYearDiv, c.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(c.chartSplitInner, c.bg)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(c.chartSplitOuter, c.bg)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(c.chartAxis, c.bg)).toBeGreaterThanOrEqual(contrastRatio(DEFAULT_CHART_TOKENS.color.chartAxis, c.bg))
  })

  it('takes every new value from the theme palette and leaves the data colours alone', () => {
    const t = more()
    const palette = new Set(Object.values(DEFAULT_CHART_TOKENS.color))
    for (const v of Object.values(t.color)) expect(palette.has(v)).toBe(true)
    const changed = Object.keys(t.color).filter((k) => t.color[k as keyof typeof t.color] !== DEFAULT_CHART_TOKENS.color[k as keyof typeof t.color])
    expect(changed.sort()).toEqual(['chartGrid', 'chartSplitInner', 'chartSplitOuter'])
  })
})

describe('the default look is unchanged', () => {
  it('returns exactly the default palette, with no contrast mark, when no query matches', () => {
    const t = readLiveChartTokens({ match: fakeMedia().match, style: NO_STYLE })
    expect(t).toEqual(DEFAULT_CHART_TOKENS)
    expect('contrast' in t).toBe(false)
  })

  it('returns the page tokens (CVD themes included) with no matchMedia at all', () => {
    const style = { getPropertyValue: (n: string) => (n === '--c-up' ? '#3399FF' : '') }
    expect(readLiveChartTokens({ match: null, style })).toEqual(readChartTokens(style))
  })
})

describe('subscribeChartContrast', () => {
  it('reports a change of forced colours, prefers-contrast and the colour scheme, until unsubscribed', () => {
    const media = fakeMedia()
    const onChange = vi.fn()
    const off = subscribeChartContrast(onChange, media.match)
    expect(media.listeners()).toBe(3)
    media.set(FORCED_COLOURS_QUERY, true)
    media.set(MORE_CONTRAST_QUERY, true)
    media.set(COLOUR_SCHEME_QUERY, false)
    expect(onChange).toHaveBeenCalledTimes(3)
    off()
    expect(media.listeners()).toBe(0)
    media.set(FORCED_COLOURS_QUERY, false)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('uses the older addListener pair when addEventListener is missing', () => {
    const added: (() => void)[] = []
    const removed: (() => void)[] = []
    const list: ContrastMediaList = { matches: false, addListener: (l) => added.push(l), removeListener: (l) => removed.push(l) }
    const onChange = vi.fn()
    const off = subscribeChartContrast(onChange, () => list)
    added[0]!()
    expect(onChange).toHaveBeenCalledTimes(1)
    off()
    expect(removed).toHaveLength(3)
  })

  describe('a switch between two contrast themes of the same scheme', () => {
    // Desert and another light theme: no media query changes, only the system colours do.
    const readers = () => {
      let canvas = 'rgb(255, 250, 239)'
      const read = (keywords: readonly string[]) => keywords.map((k) => (k === 'Canvas' ? canvas : 'rgb(61, 61, 61)'))
      return { read, setCanvas: (v: string) => void (canvas = v) }
    }

    it('reports a change of the probed system colours on window focus while forced colours are active', () => {
      const media = fakeMedia({ [FORCED_COLOURS_QUERY]: true })
      const colours = readers()
      const onChange = vi.fn()
      const off = subscribeChartContrast(onChange, media.match, colours.read)
      window.dispatchEvent(new Event('focus'))
      expect(onChange).not.toHaveBeenCalled()
      colours.setCanvas('rgb(0, 0, 0)')
      window.dispatchEvent(new Event('focus'))
      expect(onChange).toHaveBeenCalledTimes(1)
      window.dispatchEvent(new Event('focus'))
      expect(onChange).toHaveBeenCalledTimes(1)
      off()
    })

    it('reports it when the hidden watcher element starts or ends a colour transition', () => {
      const media = fakeMedia({ [FORCED_COLOURS_QUERY]: true })
      const colours = readers()
      const onChange = vi.fn()
      const off = subscribeChartContrast(onChange, media.match, colours.read)
      const watcher = document.querySelector('[data-chart-contrast-watch]')
      expect(watcher).not.toBeNull()
      colours.setCanvas('rgb(0, 0, 0)')
      watcher!.dispatchEvent(new Event('transitionrun'))
      expect(onChange).toHaveBeenCalledTimes(1)
      colours.setCanvas('rgb(0, 0, 128)')
      watcher!.dispatchEvent(new Event('transitionend'))
      expect(onChange).toHaveBeenCalledTimes(2)
      off()
    })

    it('reports it when the page becomes visible again', () => {
      const media = fakeMedia({ [FORCED_COLOURS_QUERY]: true })
      const colours = readers()
      const onChange = vi.fn()
      const off = subscribeChartContrast(onChange, media.match, colours.read)
      colours.setCanvas('rgb(0, 0, 0)')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(onChange).toHaveBeenCalledTimes(1)
      off()
    })

    it('ignores system colour changes outside forced colours (the default look is not rebuilt)', () => {
      const media = fakeMedia()
      const colours = readers()
      const onChange = vi.fn()
      const off = subscribeChartContrast(onChange, media.match, colours.read)
      colours.setCanvas('rgb(0, 0, 0)')
      window.dispatchEvent(new Event('focus'))
      expect(onChange).not.toHaveBeenCalled()
      off()
    })

    it('removes the watcher element and its listeners when unsubscribed', () => {
      const media = fakeMedia({ [FORCED_COLOURS_QUERY]: true })
      const colours = readers()
      const onChange = vi.fn()
      const off = subscribeChartContrast(onChange, media.match, colours.read)
      off()
      expect(document.querySelector('[data-chart-contrast-watch]')).toBeNull()
      colours.setCanvas('rgb(0, 0, 0)')
      window.dispatchEvent(new Event('focus'))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  it('subscribes to nothing without matchMedia, and skips a query the engine refuses', () => {
    expect(() => subscribeChartContrast(vi.fn(), null)()).not.toThrow()
    const onChange = vi.fn()
    const media = fakeMedia()
    const off = subscribeChartContrast(onChange, (q) => {
      if (q === COLOUR_SCHEME_QUERY) throw new Error('unknown query')
      return media.match(q)
    })
    expect(media.listeners()).toBe(2)
    off()
  })
})
