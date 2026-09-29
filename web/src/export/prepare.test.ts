// @vitest-environment jsdom
// prepareExport: what a dossier is made from (roadmap 15 part 2, shared by the evidence pack and the print
// dossier). The panel hands over a closure of the answers it already holds; the charts on screen become
// PNG data URLs, each kept only when it matches PNG_DATA_URL. Nothing is fetched or computed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAME_STRIP, STATUS_BAR } from '../copy/chrome'
import { DOSSIER } from '../copy/dossier'
import { GRAB } from '../copy/grab'
import { registerPanelSource, resetPanelSources } from '../chrome/panelSources'
import { VOLMANAGED } from '../screens/des/desTestData'
import { HYP_ANALYTICS } from '../screens/tear/tearP1.fixtures'
import type { DossierInput } from './dossier/types'
import { PNG_DATA_URL, prepareExport, type ExportJob } from './prepare'

const NOW = new Date('2026-09-28T18:02:11Z')
const HEALTH = { now_utc: '2026-09-28T17:59:30Z', fixture_mode: false }

// A 1 x 1 png, so the data URLs below are real ones.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const TEAR_INPUT: DossierInput = {
  kind: 'tear',
  target: { kind: 'hypothesis', name: 'volmanaged_v0' },
  tab: 'EQ',
  analytics: HYP_ANALYTICS,
  card: VOLMANAGED.card,
}

interface FigureSpec {
  readonly summary: string
  readonly width?: number
  readonly height?: number
  readonly svgOnly?: boolean
}

function place(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
}

/** A panel as PanelChrome renders it, with chart figures as ChartA11y renders them. */
function mountPanel(figures: readonly FigureSpec[], opts: { id?: string; title?: string | null } = {}): HTMLElement {
  const panel = document.createElement('section')
  panel.setAttribute('data-nqt-panel', opts.id ?? 'p1')
  if (opts.title !== null) panel.setAttribute('data-nqt-title', opts.title ?? 'volmanaged_v0 EQ')
  for (const spec of figures) {
    const width = spec.width ?? 700
    const height = spec.height ?? 300
    const figure = document.createElement('div')
    figure.className = 'chart-a11y-figure'
    figure.setAttribute('role', 'img')
    figure.setAttribute('aria-label', spec.summary)
    place(figure, 0, 0, width, height)
    if (spec.svgOnly) {
      figure.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    } else {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      place(canvas, 0, 0, width, height)
      figure.append(canvas)
    }
    panel.append(figure)
  }
  document.body.append(panel)
  return panel
}

/** jsdom draws no canvas: a context that accepts the drawing, and a toDataURL that answers from a queue. */
function stubCanvas(answers: readonly (string | Error)[] = []): { calls: () => number } {
  const queue = [...answers]
  let calls = 0
  const ctx = { fillStyle: '', scale: () => {}, fillRect: () => {}, drawImage: () => {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
    calls += 1
    const next = queue.length > 0 ? queue.shift()! : PIXEL
    if (next instanceof Error) throw next
    return next
  })
  return { calls: () => calls }
}

function registerTear(id = 'p1', input: DossierInput | null = TEAR_INPUT): void {
  registerPanelSource(id, { provenance: null, dossier: () => input })
}

function job(result: ReturnType<typeof prepareExport>): ExportJob {
  if ('message' in result) throw new Error(`expected a job, got the message: ${result.message}`)
  return result
}

function message(result: ReturnType<typeof prepareExport>): string {
  if (!('message' in result)) throw new Error('expected a message, got a job')
  return result.message
}

const prepare = (over: { panelId?: string; health?: typeof HEALTH | null; now?: Date } = {}) =>
  prepareExport({ panelId: 'p1', health: HEALTH, now: NOW, ...over })

beforeEach(() => {
  stubCanvas()
})

afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.demo
  resetPanelSources()
  vi.restoreAllMocks()
})

describe('PNG_DATA_URL', () => {
  it('accepts a base64 png data address', () => {
    expect(PNG_DATA_URL.test(PIXEL)).toBe(true)
    expect(PNG_DATA_URL.test('data:image/png;base64,AAAA+/==')).toBe(true)
  })

  it.each([
    'data:image/svg+xml;base64,AAAA',
    'data:image/jpeg;base64,AAAA',
    'data:image/png;base64,',
    'data:image/png;base64,AAAA"',
    'data:image/png;base64,AAAA\n',
    'data:image/png;base64,AA AA',
    'data:image/png,AAAA',
    'javascript:alert(1)',
    'https://example.test/a.png',
    ' data:image/png;base64,AAAA',
    'DATA:image/png;base64,AAAA',
    '',
  ])('rejects %j', (value) => {
    expect(PNG_DATA_URL.test(value)).toBe(false)
  })

  it('is not a global or sticky expression, so test() does not carry state between calls', () => {
    expect(PNG_DATA_URL.global).toBe(false)
    expect(PNG_DATA_URL.sticky).toBe(false)
    expect(PNG_DATA_URL.test(PIXEL)).toBe(true)
    expect(PNG_DATA_URL.test(PIXEL)).toBe(true)
  })
})

describe('prepareExport: what it needs', () => {
  it('says the pack is made from DES and the tear sheet when the panel registered no dossier', () => {
    mountPanel([{ summary: 'Equity' }])
    expect(message(prepare())).toBe(DOSSIER.unavailable)
  })

  it('says the same when the panel registered only a provenance', () => {
    mountPanel([{ summary: 'Equity' }])
    registerPanelSource('p1', { provenance: { tags: [], basis: null, unit: null, window: null, n: null, source: null, specSha: null } })
    expect(message(prepare())).toBe(DOSSIER.unavailable)
  })

  it('says the same when the closure holds nothing right now', () => {
    mountPanel([{ summary: 'Equity' }])
    registerTear('p1', null)
    expect(message(prepare())).toBe(DOSSIER.unavailable)
  })

  it('says there is no panel when the panel is not on the page', () => {
    registerTear()
    expect(message(prepare())).toBe(GRAB.noPanel)
  })

  it('makes no request and reads no other panel', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mountPanel([{ summary: 'Equity' }], { id: 'p2' })
    registerTear('p1')
    prepare()
    prepare({ panelId: 'p2' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lets an error from the closure through, for the runner to report', () => {
    mountPanel([])
    registerPanelSource('p1', { provenance: null, dossier: () => { throw new Error('bad answer') } })
    expect(() => prepare()).toThrow('bad answer')
  })
})

describe('prepareExport: the dossier', () => {
  it('builds the dossier of what the panel holds', () => {
    mountPanel([{ summary: 'Equity' }])
    registerTear()
    const made = job(prepare())
    expect(made.dossier.title).toBe('volmanaged_v0: tear sheet dossier')
    expect(made.dossier.story.map((s) => s.id)).toEqual(['kpis', 'interval'])
  })

  it('builds a DES dossier from a DES input', () => {
    mountPanel([])
    registerTear('p1', { kind: 'des', detail: VOLMANAGED, analytics: null })
    expect(job(prepare()).dossier.title).toBe('volmanaged_v0: hypothesis dossier')
  })

  it('makes the dossier under the moment given, and the browser clock when none is given', () => {
    mountPanel([])
    registerTear()
    const given = job(prepare({ now: NOW })).dossier.footer.join('\n')
    expect(given).toContain('14:02:11')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T19:30:00Z'))
    try {
      const clock = job(prepareExport({ panelId: 'p1', health: null })).dossier.footer.join('\n')
      expect(clock).toContain('15:30:00')
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks DEMO DATA in the flags and the footer when the page is the demo (data-demo on)', () => {
    mountPanel([])
    registerTear()
    document.documentElement.dataset.demo = 'on'
    const demo = job(prepare()).dossier
    expect(demo.flags).toContain(FRAME_STRIP.demoData)
    expect(demo.footer).toContain(DOSSIER.demoNote)
  })

  it('does not mark DEMO DATA when data-demo is absent or not on', () => {
    mountPanel([])
    registerTear()
    expect(job(prepare()).dossier.flags).not.toContain(FRAME_STRIP.demoData)
    document.documentElement.dataset.demo = 'off'
    const off = job(prepare()).dossier
    expect(off.flags).not.toContain(FRAME_STRIP.demoData)
    expect(off.footer).not.toContain(DOSSIER.demoNote)
  })

  it('marks FIXTURE DATA when the health answer says the backend serves fixtures, and not otherwise', () => {
    mountPanel([])
    registerTear()
    expect(job(prepare({ health: { ...HEALTH, fixture_mode: true } })).dossier.flags).toContain(STATUS_BAR.fixture)
    expect(job(prepare({ health: HEALTH })).dossier.flags).not.toContain(STATUS_BAR.fixture)
    expect(job(prepare({ health: null })).dossier.flags).not.toContain(STATUS_BAR.fixture)
  })

  it('states the server clock of the last health answer, and leaves it out without one', () => {
    mountPanel([])
    registerTear()
    expect(job(prepare({ health: HEALTH })).dossier.footer.join('\n')).toContain('13:59:30')
    expect(job(prepare({ health: null })).dossier.footer.join('\n')).not.toContain('13:59:30')
  })
})

describe('prepareExport: the file stem', () => {
  it('is the panel title, cleaned as file names are', () => {
    mountPanel([], { title: 'volmanaged_v0 EQ' })
    registerTear()
    expect(job(prepare()).fileStem).toBe('volmanaged_v0_EQ')
  })

  it('cleans characters a file name cannot hold, and the edges', () => {
    mountPanel([], { title: '  ../a/b: c*d?  ' })
    registerTear()
    expect(job(prepare()).fileStem).toBe('a_b_c_d')
  })

  it('is panel when the title is missing or empty', () => {
    mountPanel([], { title: null })
    registerTear()
    expect(job(prepare()).fileStem).toBe('panel')
    document.body.replaceChildren()
    mountPanel([], { title: '   ' })
    expect(job(prepare()).fileStem).toBe('panel')
  })

  it('carries no time stamp and no extension of its own', () => {
    mountPanel([])
    registerTear()
    const { fileStem } = job(prepare())
    expect(fileStem).not.toMatch(/\d{8}-\d{6}Z/)
    expect(fileStem).not.toMatch(/\.png$/)
  })
})

describe('prepareExport: the charts', () => {
  it('turns each canvas figure into a png data address with its summary and size', () => {
    mountPanel([{ summary: 'Equity curve', width: 640, height: 320 }, { summary: 'Drawdown', width: 500, height: 200 }])
    registerTear()
    const made = job(prepare())
    expect(made.figures).toEqual([
      { dataUrl: PIXEL, summary: 'Equity curve', width: 640, height: 320 },
      { dataUrl: PIXEL, summary: 'Drawdown', width: 500, height: 200 },
    ])
    expect(made.skipped).toBe(0)
  })

  it('asks the canvas for a png', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PIXEL)
    mountPanel([{ summary: 'Equity' }])
    registerTear()
    prepare()
    expect(spy).toHaveBeenCalledWith('image/png')
  })

  it('keeps only addresses that match PNG_DATA_URL, and counts the rest as left out', () => {
    stubCanvas([
      'data:image/svg+xml;base64,PHN2Zz4=',
      PIXEL,
      `${PIXEL}" onerror="alert(1)`,
      'javascript:alert(1)',
      'data:,',
    ])
    mountPanel([{ summary: 'a' }, { summary: 'b' }, { summary: 'c' }, { summary: 'd' }, { summary: 'e' }])
    registerTear()
    const made = job(prepare())
    expect(made.figures.map((f) => f.summary)).toEqual(['b'])
    expect(made.figures.every((f) => PNG_DATA_URL.test(f.dataUrl))).toBe(true)
    expect(made.skipped).toBe(4)
  })

  it('counts a canvas the browser will not export (a tainted canvas throws) as left out', () => {
    stubCanvas([new Error('The canvas has been tainted'), PIXEL])
    mountPanel([{ summary: 'a' }, { summary: 'b' }])
    registerTear()
    const made = job(prepare())
    expect(made.figures.map((f) => f.summary)).toEqual(['b'])
    expect(made.skipped).toBe(1)
  })

  it('counts a canvas that has no drawing surface as left out', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    mountPanel([{ summary: 'a' }])
    registerTear()
    const made = job(prepare())
    expect(made.figures).toEqual([])
    expect(made.skipped).toBe(1)
  })

  it('adds the figures drawn without a canvas (svg) to the ones left out', () => {
    mountPanel([{ summary: 'canvas' }, { summary: 'vector', svgOnly: true }])
    registerTear()
    const made = job(prepare())
    expect(made.figures.map((f) => f.summary)).toEqual(['canvas'])
    expect(made.skipped).toBe(1)
  })

  it('still makes a job for a panel with no chart: the dossier is text', () => {
    mountPanel([])
    registerTear()
    const made = job(prepare())
    expect(made.figures).toEqual([])
    expect(made.skipped).toBe(0)
    expect(made.dossier.title).toBe('volmanaged_v0: tear sheet dossier')
  })

  it('reads only the charts of its own panel', () => {
    mountPanel([{ summary: 'mine' }], { id: 'p1' })
    mountPanel([{ summary: 'theirs' }], { id: 'p2' })
    registerTear('p1')
    expect(job(prepare()).figures.map((f) => f.summary)).toEqual(['mine'])
  })

  it('draws at the device pixel ratio', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
    try {
      mountPanel([{ summary: 'a', width: 300, height: 100 }])
      registerTear()
      prepare()
      const canvases = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.contexts as HTMLCanvasElement[]
      const made = canvases.find((c) => c.width === 600)
      expect(made?.height).toBe(200)
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
    }
  })
})
