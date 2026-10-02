// @vitest-environment jsdom
// The command line's menus and suggestion sheet on demand (v2.1 polish, SHELL-DIET-4): the builders, the menu sheet and the
// suggestion sheet load as chunks of their own, and the shell carries only the loader (CommandLine.menus.load.ts). A menu
// asked for before its chunk has arrived opens when it does; after that it opens in the same tick; a chunk that cannot be
// fetched is reported and the next ask tries again. vi.resetModules() gives each test a loader with nothing loaded, the way
// the page is at first paint.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function fresh() {
  vi.resetModules()
  const load = await import('./CommandLine.menus.load')
  const messages = await import('./MessageLine.store')
  messages.resetMessage()
  return { load, messages }
}

afterEach(() => {
  vi.doUnmock('./CommandLine.menus')
  vi.doUnmock('./CommandLine.menu')
  vi.doUnmock('./CommandLine.sheet')
})

describe('withMenus', () => {
  it('runs with the builders once they arrive, and keeps the order asked', async () => {
    const { load } = await fresh()
    const seen: string[] = []
    load.withMenus((m) => seen.push(`last:${m.lastMenu([]).key}`))
    load.withMenus((m) => seen.push(`help:${m.helpMenu('REG').key}`))
    expect(seen).toEqual([])
    await vi.waitFor(() => expect(seen).toEqual(['last:last', 'help:help:REG']))
  })

  it('runs in the same tick once they are here', async () => {
    const { load } = await fresh()
    await load.loadMenus()
    const seen: string[] = []
    load.withMenus((m) => seen.push(m.lastMenu(['NQ GP']).items[0]?.label ?? ''))
    expect(seen).toEqual(['NQ GP'])
  })

  it('fetches each chunk once, however often it is asked, and preloadMenus starts all three', async () => {
    const { load } = await fresh()
    expect(load.loadMenus()).toBe(load.loadMenus())
    expect(load.loadMenuSheet()).toBe(load.loadMenuSheet())
    expect(load.loadSuggestionSheet()).toBe(load.loadSuggestionSheet())
    load.preloadMenus()
    await load.loadCommandLineParts()
  })

  it('says so on the message line when the chunk cannot be fetched, runs nothing, and tries again on the next ask', async () => {
    vi.resetModules()
    vi.doMock('./CommandLine.menus', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const load = await import('./CommandLine.menus.load')
    const messages = await import('./MessageLine.store')
    const { MESSAGES } = await import('../copy/chrome')
    messages.resetMessage()
    const run = vi.fn()
    load.withMenus(run)
    await vi.waitFor(() => expect(messages.useMessage.getState().text).toBe(MESSAGES.menusFailed))
    const first = messages.useMessage.getState().id
    load.withMenus(run)
    await vi.waitFor(() => expect(messages.useMessage.getState().id).toBeGreaterThan(first))
    expect(run).not.toHaveBeenCalled()
  })

  it('stays silent when only the preload fails: the first menu asked for reports it', async () => {
    vi.resetModules()
    vi.doMock('./CommandLine.menus', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const load = await import('./CommandLine.menus.load')
    const messages = await import('./MessageLine.store')
    messages.resetMessage()
    load.preloadMenus()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(messages.useMessage.getState().text).toBe('')
  })
})

describe('useMenuSheet and useSuggestionSheet', () => {
  it('are null until their chunk has arrived, then the component', async () => {
    const { load } = await fresh()
    const menu = renderHook(() => load.useMenuSheet())
    const sheet = renderHook(() => load.useSuggestionSheet())
    expect(menu.result.current).toBeNull()
    expect(sheet.result.current).toBeNull()
    await waitFor(() => expect(menu.result.current).toBeTypeOf('function'))
    await waitFor(() => expect(sheet.result.current).toBeTypeOf('function'))
  })

  it('are the component at the first render when the chunk is already here', async () => {
    const { load } = await fresh()
    await load.loadCommandLineParts()
    const menu = renderHook(() => load.useMenuSheet())
    const sheet = renderHook(() => load.useSuggestionSheet())
    expect(menu.result.current).toBeTypeOf('function')
    expect(sheet.result.current).toBeTypeOf('function')
  })

  it('say so on the message line when the chunk cannot be fetched, and stay null', async () => {
    vi.resetModules()
    vi.doMock('./CommandLine.menu', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const load = await import('./CommandLine.menus.load')
    const messages = await import('./MessageLine.store')
    const { MESSAGES } = await import('../copy/chrome')
    messages.resetMessage()
    const menu = renderHook(() => load.useMenuSheet())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(menu.result.current).toBeNull()
    expect(messages.useMessage.getState().text).toBe(MESSAGES.menusFailed)
  })
})

describe('the copy', () => {
  it('has a failure line in UK English with no dash', async () => {
    const { MESSAGES } = await import('../copy/chrome')
    expect(MESSAGES.menusFailed).toBe('The menu could not load. Reload the page to try again.')
    expect(MESSAGES.menusFailed).not.toMatch(/[\u2013\u2014]/)
  })
})
