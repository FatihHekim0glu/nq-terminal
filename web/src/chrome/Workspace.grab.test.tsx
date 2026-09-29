// GRAB through the Workspace (roadmap 15): the handle's grab() for GRAB <GO> and the Options rows of each
// panel. The grab itself (src/export/grab/run.ts) is a dynamic import, mocked here: what matters is that the
// Workspace hands it the right panel, and that nothing is requested from the API on the way.
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiQueryKey } from '../api/queryKey'
import { GRAB } from '../copy/grab'
import { LINK_COPY } from '../copy/linkCopy'
import { PANEL } from '../copy/workspace'
import type { GrabRequest } from '../export/grab/run'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import Workspace, { type WorkspaceHandle } from './Workspace'
import { BUILT_SCREENS, type ScreenRegistry } from './WorkspaceScreens'

const grabPanel = vi.hoisted(() => vi.fn<(req: unknown) => Promise<boolean>>(async () => true))
vi.mock('../export/grab/run', () => ({ grabPanel }))

// A Workspace whose dockview never reports ready has no panels, so nothing is focused: the state a GRAB typed
// before the workspace chunk has finished loading meets.
const gate = vi.hoisted(() => ({ holdReady: false }))
vi.mock('./WorkspaceController', async (importOriginal) => {
  const real = await importOriginal<typeof import('./WorkspaceController')>()
  return {
    ...real,
    createWorkspaceController: (env: Parameters<typeof real.createWorkspaceController>[0]) => {
      const controller = real.createWorkspaceController(env)
      return gate.holdReady ? { ...controller, onReady: () => undefined } : controller
    },
  }
})

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const fetchSpy = vi.fn(async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})

beforeEach(() => {
  gate.holdReady = false
  grabPanel.mockClear()
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})

function memoryStorage(): SafeStorage {
  const data = new Map<string, string>()
  return {
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => data.delete(key) || true,
  }
}

const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }
const HEALTH = { now_utc: '2026-09-26T12:00:00Z', nautilus_version: '1.231.0', kill_switch_on: false, fixture_mode: true }

function renderWorkspace(client?: QueryClient) {
  const ref = createRef<WorkspaceHandle>()
  const workspace = (
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} layouts={createLayoutsStore(memoryStorage())} linkGroups={createLinkGroupsStore(memoryStorage())} />
    </div>
  )
  const utils = render(client ? <QueryClientProvider client={client}>{workspace}</QueryClientProvider> : workspace)
  return { ...utils, ref }
}

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

/** The dockview id of panel n (1-based, reading order). */
function panelId(n: number): string {
  return document.querySelectorAll('[data-nqt-panel]')[n - 1]?.getAttribute('data-nqt-panel') ?? ''
}

function received(): GrabRequest {
  const call = grabPanel.mock.calls.at(-1)
  if (!call) throw new Error('the grab runner was not called')
  return call[0] as GrabRequest
}

// HOME: 1 NQ GP 1d (group A), 2 27F MON (A), 3 volmanaged_v0 EQ (B), 4 REG (-).
async function ready(): Promise<void> {
  await waitFor(() => expect(panelTitles()).toHaveLength(4))
}

/** Calls grab inside act, as the command line does, and returns what it answered. */
function grab(ref: React.RefObject<WorkspaceHandle | null>, target?: 'file' | 'clipboard'): boolean {
  let answer = false
  act(() => {
    answer = ref.current?.grab(target) ?? false
  })
  return answer
}

describe('WorkspaceHandle.grab', () => {
  it('answers false and grabs nothing while no panel is focused', async () => {
    gate.holdReady = true
    const { ref } = renderWorkspace()
    expect(panelTitles()).toEqual([])
    expect(grab(ref)).toBe(false)
    expect(grab(ref, 'clipboard')).toBe(false)
    await Promise.resolve()
    expect(grabPanel).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('grabs the panel the command line addresses when none was clicked: the first', async () => {
    const { ref } = renderWorkspace()
    await ready()
    expect(grab(ref)).toBe(true)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received()).toMatchObject({ panelId: panelId(1), code: 'GP', number: 1, group: 'A' })
  })

  it('grabs the focused panel: its id, mnemonic, number and link group reach the runner, saving a file', async () => {
    const { ref } = renderWorkspace()
    await ready()
    act(() => screen.getByRole('group', { name: 'volmanaged_v0 EQ content' }).focus())
    expect(grab(ref)).toBe(true)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received()).toEqual({ panelId: panelId(3), code: 'EQ', number: 3, group: 'B', health: null, target: 'file' })
  })

  it('follows the focus from one panel to another', async () => {
    const { ref } = renderWorkspace()
    await ready()
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    expect(grab(ref)).toBe(true)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received()).toMatchObject({ panelId: panelId(1), code: 'GP', number: 1, group: 'A' })
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    expect(grab(ref)).toBe(true)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(2))
    expect(received()).toMatchObject({ panelId: panelId(4), code: 'REG', number: 4, group: '-' })
  })

  it('copies to the clipboard when asked to', async () => {
    const { ref } = renderWorkspace()
    await ready()
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    expect(grab(ref, 'clipboard')).toBe(true)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received().target).toBe('clipboard')
  })

  it('passes the cached health answer to the caption, and null when the cache holds none', async () => {
    const client = new QueryClient()
    client.setQueryData(apiQueryKey('/api/health'), HEALTH)
    const { ref } = renderWorkspace(client)
    await ready()
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    grab(ref)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received().health).toEqual({ now_utc: '2026-09-26T12:00:00Z', fixture_mode: true })
    cleanup()
    grabPanel.mockClear()
    const empty = renderWorkspace(new QueryClient())
    await ready()
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    grab(empty.ref)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received().health).toBeNull()
  })

  it('makes no request of any kind', async () => {
    const client = new QueryClient()
    client.setQueryData(apiQueryKey('/api/health'), HEALTH)
    const { ref } = renderWorkspace(client)
    await ready()
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    grab(ref)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('the Options menu of a panel', () => {
  function openOptions(title: string): string[] {
    act(() => within(screen.getByRole('region', { name: title })).getByRole('button', { name: PANEL.options }).click())
    return within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent ?? '')
  }

  function choose(label: string): void {
    act(() => within(screen.getByRole('menu')).getByRole('menuitem', { name: label }).click())
  }

  it('lists Grab as image, with the copy link rows still last', async () => {
    renderWorkspace()
    await ready()
    const labels = openOptions('NQ GP 1d')
    expect(labels).toContain(GRAB.menuImage)
    expect(labels).not.toContain(GRAB.menuCopy)
    expect(labels.slice(-2)).toEqual([LINK_COPY.copyLink, LINK_COPY.copyMarkdown])
    expect(labels).toContain(PANEL.related)
  })

  it('lists Copy image too where the browser can copy an image', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => {}) }, configurable: true })
    vi.stubGlobal('ClipboardItem', class {})
    renderWorkspace()
    await ready()
    const labels = openOptions('NQ GP 1d')
    expect(labels).toContain(GRAB.menuImage)
    expect(labels).toContain(GRAB.menuCopy)
    expect(labels.slice(-2)).toEqual([LINK_COPY.copyLink, LINK_COPY.copyMarkdown])
  })

  it('offers real buttons, so the keyboard reaches them like the other rows', async () => {
    renderWorkspace()
    await ready()
    openOptions('NQ GP 1d')
    const row = within(screen.getByRole('menu')).getByRole('menuitem', { name: GRAB.menuImage })
    expect(row.tagName).toBe('BUTTON')
    row.focus()
    expect(document.activeElement).toBe(row)
  })

  it('grabs the panel it was opened from, not the focused one', async () => {
    renderWorkspace()
    await ready()
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    openOptions('volmanaged_v0 EQ')
    choose(GRAB.menuImage)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received()).toEqual({ panelId: panelId(3), code: 'EQ', number: 3, group: 'B', health: null, target: 'file' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('copies the image for Copy image, reading the health answer as it is when the row is chosen', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => {}) }, configurable: true })
    vi.stubGlobal('ClipboardItem', class {})
    const client = new QueryClient()
    const { ref } = renderWorkspace(client)
    await ready()
    expect(ref.current).not.toBeNull()
    openOptions('27F MON')
    client.setQueryData(apiQueryKey('/api/health'), HEALTH)
    choose(GRAB.menuCopy)
    await waitFor(() => expect(grabPanel).toHaveBeenCalledTimes(1))
    expect(received()).toMatchObject({ panelId: panelId(2), code: 'MON', number: 2, group: 'A', target: 'clipboard' })
    expect(received().health).toEqual({ now_utc: '2026-09-26T12:00:00Z', fixture_mode: true })
  })
})
