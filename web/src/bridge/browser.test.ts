// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAVE_OUTCOME_EVENT, SAVE_WAIT_MS, browserBridge } from './browser'
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

describe('saveFile in a shell that reports how each save ended (bridgeVersion 2)', () => {
  const SHELL_V2 = { bridgeVersion: 2, platform: 'windows', keys: 'pc' } as const
  const outcomeEvent = (uri: string, outcome: unknown) =>
    new CustomEvent(SAVE_OUTCOME_EVENT, { detail: { uri, outcome } })

  function clickSpy(url = 'blob:one') {
    Object.assign(URL, { createObjectURL: vi.fn(() => url), revokeObjectURL: vi.fn() })
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  }

  it('has started at once, and waits for the shell instead of saying saved at the click', async () => {
    clickSpy()
    const result = browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))
    expect(result.started).toBe(true)
    let ended: string | null = null
    void result.then((outcome) => {
      ended = outcome
    })
    await Promise.resolve()
    expect(ended).toBeNull()
    window.dispatchEvent(outcomeEvent('blob:one', 'saved'))
    expect(await result).toBe('saved')
  })

  it.each(['saved', 'cancelled', 'failed'] as const)('ends as %s when the shell says so for its object URL', async (said) => {
    clickSpy('blob:two')
    const result = browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))
    window.dispatchEvent(outcomeEvent('blob:two', said))
    expect(await result).toBe(said)
  })

  it('takes a word that arrives before the click returns (the listener is in place first)', async () => {
    Object.assign(URL, { createObjectURL: () => 'blob:early', revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      window.dispatchEvent(outcomeEvent('blob:early', 'cancelled'))
    })
    expect(await browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))).toBe('cancelled')
  })

  it('ignores a word for another object URL, a word with an outcome it does not know and a word with no detail', async () => {
    vi.useFakeTimers()
    clickSpy('blob:mine')
    const result = browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))
    let ended: string | null = null
    void result.then((outcome) => {
      ended = outcome
    })
    window.dispatchEvent(outcomeEvent('blob:other', 'saved'))
    window.dispatchEvent(outcomeEvent('blob:mine', 'perhaps'))
    window.dispatchEvent(new CustomEvent(SAVE_OUTCOME_EVENT))
    window.dispatchEvent(new CustomEvent(SAVE_OUTCOME_EVENT, { detail: 'blob:mine' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toBeNull()
    window.dispatchEvent(outcomeEvent('blob:mine', 'saved'))
    await vi.advanceTimersByTimeAsync(0)
    expect(ended).toBe('saved')
    vi.useRealTimers()
  })

  it('answers each of two saves in flight with its own word', async () => {
    const urls = ['blob:a', 'blob:b']
    Object.assign(URL, { createObjectURL: () => urls.shift(), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const bridge = browserBridge(SHELL_V2)
    const first = bridge.saveFile('a.csv', new Blob(['1']))
    const second = bridge.saveFile('b.csv', new Blob(['2']))
    window.dispatchEvent(outcomeEvent('blob:b', 'cancelled'))
    window.dispatchEvent(outcomeEvent('blob:a', 'saved'))
    expect([await first, await second]).toEqual(['saved', 'cancelled'])
  })

  it('says failed, and stops listening, when the shell never answers', async () => {
    vi.useFakeTimers()
    clickSpy('blob:silent')
    const remove = vi.spyOn(window, 'removeEventListener')
    const result = browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))
    await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS + 1)
    expect(await result).toBe('failed')
    expect(remove).toHaveBeenCalledWith(SAVE_OUTCOME_EVENT, expect.any(Function))
    vi.useRealTimers()
  })

  it('still says failed, and has not started, where the browser has no object URLs', async () => {
    Object.assign(URL, { createObjectURL: undefined })
    const result = browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))
    expect(result.started).toBe(false)
    expect(await result).toBe('failed')
  })

  it('stops listening when the click throws', () => {
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('no')
    })
    const remove = vi.spyOn(window, 'removeEventListener')
    expect(() => browserBridge(SHELL_V2).saveFile('a.csv', new Blob(['x']))).toThrow('no')
    expect(remove).toHaveBeenCalledWith(SAVE_OUTCOME_EVENT, expect.any(Function))
  })

  it('leaves a shell of bridgeVersion 1, which cannot report, saying saved at the click', async () => {
    clickSpy()
    expect(await browserBridge({ bridgeVersion: 1, platform: 'windows', keys: 'pc' }).saveFile('a.csv', new Blob(['x']))).toBe('saved')
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
