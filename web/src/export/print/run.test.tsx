// @vitest-environment jsdom
// printPanel: the print dossier (roadmap 15 part 3). It makes the dossier from what the panel already holds,
// mounts it as React text into a hidden #nqt-print-root with a React root of its own, waits for the frames,
// the images and the fonts, opens the print dialog once, and removes the root when printing ends (afterprint)
// or, if a browser never says so, at the next print. It makes no request of any kind, never changes what
// the screen shows, and never rejects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAB } from '../../copy/grab'
import { DOSSIER } from '../../copy/dossier'
import { fillCopy } from '../../copy/workspace'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { registerPanelSource, resetPanelSources } from '../../chrome/panelSources'
import { VOLMANAGED } from '../../screens/des/desTestData'
import { HYP_ANALYTICS } from '../../screens/tear/tearP1.fixtures'
import type { DossierInput } from '../dossier/types'
import type { HealthLite } from '../grab/run'
import { ROOT_ID, printPanel, type PrintRequest } from './run'

const NOW = new Date('2026-09-28T18:02:11Z')
const HEALTH: HealthLite = { now_utc: '2026-09-28T17:59:30Z', fixture_mode: false }
const TITLE = 'volmanaged_v0: tear sheet dossier'
const STEM = 'volmanaged_v0_EQ'
const APP_TITLE = 'NQ Terminal'

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
function mountPanel(figures: number, opts: { id?: string; title?: string } = {}): HTMLElement {
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
  return panel
}

function request(over: Partial<PrintRequest> = {}): PrintRequest {
  return { panelId: 'p1', health: HEALTH, now: NOW, ...over }
}

const message = () => useMessage.getState()
const roots = () => [...document.querySelectorAll(`#${ROOT_ID}`)]
const root = (): HTMLElement | null => document.getElementById(ROOT_ID)

/** Lets queued promise callbacks run, without waiting on a timer. */
const flush = async (turns = 12): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}
function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// ---------------------------------------------------------------- the browser, as far as the runner asks

let printSpy: ReturnType<typeof vi.fn>
let frames: ReturnType<typeof vi.fn>
const saved = { print: Object.getOwnPropertyDescriptor(window, 'print') }

function stubPrint(fn: unknown): void {
  Object.defineProperty(window, 'print', { value: fn, configurable: true, writable: true })
}

function stubFonts(ready: Promise<unknown> | null): void {
  if (ready === null) Reflect.deleteProperty(document, 'fonts')
  else Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true })
}

function stubDecode(impl: (() => Promise<void>) | null): void {
  if (impl === null) Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
  else Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: impl, configurable: true, writable: true })
}

function stubCanvas(url: string = PIXEL): void {
  const ctx = { fillStyle: '', scale: () => {}, fillRect: () => {}, drawImage: () => {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => url)
}

beforeEach(() => {
  document.title = APP_TITLE
  stubCanvas()
  printSpy = vi.fn()
  stubPrint(printSpy)
  stubFonts(Promise.resolve())
  stubDecode(async () => {})
  frames = vi.fn((cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0))
    return 1
  })
  vi.stubGlobal('requestAnimationFrame', frames)
  registerPanelSource('p1', { provenance: null, dossier: () => TEAR_INPUT })
})

afterEach(() => {
  window.dispatchEvent(new Event('afterprint'))
  vi.useRealTimers()
  document.body.replaceChildren()
  delete document.documentElement.dataset.demo
  if (saved.print) Object.defineProperty(window, 'print', saved.print)
  stubFonts(null)
  stubDecode(null)
  resetPanelSources()
  resetMessage()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('printPanel: the print root', () => {
  it('mounts the dossier into a hidden #nqt-print-root that is a child of the body', async () => {
    mountPanel(2)
    await expect(printPanel(request())).resolves.toBe(true)
    expect(ROOT_ID).toBe('nqt-print-root')
    expect(roots()).toHaveLength(1)
    expect(root()?.parentElement).toBe(document.body)
    // Hidden and shown by print.css alone: the hidden attribute would beat it (Tailwind's important [hidden] rule).
    expect(root()?.hasAttribute('hidden')).toBe(false)
    expect(root()?.querySelector('article.prt h1')?.textContent).toBe(TITLE)
    expect(root()?.querySelector('article')?.getAttribute('aria-label')).toBe(fillCopy(DOSSIER.printLabel, { title: TITLE }))
  })

  it('puts the charts of the panel in the root as PNG images with their summaries', async () => {
    mountPanel(2)
    await printPanel(request())
    const imgs = [...(root()?.querySelectorAll('figure.prt-figure img') ?? [])]
    expect(imgs).toHaveLength(2)
    for (const img of imgs) expect(img.getAttribute('src')).toBe(PIXEL)
    expect(root()?.querySelectorAll('figcaption')).toHaveLength(2)
  })

  it('leaves out a chart the browser will not give as a PNG, and says so as GRAB does', async () => {
    vi.restoreAllMocks()
    stubCanvas('data:text/plain;base64,AAAA')
    mountPanel(2)
    await printPanel(request())
    expect(root()?.querySelectorAll('img')).toHaveLength(0)
    expect(root()?.querySelector('section.prt-figures')).toBeNull()
    expect(message().text).toBe(`${fillCopy(DOSSIER.printOpened, { name: TITLE })} ${fillCopy(GRAB.skipped, { n: 2 })}`)
  })

  it('says one skipped chart in the singular', async () => {
    vi.restoreAllMocks()
    let calls = 0
    const ctx = { fillStyle: '', scale: () => {}, fillRect: () => {}, drawImage: () => {} }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
      calls += 1
      return calls === 1 ? PIXEL : 'data:text/plain;base64,AAAA'
    })
    mountPanel(2)
    await printPanel(request())
    expect(root()?.querySelectorAll('img')).toHaveLength(1)
    expect(message().text).toBe(`${fillCopy(DOSSIER.printOpened, { name: TITLE })} ${GRAB.skippedOne}`)
  })

  it('mounts a dossier with no charts at all', async () => {
    mountPanel(0)
    await expect(printPanel(request())).resolves.toBe(true)
    expect(root()?.querySelector('h1')?.textContent).toBe(TITLE)
    expect(root()?.querySelectorAll('img')).toHaveLength(0)
    expect(message().text).toBe(fillCopy(DOSSIER.printOpened, { name: TITLE }))
  })

  it('renders hostile text as text: no script element in the root', async () => {
    mountPanel(0)
    const hostile = '"><script>alert(1)</script><img src=x onerror=alert(2)>'
    registerPanelSource('p1', {
      provenance: null,
      dossier: () => ({
        ...TEAR_INPUT,
        target: { kind: 'hypothesis', name: hostile },
      }),
    })
    await printPanel(request())
    expect(root()?.querySelectorAll('script')).toHaveLength(0)
    expect(root()?.querySelector('h1')?.textContent).toContain(hostile)
    expect(root()?.querySelectorAll('img')).toHaveLength(0)
  })
})

describe('printPanel: one print', () => {
  it('opens the print dialog once, with the dossier already on the page', async () => {
    mountPanel(1)
    const seen: Array<{ root: boolean; heading: string | null | undefined; text: string }> = []
    printSpy.mockImplementation(() => {
      seen.push({ root: root() !== null, heading: root()?.querySelector('h1')?.textContent, text: message().text })
    })
    await expect(printPanel(request())).resolves.toBe(true)
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ root: true, heading: TITLE, text: fillCopy(DOSSIER.printOpened, { name: TITLE }) }])
  })

  it('posts that the dialog opened, and how to keep a copy, before it opens (the dialog may block)', async () => {
    mountPanel(1)
    await printPanel(request())
    expect(message().text).toBe(`Print dialog opened for ${TITLE}. Choose Save as PDF to keep a copy.`)
    expect(message().tone).toBe('info')
  })

  it('names the document for the PDF while the dialog is open, and gives the title back afterwards', async () => {
    mountPanel(1)
    const during: string[] = []
    printSpy.mockImplementation(() => during.push(document.title))
    await printPanel(request())
    expect(during).toEqual([STEM])
    expect(document.title).toBe(STEM)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe(APP_TITLE)
  })

  it('makes no request of any kind', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mountPanel(2)
    await printPanel(request())
    window.dispatchEvent(new Event('afterprint'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads the server clock from the health answer it is given, and shows the demo note in the demo', async () => {
    document.documentElement.dataset.demo = 'on'
    mountPanel(0)
    await printPanel(request())
    expect(root()?.textContent).toContain(DOSSIER.demoNote)
    expect(root()?.textContent).toContain('Server clock')
  })

  it('prints without a health answer, and the dossier then has no server clock', async () => {
    mountPanel(0)
    await expect(printPanel({ panelId: 'p1', health: null })).resolves.toBe(true)
    expect(root()?.textContent).not.toContain('Server clock')
    expect(printSpy).toHaveBeenCalledTimes(1)
  })
})

describe('printPanel: it waits until the page is ready to print', () => {
  it('waits two animation frames, then the images, then the fonts, before it prints', async () => {
    mountPanel(2)
    const decoding = [deferred(), deferred()]
    let decodes = 0
    stubDecode(() => decoding[decodes++]!.promise)
    const fonts = deferred()
    stubFonts(fonts.promise)
    const done = printPanel(request())
    await flush()
    expect(frames.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(decodes).toBe(2)
    expect(printSpy).not.toHaveBeenCalled()
    decoding[0]!.resolve()
    decoding[1]!.resolve()
    await flush()
    expect(printSpy).not.toHaveBeenCalled()
    fonts.resolve()
    await done
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('waits for the frames before it decodes anything', async () => {
    mountPanel(1)
    const order: string[] = []
    frames.mockImplementation((cb: FrameRequestCallback) => {
      order.push('frame')
      queueMicrotask(() => cb(0))
      return 1
    })
    stubDecode(async () => {
      order.push('decode')
    })
    await printPanel(request())
    expect(order.slice(0, 3)).toEqual(['frame', 'frame', 'decode'])
  })

  it('prints all the same when an image cannot be decoded', async () => {
    mountPanel(2)
    stubDecode(() => Promise.reject(new Error('EncodingError')))
    await expect(printPanel(request())).resolves.toBe(true)
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('prints in a browser with no image decode and no font loading set', async () => {
    mountPanel(1)
    stubDecode(null)
    stubFonts(null)
    await expect(printPanel(request())).resolves.toBe(true)
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('prints all the same when the fonts fail to load', async () => {
    mountPanel(1)
    stubFonts(Promise.reject(new Error('font')))
    await expect(printPanel(request())).resolves.toBe(true)
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('does not wait for ever on a page that never settles: it prints after the wait is capped', async () => {
    mountPanel(1)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubDecode(() => new Promise<void>(() => {}))
    const done = printPanel(request())
    await flush()
    expect(printSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(done).resolves.toBe(true)
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves no timer behind when the page settles at once', async () => {
    mountPanel(1)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await printPanel(request())
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('printPanel: cleaning up', () => {
  it('removes the root when printing ends (afterprint), and only the root', async () => {
    const panel = mountPanel(1)
    const before = document.body.innerHTML
    await printPanel(request())
    expect(roots()).toHaveLength(1)
    window.dispatchEvent(new Event('afterprint'))
    expect(roots()).toHaveLength(0)
    expect(document.body.innerHTML).toBe(before)
    expect(panel.isConnected).toBe(true)
  })

  it('listens for afterprint once', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    mountPanel(1)
    await printPanel(request())
    const call = add.mock.calls.find(([type]) => type === 'afterprint')
    expect(call?.[2]).toEqual({ once: true })
  })

  it('answers a second afterprint without harm', async () => {
    mountPanel(1)
    await printPanel(request())
    window.dispatchEvent(new Event('afterprint'))
    expect(() => window.dispatchEvent(new Event('afterprint'))).not.toThrow()
    expect(roots()).toHaveLength(0)
    expect(document.title).toBe(APP_TITLE)
  })

  it('leaves the page as it found it: markup, title and the html element', async () => {
    mountPanel(2)
    const html = document.documentElement.outerHTML
    await printPanel(request())
    window.dispatchEvent(new Event('afterprint'))
    expect(document.documentElement.outerHTML).toBe(html)
    expect(document.title).toBe(APP_TITLE)
  })

  it('keeps one root when it is used again before the first was cleaned up, and removes the old one', async () => {
    mountPanel(1)
    await printPanel(request())
    const first = root()
    await printPanel(request())
    expect(roots()).toHaveLength(1)
    expect(root()).not.toBe(first)
    expect(first?.isConnected).toBe(false)
    expect(printSpy).toHaveBeenCalledTimes(2)
    expect(root()?.querySelectorAll('article')).toHaveLength(1)
  })

  it('cleans up a repeated print with one afterprint, and hands the title back to the app, not to the first print', async () => {
    mountPanel(1)
    await printPanel(request())
    await printPanel(request())
    window.dispatchEvent(new Event('afterprint'))
    expect(roots()).toHaveLength(0)
    expect(document.title).toBe(APP_TITLE)
  })

  it('does not let the first print take the second one down: the old listener is gone', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    mountPanel(1)
    await printPanel(request())
    await printPanel(request())
    expect(remove.mock.calls.filter(([type]) => type === 'afterprint').length).toBeGreaterThanOrEqual(1)
    const second = root()
    window.dispatchEvent(new Event('afterprint'))
    expect(second?.isConnected).toBe(false)
  })

  it('removes a root left by an earlier copy of this module, and never keeps two', async () => {
    const stale = document.createElement('div')
    stale.id = ROOT_ID
    stale.textContent = 'left over'
    document.body.append(stale)
    mountPanel(0)
    await printPanel(request())
    expect(roots()).toHaveLength(1)
    expect(stale.isConnected).toBe(false)
    expect(root()?.textContent).not.toContain('left over')
  })

  it('lets the newest call win when two overlap, and prints once', async () => {
    mountPanel(1)
    const gate = deferred()
    stubFonts(gate.promise)
    const first = printPanel(request())
    await flush()
    const second = printPanel(request())
    await flush()
    gate.resolve()
    const results = await Promise.all([first, second])
    expect(results).toEqual([false, true])
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect(roots()).toHaveLength(1)
    expect(message().text).toBe(fillCopy(DOSSIER.printOpened, { name: TITLE }))
  })
})

describe('printPanel: when it cannot print', () => {
  it('says the browser cannot print from here when there is no window.print, and builds nothing', async () => {
    const closure = vi.fn(() => TEAR_INPUT)
    registerPanelSource('p1', { provenance: null, dossier: closure })
    mountPanel(1)
    stubPrint(undefined)
    await expect(printPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(DOSSIER.printUnavailable)
    expect(message().tone).toBe('error')
    expect(roots()).toHaveLength(0)
    expect(closure).not.toHaveBeenCalled()
    expect(document.title).toBe(APP_TITLE)
  })

  it('says so when window.print is not a function', async () => {
    mountPanel(1)
    stubPrint('print')
    await expect(printPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(DOSSIER.printUnavailable)
  })

  it('gives the dossier message when the panel registered no dossier', async () => {
    resetPanelSources()
    mountPanel(1)
    await expect(printPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(DOSSIER.unavailable)
    expect(message().tone).toBe('info')
    expect(printSpy).not.toHaveBeenCalled()
    expect(roots()).toHaveLength(0)
  })

  it('gives the dossier message when the closure holds nothing right now', async () => {
    registerPanelSource('p1', { provenance: null, dossier: () => null })
    mountPanel(1)
    await expect(printPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(DOSSIER.unavailable)
    expect(roots()).toHaveLength(0)
  })

  it('says the panel is not on the page when it is not', async () => {
    await expect(printPanel(request({ panelId: 'p1' }))).resolves.toBe(false)
    expect(message().text).toBe(GRAB.noPanel)
    expect(printSpy).not.toHaveBeenCalled()
    expect(roots()).toHaveLength(0)
  })

  it('does not remove the dossier of an earlier print when a later request has nothing to print', async () => {
    mountPanel(1)
    await printPanel(request())
    const first = root()
    resetPanelSources()
    await printPanel(request())
    expect(root()).toBe(first)
  })

  it('reports a failing print as the dossier failure, removes the root and gives the title back', async () => {
    mountPanel(1)
    printSpy.mockImplementation(() => {
      throw new Error('Printing is disabled by policy.')
    })
    await expect(printPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(fillCopy(DOSSIER.failed, { detail: 'Printing is disabled by policy' }))
    expect(message().tone).toBe('error')
    expect(roots()).toHaveLength(0)
    expect(document.title).toBe(APP_TITLE)
  })

  it('reports a dossier closure that throws, and builds nothing', async () => {
    registerPanelSource('p1', {
      provenance: null,
      dossier: () => {
        throw new Error('analytics missing')
      },
    })
    mountPanel(1)
    await expect(printPanel(request())).resolves.toBe(false)
    expect(message().text).toBe(fillCopy(DOSSIER.failed, { detail: 'analytics missing' }))
    expect(message().tone).toBe('error')
    expect(roots()).toHaveLength(0)
    expect(printSpy).not.toHaveBeenCalled()
  })

  it('reads a thrown value that is not an Error', async () => {
    mountPanel(1)
    printSpy.mockImplementation(() => {
      throw 'boom'
    })
    await printPanel(request())
    expect(message().text).toBe(fillCopy(DOSSIER.failed, { detail: GRAB.detail.unknown }))
    expect(roots()).toHaveLength(0)
  })

  it('never rejects', async () => {
    mountPanel(1)
    printSpy.mockImplementation(() => {
      throw new Error('x')
    })
    await expect(printPanel(request())).resolves.toBe(false)
  })
})
