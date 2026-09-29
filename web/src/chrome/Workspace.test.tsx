// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode, createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { LINK_COPY } from '../copy/linkCopy'
import { PLACEHOLDER } from '../copy/placeholder'
import { PANEL } from '../copy/workspace'
import { HELP } from '../copy/help'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import type { SerializedDockview } from 'dockview-react'
import { linesFromHash, resetWorkspaceReady, whenWorkspaceReady } from './deepLink'
import { resetMessage, useMessage } from './MessageLine.store'
import Workspace, { WORKSPACE_THEME, type FocusedPanel, type WorkspaceHandle } from './Workspace'
import { toStored } from './WorkspaceStorage'
import { panelTabStops } from './WorkspaceFocus'
import { activateNumbered, numberedItems } from './NumberedActions'
import { BUILT_SCREENS, type ScreenProps, type ScreenRegistry } from './WorkspaceScreens'

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
})

afterEach(cleanup)

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

function command(code: string, extra: Partial<ParsedCommand> = {}): ParsedCommand {
  const mnemonic = findMnemonic(code)
  if (!mnemonic) throw new Error(code)
  return { mnemonic, context: null, contextSource: 'none', args: {}, canonical: code, ...extra }
}

// These tests exercise the workspace itself (layouts, focus, history, menus), so every screen but HELP
// renders its labelled placeholder, which needs no API; the built screens have their own tests.
const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }

function renderWorkspace(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  const ref = createRef<WorkspaceHandle>()
  const layouts = createLayoutsStore(memoryStorage())
  const linkGroups = createLinkGroupsStore(memoryStorage())
  const onLayoutChange = vi.fn()
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} layouts={layouts} linkGroups={linkGroups} onLayoutChange={onLayoutChange} {...props} />
    </div>,
  )
  return { ...utils, ref, layouts, linkGroups, onLayoutChange }
}

const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

function panelNumbers(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-panel] .ptitle-no')).map((h) => h.textContent ?? '')
}

describe('Workspace (dockview) with the default layouts', () => {
  it('opens HOME as the 2x2 home layout and reports the screen', async () => {
    const { onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(panelTitles()).toEqual(HOME_TITLES)
    expect(onLayoutChange).toHaveBeenCalledWith({ code: 'HOME', edited: false, workspace: null })
  })

  it('shows a labelled placeholder for an unbuilt screen', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const reg = screen.getByRole('region', { name: 'REG' })
    expect(within(reg).getByText('REG: Registry board')).toBeTruthy()
    expect(within(reg).getByText(PLACEHOLDER.status)).toBeTruthy()
    // The placeholder is drawn the way a built screen will be: a red function bar and a grid.
    expect(within(reg).getByRole('toolbar', { name: 'Registry board functions' })).toBeTruthy()
    const grid = within(reg).getByRole('table', { name: 'REG placeholder: what this panel will show' })
    expect(grid.className).toBe('nqt-grid')
    expect(grid.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(30)
  })

  it('loads a multi-panel screen on Enter and renders HELP from the registry', async () => {
    const { ref, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    act(() => ref.current?.run(command('HELP'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('HELP'))
    await waitFor(() => expect(screen.getByRole('table', { name: HELP.mnemonicsCaption })).toBeTruthy(), { timeout: 5000 })
    // A panel added beside the layout is an edit of the screen shown, not a new screen.
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'REG', edited: true, workspace: null })
  })

  it('replaces the focused panel in place and retargets its link group', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const gpBody = screen.getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gpBody.focus())
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    expect(panelTitles()).toHaveLength(4)
    expect(linkGroups.getState().contexts.A).toEqual(es)
  })

  it('keeps exactly one Tab stop per panel (dockview tab strips hidden)', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const root = container.querySelector('.nqt-workspace') as HTMLElement
    const stops = panelTabStops(root)
    expect(stops).toHaveLength(4)
    for (const stop of stops) expect(stop.closest('[data-nqt-panel]')).not.toBeNull()
  })

  it('returns focus to the last focused panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const oos = screen.getByRole('group', { name: 'REG content' })
    act(() => oos.focus())
    act(() => (document.activeElement as HTMLElement).blur())
    let moved = false
    act(() => {
      moved = ref.current?.focusPanel() ?? false
    })
    expect(moved).toBe(true)
    expect(document.activeElement).toBe(oos)
  })

  it('restores a screen layout saved from another screen, and restores it again when typed on itself (RESET is the only way to reset)', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    act(() => ref.current?.run(command('RUNS'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    const customised = panelTitles()
    expect(customised).toHaveLength(5)
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(customised))
    // Typing HOME again, now that HOME is already shown, still restores the saved layout: a bare
    // mnemonic never resets (the D-defect this wave fixes). Only ref.current.resetLayout() (RESET) does.
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(customised))
    let outcome: string | null = null
    act(() => {
      outcome = ref.current?.resetLayout() ?? null
    })
    expect(outcome).toBe('reset')
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
  })

  it('does not wipe a customised HOME layout when HOME is typed again afterwards (D01)', async () => {
    const { ref, layouts, onLayoutChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'volmanaged_v0 EQ content' }).focus())
    act(() => ref.current?.run(command('RUNS'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
    expect(layouts.getState().layouts.HOME).toBeDefined()
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    expect(layouts.getState().layouts.HOME).toBeDefined()
  })

  it('does not silently wipe a saved LIVE layout when LIVE is typed again after a Shift+Enter add and a HOME round-trip (D01 regression)', async () => {
    const { ref, layouts } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => ref.current?.run(command('LIVE'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('JRNL'))
    act(() => screen.getByRole('group', { name: 'LIVE content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    expect(layouts.getState().layouts.LIVE).toBeDefined()
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    act(() => ref.current?.run(command('LIVE'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('LIVE'))
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    act(() => document.body.focus())
    act(() => ref.current?.run(command('LIVE'), 'replace'))
    await waitFor(() => expect(layouts.getState().layouts.LIVE).toBeDefined())
    expect(panelTitles()).toContain('LEDG')
  })

  it('anchors a new panel to the addressed panel when nothing has real focus, instead of hiding it as a tab (D02)', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => ref.current?.run(command('LEDG'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    expect(panelTitles()).toHaveLength(5)
    expect(panelNumbers()).toHaveLength(5)
    expect(panelNumbers().map((n) => n.split('-')[0])).toEqual(['1', '2', '3', '4', '5'])
    let ok = false
    act(() => {
      ok = ref.current?.focusPanelNumber(4) ?? false
    })
    expect(ok).toBe(true)
    act(() => {
      ok = ref.current?.focusPanelNumber(5) ?? false
    })
    expect(ok).toBe(true)
  })

  it('BACK restores what a linked panel showed, not its stale stored context after a retarget (D03)', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: '27F MON content' }).focus())
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(panelTitles()[1]).toBe('ES GP')
    act(() => screen.getByRole('group', { name: 'ES GP 1d content' }).focus())
    act(() => ref.current?.run(command('GIP', { args: { date: '2019-03-14' }, canonical: 'GIP 2019-03-14' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GIP 2019-03-14'))
    let moved = false
    act(() => {
      moved = ref.current?.goBack('home-gp') ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(linkGroups.getState().contexts.A?.value).toBe('ES')
    expect(panelTitles()[1]).toBe('ES GP')
  })

  it('BACK restores what a panel showed after a context-only line retargets its link group (D09)', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => {
      linkGroups.getState().setContext('A', { kind: 'instrument', value: 'ES' })
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() =>
      ref.current?.run(command('GIP', { context: es, contextSource: 'link-group', args: { date: '2019-03-14' }, canonical: 'GIP 2019-03-14' }), 'replace'),
    )
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GIP 2019-03-14'))
    let moved = false
    act(() => {
      moved = ref.current?.goBack('home-gp') ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP 1d'))
    expect(linkGroups.getState().contexts.A?.value).toBe('ES')
  })

  it('FORWARD restores what a linked panel showed, not its stale stored context, and retargets the group (D03/D09 forward)', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => ref.current?.run(command('GIP', { args: { date: '2019-03-14' }, canonical: 'GIP 2019-03-14' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GIP 2019-03-14'))
    act(() => screen.getByRole('group', { name: '27F MON content' }).focus())
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GIP 2019-03-14'))
    let moved = false
    act(() => {
      moved = ref.current?.goBack('home-gp') ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    act(() => {
      moved = ref.current?.goForward('home-gp') ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GIP 2019-03-14'))
    expect(linkGroups.getState().contexts.A?.value).toBe('ES')
  })

  it('born failing: a tampered saved layout falls back to the default instead of rendering it', async () => {
    const layouts = createLayoutsStore(memoryStorage())
    layouts.getState().saveLayout('HOME', toStored('HOME', { grid: 'not a grid' } as unknown as SerializedDockview))
    renderWorkspace({ layouts })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(panelTitles()[0]).toBe('NQ GP 1d')
  })

  it('with no panel focused yet, focusPanel focuses the first panel (a second Esc never lands on the page)', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    let moved = false
    act(() => {
      moved = ref.current?.focusPanel() ?? false
    })
    expect(moved).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'NQ GP 1d content' }))
  })

  it('with no panel focused, a single-panel screen loads its own layout instead of replacing a panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => ref.current?.run(command('HELP'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['HELP']))
  })

  it('born failing: the fallback context follows the focused panel after a command replaces it', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    // Before any focus the command line addresses panel 1 (command-target fix), so its context is NQ.
    expect(ref.current?.focusedContext()).toEqual({ kind: 'instrument', value: 'NQ' })
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    expect(ref.current?.focusedContext()).toBeNull()
    const nq = { kind: 'instrument' as const, value: 'NQ' }
    act(() => ref.current?.run(command('GP', { context: nq, contextSource: 'typed', canonical: 'NQ GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[3]).toBe('NQ GP'))
    expect(ref.current?.focusedContext()).toEqual(nq)
  })

  it('born failing: the fallback context follows the focused panel link group when a command retargets it', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    expect(ref.current?.focusedContext()).toEqual({ kind: 'instrument', value: 'NQ' })
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    expect(ref.current?.focusedContext()).toEqual(es)
  })

  // Changed with the command-target fix (visual review, nav toolbar blank until a panel had DOM focus):
  // once a load removes the focused panel, the command line addresses panel 1 of the new layout, so
  // the report names that panel instead of null. REG's panels carry no context, so the context is null.
  it('reports the focused panel again after a run, and panel 1 of the new layout once a load removes it', async () => {
    const onFocusedPanelChange = vi.fn<(panel: FocusedPanel | null) => void>()
    const { ref } = renderWorkspace({ onFocusedPanelChange })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ group: 'A' }) }))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ number: 1, params: expect.objectContaining({ code: 'REG' }) }))
    expect(ref.current?.focusedContext()).toBeNull()
  })

  it('born failing: before any panel has focus, the command line addresses panel 1 (look spec 4.2, 4.3)', async () => {
    const onFocusedPanelChange = vi.fn<(panel: FocusedPanel | null) => void>()
    const { ref } = renderWorkspace({ onFocusedPanelChange })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await waitFor(() => expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ panelId: 'home-gp', number: 1 })))
    const ringed = () => Array.from(document.querySelectorAll('[data-nqt-panel][data-focused="true"]')).map((el) => el.getAttribute('data-nqt-title'))
    await waitFor(() => expect(ringed()).toEqual(['NQ GP 1d']))
    expect(ref.current?.focusedContext()).toEqual({ kind: 'instrument', value: 'NQ' })
  })

  it('after a command, the command line addresses the panel the command ran in', async () => {
    const onFocusedPanelChange = vi.fn<(panel: FocusedPanel | null) => void>()
    const { ref } = renderWorkspace({ onFocusedPanelChange })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => ref.current?.run(command('LEDG'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    const added = document.querySelector('[data-nqt-title="LEDG"]')?.getAttribute('data-nqt-panel')
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ panelId: added, params: expect.objectContaining({ code: 'LEDG' }) }))
    act(() => ref.current?.run(command('GP', { context: { kind: 'instrument', value: 'ES' }, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['ES GP']))
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ number: 1, params: expect.objectContaining({ code: 'GP' }) }))
  })

  it('seeds empty link groups from the layout it loads, and leaves a set group alone', async () => {
    const linkGroups = createLinkGroupsStore(memoryStorage())
    linkGroups.getState().setContext('B', { kind: 'hypothesis', value: 'za_v0' })
    renderWorkspace({ linkGroups })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(linkGroups.getState().contexts).toEqual({
      A: { kind: 'instrument', value: 'NQ' },
      B: { kind: 'hypothesis', value: 'za_v0' },
      C: null,
    })
  })

  it('born failing: saves a layout only after a command changes it, never the untouched default', async () => {
    const { ref, layouts } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(layouts.getState().layouts).toEqual({})
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(Object.keys(layouts.getState().layouts)).toEqual(['HOME']))
  })

  it('leaves no orphan tabpanel behind the hidden tab strips', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(0)
    expect(container.querySelectorAll('.dv-content-container[aria-labelledby]')).toHaveLength(0)
  })
})

describe('Workspace panels: numbers, focus cue, history and the related menu (look spec 4.3, 4.7, 5.2)', () => {
  it('numbers panels in reading order on their title bars (1-GP 2-MON 3-EQ 4-REG)', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelNumbers()).toEqual(['1-GP', '2-MON', '3-EQ', '4-REG']))
  })

  it('separates panels by a 2px black gutter, with no panel borders or tab strips', () => {
    expect(WORKSPACE_THEME.gap).toBe(2)
    expect(WORKSPACE_THEME.className).toBe('dockview-theme-nqt')
  })

  it('marks the focused panel and reports its id and number', async () => {
    const onFocusedPanelChange = vi.fn<(panel: FocusedPanel | null) => void>()
    renderWorkspace({ onFocusedPanelChange })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: '27F MON content' }).focus())
    await waitFor(() => {
      const focused = document.querySelectorAll('[data-nqt-panel][data-focused="true"]')
      expect(Array.from(focused).map((el) => el.getAttribute('data-nqt-title'))).toEqual(['27F MON'])
    })
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ panelId: 'home-mon', number: 2 }))
  })

  it('focuses panel N for Alt+N through the handle, and refuses a number with no panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelNumbers()).toHaveLength(4))
    let ok = false
    act(() => {
      ok = ref.current?.focusPanelNumber(3) ?? false
    })
    expect(ok).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'volmanaged_v0 EQ content' }))
    act(() => {
      ok = ref.current?.focusPanelNumber(9) ?? true
    })
    expect(ok).toBe(false)
  })

  it('goes back and forward through what one panel showed; false when there is nowhere to go', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    let moved = true
    act(() => {
      moved = ref.current?.goBack('home-gp') ?? true
    })
    expect(moved).toBe(false)
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    act(() => {
      moved = ref.current?.goBack('home-gp') ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    act(() => {
      moved = ref.current?.goForward('home-gp') ?? false
    })
    expect(moved).toBe(true)
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    act(() => {
      moved = ref.current?.goForward('home-gp') ?? true
    })
    expect(moved).toBe(false)
  })

  it('opens the related functions menu inside the focused panel only, and a row replaces that panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    let opened = false
    act(() => {
      opened = ref.current?.openRelatedMenu() ?? false
    })
    expect(opened).toBe(true)
    const dialog = await screen.findByRole('dialog', { name: 'Related functions' })
    expect(dialog.closest('[data-nqt-panel]')?.getAttribute('data-nqt-panel')).toBe('home-gp')
    const gip = within(dialog).getAllByRole('menuitem').find((m) => /\bGIP\b/.test(m.textContent ?? ''))
    act(() => gip?.click())
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GIP'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the related functions menu when focus moves to another panel, and keeps it for the chrome', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => {
      ref.current?.openRelatedMenu('home-gp')
    })
    await screen.findByRole('dialog', { name: 'Related functions' })
    const outside = document.createElement('button')
    document.body.append(outside)
    act(() => outside.focus())
    expect(screen.getByRole('dialog', { name: 'Related functions' })).toBeTruthy()
    act(() => screen.getByRole('group', { name: '27F MON content' }).focus())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    outside.remove()
  })
})

describe('Workspace panels: maximise and Number <GO> (look spec 4.3, 5.1 item 5)', () => {
  it('maximises a panel from its title bar and restores it again', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const reg = screen.getByRole('region', { name: 'REG' })
    const max = within(reg).getByRole('button', { name: 'Maximise panel' })
    expect(max.getAttribute('aria-pressed')).toBe('false')
    act(() => max.click())
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'REG' })).getByRole('button', { name: 'Maximise panel' }).getAttribute('aria-pressed')).toBe('true'))
    act(() => within(screen.getByRole('region', { name: 'REG' })).getByRole('button', { name: 'Maximise panel' }).click())
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'REG' })).getByRole('button', { name: 'Maximise panel' }).getAttribute('aria-pressed')).toBe('false'))
  })

  it('registers each panel red-bar button with the numbered registry; 96 opens the Actions menu', async () => {
    renderWorkspace()
    await waitFor(() => expect(numberedItems('home-reg').map((i) => i.n)).toContain(96))
    expect(numberedItems('home-eq').map((i) => i.n)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 96]))
    let ran = false
    act(() => {
      ran = activateNumbered('home-reg', 96)
    })
    expect(ran).toBe(true)
    expect(within(screen.getByRole('region', { name: 'REG' })).getByRole('menu', { name: 'Actions menu' })).toBeTruthy()
  })

  it('while the related functions menu is open, its rows are the panel numbers; closing it restores the bar', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => {
      ref.current?.openRelatedMenu('home-reg')
    })
    await screen.findByRole('dialog', { name: 'Related functions' })
    await waitFor(() => expect(numberedItems('home-reg').map((i) => i.n)).not.toContain(96))
    expect(numberedItems('home-reg')[0]?.n).toBe(1)
    act(() => ref.current?.closeRelatedMenu())
    await waitFor(() => expect(numberedItems('home-reg').map((i) => i.n)).toContain(96))
  })

  it('a tab on a shared analytics panel opens that function in the same panel', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const eq = screen.getByRole('region', { name: 'volmanaged_v0 EQ' })
    act(() => within(eq).getByRole('tab', { name: '2) Drawdown' }).click())
    await waitFor(() => expect(panelTitles()[2]).toBe('volmanaged_v0 DD'))
  })
})

describe('Workspace panels: a screen that throws draws again once its arguments change (D06)', () => {
  it('does not keep a stale render error once BACK or a new run changes the argument', async () => {
    const ThrowingGP = ({ params }: ScreenProps) => {
      if (params.args.timeframe === '1d') throw new Error('bad 1d bar')
      return <p>ok {params.args.timeframe}</p>
    }
    const failed = () => screen.queryByText(/could not be drawn/)
    const { ref } = renderWorkspace({ screens: { GP: ThrowingGP } })
    await waitFor(() => expect(failed()).toBeTruthy())
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => ref.current?.run(command('GP', { args: { timeframe: '1h' }, canonical: 'NQ GP 1h' }), 'replace'))
    await waitFor(() => expect(failed()).toBeNull())
    expect(screen.getByText('ok 1h')).toBeTruthy()
  })
})

describe('Workspace links: the ready signal and Copy link in the Options menu', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
    resetWorkspaceReady()
    resetMessage()
  })

  const stillWaiting = (promise: Promise<void>): Promise<boolean> =>
    Promise.race([promise.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20))])

  function stubClipboard() {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  async function copyFrom(title: string, row: string): Promise<void> {
    const options = within(screen.getByRole('region', { name: title })).getByRole('button', { name: PANEL.options })
    act(() => options.click())
    act(() => within(screen.getByRole('menu')).getByRole('menuitem', { name: row }).click())
  }

  it('whenWorkspaceReady waits for dockview, then resolves', async () => {
    resetWorkspaceReady()
    expect(await stillWaiting(whenWorkspaceReady())).toBe(true)
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await expect(whenWorkspaceReady()).resolves.toBeUndefined()
  })

  it('is not ready any more once the Workspace has unmounted', async () => {
    resetWorkspaceReady()
    const view = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    view.unmount()
    expect(await stillWaiting(whenWorkspaceReady())).toBe(true)
  })

  it('stays ready under StrictMode, where the effects run twice', async () => {
    resetWorkspaceReady()
    render(
      <StrictMode>
        <div style={{ width: 1200, height: 800 }}>
          <Workspace screens={SHELL_SCREENS} layouts={createLayoutsStore(memoryStorage())} linkGroups={createLinkGroupsStore(memoryStorage())} />
        </div>
      </StrictMode>,
    )
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await expect(whenWorkspaceReady()).resolves.toBeUndefined()
  })

  it("Copy link on 'NQ GP 1d' copies this page address ending in #go=NQ%20GP%201d", async () => {
    const writeText = stubClipboard()
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await copyFrom('NQ GP 1d', LINK_COPY.copyLink)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0]?.[0] ?? ''
    expect(copied).toBe(`${window.location.origin}${window.location.pathname}#go=NQ%20GP%201d`)
    expect(copied.endsWith('#go=NQ%20GP%201d')).toBe(true)
    await waitFor(() => expect(useMessage.getState().text).toBe('Link to NQ GP 1d copied.'))
  })

  it('Copy link as Markdown copies [title](link)', async () => {
    const writeText = stubClipboard()
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await copyFrom('volmanaged_v0 EQ', LINK_COPY.copyMarkdown)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toBe(
      `[volmanaged_v0 EQ](${window.location.origin}${window.location.pathname}#go=volmanaged_v0%20EQ)`,
    )
  })

  it('shows the link itself when the browser has no clipboard', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    await copyFrom('REG', LINK_COPY.copyLink)
    await waitFor(() => expect(useMessage.getState().tone).toBe('error'))
    expect(useMessage.getState().text).toContain('#go=REG')
  })

  it('every panel of HOME offers a link that reads back as its own command line', async () => {
    const writeText = stubClipboard()
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    for (const title of HOME_TITLES) {
      writeText.mockClear()
      await copyFrom(title, LINK_COPY.copyLink)
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
      const link = writeText.mock.calls[0]?.[0] ?? ''
      expect(linesFromHash(link.slice(link.indexOf('#')))).toEqual([{ line: title, newPanel: false }])
    }
  })

  it('offers Copy link and Copy link as Markdown last in the Options menu, after the panel own rows', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => within(screen.getByRole('region', { name: 'NQ GP 1d' })).getByRole('button', { name: PANEL.options }).click())
    const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)
    expect(labels.slice(-2)).toEqual([LINK_COPY.copyLink, LINK_COPY.copyMarkdown])
    expect(labels).toContain(PANEL.related)
  })
})
