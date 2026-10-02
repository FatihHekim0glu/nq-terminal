// @vitest-environment jsdom
// The key actions on demand (v2.1 polish, SHELL-DIET-4): KeyToolbar.actions.ts loads as a chunk of its own and the shell
// carries only the facade (KeyToolbar.lazy.ts). A key pressed before the chunk has arrived runs when it does, in the order
// pressed; after that it runs in the same tick; a chunk that cannot be fetched is reported and the next key tries again.
// vi.resetModules() gives each test a fresh facade with nothing loaded, the way the page is at first paint.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandLineHandle } from './CommandLine'
import type { ChromeEnv } from './KeyToolbar.actions'

function fakeCmd() {
  const calls: string[] = []
  const cmd: CommandLineHandle = {
    focus: () => void calls.push('focus'),
    insert: () => {},
    runLine: (line) => void calls.push(`run ${line}`),
    cancel: () => void calls.push('cancel'),
    walkHistory: () => {},
    help: () => {},
    related: () => {},
    showMenu: () => {},
    takeCount: () => null,
    lineText: () => '',
  }
  return { cmd, calls }
}

function envOf(cmd: CommandLineHandle): ChromeEnv {
  return { cmd: () => cmd, workspace: () => null, focusedPanelId: () => null, focusedCode: () => null, focusedContextLine: () => null, toggleKeymap: () => {} }
}

async function fresh() {
  vi.resetModules()
  const lazy = await import('./KeyToolbar.lazy')
  const messages = await import('./MessageLine.store')
  messages.resetMessage()
  return { lazy, messages }
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.doUnmock('./KeyToolbar.actions')
})

describe('createLazyChrome before the module has loaded', () => {
  it('runs a key pressed early once the module arrives, and keeps the order pressed', async () => {
    const { lazy } = await fresh()
    const { cmd, calls } = fakeCmd()
    const chrome = lazy.createLazyChrome(envOf(cmd))
    chrome.runAndFocus('REG')
    chrome.key('esc')
    chrome.runAndFocus('LEDG')
    expect(calls).toEqual([])
    await vi.waitFor(() => expect(calls).toEqual(['run REG', 'focus', 'cancel', 'run LEDG', 'focus']))
  })

  it('fetches the module once for any number of facades and keys', async () => {
    const { lazy } = await fresh()
    const { cmd } = fakeCmd()
    const first = lazy.loadKeyActions()
    expect(lazy.loadKeyActions()).toBe(first)
    const a = lazy.createLazyChrome(envOf(cmd))
    const b = lazy.createLazyChrome(envOf(cmd))
    a.preload()
    b.preload()
    expect(await first).toBe(await lazy.loadKeyActions())
  })
})

describe('createLazyChrome after the module has loaded', () => {
  it('runs a key in the same tick, as before the split', async () => {
    const { lazy } = await fresh()
    const { cmd, calls } = fakeCmd()
    const chrome = lazy.createLazyChrome(envOf(cmd))
    await lazy.loadKeyActions()
    chrome.runAndFocus('HOME')
    expect(calls).toEqual(['run HOME', 'focus'])
    chrome.key('esc')
    expect(calls.at(-1)).toBe('cancel')
  })

  it('routes a nav control and a global key to the same actions the module has', async () => {
    const { lazy } = await fresh()
    const { cmd, calls } = fakeCmd()
    const chrome = lazy.createLazyChrome({ ...envOf(cmd), focusedContextLine: () => 'NQ1 Index' })
    await lazy.loadKeyActions()
    chrome.nav('context')
    expect(calls).toEqual(['run NQ1 Index', 'focus'])
    const toggled = vi.fn()
    const withToggle = lazy.createLazyChrome({ ...envOf(cmd), toggleKeymap: toggled })
    withToggle.global({ kind: 'keymap' })
    expect(toggled).toHaveBeenCalledTimes(1)
  })

  it('queues behind an earlier key still waiting, so the order pressed holds across the switch to synchronous', async () => {
    const { lazy } = await fresh()
    const { cmd, calls } = fakeCmd()
    const chrome = lazy.createLazyChrome(envOf(cmd))
    chrome.runAndFocus('A')
    await lazy.loadKeyActions()
    chrome.runAndFocus('B')
    await vi.waitFor(() => expect(calls).toEqual(['run A', 'focus', 'run B', 'focus']))
  })
})

describe('createLazyChrome when the chunk cannot be fetched', () => {
  it('says so on the message line, runs nothing, and lets the next key try again', async () => {
    vi.resetModules()
    vi.doMock('./KeyToolbar.actions', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const lazy = await import('./KeyToolbar.lazy')
    const messages = await import('./MessageLine.store')
    const { MESSAGES } = await import('../copy/chrome')
    messages.resetMessage()
    const { cmd, calls } = fakeCmd()
    const chrome = lazy.createLazyChrome(envOf(cmd))
    chrome.runAndFocus('REG')
    await vi.waitFor(() => expect(messages.useMessage.getState().text).toBe(MESSAGES.keysFailed))
    expect(calls).toEqual([])
    // The failure is forgotten: the next key fetches again (the mock fails again, so it says so again).
    const before = messages.useMessage.getState().id
    chrome.key('esc')
    await vi.waitFor(() => expect(messages.useMessage.getState().id).toBeGreaterThan(before))
    expect(calls).toEqual([])
  })

  it('stays silent when only the idle preload fails: the first key reports it', async () => {
    vi.resetModules()
    vi.doMock('./KeyToolbar.actions', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const lazy = await import('./KeyToolbar.lazy')
    const messages = await import('./MessageLine.store')
    messages.resetMessage()
    const { cmd } = fakeCmd()
    lazy.createLazyChrome(envOf(cmd)).preload()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(messages.useMessage.getState().text).toBe('')
  })
})

describe('the copy', () => {
  it('has a failure line in UK English with no dash', async () => {
    const { MESSAGES } = await import('../copy/chrome')
    expect(MESSAGES.keysFailed).toBe('The keys could not load. Reload the page to try again.')
    expect(MESSAGES.keysFailed).not.toMatch(/[\u2013\u2014]/)
  })
})
