// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBridge } from './bridge.testUtil'
import { bridgeClipboard, getBridge, installBridge } from './index'

afterEach(() => {
  installBridge(null)
  Reflect.deleteProperty(window, '__NQT_SHELL__')
  vi.restoreAllMocks()
})

describe('getBridge', () => {
  it('is the browser bridge, bridgeVersion 0, where no shell injected anything', () => {
    const bridge = getBridge()
    expect(bridge.bridgeVersion).toBe(0)
    expect(bridge.platform).toBe('browser')
    expect(bridge.keys).toBe('pc')
  })

  it('reads what the shell injected before the page scripts ran', () => {
    Object.defineProperty(window, '__NQT_SHELL__', { value: { bridgeVersion: 1, platform: 'windows', keys: 'pc' }, configurable: true })
    installBridge(null)
    expect(getBridge().bridgeVersion).toBe(1)
    expect(getBridge().platform).toBe('windows')
  })

  it('returns the same bridge each time, and the installed one once a test installs it', () => {
    expect(getBridge()).toBe(getBridge())
    const fake = fakeBridge()
    installBridge(fake)
    expect(getBridge()).toBe(fake)
  })
})

describe('bridgeClipboard', () => {
  it('writes the text through bridge.copyText', async () => {
    const bridge = fakeBridge()
    installBridge(bridge)
    await bridgeClipboard().writeText('https://x/#go=EQ')
    expect(bridge.copyText).toHaveBeenCalledWith('https://x/#go=EQ')
  })

  it('rejects where the bridge could not copy, as a refusing clipboard does', async () => {
    installBridge(fakeBridge({ copyText: vi.fn(async () => false) }))
    await expect(bridgeClipboard().writeText('x')).rejects.toThrow()
  })
})
