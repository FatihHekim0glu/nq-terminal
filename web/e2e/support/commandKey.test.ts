// Pins the modifier of the command-line focus key per host platform: Cmd on a Mac, Ctrl everywhere else, the two tables of
// src/chrome/CommandLine.keys.ts (Cmd+K only on the Mac table). A wrong modifier on the Mac runner failed about 60 offline WebKit tests (run 38207205886).
import { describe, expect, it } from 'vitest'
import { COMMAND_LINE_KEY, commandLineKey, isWebkitOnMac } from './commandKey.ts'

describe('commandLineKey', () => {
  it('is Meta+k on darwin', () => {
    expect(commandLineKey('darwin')).toBe('Meta+k')
  })

  it.each(['win32', 'linux', 'freebsd', ''])('is Control+k on %s', (platform) => {
    expect(commandLineKey(platform)).toBe('Control+k')
  })

  it('follows the host for the constant the specs import', () => {
    expect(COMMAND_LINE_KEY).toBe(commandLineKey(process.platform))
  })

})

describe('isWebkitOnMac', () => {
  it('is true only for a WebKit project on darwin', () => {
    expect(isWebkitOnMac('offline-webkit', 'darwin')).toBe(true)
    expect(isWebkitOnMac('offline-webkit-demo', 'darwin')).toBe(true)
    expect(isWebkitOnMac('offline', 'darwin')).toBe(false)
    expect(isWebkitOnMac('chromium', 'darwin')).toBe(false)
    expect(isWebkitOnMac('offline-webkit', 'win32')).toBe(false)
  })
})
