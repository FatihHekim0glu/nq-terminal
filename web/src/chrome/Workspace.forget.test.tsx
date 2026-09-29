// FORGET NAME on the workspace that owns the layout (roadmap #14): the handle drops the saved recipe and gives the
// layout back to the screen, so later edits are remembered for the screen again and RESET does not bring the
// forgotten workspace's panels back. The real Workspace runs over in-memory stores.
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { WORKSPACES } from '../copy/workspaces'
import { fillCopy } from '../copy/workspace'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import { createWorkspacesStore } from '../state/workspaces'
import Workspace, { type ShownLayout, type WorkspaceHandle } from './Workspace'
import { BUILT_SCREENS, type ScreenRegistry } from './WorkspaceScreens'

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

function command(code: string): ParsedCommand {
  const mnemonic = findMnemonic(code)
  if (!mnemonic) throw new Error(code)
  return { mnemonic, context: null, contextSource: 'none', args: {}, canonical: code }
}

const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }

function renderWorkspace() {
  const ref = createRef<WorkspaceHandle>()
  const layouts = createLayoutsStore(memoryStorage())
  const linkGroups = createLinkGroupsStore(memoryStorage())
  const workspaces = createWorkspacesStore(memoryStorage())
  const onLayoutChange = vi.fn<(shown: ShownLayout) => void>()
  render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} onLayoutChange={onLayoutChange} layouts={layouts} linkGroups={linkGroups} workspaces={workspaces} />
    </div>,
  )
  return { ref, layouts, workspaces, onLayoutChange }
}

const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']
const CUSTOM_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'LEDG']
const EDITED_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'RUNS']

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

/** Calls a handle method inside act and returns what it returned. */
function call<T>(fn: () => T): T {
  let result!: T
  act(() => {
    result = fn()
  })
  return result
}

/** Replaces panel 4 (focused first) with `code`. */
async function replaceFourth(ref: React.RefObject<WorkspaceHandle | null>, from: string, code: string, titles: string[]): Promise<void> {
  act(() => screen.getByRole('group', { name: `${from} content` }).focus())
  act(() => ref.current?.run(command(code), 'replace'))
  await waitFor(() => expect(panelTitles()).toEqual(titles))
}

describe('forgetWorkspace on the handle', () => {
  it('drops the saved workspace and gives the layout back to the screen', async () => {
    const { ref, workspaces, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'ALPHA' })
    expect(call(() => ref.current?.forgetWorkspace('ALPHA'))).toBe(fillCopy(WORKSPACES.forgotten, { name: 'ALPHA' }))
    // A second FORGET finds nothing.
    expect(call(() => ref.current?.forgetWorkspace('ALPHA'))).toBe(fillCopy(WORKSPACES.missing, { name: 'ALPHA' }))
    expect(Object.keys(workspaces.getState().list)).toEqual([])
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: null })
    // The panels stay as they were.
    expect(panelTitles()).toEqual(HOME_TITLES)
  })

  it('says Forgot ALPHA. for the workspace that owns the layout', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    expect(call(() => ref.current?.forgetWorkspace('ALPHA'))).toBe('Forgot ALPHA.')
  })

  it('later edits are saved for the shown screen again, not lost as unsaved edits of the forgotten workspace', async () => {
    const { ref, layouts, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    call(() => ref.current?.forgetWorkspace('ALPHA'))
    expect(layouts.getState().layouts.HOME).toBeUndefined()
    await replaceFourth(ref, 'REG', 'LEDG', CUSTOM_TITLES)
    expect(layouts.getState().layouts.HOME).toBeDefined()
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
  })

  it('RESET after FORGET does not bring the forgotten workspace panels back', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    await replaceFourth(ref, 'REG', 'LEDG', CUSTOM_TITLES)
    call(() => ref.current?.saveWorkspace('ALPHA'))
    await replaceFourth(ref, 'LEDG', 'RUNS', EDITED_TITLES)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'ALPHA' })
    expect(call(() => ref.current?.forgetWorkspace('ALPHA'))).toBe('Forgot ALPHA.')
    expect(call(() => ref.current?.resetLayout())).toBe('reset')
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(panelTitles()).not.toEqual(CUSTOM_TITLES)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: null })
  })

  it('names a workspace that is not saved, and changes nothing', async () => {
    const { ref, workspaces, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    const calls = onLayoutChange.mock.calls.length
    expect(call(() => ref.current?.forgetWorkspace('NOPE'))).toBe('No workspace named NOPE. LOAD lists the saved ones.')
    expect(call(() => ref.current?.forgetWorkspace('NOPE'))).toBe(fillCopy(WORKSPACES.missing, { name: 'NOPE' }))
    expect(Object.keys(workspaces.getState().list)).toEqual(['ALPHA'])
    expect(onLayoutChange.mock.calls.length).toBe(calls)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'ALPHA' })
  })

  it('takes a name in any case, trimmed, as SAVE and LOAD do', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    expect(call(() => ref.current?.forgetWorkspace(' alpha '))).toBe('Forgot ALPHA.')
    expect(workspaces.getState().list).toEqual({})
  })

  it('forgetting a workspace that does not own the layout leaves the owner as it is', async () => {
    const { ref, workspaces, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    call(() => ref.current?.saveWorkspace('BRAVO'))
    expect(call(() => ref.current?.forgetWorkspace('ALPHA'))).toBe('Forgot ALPHA.')
    expect(Object.keys(workspaces.getState().list)).toEqual(['BRAVO'])
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'BRAVO' })
  })

  it('UNDO to a step taken in a forgotten workspace comes back as the screen, not as a ghost workspace', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('ALPHA'))
    await replaceFourth(ref, 'REG', 'LEDG', CUSTOM_TITLES)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'ALPHA' })
    call(() => ref.current?.forgetWorkspace('ALPHA'))
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: null })
  })
})
