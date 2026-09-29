// Named workspaces (roadmap #14, core): the Workspace handle saves the panels on screen as a recipe of
// command lines and loads one back through the parser, without touching the per-screen layouts.
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { DockviewApi } from 'dockview-react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseLine, type LineResult } from '../commands/line'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import type { CommandIndexData } from '../commands/types'
import { WORKSPACES } from '../copy/workspaces'
import { fillCopy } from '../copy/workspace'
import { LAYOUTS_KEY, createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import { createWorkspacesStore, type Recipe } from '../state/workspaces'
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

function recordingStorage(): SafeStorage & { readonly writes: string[] } {
  const data = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => {
      writes.push(key)
      data.set(key, value)
      return true
    },
    remove: (key) => data.delete(key) || true,
  }
}

function command(code: string, extra: Partial<ParsedCommand> = {}): ParsedCommand {
  const mnemonic = findMnemonic(code)
  if (!mnemonic) throw new Error(code)
  return { mnemonic, context: null, contextSource: 'none', args: {}, canonical: code, ...extra }
}

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
  ],
  universe: ['27F'],
  hypotheses: ['volmanaged_v0'],
  confirmations: [],
  runs: [],
  registry_error: null,
}

/** The parse the command line will hand the handle: the real grammar over a small index. */
const parse = (line: string): LineResult => parseLine(line, { index: INDEX })
/** The same index once the hypothesis has left the registry. */
const parseWithoutHypothesis = (line: string): LineResult => parseLine(line, { index: { ...INDEX, hypotheses: [] } })

const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }

function renderWorkspace(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  const ref = createRef<WorkspaceHandle>()
  const layoutStorage = recordingStorage()
  const layouts = props.layouts ?? createLayoutsStore(layoutStorage)
  const linkGroups = props.linkGroups ?? createLinkGroupsStore(recordingStorage())
  const workspaces = props.workspaces ?? createWorkspacesStore(recordingStorage())
  const onLayoutChange = vi.fn<(shown: ShownLayout) => void>()
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} onLayoutChange={onLayoutChange} {...props} layouts={layouts} linkGroups={linkGroups} workspaces={workspaces} />
    </div>,
  )
  return { ...utils, ref, layouts, layoutStorage, linkGroups, workspaces, onLayoutChange }
}

const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']
const HOME_COMMANDS: ParsedCommand[] = [command('GP'), command('EQ'), command('MON'), command('LEDG')]
const CUSTOM_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'LEDG']
const CUSTOM_GROUPS = ['A', 'A', 'B', '-']
/** CUSTOM_TITLES with panel 4 replaced by RUNS: the edit the RESET tests make. */
const EDITED_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'RUNS']

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

function panelGroups(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-panel]')).map((el) => el.getAttribute('data-group') ?? '')
}

function panelNumbers(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-panel] .ptitle-no')).map((h) => h.textContent ?? '')
}

/** Calls a handle method inside act and returns what it returned. */
function call<T>(fn: () => T): T {
  let result!: T
  act(() => {
    result = fn()
  })
  return result
}

/** HOME with REG replaced by LEDG: a layout that is not the default. */
async function customise(ref: React.RefObject<WorkspaceHandle | null>): Promise<void> {
  await waitFor(() => expect(panelTitles()).toHaveLength(4))
  act(() => screen.getByRole('group', { name: 'REG content' }).focus())
  act(() => ref.current?.run(command('LEDG'), 'replace'))
  await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
}

describe('saveWorkspace and loadWorkspace', () => {
  it('keeps the panels on screen under a name and rebuilds them, titles, numbers and link groups', async () => {
    const { ref, workspaces, linkGroups } = renderWorkspace()
    await customise(ref)
    const numbers = panelNumbers()
    expect(numbers).toEqual(['1-GP', '2-MON', '3-EQ', '4-LEDG'])
    expect(call(() => ref.current?.saveWorkspace('MINE'))).toBe(fillCopy(WORKSPACES.saved, { name: 'MINE', n: 4 }))
    expect(Object.keys(workspaces.getState().list)).toEqual(['MINE'])
    expect(workspaces.getState().last).toBe('MINE')
    // Away to another screen and another link group context, then back.
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    act(() => {
      linkGroups.getState().setContext('A', { kind: 'instrument', value: 'ES' })
    })
    expect(call(() => ref.current?.loadWorkspace('MINE', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'MINE' }))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(panelNumbers()).toEqual(numbers)
    expect(panelGroups()).toEqual(CUSTOM_GROUPS)
    expect(linkGroups.getState().contexts).toEqual({
      A: { kind: 'instrument', value: 'NQ' },
      B: { kind: 'hypothesis', value: 'volmanaged_v0' },
      C: null,
    })
  })

  it('rebuilds the HOME reading sequence 1-GP 2-MON 3-EQ 4-REG from its recipe', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('DESK'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    call(() => ref.current?.loadWorkspace('DESK', parse))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(panelNumbers()).toEqual(['1-GP', '2-MON', '3-EQ', '4-REG'])
    expect(panelGroups()).toEqual(['A', 'A', 'B', '-'])
  })

  it('rebuilds a layout of three columns and one of stacked panels with the same splits', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const lines = ['REG', 'LEDG', 'RUNS']
    const recipe = (direction: 'right' | 'below'): Recipe => ({
      version: 1,
      panels: lines.map((line, i) => ({ line, group: '-', ref: i === 0 ? null : i - 1, direction: i === 0 ? 'right' : direction })),
      groups: { A: null, B: null, C: null },
    })
    workspaces.getState().save('COLUMNS', recipe('right'))
    workspaces.getState().save('STACK', recipe('below'))
    call(() => ref.current?.loadWorkspace('COLUMNS', parse))
    await waitFor(() => expect(panelTitles()).toEqual(lines))
    expect(panelNumbers()).toEqual(['1-REG', '2-LEDG', '3-RUNS'])
    // What dockview built, written down again, is the recipe that built it.
    expect(call(() => ref.current?.saveRecipe('COLUMNS'))).toEqual(recipe('right'))
    call(() => ref.current?.loadWorkspace('STACK', parse))
    await waitFor(() => expect(panelTitles()).toEqual(lines))
    expect(panelNumbers()).toEqual(['1-REG', '2-LEDG', '3-RUNS'])
    expect(call(() => ref.current?.saveRecipe('STACK'))).toEqual(recipe('below'))
  })

  it('takes a name in any case and saves it in capitals', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(call(() => ref.current?.saveWorkspace(' mine '))).toBe(fillCopy(WORKSPACES.saved, { name: 'MINE', n: 4 }))
    expect(Object.keys(workspaces.getState().list)).toEqual(['MINE'])
    expect(call(() => ref.current?.loadWorkspace('mine', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'MINE' }))
  })

  it('says "1 panel" for a single panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    // Nothing has focus yet, so a one panel screen loads as the only panel.
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['LEDG']))
    expect(call(() => ref.current?.saveWorkspace('SOLO'))).toBe(fillCopy(WORKSPACES.savedOne, { name: 'SOLO' }))
  })

  it('refuses a name that is not a workspace name, without saving or moving anything', async () => {
    const { ref, workspaces, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const before = onLayoutChange.mock.calls.length
    for (const name of ['', 'X', '1ST', 'MY DESK', 'HOME', 'RESET', 'INDEX', 'A'.repeat(17)]) {
      expect(call(() => ref.current?.saveWorkspace(name)), name).toBe(WORKSPACES.badName)
    }
    expect(workspaces.getState().list).toEqual({})
    expect(workspaces.getState().last).toBeNull()
    expect(onLayoutChange.mock.calls.length).toBe(before)
  })

  it('says the panels cannot be kept when the store refuses the recipe, and does not take ownership', async () => {
    const { ref, workspaces, onLayoutChange } = renderWorkspace()
    await customise(ref)
    workspaces.setState({ save: () => false })
    const calls = onLayoutChange.mock.calls.length
    expect(call(() => ref.current?.saveWorkspace('MINE'))).toBe(WORKSPACES.notKept)
    expect(workspaces.getState().last).toBeNull()
    expect(onLayoutChange.mock.calls.length).toBe(calls)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
  })

  it('says the workspace is kept for this session only when the browser refuses the write, and still takes ownership', async () => {
    const refusing: SafeStorage = { read: () => null, write: () => false, remove: () => false }
    const workspaces = createWorkspacesStore(refusing)
    const { ref, onLayoutChange } = renderWorkspace({ workspaces })
    await customise(ref)
    expect(call(() => ref.current?.saveWorkspace('MINE'))).toBe(fillCopy(WORKSPACES.savedSession, { name: 'MINE' }))
    expect(workspaces.getState().list.MINE?.panels).toHaveLength(4)
    expect(workspaces.getState().last).toBe('MINE')
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
    // It loads back in this window all the same.
    expect(call(() => ref.current?.loadWorkspace('MINE', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'MINE' }))
  })

  it('refuses a 13th workspace but still replaces one that exists', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const one: Recipe = { version: 1, panels: [{ line: 'REG', group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }
    for (let i = 0; i < 12; i += 1) workspaces.getState().save(`WS_${i}`, one)
    expect(call(() => ref.current?.saveWorkspace('EXTRA'))).toBe(WORKSPACES.full)
    expect(workspaces.getState().list.EXTRA).toBeUndefined()
    expect(call(() => ref.current?.saveWorkspace('WS_5'))).toBe(fillCopy(WORKSPACES.saved, { name: 'WS_5', n: 4 }))
    expect(workspaces.getState().list.WS_5?.panels).toHaveLength(4)
  })

  it('says so when no workspace has that name, and changes nothing', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    const before = onLayoutChange.mock.calls.length
    expect(call(() => ref.current?.loadWorkspace('NOPE', parse))).toBe(fillCopy(WORKSPACES.missing, { name: 'NOPE' }))
    expect(call(() => ref.current?.loadWorkspace('not a name', parse))).toContain('No workspace named')
    expect(panelTitles()).toEqual(HOME_TITLES)
    expect(onLayoutChange.mock.calls.length).toBe(before)
  })

  it('a recipe line that no longer parses refuses the whole load with lineFailed', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    const calls = onLayoutChange.mock.calls.length
    const text = call(() => ref.current?.loadWorkspace('MINE', parseWithoutHypothesis))
    expect(text).toBe(
      fillCopy(WORKSPACES.lineFailed, {
        name: 'MINE',
        line: 'volmanaged_v0 EQ',
        reason: 'volmanaged_v0 is not a known instrument, hypothesis or run',
      }),
    )
    // Nothing was loaded and nothing was recorded: the screen is as it was, and UNDO still goes back one step.
    expect(panelTitles()).toEqual(['REG', 'MT'])
    expect(onLayoutChange.mock.calls.length).toBe(calls)
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
  })

  it('names the first line that fails', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    const recipe: Recipe = {
      version: 1,
      panels: ['REG', 'GONE_V0 EQ', 'LEDG', 'ALSO_GONE EQ'].map((line, i) => ({ line, group: '-', ref: i === 0 ? null : i - 1, direction: 'right' as const })),
      groups: { A: null, B: null, C: null },
    }
    workspaces.getState().save('MIXED', recipe)
    const text = call(() => ref.current?.loadWorkspace('MIXED', parse))
    expect(text).toContain('its line GONE_V0 EQ no longer runs')
    expect(text).toContain('GONE_V0 is not a known instrument, hypothesis or run')
    expect(text).not.toContain('ALSO_GONE')
    expect(panelTitles()).toEqual(HOME_TITLES)
  })

  it('parses every line of the recipe, in order, before it loads', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    const lines = ['REG', 'LEDG', 'RUNS']
    workspaces.getState().save('GOOD', {
      version: 1,
      panels: lines.map((line, i) => ({ line, group: '-' as const, ref: i === 0 ? null : i - 1, direction: 'right' as const })),
      groups: { A: null, B: null, C: null },
    })
    const spy = vi.fn(parse)
    expect(call(() => ref.current?.loadWorkspace('GOOD', spy))).toBe(fillCopy(WORKSPACES.loaded, { name: 'GOOD' }))
    expect(spy.mock.calls.map(([line]) => line)).toEqual(lines)
    await waitFor(() => expect(panelTitles()).toEqual(lines))
  })

  it('refuses a line that parses but is not a screen command, naming why', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    for (const line of ['RESET', 'UNDO', '12', 'LAST', 'INDEX', 'HL momentum', 'NQ']) {
      const recipe: Recipe = { version: 1, panels: [{ line, group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }
      workspaces.getState().save('ODD', recipe)
      const text = call(() => ref.current?.loadWorkspace('ODD', parse))
      expect(text, line).toBe(fillCopy(WORKSPACES.lineFailed, { name: 'ODD', line, reason: WORKSPACES.notScreen }))
    }
    expect(panelTitles()).toEqual(HOME_TITLES)
  })

  it('opens the screen of a NXTW line like any other run', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    const recipe: Recipe = { version: 1, panels: [{ line: 'NXTW LEDG', group: '-', ref: null, direction: 'right' }], groups: { A: null, B: null, C: null } }
    workspaces.getState().save('NEXT', recipe)
    expect(call(() => ref.current?.loadWorkspace('NEXT', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'NEXT' }))
    await waitFor(() => expect(panelTitles()).toEqual(['LEDG']))
  })

  it('sets last on save and on load', async () => {
    const { ref, workspaces } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    call(() => ref.current?.saveWorkspace('AAA'))
    call(() => ref.current?.saveWorkspace('BBB'))
    expect(workspaces.getState().last).toBe('BBB')
    call(() => ref.current?.loadWorkspace('AAA', parse))
    expect(workspaces.getState().last).toBe('AAA')
    call(() => ref.current?.loadWorkspace('NOPE', parse))
    expect(workspaces.getState().last).toBe('AAA')
  })
})

/** LEDG (panel 4, unlinked) replaced by DES with no subject: a panel whose line would read "DES" and could not load. */
async function showBareDes(ref: React.RefObject<WorkspaceHandle | null>): Promise<void> {
  expect(findMnemonic('DES')!.accepts.length).toBeGreaterThan(0)
  act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
  act(() => ref.current?.run(command('DES'), 'replace'))
  await waitFor(() => expect(panelTitles()).toContain('DES'))
}

describe('SAVE and the lines LOAD can run again', () => {
  it('SAVE refuses a panel whose line could not load again', async () => {
    const { ref, workspaces, onLayoutChange } = renderWorkspace()
    await customise(ref)
    await showBareDes(ref)
    expect(call(() => ref.current?.saveWorkspace('DESK'))).toBe(fillCopy(WORKSPACES.noContext, { name: 'DESK', line: 'DES' }))
    expect(workspaces.getState().list.DESK).toBeUndefined()
    expect(workspaces.getState().last).toBeNull()
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
  })

  it('a refused SAVE keeps the workspace already stored under that name', async () => {
    const { ref, workspaces } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    const stored = structuredClone(workspaces.getState().list.MINE)
    expect(stored).toBeDefined()
    await showBareDes(ref)
    expect(call(() => ref.current?.saveWorkspace('MINE'))).toBe(fillCopy(WORKSPACES.noContext, { name: 'MINE', line: 'DES' }))
    expect(workspaces.getState().list.MINE).toEqual(stored)
    expect(call(() => ref.current?.loadWorkspace('MINE', parse))).toBe(fillCopy(WORKSPACES.loaded, { name: 'MINE' }))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
  })

  it.each([
    ['the HOME default', false],
    ['a customised layout', true],
  ])('every line SAVE keeps from %s parses back to a screen command (SAVE and LOAD agree)', async (_name, custom) => {
    const { ref, workspaces } = renderWorkspace()
    if (custom) await customise(ref)
    else await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(call(() => ref.current?.saveWorkspace('DESK'))).toContain('Saved DESK')
    const recipe = workspaces.getState().list.DESK!
    expect(recipe.panels.length).toBe(4)
    for (const { line } of recipe.panels) {
      expect(parseLine(line, { index: INDEX, fallbackContext: null }), line).toMatchObject({ ok: true, action: { kind: 'run' } })
    }
  })
})

describe('the owner of the layout: a screen or a workspace', () => {
  it('names the workspace in the layout report once it is saved, and clears the edited mark', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
    call(() => ref.current?.saveWorkspace('MINE'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
  })

  it('reports the workspace, unedited, after a load', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    call(() => ref.current?.loadWorkspace('MINE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    // The first panel of the recipe decides which screen the report names.
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'GP', edited: false, workspace: 'MINE' })
  })

  it('edits set the edited mark and leave nqt.layouts alone', async () => {
    const { ref, layouts, layoutStorage, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    const layoutsBefore = structuredClone(layouts.getState().layouts)
    const writesBefore = layoutStorage.writes.filter((key) => key === LAYOUTS_KEY).length
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'MINE' })
    act(() => ref.current?.run(command('HELP'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('HELP'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'MINE' })
    expect(layouts.getState().layouts).toEqual(layoutsBefore)
    expect(layoutStorage.writes.filter((key) => key === LAYOUTS_KEY).length).toBe(writesBefore)
  })

  it('the same edits on a loaded workspace leave nqt.layouts alone too', async () => {
    const { ref, layouts, layoutStorage, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    const layoutsBefore = structuredClone(layouts.getState().layouts)
    const writesBefore = layoutStorage.writes.filter((key) => key === LAYOUTS_KEY).length
    call(() => ref.current?.loadWorkspace('MINE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'GP', edited: true, workspace: 'MINE' })
    expect(layouts.getState().layouts).toEqual(layoutsBefore)
    expect(layoutStorage.writes.filter((key) => key === LAYOUTS_KEY).length).toBe(writesBefore)
  })

  it('drops the edited mark when a panel is taken back to what the recipe says', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'MINE' })
    const id = document.querySelectorAll('[data-nqt-panel]')[3]?.getAttribute('data-nqt-panel') ?? ''
    expect(call(() => ref.current?.goBack(id))).toBe(true)
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
  })

  it('a link group retarget outside a command counts as an edit, and undoing it does not', async () => {
    const { ref, linkGroups, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => {
      linkGroups.getState().setContext('A', { kind: 'instrument', value: 'ES' })
    })
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'MINE' })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    act(() => {
      linkGroups.getState().setContext('A', { kind: 'instrument', value: 'NQ' })
    })
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
  })

  it('a screen load gives the layout back to the screen', async () => {
    const { ref, layouts, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'REG', edited: false, workspace: null })
    // Edits are remembered for the screen again.
    act(() => screen.getByRole('group', { name: 'MT content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'LEDG']))
    expect(layouts.getState().layouts.REG).toBeDefined()
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'REG', edited: true, workspace: null })
  })

  it('a load from a workspace into another workspace names the new one', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('ONE'))
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    call(() => ref.current?.saveWorkspace('TWO'))
    call(() => ref.current?.loadWorkspace('ONE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'GP', edited: false, workspace: 'ONE' })
  })
})

describe('UNDO and RESET around workspaces', () => {
  it('UNDO after LOAD brings back the screen the load replaced', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    call(() => ref.current?.loadWorkspace('MINE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(call(() => ref.current?.undo())).toBe('REG')
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'REG', edited: false, workspace: null })
    // And once more, back to the customised HOME.
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
  })

  it('UNDO after a screen load leaves a workspace comes back to that workspace, unedited', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    call(() => ref.current?.loadWorkspace('MINE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    act(() => ref.current?.run(command('LIVE'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['LIVE', 'JRNL']))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'LIVE', edited: false, workspace: null })
    expect(call(() => ref.current?.undo())).toBe('GP')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'GP', edited: false, workspace: 'MINE' })
  })

  it('UNDO of an edit made in a workspace keeps the workspace', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
  })

  it('leaving a workspace for a screen layout that looks the same can still be undone', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    call(() => ref.current?.saveWorkspace('MINE'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
    // HOME's default is exactly what the workspace holds, yet the layout now belongs to the screen again.
    act(() => ref.current?.run(command('HOME'), 'replace'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: null })
    expect(call(() => ref.current?.undo())).toBe('HOME')
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
  })

  it('a load that changes nothing leaves nothing to undo', async () => {
    const { ref } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    // The workspace is already what is on screen.
    call(() => ref.current?.loadWorkspace('MINE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    // The one undo left is the customise step, not the load.
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(call(() => ref.current?.undo())).toBeNull()
  })

  it('RESET on an edited workspace puts its own panels back, keeps it the owner and never touches nqt.layouts', async () => {
    const { ref, layouts, layoutStorage, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    const before = structuredClone(layouts.getState().layouts)
    const writes = layoutStorage.writes.length
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(EDITED_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'MINE' })
    expect(call(() => ref.current?.resetLayout())).toBe('reset')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(layouts.getState().layouts).toEqual(before)
    expect(layoutStorage.writes.length).toBe(writes)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
    // UNDO brings the edits back, and the workspace with them.
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(EDITED_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: 'MINE' })
  })

  it('RESET on an edited workspace puts the link group contexts back too', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    const saved = structuredClone(linkGroups.getState().contexts)
    act(() => {
      linkGroups.getState().setContext('A', { kind: 'instrument', value: 'ES' })
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(call(() => ref.current?.resetLayout())).toBe('reset')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(linkGroups.getState().contexts).toEqual(saved)
  })

  it('RESET on an unedited workspace answers default and adds no undo entry', async () => {
    const { ref } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    expect(call(() => ref.current?.resetLayout())).toBe('default')
    expect(panelTitles()).toEqual(CUSTOM_TITLES)
    // The one undo there is belongs to the customise step, not to RESET.
    expect(call(() => ref.current?.undo())).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(call(() => ref.current?.undo())).toBeNull()
  })

  it('RESET on a loaded workspace keeps the saved layout of the screen its first panel shows', async () => {
    const { ref, layouts, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    // GP gets a saved layout of its own: it is loaded as a screen and given a second panel.
    act(() => ref.current?.run(command('GP'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['GP']))
    act(() => ref.current?.run(command('HELP'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toEqual(['GP', 'HELP']))
    const savedGp = structuredClone(layouts.getState().layouts.GP)
    expect(savedGp).toBeDefined()
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    call(() => ref.current?.loadWorkspace('MINE', parse))
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'GP', edited: true, workspace: 'MINE' })
    expect(call(() => ref.current?.resetLayout())).toBe('reset')
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(layouts.getState().layouts.GP).toEqual(savedGp)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'GP', edited: false, workspace: 'MINE' })
  })

  it('RESET on an edited workspace whose saved panels cannot be applied falls back to the shown screen, and still spares nqt.layouts', async () => {
    const { ref, layouts, layoutStorage, onLayoutChange } = renderWorkspace()
    await customise(ref)
    call(() => ref.current?.saveWorkspace('MINE'))
    act(() => screen.getByRole('group', { name: 'LEDG content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    const before = structuredClone(layouts.getState().layouts)
    const writes = layoutStorage.writes.length
    vi.spyOn(DockviewApi.prototype, 'fromJSON').mockImplementationOnce(() => {
      throw new Error('cannot apply')
    })
    expect(call(() => ref.current?.resetLayout())).toBe('reset')
    // HOME's saved layout is the customised one, and RESET did not erase it.
    await waitFor(() => expect(panelTitles()).toEqual(CUSTOM_TITLES))
    expect(layouts.getState().layouts).toEqual(before)
    expect(layoutStorage.writes.length).toBe(writes)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
  })
})

describe('saveRecipe and loadRecipe on the handle', () => {
  it('saveRecipe gives the recipe of the panels on screen and makes the workspace the owner', async () => {
    const { ref, onLayoutChange, workspaces } = renderWorkspace()
    await customise(ref)
    const recipe = call(() => ref.current?.saveRecipe('MINE'))
    expect(recipe?.panels.map((p) => [p.line, p.group, p.ref, p.direction])).toEqual([
      ['NQ GP 1d', 'A', null, 'right'],
      ['volmanaged_v0 EQ', 'B', 0, 'below'],
      ['27F MON', 'A', 0, 'right'],
      ['LEDG', '-', 1, 'right'],
    ])
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
    // saveRecipe only derives the recipe: keeping it is saveWorkspace's job.
    expect(workspaces.getState().list).toEqual({})
  })

  it('saveRecipe and loadRecipe refuse a name that is not a workspace name, and change nothing', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    const recipe = call(() => ref.current?.saveRecipe('MINE')) as Recipe
    const calls = onLayoutChange.mock.calls.length
    for (const name of ['mine', 'M', 'HOME', 'RESET', 'MY DESK', '']) {
      expect(call(() => ref.current?.saveRecipe(name)), name).toBeNull()
      expect(call(() => ref.current?.loadRecipe(name, recipe, HOME_COMMANDS)), name).toBe(false)
    }
    expect(onLayoutChange.mock.calls.length).toBe(calls)
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: 'MINE' })
  })

  it('loadRecipe refuses commands that do not match the recipe, and changes nothing', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await customise(ref)
    const recipe = call(() => ref.current?.saveRecipe('MINE')) as Recipe
    const calls = onLayoutChange.mock.calls.length
    expect(call(() => ref.current?.loadRecipe('MINE', recipe, [command('REG')]))).toBe(false)
    expect(call(() => ref.current?.loadRecipe('MINE', recipe, []))).toBe(false)
    expect(panelTitles()).toEqual(CUSTOM_TITLES)
    expect(onLayoutChange.mock.calls.length).toBe(calls)
  })

  it('loadRecipe checks the recipe it is given', async () => {
    const { ref } = renderWorkspace()
    await customise(ref)
    const bad = { version: 1, panels: [{ line: 'REG', group: '-', ref: 3, direction: 'right' }], groups: { A: null, B: null, C: null } } as unknown as Recipe
    expect(call(() => ref.current?.loadRecipe('MINE', bad, [command('REG')]))).toBe(false)
    expect(panelTitles()).toEqual(CUSTOM_TITLES)
  })
})
