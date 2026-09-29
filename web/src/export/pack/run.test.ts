// @vitest-environment jsdom
// packPanel: the evidence pack saved as one HTML file (roadmap 15 part 2). It makes the dossier from what the
// panel already holds, lays it out with the print palette, saves it through saveText and says so on the
// message line. It makes no request of any kind and never rejects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAB } from '../../copy/grab'
import { DOSSIER } from '../../copy/dossier'
import { fillCopy } from '../../copy/workspace'
import { captureDownloads, type DownloadCapture } from '../../chrome/download.testUtil'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { registerPanelSource, resetPanelSources } from '../../chrome/panelSources'
import { readRawTokens } from '../../theme/contrast'
import tokensCss from '../../theme/tokens.css?raw'
import { VOLMANAGED } from '../../screens/des/desTestData'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import type { DossierInput } from '../dossier/types'
import type { HealthLite } from '../grab/run'
import { packPanel, type PackRequest } from './run'

const NOW = new Date('2026-09-28T18:02:11Z')
const HEALTH: HealthLite = { now_utc: '2026-09-28T17:59:30Z', fixture_mode: false }
const FILE = 'volmanaged_v0_EQ_pack_20260928-180211Z.html'

// A 1 x 1 png, so the data URLs below are real ones.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const TEAR_INPUT: DossierInput = {
  kind: 'tear',
  target: { kind: 'hypothesis', name: 'volmanaged_v0' },
  tab: 'EQ',
  analytics: HYP_ANALYTICS,
  card: VOLMANAGED.card,
}

function place(el: Element, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
}

/** A panel as PanelChrome renders it, with chart figures as ChartA11y renders them. */
function mountPanel(figures: number, opts: { id?: string; title?: string } = {}): void {
  const panel = document.createElement('section')
  panel.setAttribute('data-nqt-panel', opts.id ?? 'p1')
  panel.setAttribute('data-nqt-title', opts.title ?? 'volmanaged_v0 EQ')
  for (let i = 0; i < figures; i += 1) {
    const figure = document.createElement('div')
    figure.className = 'chart-a11y-figure'
    figure.setAttribute('role', 'img')
    figure.setAttribute('aria-label', `Chart ${i + 1}`)
    place(figure, 700, 300)
    const canvas = document.createElement('canvas')
    canvas.width = 700
    canvas.height = 300
    place(canvas, 700, 300)
    figure.append(canvas)
    panel.append(figure)
  }
  document.body.append(panel)
}

function request(over: Partial<PackRequest> = {}): PackRequest {
  return { panelId: 'p1', health: HEALTH, now: NOW, ...over }
}

const message = () => useMessage.getState()
let capture: DownloadCapture

/** The print tokens on the page, as the stylesheet would give them (jsdom loads no stylesheet). */
function setPrintTokens(over: Readonly<Record<string, string>> = {}): void {
  const raw = readRawTokens(tokensCss)
  const style = document.documentElement.style
  for (const name of ['print-bg', 'print-fg', 'print-muted', 'print-rule', 'print-label', 'font-sans', 'font-mono']) {
    style.setProperty(`--${name}`, over[name] ?? raw[name] ?? '')
  }
}

function stubCanvas(): void {
  const ctx = { fillStyle: '', scale: () => {}, fillRect: () => {}, drawImage: () => {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => PIXEL)
}

beforeEach(() => {
  stubCanvas()
  capture = captureDownloads()
  setPrintTokens()
  registerPanelSource('p1', { provenance: null, dossier: () => TEAR_INPUT })
})

afterEach(() => {
  capture.restore()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.demo
  resetPanelSources()
  resetMessage()
  vi.restoreAllMocks()
})

describe('packPanel: the file', () => {
  it('saves one html file named for the panel and the UTC time, and says so on the message line', async () => {
    mountPanel(2)
    await expect(packPanel(request())).resolves.toBe(true)
    expect(capture.files.map((f) => f.name)).toEqual([FILE])
    expect(message().text).toBe(fillCopy(DOSSIER.packSaved, { file: FILE, n: 2 }))
    expect(message().tone).toBe('info')
  })

  it.each([
    [0, fillCopy(DOSSIER.packSavedNone, { file: FILE }), 'with no charts'],
    [1, fillCopy(DOSSIER.packSavedOne, { file: FILE }), 'with 1 chart,'],
    [2, `Saved the evidence pack as ${FILE} with 2 charts, built from the answers already on screen.`, 'with 2 charts'],
    [3, fillCopy(DOSSIER.packSaved, { file: FILE, n: 3 }), 'with 3 charts'],
  ])('says the number of charts right for %i of them, never "with 1 charts" or "with 0 charts"', async (figures, text, words) => {
    mountPanel(figures)
    await expect(packPanel(request())).resolves.toBe(true)
    expect(message().text).toBe(text)
    expect(message().text).toContain(words)
    expect(message().text).not.toMatch(/\b[01] charts\b/)
  })

  it('saves the file as utf-8 html', async () => {
    mountPanel(1)
    await packPanel(request())
    expect(capture.files[0]?.blob.type).toBe('text/html;charset=utf-8')
  })

  it('names the file with the panel stem, the word pack and the UTC time to the second', async () => {
    mountPanel(0, { title: 'nt_run 1 RET' })
    await packPanel(request({ now: new Date('2026-01-02T03:04:05Z') }))
    expect(capture.files.map((f) => f.name)).toEqual(['nt_run_1_RET_pack_20260102-030405Z.html'])
  })

  it('writes the evidence pack: the dossier, the charts and the print palette, and nothing that loads', async () => {
    mountPanel(2)
    await packPanel(request())
    const html = await capture.text(FILE)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(doc.title).toBe('volmanaged_v0: tear sheet dossier')
    expect(doc.querySelectorAll('img')).toHaveLength(2)
    expect(doc.scripts).toHaveLength(0)
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).toContain(readRawTokens(tokensCss)['print-label']!)
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    )
  })

  it('saves the pack when the browser reports the print colours as a minified stylesheet gives them (#fff, #000)', async () => {
    mountPanel(0)
    setPrintTokens({ 'print-bg': '#fff', 'print-fg': '#000', 'print-muted': '#4d4d4d', 'print-rule': '#8c8c8c', 'print-label': '#8a4b00' })
    await expect(packPanel(request())).resolves.toBe(true)
    const html = await capture.text(FILE)
    expect(html).toContain('background: #ffffff')
    expect(html).toContain('#8a4b00')
  })

  it('makes the dossier under the health answer it was given', async () => {
    mountPanel(0)
    await packPanel(request({ health: { now_utc: '2026-09-28T17:59:30Z', fixture_mode: true } }))
    const html = await capture.text(FILE)
    expect(html).toContain('13:59:30')
  })

  it('marks DEMO DATA in the demo build', async () => {
    mountPanel(0)
    document.documentElement.dataset.demo = 'on'
    await packPanel(request())
    expect(await capture.text(FILE)).toContain(DOSSIER.demoNote)
  })

  it('reads the dossier when it is chosen, not when it was registered', async () => {
    mountPanel(0)
    let input: DossierInput | null = null
    registerPanelSource('p1', { provenance: null, dossier: () => input })
    await packPanel(request())
    expect(capture.files).toHaveLength(0)
    expect(message().text).toBe(DOSSIER.unavailable)
    input = TEAR_INPUT
    await packPanel(request())
    expect(capture.files).toHaveLength(1)
  })

  it('names the charts left out, with the words GRAB uses', async () => {
    mountPanel(1)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const figure = document.createElement('div')
    figure.className = 'chart-a11y-figure'
    figure.setAttribute('role', 'img')
    figure.setAttribute('aria-label', 'Vector chart')
    place(figure, 400, 200)
    figure.append(svg)
    document.querySelector('[data-nqt-panel="p1"]')?.append(figure)
    await packPanel(request())
    expect(message().text).toBe(`${fillCopy(DOSSIER.packSavedOne, { file: FILE })} ${GRAB.skippedOne}`)
  })

  it('works without a health answer', async () => {
    mountPanel(0)
    await expect(packPanel(request({ health: null }))).resolves.toBe(true)
    expect(capture.files).toHaveLength(1)
  })

  it('takes the browser clock when no time is given', async () => {
    mountPanel(0)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-04T05:06:07Z'))
    try {
      await packPanel({ panelId: 'p1', health: null })
    } finally {
      vi.useRealTimers()
    }
    expect(capture.files.map((f) => f.name)).toEqual(['volmanaged_v0_EQ_pack_20270304-050607Z.html'])
  })
})

describe('packPanel: it makes no request', () => {
  it('calls neither fetch, XMLHttpRequest, sendBeacon nor an event source', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open')
    const beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    try {
      mountPanel(2)
      await packPanel(request())
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
      expect(beacon).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(navigator, 'sendBeacon')
    }
  })
})

describe('packPanel: when there is nothing to save', () => {
  it('says the pack is made from DES and the tear sheet for a panel without a dossier, and saves nothing', async () => {
    mountPanel(1, { id: 'p2' })
    await expect(packPanel(request({ panelId: 'p2' }))).resolves.toBe(false)
    expect(capture.files).toHaveLength(0)
    expect(message().text).toBe(DOSSIER.unavailable)
    expect(message().tone).toBe('info')
  })

  it('says there is no panel when the panel is not on the page', async () => {
    await expect(packPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(GRAB.noPanel)
    expect(capture.files).toHaveLength(0)
  })
})

describe('packPanel: errors', () => {
  it('says the dossier could not be made when the closure breaks, and never rejects', async () => {
    mountPanel(0)
    registerPanelSource('p1', { provenance: null, dossier: () => { throw new Error('the answer is broken.') } })
    await expect(packPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(fillCopy(DOSSIER.failed, { detail: 'the answer is broken' }))
    expect(message().tone).toBe('error')
    expect(capture.files).toHaveLength(0)
  })

  it('reads a thrown value that is not an Error', async () => {
    mountPanel(0)
    registerPanelSource('p1', { provenance: null, dossier: () => { throw 'boom' } })
    await expect(packPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(fillCopy(DOSSIER.failed, { detail: GRAB.detail.unknown }))
  })

  it('says the dossier could not be made when the print tokens are not usable, and saves nothing', async () => {
    mountPanel(0)
    setPrintTokens({ 'print-bg': 'red;}body{' })
    await expect(packPanel(request())).resolves.toBe(false)
    expect(message().tone).toBe('error')
    expect(message().text).toMatch(/^The dossier could not be made: .*print-bg.*\.$/)
    expect(capture.files).toHaveLength(0)
  })

  it('says the dossier could not be made when the print tokens are missing', async () => {
    mountPanel(0)
    document.documentElement.removeAttribute('style')
    await expect(packPanel(request())).resolves.toBe(false)
    expect(message().tone).toBe('error')
    expect(message().text).toContain('The dossier could not be made')
  })

  it('says the browser cannot save a file when it has no object URLs', async () => {
    mountPanel(0)
    capture.restore()
    const original = URL.createObjectURL
    Object.assign(URL, { createObjectURL: undefined })
    try {
      await expect(packPanel(request())).resolves.toBe(false)
    } finally {
      Object.assign(URL, { createObjectURL: original })
      capture = captureDownloads()
    }
    expect(message().text).toBe(GRAB.unavailable)
    expect(message().tone).toBe('error')
  })

  it('reports no save when the browser refuses the object URL', async () => {
    mountPanel(0)
    capture.restore()
    const original = URL.createObjectURL
    Object.assign(URL, { createObjectURL: () => { throw new Error('blocked') } })
    try {
      await expect(packPanel(request())).resolves.toBe(false)
    } finally {
      Object.assign(URL, { createObjectURL: original })
      capture = captureDownloads()
    }
    expect(message().text).toBe(GRAB.unavailable)
  })
})
