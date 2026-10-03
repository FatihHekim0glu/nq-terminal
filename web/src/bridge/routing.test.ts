// @vitest-environment jsdom
// Every file save and every clipboard write of the page goes through the bridge (roadmap D3.2): a spy
// bridge is installed and each caller is driven. The browser behaviour itself is pinned by the callers'
// own tests, which are unchanged; this file pins only that the calls arrive at the bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveBlob, saveText } from '../chrome/download'
import { exportCsv } from '../chrome/exportCsv'
import { EXPORT } from '../copy/panelParts'
import { resetMessage, useMessage } from '../chrome/MessageLine.store'
import { panelExportEntries, type PanelExportTarget } from '../chrome/panelExport'
import { resetPanelSources } from '../chrome/panelSources'
import { GRAB } from '../copy/grab'
import { RUN } from '../copy/runs'
import { fillCopy } from '../copy/workspace'
import { grabPanel, type GrabRequest } from '../export/grab/run'
import { copyCommand } from '../screens/runs/RunHeader'
import { endedResult, fakeBridge, savedResult } from './bridge.testUtil'
import { installBridge } from './index'

const message = () => useMessage.getState()
const NOW = new Date('2026-09-28T18:02:11Z')

beforeEach(() => resetMessage())
afterEach(() => {
  installBridge(null)
  document.body.replaceChildren()
  resetPanelSources()
  resetMessage()
  vi.restoreAllMocks()
})

describe('saveBlob and saveText call bridge.saveFile', () => {
  it('hands the name and the very blob to the bridge and reports that the save started', () => {
    const bridge = fakeBridge()
    installBridge(bridge)
    const blob = new Blob(['x'], { type: 'image/png' })
    expect(saveBlob('EQ.png', blob).started).toBe(true)
    expect(bridge.saveFile).toHaveBeenCalledWith('EQ.png', blob)
  })

  it('reports false, as the caller needs, when the bridge did not start the save', () => {
    installBridge(fakeBridge({ saveFile: vi.fn(() => savedResult(false)) }))
    expect(saveBlob('EQ.png', new Blob(['x'])).started).toBe(false)
    expect(saveText('a.csv', 'x').started).toBe(false)
  })

  it('saveText saves a csv blob by default and the given type otherwise', async () => {
    const bridge = fakeBridge()
    installBridge(bridge)
    expect(saveText('a.csv', 'x,y').started).toBe(true)
    expect(saveText('p.html', '<p>', 'text/html;charset=utf-8').started).toBe(true)
    const calls = vi.mocked(bridge.saveFile).mock.calls
    expect(calls.map(([name]) => name)).toEqual(['a.csv', 'p.html'])
    expect(calls[0]?.[1].type).toBe('text/csv;charset=utf-8')
    expect(await calls[0]?.[1].text()).toBe('x,y')
    expect(calls[1]?.[1].type).toBe('text/html;charset=utf-8')
  })
})

describe('a save that does not end saved is not reported as saved', () => {
  it('born failing: a cancelled CSV save says cancelled and posts no Saved line', async () => {
    installBridge(fakeBridge({ saveFile: vi.fn(() => endedResult('cancelled')) }))
    expect(exportCsv('a.csv', 'x,y', 1)).toBe(true)
    await vi.waitFor(() => expect(message().text).toBe(EXPORT.cancelled))
    expect(message().text).not.toMatch(/^Saved/)
  })

  it('born failing: a failed CSV save says so as an error', async () => {
    installBridge(fakeBridge({ saveFile: vi.fn(() => endedResult('failed')) }))
    exportCsv('a.csv', 'x,y', 1)
    await vi.waitFor(() => expect(message().text).toBe(EXPORT.failed))
    expect(message().tone).toBe('error')
  })

  it('born failing: a rejecting shell save is a failure (the runner fails the run on an unhandled rejection)', async () => {
    installBridge(fakeBridge({ saveFile: vi.fn(() => endedResult('rejects')) }))
    exportCsv('a.csv', 'x,y', 1)
    await vi.waitFor(() => expect(message().text).toBe(EXPORT.failed))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('says Saved once the save ended saved', async () => {
    installBridge(fakeBridge())
    exportCsv('a.csv', 'x,y', 1)
    await vi.waitFor(() => expect(message().text).toBe('Saved 1 row as a.csv.'))
  })
})

describe('the run ledger command is copied through bridge.copyText', () => {
  it('hands the command to the bridge and says copied', async () => {
    const bridge = fakeBridge()
    installBridge(bridge)
    copyCommand('uv run python x.py')
    expect(bridge.copyText).toHaveBeenCalledWith('uv run python x.py')
    await vi.waitFor(() => expect(message().text).toBe(RUN.ledger.copied))
  })

  it('says the copy failed when the bridge says false', async () => {
    installBridge(fakeBridge({ copyText: vi.fn(async () => false) }))
    copyCommand('x')
    await vi.waitFor(() => expect(message().text).toBe(RUN.ledger.copyFailed))
    expect(message().tone).toBe('error')
  })

  it('says the copy failed when the bridge rejects', async () => {
    installBridge(fakeBridge({ copyText: vi.fn(async () => { throw new Error('no') }) }))
    copyCommand('x')
    await vi.waitFor(() => expect(message().text).toBe(RUN.ledger.copyFailed))
  })
})

describe('the panel export rows ask the bridge what it can copy', () => {
  const TARGET: PanelExportTarget = { panelId: 'panel_3', code: 'EQ', number: 3, group: 'A' }

  it('offers Copy image when the bridge can, whatever the page clipboard says', () => {
    installBridge(fakeBridge({ canCopyImage: vi.fn(() => true) }))
    expect(panelExportEntries(TARGET, () => null).map((e) => e.label)).toEqual([GRAB.menuImage, GRAB.menuCopy])
  })

  it('offers only Grab as image when the bridge cannot copy an image', () => {
    installBridge(fakeBridge({ canCopyImage: vi.fn(() => false) }))
    expect(panelExportEntries(TARGET, () => null).map((e) => e.label)).toEqual([GRAB.menuImage])
  })
})

/** A panel with one chart canvas, and a canvas that draws nothing and encodes a fixed png. */
function mountPanelWithChart(): void {
  const panel = document.createElement('section')
  panel.setAttribute('data-nqt-panel', 'p1')
  panel.setAttribute('data-nqt-title', 'volmanaged_v0 EQ')
  const figure = document.createElement('div')
  figure.className = 'chart-a11y-figure'
  figure.setAttribute('role', 'img')
  figure.setAttribute('aria-label', 'Equity: 3 points')
  const box = { left: 0, top: 0, width: 700, height: 300, right: 700, bottom: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  figure.getBoundingClientRect = () => box
  const canvas = document.createElement('canvas')
  canvas.width = 700
  canvas.height = 300
  canvas.getBoundingClientRect = () => box
  figure.append(canvas)
  panel.append(figure)
  document.body.append(panel)
  const ctx = {
    fillStyle: '', font: '', textBaseline: '',
    measureText: (text: string) => ({ width: text.length * 5 }),
    scale: () => {}, fillRect: () => {}, drawImage: () => {}, fillText: () => {},
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback, type?: string) {
    callback(new Blob(['png-bytes'], { type }))
  })
}

const request = (over: Partial<GrabRequest> = {}): GrabRequest => ({
  panelId: 'p1', code: 'EQ', number: 1, group: 'A', health: null, target: 'file', now: NOW, ...over,
})

describe('GRAB goes through the bridge', () => {
  it('saves the png with bridge.saveFile', async () => {
    mountPanelWithChart()
    const bridge = fakeBridge()
    installBridge(bridge)
    expect(await grabPanel(request())).toBe(true)
    const [name, blob] = vi.mocked(bridge.saveFile).mock.calls[0] ?? []
    expect(name).toMatch(/^volmanaged_v0_EQ_20260928-180211Z\.png$/)
    expect(blob?.type).toBe('image/png')
  })

  it('says the browser cannot save an image when the bridge did not start the save', async () => {
    mountPanelWithChart()
    installBridge(fakeBridge({ saveFile: vi.fn(() => savedResult(false)) }))
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(GRAB.unavailable)
  })

  it('born failing: a cancelled image save resolves false and does not say Saved', async () => {
    mountPanelWithChart()
    installBridge(fakeBridge({ saveFile: vi.fn(() => endedResult('cancelled')) }))
    expect(await grabPanel(request())).toBe(false)
    expect(message().text).toBe(EXPORT.cancelled)
  })

  it('copies with bridge.copyImage, called within the click with a promise of the png', async () => {
    mountPanelWithChart()
    const bridge = fakeBridge()
    installBridge(bridge)
    const done = grabPanel(request({ target: 'clipboard' }))
    expect(bridge.copyImage).toHaveBeenCalledTimes(1)
    const [image] = vi.mocked(bridge.copyImage).mock.calls[0] ?? []
    expect(image).toBeInstanceOf(Promise)
    expect(await done).toBe(true)
    expect(message().text).toBe(GRAB.copiedOne)
  })

  it('says so, and makes no image, when the bridge cannot copy one', async () => {
    mountPanelWithChart()
    const bridge = fakeBridge({ canCopyImage: vi.fn(() => false) })
    installBridge(bridge)
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(GRAB.clipboardUnavailable)
    expect(bridge.copyImage).not.toHaveBeenCalled()
  })

  it('says so when the bridge answers false to the copy', async () => {
    mountPanelWithChart()
    installBridge(fakeBridge({ copyImage: vi.fn(async () => false) }))
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(GRAB.clipboardUnavailable)
  })

  it('gives the reason of the browser when the bridge rejects the copy', async () => {
    mountPanelWithChart()
    installBridge(fakeBridge({ copyImage: vi.fn(async () => { throw new Error('Document is not focused') }) }))
    expect(await grabPanel(request({ target: 'clipboard' }))).toBe(false)
    expect(message().text).toBe(fillCopy(GRAB.clipboardRefused, { detail: 'Document is not focused' }))
  })
})
