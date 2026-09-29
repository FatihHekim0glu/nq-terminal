// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAME_STRIP, STATUS_BAR } from '../../copy/chrome'
import { GRAB } from '../../copy/grab'
import { fillCopy } from '../../copy/workspace'
import { captureDownloads, type DownloadCapture } from '../../chrome/download.testUtil'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { registerPanelSource, resetPanelSources } from '../../chrome/panelSources'
import type { GrabProvenance } from './grabModel'
import { grabPanel, type GrabRequest, type HealthLite } from './run'

const NOW = new Date('2026-09-28T18:02:11Z') // 14:02:11 in New York
const HEALTH: HealthLite = { now_utc: '2026-09-28T17:59:30Z', fixture_mode: false }
const FILE = 'volmanaged_v0_EQ_20260928-180211Z.png'

const PROVENANCE: GrabProvenance = {
  tags: ['[POST HOC]'],
  basis: 'Basis net: after costs',
  unit: 'ticks',
  window: '2010-01-01..2021-12-31',
  n: 3021,
  source: '/api/analytics?run=nt_x',
  specSha: '0123456789abcdef0123456789abcdef',
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

function request(over: Partial<GrabRequest> = {}): GrabRequest {
  return { panelId: 'p1', code: 'EQ', number: 1, group: 'A', health: HEALTH, target: 'file', now: NOW, ...over }
}

const message = () => useMessage.getState()

let drawn: { texts: string[]; canvases: HTMLCanvasElement[] }
let capture: DownloadCapture

/** What the page needs to draw: jsdom has no canvas, so a context that records the text it is given. */
function stubCanvas(): void {
  drawn = { texts: [], canvases: [] }
  const ctx = {
    fillStyle: '',
    font: '',
    textBaseline: '',
    measureText: (text: string) => ({ width: text.length * 5 }),
    scale: () => {},
    fillRect: () => {},
    drawImage: () => {},
    fillText: (text: string) => {
      drawn.texts.push(text)
    },
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    drawn.canvases.push(this)
    return ctx as never
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback, type?: string) {
    callback(new Blob(['png-bytes'], { type }))
  })
}

function setRatio(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
}

beforeEach(() => {
  stubCanvas()
  capture = captureDownloads()
  setRatio(1)
})

afterEach(() => {
  capture.restore()
  document.body.replaceChildren()
  delete document.documentElement.dataset.demo
  resetPanelSources()
  resetMessage()
  delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('grabPanel to a file', () => {
  it('saves one png named for the panel and the UTC time, and says so on the message line', async () => {
    mountPanel([{ summary: 'Equity: 3 points' }])
    expect(await grabPanel(request())).toBe(true)
    expect(capture.files.map((f) => f.name)).toEqual([FILE])
    expect(capture.files[0]?.blob.type).toBe('image/png')
    expect(capture.files[0]?.blob.size).toBeGreaterThan(0)
    expect(message().text).toBe(fillCopy(GRAB.savedOne, { file: FILE }))
    expect(message().tone).toBe('info')
  })

  it('counts the charts in the message when there are several', async () => {
    mountPanel([{ summary: 'one' }, { summary: 'two' }, { summary: 'three' }])
    expect(await grabPanel(request())).toBe(true)
    expect(message().text).toBe(fillCopy(GRAB.saved, { n: 3, file: FILE }))
  })

  it('names the file after the mnemonic when the panel has no title', async () => {
    mountPanel([{ summary: 'one' }], { title: null })
    await grabPanel(request())
    expect(capture.files.map((f) => f.name)).toEqual(['EQ_20260928-180211Z.png'])
  })

  it('uses the current time when none is given', async () => {
    mountPanel([{ summary: 'one' }])
    await grabPanel(request({ now: undefined }))
    expect(capture.files[0]?.name).toMatch(/^volmanaged_v0_EQ_\d{8}-\d{6}Z\.png$/)
  })

  it('says the browser cannot save when it refuses object URLs, and reports false', async () => {
    mountPanel([{ summary: 'one' }])
    Object.assign(URL, { createObjectURL: undefined })
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(GRAB.unavailable)
    expect(message().tone).toBe('error')
  })

  it('appends a note for each figure drawn without a canvas', async () => {
    mountPanel([{ summary: 'one' }, { summary: 'svg', svgOnly: true }])
    await grabPanel(request())
    expect(message().text).toBe(`${fillCopy(GRAB.savedOne, { file: FILE })} ${GRAB.skippedOne}`)
    resetMessage()
    document.body.replaceChildren()
    mountPanel([{ summary: 'one' }, { summary: 'a', svgOnly: true }, { summary: 'b', svgOnly: true }])
    await grabPanel(request())
    expect(message().text).toBe(`${fillCopy(GRAB.savedOne, { file: FILE })} ${fillCopy(GRAB.skipped, { n: 2 })}`)
  })

  it('appends the trimmed note when charts did not fit in one image', async () => {
    mountPanel([
      { summary: 'a', height: 3000 },
      { summary: 'b', height: 3000 },
      { summary: 'c', height: 3000 },
    ])
    expect(await grabPanel(request())).toBe(true)
    expect(message().text).toBe(`${fillCopy(GRAB.saved, { n: 2, file: FILE })} ${GRAB.trimmed}`)
  })

  it('draws at the device pixel ratio', async () => {
    setRatio(2)
    mountPanel([{ summary: 'one' }])
    await grabPanel(request())
    const made = drawn.canvases.at(-1)
    expect(made?.width).toBe(2 * 716)
  })
})

describe('grabPanel refusals', () => {
  it('says no panel is focused when the panel is not on the page', async () => {
    mountPanel([{ summary: 'one' }])
    expect(await grabPanel(request({ panelId: 'gone' }))).toBe(false)
    expect(message().text).toBe(GRAB.noPanel)
    expect(capture.files).toEqual([])
  })

  it('says the panel draws no chart when it has no figure (a table view is on)', async () => {
    mountPanel([])
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(GRAB.noFigures)
    expect(capture.files).toEqual([])
  })

  it('says the same when every figure is drawn without a canvas', async () => {
    mountPanel([{ summary: 'svg', svgOnly: true }])
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(GRAB.noFigures)
  })
})

describe('grabPanel failures', () => {
  it('reports a browser that gives no drawing surface', async () => {
    mountPanel([{ summary: 'one' }])
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.failed, { detail: GRAB.detail.noSurface }))
    expect(message().tone).toBe('error')
    expect(capture.files).toEqual([])
  })

  it('reports a canvas that yields no image data', async () => {
    mountPanel([{ summary: 'one' }])
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(null))
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.failed, { detail: GRAB.detail.noImage }))
  })

  it('reports the reason when reading the canvas throws (a tainted canvas)', async () => {
    mountPanel([{ summary: 'one' }])
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {
      throw new Error('canvas is tainted')
    })
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.failed, { detail: 'canvas is tainted' }))
    expect(message().tone).toBe('error')
  })

  it('never rejects, whatever throws', async () => {
    mountPanel([{ summary: 'one' }])
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw 'not an error object'
    })
    await expect(grabPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.failed, { detail: GRAB.detail.unknown }))
  })
})

describe('grabPanel to the clipboard', () => {
  function installClipboard(write: (items: unknown[]) => Promise<void>) {
    class FakeItem {
      readonly items: Record<string, Blob | Promise<Blob>>
      constructor(items: Record<string, Blob | Promise<Blob>>) {
        this.items = items
      }
    }
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeItem
    const spy = vi.fn(write)
    Object.defineProperty(navigator, 'clipboard', { value: { write: spy }, configurable: true })
    return spy
  }

  it('writes one png item and says so', async () => {
    mountPanel([{ summary: 'one' }])
    const write = installClipboard(async () => {})
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    const [items] = write.mock.calls[0] as [Array<{ items: Record<string, Blob | Promise<Blob>> }>]
    expect(items).toHaveLength(1)
    expect(Object.keys(items[0]!.items)).toEqual(['image/png'])
    // A promise of the png, so the write can be asked for before the image is encoded.
    expect(await items[0]!.items['image/png']).toBeInstanceOf(Blob)
    expect(message().text).toBe(GRAB.copiedOne)
    expect(capture.files).toEqual([])
  })

  it('counts the charts and appends the notes', async () => {
    mountPanel([{ summary: 'one' }, { summary: 'two' }, { summary: 'svg', svgOnly: true }])
    installClipboard(async () => {})
    await grabPanel(request({ target: 'clipboard' }))
    expect(message().text).toBe(`${fillCopy(GRAB.copied, { n: 2 })} ${GRAB.skippedOne}`)
  })

  it('points to the file save where the browser cannot copy an image, and saves nothing', async () => {
    mountPanel([{ summary: 'one' }])
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(GRAB.clipboardUnavailable)
    expect(capture.files).toEqual([])
  })

  it('points to the file save where the clipboard exists but cannot take an image item', async () => {
    mountPanel([{ summary: 'one' }])
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
    ;(globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {}
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(GRAB.clipboardUnavailable)
  })

  it('asks for the clipboard within the call, before the image is encoded, so the browser still counts the click', async () => {
    // Safari accepts a clipboard write only inside the user's gesture: the write is asked for synchronously, with
    // a promise of the png, and nothing is awaited before it.
    mountPanel([{ summary: 'one' }])
    const write = installClipboard(async () => {})
    const done = grabPanel(request({ target: 'clipboard' }))
    expect(write).toHaveBeenCalledTimes(1)
    expect(await done).toBe(true)
  })

  it('says the browser did not allow the copy when it refuses the write, and points to the file save', async () => {
    // The image was made; saying 'could not be made' would send the user looking for the wrong fault.
    mountPanel([{ summary: 'one' }])
    installClipboard(async () => {
      throw new Error('Document is not focused')
    })
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.clipboardRefused, { detail: 'Document is not focused' }))
    expect(message().text).not.toContain('could not be made')
    expect(message().tone).toBe('error')
  })

  it('reports no image data on the clipboard path as it does for a file, not as a refused copy', async () => {
    mountPanel([{ summary: 'one' }])
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => callback(null))
    const write = installClipboard(async (items) => {
      await (items[0] as { items: Record<string, Promise<Blob>> }).items['image/png']
    })
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(write).toHaveBeenCalledTimes(1)
    expect(message().text).toBe(fillCopy(GRAB.failed, { detail: GRAB.detail.noImage }))
  })

  it('reports the reason when reading the canvas throws on the clipboard path, and never rejects', async () => {
    mountPanel([{ summary: 'one' }])
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {
      throw new Error('The canvas has been tainted')
    })
    installClipboard(async (items) => {
      await (items[0] as { items: Record<string, Promise<Blob>> }).items['image/png']
    })
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.failed, { detail: 'The canvas has been tainted' }))
  })

  it('still says there is no chart before it looks for a clipboard', async () => {
    mountPanel([])
    await grabPanel(request({ target: 'clipboard' }))
    expect(message().text).toBe(GRAB.noFigures)
  })
})

describe('the caption', () => {
  it('carries the panel, the provenance the screen registered, the fence, the source and both times', async () => {
    mountPanel([{ summary: 'Equity: 3 points' }])
    registerPanelSource('p1', { provenance: PROVENANCE })
    await grabPanel(request())
    expect(drawn.texts).toContain('1-EQ [A] | volmanaged_v0 EQ')
    expect(drawn.texts).toContain(
      '[POST HOC] | Basis net: after costs | ticks | 2010-01-01..2021-12-31, n 3021 | spec 0123456789ab',
    )
    const last = drawn.texts.find((t) => t.includes('GET /api/analytics?run=nt_x'))
    expect(last).toContain('as of 13:59:30 ET')
    expect(last).toContain('grabbed 14:02:11 ET')
  })

  it('draws the chart summary above the chart', async () => {
    mountPanel([{ summary: 'Equity: 3 points' }])
    await grabPanel(request())
    expect(drawn.texts).toContain('Equity: 3 points')
  })

  it('writes two caption lines, with no provenance line, for a screen that registered nothing', async () => {
    mountPanel([{ summary: 'one' }])
    await grabPanel(request())
    const caption = drawn.texts.filter((t) => t !== 'one')
    expect(caption).toHaveLength(2)
    expect(caption.join('\n')).not.toMatch(/null|undefined|NaN/)
  })

  it('flags fixture data from the health answer and demo data from the page', async () => {
    mountPanel([{ summary: 'one' }])
    document.documentElement.dataset.demo = 'on'
    await grabPanel(request({ health: { now_utc: HEALTH.now_utc, fixture_mode: true } }))
    const first = drawn.texts.find((t) => t.startsWith('1-EQ'))
    expect(first).toContain(FRAME_STRIP.demoData)
    expect(first).toContain(STATUS_BAR.fixture)
  })

  it('leaves the flags out for a live answer, and copes with no health answer at all', async () => {
    mountPanel([{ summary: 'one' }])
    await grabPanel(request({ health: null }))
    const first = drawn.texts.find((t) => t.startsWith('1-EQ'))
    expect(first).not.toContain(FRAME_STRIP.demoData)
    expect(first).not.toContain(STATUS_BAR.fixture)
    expect(drawn.texts.join('\n')).not.toContain('as of')
  })

  it('writes the mnemonic alone, without a number or group chip, when the panel has neither', async () => {
    mountPanel([{ summary: 'one' }])
    await grabPanel(request({ number: null, group: '-' }))
    expect(drawn.texts).toContain('EQ | volmanaged_v0 EQ')
  })

  it('uses the source of the panel that was grabbed, not another panel', async () => {
    mountPanel([{ summary: 'one' }])
    registerPanelSource('other', { provenance: PROVENANCE })
    await grabPanel(request())
    expect(drawn.texts.join('\n')).not.toContain('spec ')
  })
})

describe('no request', () => {
  it('sends nothing anywhere for any target or outcome', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'))
    const beacon = vi.fn()
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    mountPanel([{ summary: 'one' }])
    registerPanelSource('p1', { provenance: PROVENANCE })
    await grabPanel(request())
    await grabPanel(request({ target: 'clipboard' }))
    await grabPanel(request({ panelId: 'gone' }))
    document.body.replaceChildren()
    mountPanel([])
    await grabPanel(request())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(beacon).not.toHaveBeenCalled()
  })
})
