// Layout safety (roadmap #6, UI_SPEC section 2): a bare mnemonic restores instead of resetting, a
// 10-deep undo ring, preview with no side effects, and a stale-base saved layout that is dropped but
// recoverable through UNDO instead of silently discarded.
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
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

const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }

function renderWorkspace(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  const ref = createRef<WorkspaceHandle>()
  const layouts = props.layouts ?? createLayoutsStore(memoryStorage())
  const linkGroups = props.linkGroups ?? createLinkGroupsStore(memoryStorage())
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} {...props} layouts={layouts} linkGroups={linkGroups} />
    </div>,
  )
  return { ...utils, ref, layouts, linkGroups }
}

const HOME_TITLES = ['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG']

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

describe('born failing: a bare mnemonic restores the shown screen instead of resetting it (D-defect)', () => {
  it('typing HOME again while HOME is already shown keeps 5 customised panels', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    act(() => ref.current?.run(command('RUNS'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    const customised = panelTitles()
    expect(customised).toHaveLength(5)
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(customised))
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(customised))
    expect(panelTitles()).toHaveLength(5)
  })
})

describe('RESET and UNDO', () => {
  it('RESET returns the shown screen to its default; a second RESET reports it already is one', async () => {
    const { ref, layouts } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    expect(layouts.getState().layouts.HOME).toBeDefined()
    let outcome: string | null = null
    act(() => {
      outcome = ref.current?.resetLayout() ?? null
    })
    expect(outcome).toBe('reset')
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(layouts.getState().layouts.HOME).toBeUndefined()
    act(() => {
      outcome = ref.current?.resetLayout() ?? null
    })
    expect(outcome).toBe('default')
  })

  it('UNDO brings back what RESET took away', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    act(() => {
      ref.current?.resetLayout()
    })
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    let restored: string | null = null
    act(() => {
      restored = ref.current?.undo() ?? null
    })
    expect(restored).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
  })

  it('UNDO restores the link-group context a typed command retargeted (ES GP retarget undo)', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(linkGroups.getState().contexts.A).toEqual({ kind: 'instrument', value: 'NQ' })
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    expect(linkGroups.getState().contexts.A).toEqual(es)
    let restored: string | null = null
    act(() => {
      restored = ref.current?.undo() ?? null
    })
    expect(restored).toBe('HOME')
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GP 1d'))
    expect(linkGroups.getState().contexts.A).toEqual({ kind: 'instrument', value: 'NQ' })
  })

  it('undoes nothing, and returns null, once the ring is empty', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    let outcome: string | null = 'not yet called'
    act(() => {
      outcome = ref.current?.undo() ?? null
    })
    expect(outcome).toBeNull()
  })

  it('keeps 10 changes: an 11th drops the oldest, so 10 undos land back after the first change', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    const codes = ['LEDG', 'RUNS', 'OOS', 'LEDG', 'RUNS', 'OOS', 'LEDG', 'RUNS', 'OOS', 'LEDG', 'RUNS']
    expect(codes).toHaveLength(11)
    for (const code of codes) {
      act(() => ref.current?.run(command(code), 'replace'))
      await waitFor(() => expect(panelTitles()[3]).toBe(code))
    }
    for (let i = 0; i < 10; i += 1) {
      let restored: string | null = null
      act(() => {
        restored = ref.current?.undo() ?? null
      })
      expect(restored).toBe('HOME')
    }
    // The very first change's pre-state (plain HOME) fell off the 10-deep ring; the 10 pops land on
    // the state right after the first change ran (codes[0]).
    await waitFor(() => expect(panelTitles()[3]).toBe('LEDG'))
    let last: string | null = 'not yet called'
    act(() => {
      last = ref.current?.undo() ?? null
    })
    expect(last).toBeNull()
  })

  it('a command that changes nothing leaves no undo entry', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()[3]).toBe('LEDG'))
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()[3]).toBe('LEDG'))
    let restored: string | null = null
    act(() => {
      restored = ref.current?.undo() ?? null
    })
    expect(restored).toBe('HOME')
    await waitFor(() => expect(panelTitles()[3]).toBe('REG'))
    let second: string | null = 'not yet called'
    act(() => {
      second = ref.current?.undo() ?? null
    })
    expect(second).toBeNull()
  })

  it('reports the edited flag through onLayoutChange after a change, a reset and an undo', async () => {
    const onLayoutChange = vi.fn()
    const { ref } = renderWorkspace({ onLayoutChange })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: null })
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
    act(() => {
      ref.current?.resetLayout()
    })
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: false, workspace: null })
    act(() => {
      ref.current?.undo()
    })
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    expect(onLayoutChange).toHaveBeenLastCalledWith({ code: 'HOME', edited: true, workspace: null })
  })
})

describe('a dropped saved layout (stale base)', () => {
  it('is announced, shows the default on mount, and UNDO restores it', async () => {
    // First pass: customise HOME so there is a real, structurally valid dock JSON to reuse.
    const first = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => first.ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    const saved = first.layouts.getState().layouts.HOME as { readonly dock: unknown }
    first.unmount()

    // Second pass: a fresh store, seeded with that dock under a stale ('00000000') base.
    const layouts = createLayoutsStore(memoryStorage())
    layouts.getState().saveLayout('HOME', { base: '00000000', dock: saved.dock })
    const onLayoutDropped = vi.fn()
    const { ref } = renderWorkspace({ layouts, onLayoutDropped })
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(onLayoutDropped).toHaveBeenCalledWith('HOME')

    let restored: string | null = null
    act(() => {
      restored = ref.current?.undo() ?? null
    })
    expect(restored).toBe('HOME')
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
  })

  it('never fires onLayoutDropped for a tampered layout (today’s silent fallback stays silent)', async () => {
    const layouts = createLayoutsStore(memoryStorage())
    layouts.getState().saveLayout('HOME', { base: 'not-a-real-signature', dock: { grid: 'not a grid' } })
    const onLayoutDropped = vi.fn()
    renderWorkspace({ layouts, onLayoutDropped })
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(onLayoutDropped).not.toHaveBeenCalled()
  })

  it('a stale-base layout with an unknown panel code is not announced and cannot be undone', async () => {
    // First pass: customise HOME so there is a real, structurally valid dock JSON to reuse.
    const first = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => first.ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    const saved = first.layouts.getState().layouts.HOME as {
      readonly dock: { readonly panels: Record<string, { readonly params: Record<string, unknown> }> }
    }
    first.unmount()

    // Tamper one panel's params with an unknown mnemonic code: structurally sound (readDock still
    // accepts it) but not restorable (sanitiseParams refuses it).
    const dock = structuredClone(saved.dock)
    const panelId = Object.keys(dock.panels)[0]
    if (!panelId) throw new Error('expected at least one saved panel')
    const panel = dock.panels[panelId]
    if (!panel) throw new Error('expected the saved panel to be present')
    dock.panels[panelId] = { ...panel, params: { ...panel.params, code: 'ZZZZ' } }

    // Second pass: a fresh store, seeded with that dock under a stale ('00000000') base.
    const layouts = createLayoutsStore(memoryStorage())
    layouts.getState().saveLayout('HOME', { base: '00000000', dock })
    const onLayoutDropped = vi.fn()
    const { ref } = renderWorkspace({ layouts, onLayoutDropped })
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    expect(onLayoutDropped).not.toHaveBeenCalled()

    let restored: string | null = 'not yet called'
    act(() => {
      restored = ref.current?.undo() ?? null
    })
    expect(restored).toBeNull()
    expect(layouts.getState().layouts.HOME).toBeUndefined()
  })
})

describe('preview: what Enter or Shift+Enter would do, with no side effects', () => {
  it('reports a replace and an add without changing any panel, store or link group', async () => {
    const { ref, layouts, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    const before = panelTitles()
    const es = { kind: 'instrument' as const, value: 'ES' }
    let replacePreview: ReturnType<NonNullable<typeof ref.current>['preview']> = null
    let addPreview: ReturnType<NonNullable<typeof ref.current>['preview']> = null
    act(() => {
      replacePreview = ref.current?.preview(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace') ?? null
      addPreview = ref.current?.preview(command('LEDG'), 'new-panel') ?? null
    })
    expect(panelTitles()).toEqual(before)
    expect(layouts.getState().layouts).toEqual({})
    expect(linkGroups.getState().contexts.A).toEqual({ kind: 'instrument', value: 'NQ' })
    expect(replacePreview).toEqual({ kind: 'replace', panel: { number: 1, code: 'GP' }, code: 'GP', retarget: null })
    expect(addPreview).toEqual({ kind: 'add', after: { number: 1, code: 'GP' }, code: 'LEDG', retarget: null })
  })

  it('reports a load sourced from the saved layout, still with no side effects', async () => {
    const { ref, layouts } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    // Customise REG itself, then leave it, so REG has a saved layout of its own to preview against.
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    expect(layouts.getState().layouts.REG).toBeDefined()
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(HOME_TITLES))
    const before = panelTitles()
    const layoutsBefore = layouts.getState().layouts
    let loadPreview: ReturnType<NonNullable<typeof ref.current>['preview']> = null
    act(() => {
      loadPreview = ref.current?.preview(command('REG'), 'replace') ?? null
    })
    expect(panelTitles()).toEqual(before)
    expect(layouts.getState().layouts).toEqual(layoutsBefore)
    expect(loadPreview).toEqual({ kind: 'load', screen: 'REG', panels: 2, source: 'saved', same: false })
  })
})
