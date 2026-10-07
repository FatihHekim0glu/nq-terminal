// Test helper (imported by *.test.* files only): a bridge whose every member is a spy, to install with
// installBridge so a test can see which calls the page makes through the bridge.
import { vi } from 'vitest'
import type { SaveOutcome, SaveResult, ShellBridge } from './index'

export function savedResult(started = true): SaveResult {
  return Object.assign(Promise.resolve(started ? ('saved' as const) : ('failed' as const)), { started })
}

/** A started save that ends as `outcome`, or whose promise rejects (`'rejects'`), as a shell may answer it. */
export function endedResult(outcome: SaveOutcome | 'rejects'): SaveResult {
  const ended = outcome === 'rejects' ? Promise.reject(new Error('the shell went away')) : Promise.resolve(outcome)
  return Object.assign(ended, { started: true })
}

export function fakeBridge(overrides: Partial<ShellBridge> = {}): ShellBridge {
  return {
    bridgeVersion: 9,
    platform: 'windows',
    keys: 'pc',
    ibSnapshot: null,
    saveFile: vi.fn(() => savedResult()),
    copyText: vi.fn(async () => true),
    copyImage: vi.fn(async () => true),
    canCopyImage: vi.fn(() => true),
    ...overrides,
  }
}
