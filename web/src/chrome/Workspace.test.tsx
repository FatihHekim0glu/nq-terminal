// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { PLACEHOLDER } from '../copy/workspace'
import { HELP } from '../copy/help'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import type { SerializedDockview } from 'dockview-react'
import Workspace, { type FocusedPanel, type WorkspaceHandle } from './Workspace'
import { toStored } from './WorkspaceStorage'
import { panelTabStops } from './WorkspaceFocus'

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

function renderWorkspace(props: Partial<Parameters<typeof Workspace>[0]> = {}) {
  const ref = createRef<WorkspaceHandle>()
  const layouts = createLayoutsStore(memoryStorage())
  const linkGroups = createLinkGroupsStore(memoryStorage())
  const onScreenChange = vi.fn()
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} layouts={layouts} linkGroups={linkGroups} onScreenChange={onScreenChange} {...props} />
    </div>,
  )
  return { ...utils, ref, layouts, linkGroups, onScreenChange }
}

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-panel] h2')).map((h) => h.textContent ?? '')
}

describe('Workspace (dockview) with the default layouts', () => {
  it('opens HOME with its six panels and reports the screen', async () => {
    const { onScreenChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    expect(panelTitles()).toEqual(['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG', 'LIVE', 'OOS'])
    expect(onScreenChange).toHaveBeenCalledWith('HOME')
  })

  it('shows a labelled placeholder for an unbuilt screen', async () => {
    renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    const reg = screen.getByRole('region', { name: 'REG' })
    expect(within(reg).getByText('REG: Registry board')).toBeTruthy()
    expect(within(reg).getByText(PLACEHOLDER.status)).toBeTruthy()
  })

  it('loads a multi-panel screen on Enter and renders HELP from the registry', async () => {
    const { ref, onScreenChange } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    act(() => ref.current?.run(command('HELP'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('HELP'))
    await waitFor(() => expect(screen.getByRole('table', { name: HELP.mnemonicsCaption })).toBeTruthy(), { timeout: 5000 })
    expect(onScreenChange).toHaveBeenLastCalledWith('HELP')
  })

  it('replaces the focused panel in place and retargets its link group', async () => {
    const { ref, linkGroups } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    const gpBody = screen.getByRole('group', { name: 'NQ GP 1d content' })
    act(() => gpBody.focus())
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    expect(panelTitles()).toHaveLength(6)
    expect(linkGroups.getState().contexts.A).toEqual(es)
  })

  it('keeps exactly one Tab stop per panel (dockview tab strips hidden)', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    const root = container.querySelector('.nqt-workspace') as HTMLElement
    const stops = panelTabStops(root)
    expect(stops).toHaveLength(6)
    for (const stop of stops) expect(stop.closest('[data-nqt-panel]')).not.toBeNull()
  })

  it('returns focus to the last focused panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    const oos = screen.getByRole('group', { name: 'OOS content' })
    act(() => oos.focus())
    act(() => (document.activeElement as HTMLElement).blur())
    let moved = false
    act(() => {
      moved = ref.current?.focusPanel() ?? false
    })
    expect(moved).toBe(true)
    expect(document.activeElement).toBe(oos)
  })

  it('restores a screen layout saved from another screen, and resets it when typed on itself', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    act(() => screen.getByRole('group', { name: 'OOS content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toContain('LEDG'))
    act(() => ref.current?.run(command('RUNS'), 'new-panel'))
    await waitFor(() => expect(panelTitles()).toContain('RUNS'))
    const customised = panelTitles()
    expect(customised).toHaveLength(7)
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(customised))
    act(() => ref.current?.run(command('HOME'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['NQ GP 1d', '27F MON', 'volmanaged_v0 EQ', 'REG', 'LIVE', 'OOS']))
  })

  it('born failing: a tampered saved layout falls back to the default instead of rendering it', async () => {
    const layouts = createLayoutsStore(memoryStorage())
    layouts.getState().saveLayout('HOME', toStored('HOME', { grid: 'not a grid' } as unknown as SerializedDockview))
    renderWorkspace({ layouts })
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    expect(panelTitles()[0]).toBe('NQ GP 1d')
  })

  it('with no panel focused yet, focusPanel focuses the first panel (a second Esc never lands on the page)', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    let moved = false
    act(() => {
      moved = ref.current?.focusPanel() ?? false
    })
    expect(moved).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'NQ GP 1d content' }))
  })

  it('with no panel focused, a single-panel screen loads its own layout instead of replacing a panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    act(() => ref.current?.run(command('HELP'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['HELP']))
  })

  it('born failing: the fallback context follows the focused panel after a command replaces it', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    expect(ref.current?.focusedContext()).toBeNull()
    act(() => screen.getByRole('group', { name: 'REG content' }).focus())
    expect(ref.current?.focusedContext()).toBeNull()
    const nq = { kind: 'instrument' as const, value: 'NQ' }
    act(() => ref.current?.run(command('GP', { context: nq, contextSource: 'typed', canonical: 'NQ GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[3]).toBe('NQ GP'))
    expect(ref.current?.focusedContext()).toEqual(nq)
  })

  it('born failing: the fallback context follows the focused panel link group when a command retargets it', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    expect(ref.current?.focusedContext()).toEqual({ kind: 'instrument', value: 'NQ' })
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace'))
    await waitFor(() => expect(panelTitles()[0]).toBe('ES GP'))
    expect(ref.current?.focusedContext()).toEqual(es)
  })

  it('reports the focused panel again after a run, and null once a load removes it', async () => {
    const onFocusedPanelChange = vi.fn<(panel: FocusedPanel | null) => void>()
    const { ref } = renderWorkspace({ onFocusedPanelChange })
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ group: 'A' }) }))
    act(() => ref.current?.run(command('REG'), 'replace'))
    await waitFor(() => expect(panelTitles()).toEqual(['REG', 'MT']))
    expect(onFocusedPanelChange).toHaveBeenLastCalledWith(null)
    expect(ref.current?.focusedContext()).toBeNull()
  })

  it('seeds empty link groups from the layout it loads, and leaves a set group alone', async () => {
    const linkGroups = createLinkGroupsStore(memoryStorage())
    linkGroups.getState().setContext('B', { kind: 'hypothesis', value: 'za_v0' })
    renderWorkspace({ linkGroups })
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    expect(linkGroups.getState().contexts).toEqual({
      A: { kind: 'instrument', value: 'NQ' },
      B: { kind: 'hypothesis', value: 'za_v0' },
      C: null,
    })
  })

  it('born failing: saves a layout only after a command changes it, never the untouched default', async () => {
    const { ref, layouts } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(layouts.getState().layouts).toEqual({})
    act(() => screen.getByRole('group', { name: 'OOS content' }).focus())
    act(() => ref.current?.run(command('LEDG'), 'replace'))
    await waitFor(() => expect(Object.keys(layouts.getState().layouts)).toEqual(['HOME']))
  })

  it('leaves no orphan tabpanel behind the hidden tab strips', async () => {
    const { container } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(6))
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(0)
    expect(container.querySelectorAll('.dv-content-container[aria-labelledby]')).toHaveLength(0)
  })
})
