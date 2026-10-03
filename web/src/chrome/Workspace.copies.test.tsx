// The copies the workspace store's merge keeps beside a name (03 section 10.2), "<name> (conflict)" and
// "<name> (imported)": the handle loads and forgets them by their stored name, so a copy can be opened, kept under
// a name of its own with SAVE, and dropped with FORGET, and the 12 places they share with the saved workspaces can
// always be freed. The real Workspace runs over in-memory stores.
// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseLine, type LineResult } from '../commands/line'
import type { CommandIndexData } from '../commands/types'
import { WORKSPACES } from '../copy/workspaces'
import { fillCopy } from '../copy/workspace'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import { MAX_WORKSPACES, WORKSPACES_KEY, createWorkspacesStore, type Recipe } from '../state/workspaces'
import Workspace, { type WorkspaceHandle } from './Workspace'
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

function memoryStorage(seed: Readonly<Record<string, string>> = {}): SafeStorage {
  const data = new Map<string, string>(Object.entries(seed))
  return {
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => data.delete(key) || true,
  }
}

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: [],
  registry_error: null,
}

const parse = (line: string): LineResult => parseLine(line, { index: INDEX })

const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }
const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']
const NO_GROUPS = { A: null, B: null, C: null }
const LEDG: Recipe = { version: 1, panels: [{ line: 'LEDG', group: '-', ref: null, direction: 'right' }], groups: NO_GROUPS }
const RUNS: Recipe = { version: 1, panels: [{ line: 'RUNS', group: '-', ref: null, direction: 'right' }], groups: NO_GROUPS }

/** A saved list as the store's cache holds it after a merge: MINE, its two copies, and `more` plain names. */
function storedList(more: number): Record<string, Recipe> {
  const plain = Object.fromEntries(Array.from({ length: more }, (_, i) => [`DESK_${String.fromCharCode(65 + i)}`, LEDG]))
  return { MINE: LEDG, 'MINE (conflict)': RUNS, 'MINE (imported)': LEDG, ...plain }
}

function renderWorkspace(list: Record<string, Recipe>) {
  const ref = createRef<WorkspaceHandle>()
  const seed = { [WORKSPACES_KEY]: JSON.stringify({ version: 1, list, last: 'MINE' }) }
  const workspaces = createWorkspacesStore(memoryStorage(seed))
  render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} layouts={createLayoutsStore(memoryStorage())} linkGroups={createLinkGroupsStore(memoryStorage())} workspaces={workspaces} />
    </div>,
  )
  return { ref, workspaces }
}

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

function call<T>(fn: () => T): T {
  let result!: T
  act(() => {
    result = fn()
  })
  return result
}

describe('copies kept beside a workspace name', () => {
  it('LOAD of a copy rebuilds its panels and makes it the last workspace, whatever the case typed', async () => {
    const { ref, workspaces } = renderWorkspace(storedList(0))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(call(() => ref.current?.loadWorkspace('MINE (conflict)', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'MINE (conflict)' }))
    await waitFor(() => expect(panelTitles()).toEqual(['RUNS']))
    expect(workspaces.getState().last).toBe('MINE (conflict)')
    expect(call(() => ref.current?.loadWorkspace(' mine (IMPORTED) ', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'MINE (imported)' }))
    await waitFor(() => expect(panelTitles()).toEqual(['LEDG']))
  })

  it('a loaded copy can be kept under a name of its own with SAVE, then dropped with FORGET', async () => {
    const { ref, workspaces } = renderWorkspace(storedList(0))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.loadWorkspace('MINE (conflict)', parse))
    await waitFor(() => expect(panelTitles()).toEqual(['RUNS']))
    expect(call(() => ref.current?.saveWorkspace('THEIRS'))).toBe(fillCopy(WORKSPACES.savedOne, { name: 'THEIRS' }))
    expect(call(() => ref.current?.forgetWorkspace('mine (conflict)'))).toBe(fillCopy(WORKSPACES.forgotten, { name: 'MINE (conflict)' }))
    expect(Object.keys(workspaces.getState().list)).toEqual(['MINE', 'MINE (imported)', 'THEIRS'])
    expect(workspaces.getState().list.THEIRS?.panels.map((p) => p.line)).toEqual(['RUNS'])
  })

  it('when copies fill the 12 places, FORGET of a copy frees one and SAVE works again', async () => {
    const { ref, workspaces } = renderWorkspace(storedList(MAX_WORKSPACES - 3))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(Object.keys(workspaces.getState().list)).toHaveLength(MAX_WORKSPACES)
    expect(call(() => ref.current?.saveWorkspace('NEWNAME'))).toBe(WORKSPACES.full)
    expect(call(() => ref.current?.forgetWorkspace('MINE (imported)'))).toBe(fillCopy(WORKSPACES.forgotten, { name: 'MINE (imported)' }))
    expect(call(() => ref.current?.saveWorkspace('NEWNAME'))).toBe(fillCopy(WORKSPACES.saved, { name: 'NEWNAME', n: 4 }))
    expect(Object.keys(workspaces.getState().list)).toHaveLength(MAX_WORKSPACES)
  })

  it('a copy of a name that is not stored, or another suffix, is still "no workspace named"', async () => {
    const { ref } = renderWorkspace(storedList(0))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(call(() => ref.current?.loadWorkspace('OTHER (conflict)', parse))).toBe(fillCopy(WORKSPACES.missing, { name: 'OTHER (conflict)' }))
    expect(call(() => ref.current?.forgetWorkspace('MINE (other)'))).toBe(fillCopy(WORKSPACES.missing, { name: 'MINE (OTHER)' }))
  })
})
