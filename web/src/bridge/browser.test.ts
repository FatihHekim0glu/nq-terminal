// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserBridge } from './browser'
import { BROWSER_SHELL } from './detect'

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
afterEach(() => {
  Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke })
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

describe('the browser bridge carries the shell facts it was built with', () => {
  it('reports bridgeVersion 0, the browser platform and PC keys', () => {
    const bridge = browserBridge(BROWSER_SHELL)
    expect(bridge.bridgeVersion).toBe(0)
    expect(bridge.platform).toBe('browser')
    expect(bridge.keys).toBe('pc')
  })

  it('reports an injected shell as it is: the save and copy code is the same in every shell', () => {
    const bridge = browserBridge({ bridgeVersion: 1, platform: 'windows', keys: 'pc' })
    expect(bridge.bridgeVersion).toBe(1)
    expect(bridge.platform).toBe('windows')
  })
})

describe('saveFile: the object-URL anchor of today', () => {
  it('clicks a download link for an object URL made from the blob, revokes it and says saved', async () => {
    const create = vi.fn(() => 'blob:png')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    let link: HTMLAnchorElement | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      link = this
    })
    const result = browserBridge(BROWSER_SHELL).saveFile('EQ.png', PNG)
    expect(result.started).toBe(true)
    expect(await result).toBe('saved')
    expect(create).toHaveBeenCalledWith(PNG)
    expect(link!.download).toBe('EQ.png')
    expect(link!.href).toBe('blob:png')
    expect(link!.rel).toBe('noopener')
    expect(revoke).toHaveBeenCalledWith('blob:png')
  })

  it('clicks the link before it returns, so the browser still counts the click of the user', () => {
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    void browserBridge(BROWSER_SHELL).saveFile('a.csv', new Blob(['x']))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('says failed, and has not started, where the browser has no object URLs', async () => {
    Object.assign(URL, { createObjectURL: undefined })
    const result = browserBridge(BROWSER_SHELL).saveFile('a.csv', new Blob(['x']))
    expect(result.started).toBe(false)
    expect(await result).toBe('failed')
  })

  it('says failed, never throws, when making the object URL fails', async () => {
    Object.assign(URL, { createObjectURL: () => { throw new Error('blocked') }, revokeObjectURL: vi.fn() })
    const result = browserBridge(BROWSER_SHELL).saveFile('a.csv', new Blob(['x']))
    expect(result.started).toBe(false)
    expect(await result).toBe('failed')
  })

  it('revokes the object URL even when the click throws', () => {
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: revoke })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('no') })
    expect(() => browserBridge(BROWSER_SHELL).saveFile('a.csv', new Blob(['x']))).toThrow('no')
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})

describe('copyText', () => {
  it('writes the text to the clipboard and says true', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await browserBridge(BROWSER_SHELL).copyText('uv run x')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('uv run x')
  })

  it('says false where there is no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    expect(await browserBridge(BROWSER_SHELL).copyText('x')).toBe(false)
  })

  it('says false, never rejects, when the browser refuses the write', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    expect(await browserBridge(BROWSER_SHELL).copyText('x')).toBe(false)
  })

  it('says false when writeText throws before it returns a promise', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => { throw new Error('sync') } }, configurable: true })
    expect(await browserBridge(BROWSER_SHELL).copyText('x')).toBe(false)
  })
})

describe('copyImage and canCopyImage', () => {
  class FakeItem {
    readonly parts: Record<string, unknown>
    constructor(parts: Record<string, unknown>) {
      this.parts = parts
    }
  }

  it('offers an image copy only with ClipboardItem and a clipboard that writes', () => {
    const bridge = browserBridge(BROWSER_SHELL)
    expect(bridge.canCopyImage()).toBe(false)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true })
    vi.stubGlobal('ClipboardItem', FakeItem)
    expect(bridge.canCopyImage()).toBe(false)
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true })
    expect(bridge.canCopyImage()).toBe(true)
    vi.stubGlobal('ClipboardItem', undefined)
    expect(bridge.canCopyImage()).toBe(false)
  })

  it('writes one image item at once, taking the promise of the image so the click still counts', async () => {
    const write = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true })
    vi.stubGlobal('ClipboardItem', FakeItem)
    const image = Promise.resolve(PNG)
    const done = browserBridge(BROWSER_SHELL).copyImage(image)
    expect(write).toHaveBeenCalledTimes(1)
    const items = (write.mock.calls[0] as unknown as [FakeItem[]])[0]
    expect(items).toHaveLength(1)
    expect(items[0]!.parts['image/png']).toBe(image)
    expect(await done).toBe(true)
  })

  it('says false where the clipboard takes no image', async () => {
    expect(await browserBridge(BROWSER_SHELL).copyImage(PNG)).toBe(false)
  })

  it('rejects with the error of the browser when the write is refused, so the caller can say why', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: async () => { throw new Error('Document is not focused') } }, configurable: true })
    vi.stubGlobal('ClipboardItem', FakeItem)
    await expect(browserBridge(BROWSER_SHELL).copyImage(PNG)).rejects.toThrow('Document is not focused')
  })

  it('rejects, not throws, when the item constructor throws', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn() }, configurable: true })
    vi.stubGlobal('ClipboardItem', class { constructor() { throw new Error('bad item') } })
    await expect(browserBridge(BROWSER_SHELL).copyImage(PNG)).rejects.toThrow('bad item')
  })
})
