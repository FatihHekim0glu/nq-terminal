import { describe, expect, it } from 'vitest'
import { BROWSER_SHELL, detectShell, readInjectedShell } from './detect'

describe('detectShell: what the shell injected before the page scripts ran', () => {
  it('reports bridgeVersion 0, the browser and PC keys when nothing was injected', () => {
    expect(detectShell(undefined)).toEqual({ bridgeVersion: 0, platform: 'browser', keys: 'pc' })
    expect(detectShell(null)).toEqual(BROWSER_SHELL)
    expect(BROWSER_SHELL.bridgeVersion).toBe(0)
  })

  it('reads the version, platform and keys of an injected object', () => {
    expect(detectShell({ bridgeVersion: 1, platform: 'windows', keys: 'pc' })).toEqual({ bridgeVersion: 1, platform: 'windows', keys: 'pc' })
    expect(detectShell({ bridgeVersion: 2, platform: 'macos', keys: 'mac' })).toEqual({ bridgeVersion: 2, platform: 'macos', keys: 'mac' })
  })

  it.each([
    ['a string', 'windows'],
    ['a number', 7],
    ['an array', [1, 'windows', 'pc']],
    ['a version that is not a whole number', { bridgeVersion: 1.5, platform: 'windows', keys: 'pc' }],
    ['a negative version', { bridgeVersion: -1, platform: 'windows', keys: 'pc' }],
    ['a version given as text', { bridgeVersion: '1', platform: 'windows', keys: 'pc' }],
    ['no version', { platform: 'windows', keys: 'pc' }],
    ['an unknown platform', { bridgeVersion: 1, platform: 'amiga', keys: 'pc' }],
    ['a version of 0', { bridgeVersion: 0, platform: 'windows', keys: 'pc' }],
  ])('treats %s as no shell at all', (_label, injected) => {
    expect(detectShell(injected)).toEqual(BROWSER_SHELL)
  })

  it('takes the keys from the platform when the injected keys are missing or unknown', () => {
    expect(detectShell({ bridgeVersion: 1, platform: 'macos' }).keys).toBe('mac')
    expect(detectShell({ bridgeVersion: 1, platform: 'windows', keys: 'dvorak' }).keys).toBe('pc')
  })

  it('returns a frozen copy and never writes to what was injected', () => {
    const injected = Object.freeze({ bridgeVersion: 1, platform: 'windows', keys: 'pc' })
    const shell = detectShell(injected)
    expect(Object.isFrozen(shell)).toBe(true)
    expect(shell).not.toBe(injected)
    expect(Object.isFrozen(BROWSER_SHELL)).toBe(true)
  })
})

describe('readInjectedShell: the one global the page reads', () => {
  it('reads __NQT_SHELL__ and nothing else', () => {
    const scope = { __NQT_SHELL__: { bridgeVersion: 3, platform: 'windows', keys: 'pc' }, other: () => 'no' }
    expect(readInjectedShell(scope)).toEqual({ bridgeVersion: 3, platform: 'windows', keys: 'pc' })
  })

  it('is the browser where the global is absent or reading it throws', () => {
    expect(readInjectedShell({})).toEqual(BROWSER_SHELL)
    const hostile = Object.defineProperty({}, '__NQT_SHELL__', { get: () => { throw new Error('no') } })
    expect(readInjectedShell(hostile)).toEqual(BROWSER_SHELL)
  })

  it('reads bridgeVersion 0 in the test browser, where no shell injected anything', () => {
    expect(readInjectedShell().bridgeVersion).toBe(0)
  })
})
