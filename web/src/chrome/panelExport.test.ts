// @vitest-environment jsdom
// The Options rows and the runner behind GRAB <GO> (roadmap 15). panelExport.ts is what the Workspace
// imports; the grab itself (src/export/grab/run.ts) is reached only through a dynamic import, mocked here.
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiQueryKey } from '../api/queryKey'
import { GRAB } from '../copy/grab'
import { fillCopy } from '../copy/workspace'
import type { GrabRequest } from '../export/grab/run'
import { resetMessage, useMessage } from './MessageLine.store'
import { panelExportEntries, panelTarget, readHealth, resetGrabRunner, runGrab, type PanelExportTarget } from './panelExport'

const grabPanel = vi.hoisted(() => vi.fn<(req: unknown) => Promise<boolean>>(async () => true))
vi.mock('../export/grab/run', () => ({ grabPanel }))

const TARGET: PanelExportTarget = { panelId: 'panel_3', code: 'EQ', number: 3, group: 'A' }
const HEALTH = { now_utc: '2026-09-26T12:00:00Z', fixture_mode: true }

/** The call the mocked runner received, typed as the request the real one takes. */
function received(): GrabRequest {
  const call = grabPanel.mock.calls.at(-1)
  if (!call) throw new Error('the grab runner was not called')
  return call[0] as GrabRequest
}

beforeEach(() => {
  grabPanel.mockClear()
  grabPanel.mockImplementation(async () => true)
  resetGrabRunner()
  resetMessage()
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function supportClipboardImages(): void {
  Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => {}) }, configurable: true })
  vi.stubGlobal('ClipboardItem', class {})
}

/** Lets the dynamic import and the grab settle. */
const settle = () => vi.waitFor(() => expect(grabPanel).toHaveBeenCalled())

describe('readHealth', () => {
  it('reads the cached health answer without a request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const client = new QueryClient()
    client.setQueryData(apiQueryKey('/api/health'), { ...HEALTH, nautilus_version: '1.231.0', kill_switch_on: false })
    expect(readHealth(client)).toEqual(HEALTH)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers null when nothing is cached', () => {
    expect(readHealth(new QueryClient())).toBeNull()
  })

  it('answers null without a client', () => {
    expect(readHealth(undefined)).toBeNull()
    expect(readHealth(null)).toBeNull()
  })

  it('reads a fixture flag that is not true as false, and a missing clock as null', () => {
    const client = new QueryClient()
    client.setQueryData(apiQueryKey('/api/health'), { fixture_mode: undefined })
    expect(readHealth(client)).toEqual({ now_utc: null, fixture_mode: false })
  })
})

describe('panelTarget', () => {
  it('names the panel, its mnemonic, its number and its link group', () => {
    expect(panelTarget('panel_3', 'EQ', 3, 'A')).toEqual(TARGET)
  })

  it('reads a number below 1 as no number', () => {
    expect(panelTarget('panel_3', 'EQ', 0, '-').number).toBeNull()
    expect(panelTarget('panel_3', 'EQ', -1, '-').number).toBeNull()
    expect(panelTarget('panel_3', 'EQ', 1, '-').number).toBe(1)
  })
})

describe('panelExportEntries', () => {
  it('offers only Grab as image where the browser cannot copy an image', () => {
    expect(panelExportEntries(TARGET, () => null).map((e) => e.label)).toEqual([GRAB.menuImage])
  })

  it('offers Copy image too where the clipboard takes an image', () => {
    supportClipboardImages()
    expect(panelExportEntries(TARGET, () => null).map((e) => e.label)).toEqual([GRAB.menuImage, GRAB.menuCopy])
  })

  it('offers no Copy image with a clipboard that only takes text', () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true })
    vi.stubGlobal('ClipboardItem', class {})
    expect(panelExportEntries(TARGET, () => null).map((e) => e.label)).toEqual([GRAB.menuImage])
  })

  it('offers no Copy image without ClipboardItem', () => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => {}) }, configurable: true })
    expect(panelExportEntries(TARGET, () => null).map((e) => e.label)).toEqual([GRAB.menuImage])
  })

  it('saves a file for Grab as image, with the panel and the health read at that moment', async () => {
    let health: typeof HEALTH | null = null
    const [image] = panelExportEntries(TARGET, () => health)
    health = HEALTH
    image?.onSelect()
    await settle()
    expect(received()).toEqual({ ...TARGET, health: HEALTH, target: 'file' })
  })

  it('copies to the clipboard for Copy image', async () => {
    supportClipboardImages()
    const copy = panelExportEntries(TARGET, () => null)[1]
    copy?.onSelect()
    await settle()
    expect(received()).toEqual({ ...TARGET, health: null, target: 'clipboard' })
  })

  it('carries a panel without a number as null', async () => {
    panelExportEntries({ ...TARGET, number: null }, () => null)[0]?.onSelect()
    await settle()
    expect(received().number).toBeNull()
  })
})

describe('runGrab', () => {
  it('hands the request to the lazy grab runner and makes no request of its own', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await runGrab(TARGET, HEALTH, 'file')
    expect(received()).toEqual({ panelId: 'panel_3', code: 'EQ', number: 3, group: 'A', health: HEALTH, target: 'file' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('passes the clipboard target through', async () => {
    await runGrab(TARGET, null, 'clipboard')
    expect(received().target).toBe('clipboard')
    expect(received().health).toBeNull()
  })

  it('says so on the message line when the runner breaks, and never rejects', async () => {
    grabPanel.mockRejectedValueOnce(new Error('canvas is tainted'))
    await expect(runGrab(TARGET, null, 'file')).resolves.toBeUndefined()
    expect(useMessage.getState().text).toBe(fillCopy(GRAB.failed, { detail: 'canvas is tainted' }))
    expect(useMessage.getState().tone).toBe('error')
  })

  it('reads a thrown value that is not an Error', async () => {
    grabPanel.mockRejectedValueOnce('boom')
    await runGrab(TARGET, null, 'file')
    expect(useMessage.getState().text).toBe(fillCopy(GRAB.failed, { detail: 'boom' }))
  })

  it('leaves the message line alone when the grab went well', async () => {
    await runGrab(TARGET, null, 'file')
    expect(useMessage.getState().text).toBe('')
  })
})

// ---------------------------------------------------------------- the gesture ordering of Copy image

/** Lets a started dynamic import land and its .then run, so the warmed runner is in place. */
async function settleImport(): Promise<void> {
  await vi.dynamicImportSettled()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Copy image keeps the click gesture (Safari writes the clipboard only inside it)', () => {
  it('warms the runner when the rows are built, so choosing Copy image grabs at once, with nothing awaited', async () => {
    supportClipboardImages()
    const copy = panelExportEntries(TARGET, () => HEALTH)[1]
    await settleImport()
    copy?.onSelect()
    // No await between the click and this line: the runner was in place, so grabPanel ran inside the gesture.
    expect(grabPanel).toHaveBeenCalledTimes(1)
    expect(received()).toEqual({ ...TARGET, health: HEALTH, target: 'clipboard' })
  })

  it('also grabs a file at once once the runner is warm', async () => {
    supportClipboardImages()
    const [image] = panelExportEntries(TARGET, () => null)
    await settleImport()
    image?.onSelect()
    expect(grabPanel).toHaveBeenCalledTimes(1)
    expect(received().target).toBe('file')
  })

  it('loads the runner on demand when nothing warmed it, and then grabs', async () => {
    const pending = runGrab(TARGET, null, 'file')
    expect(grabPanel).not.toHaveBeenCalled()
    await pending
    expect(grabPanel).toHaveBeenCalledTimes(1)
    expect(received().target).toBe('file')
  })

  it('once loaded, a later runGrab calls grabPanel synchronously', async () => {
    await runGrab(TARGET, null, 'file')
    grabPanel.mockClear()
    void runGrab(TARGET, null, 'clipboard')
    expect(grabPanel).toHaveBeenCalledTimes(1)
  })

  it('says so on the message line when a warm runner breaks synchronously, and never rejects', async () => {
    await runGrab(TARGET, null, 'file')
    grabPanel.mockImplementationOnce(() => {
      throw new Error('no drawing surface')
    })
    await expect(runGrab(TARGET, null, 'clipboard')).resolves.toBeUndefined()
    expect(useMessage.getState().text).toBe(fillCopy(GRAB.failed, { detail: 'no drawing surface' }))
  })
})

describe('the lazy runner is loaded only when it can be used, and a failed load is not remembered', () => {
  afterEach(() => {
    vi.doUnmock('../export/grab/run')
    vi.resetModules()
  })

  /** A fresh panelExport (and message line) over a runner module built by `factory`, which counts each load. */
  async function fresh(factory: () => Record<string, unknown>) {
    vi.resetModules()
    vi.doMock('../export/grab/run', factory)
    const exported = await import('./panelExport')
    const { useMessage: message } = await import('./MessageLine.store')
    return { ...exported, message }
  }

  it('starts no import when Copy image is not offered', async () => {
    let loads = 0
    const { panelExportEntries: entries } = await fresh(() => {
      loads += 1
      return { grabPanel }
    })
    entries(TARGET, () => null)
    await settleImport()
    expect(loads).toBe(0)
  })

  it('starts the import when Copy image is offered, and only once however often the rows are built', async () => {
    supportClipboardImages()
    let loads = 0
    const { panelExportEntries: entries } = await fresh(() => {
      loads += 1
      return { grabPanel }
    })
    entries(TARGET, () => null)
    entries(TARGET, () => null)
    await settleImport()
    expect(loads).toBe(1)
  })

  it('posts GRAB.failed when the chunk cannot load, and imports again on the next attempt', async () => {
    let loads = 0
    const ok = vi.fn(async () => true)
    const exported = await fresh(() => {
      loads += 1
      if (loads === 1) throw new Error('Failed to fetch dynamically imported module')
      return { grabPanel: ok }
    })
    await expect(exported.runGrab(TARGET, null, 'file')).resolves.toBeUndefined()
    // vitest wraps a throwing mock factory in its own message, so the detail is not asserted word for word.
    expect(exported.message.getState().text).toMatch(/^The image could not be made: .+\.$/)
    expect(exported.message.getState().tone).toBe('error')
    expect(ok).not.toHaveBeenCalled()
    await exported.runGrab(TARGET, null, 'file')
    expect(loads).toBe(2)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('a failed warm-up is silent, and the click that follows loads the chunk again', async () => {
    supportClipboardImages()
    let loads = 0
    const ok = vi.fn(async () => true)
    const exported = await fresh(() => {
      loads += 1
      if (loads === 1) throw new Error('offline')
      return { grabPanel: ok }
    })
    const copy = exported.panelExportEntries(TARGET, () => null)[1]
    await settleImport()
    expect(exported.message.getState().text).toBe('')
    copy?.onSelect()
    await vi.waitFor(() => expect(ok).toHaveBeenCalledTimes(1))
    expect(loads).toBe(2)
  })
})
