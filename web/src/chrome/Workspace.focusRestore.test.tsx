// @vitest-environment jsdom
// Regression tests for the polish-2 dogfood round (G05, G12, G13): a panel action that unmounts or
// hides what had keyboard focus must land focus back inside a panel, never on <body> and never on a
// panel hidden by maximise. A new file (not Workspace.test.tsx) so the wave-2 merge stays clean.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import Workspace, { type WorkspaceHandle } from './Workspace'
import type { ScreenProps, ScreenRegistry } from './WorkspaceScreens'
import { BUILT_SCREENS } from './WorkspaceScreens'

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
  const layouts = createLayoutsStore(memoryStorage())
  const linkGroups = createLinkGroupsStore(memoryStorage())
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} layouts={layouts} linkGroups={linkGroups} {...props} />
    </div>,
  )
  return { ...utils, ref, layouts, linkGroups }
}

function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

function panelEl(id: string): HTMLElement | null {
  return document.querySelector(`[data-nqt-panel="${id}"]`)
}

describe('G05: closing the related functions menu returns focus into the panel, not <body>', () => {
  it('Esc on a menu row lands focus back on the panel (the close-overlay path)', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => {
      ref.current?.openRelatedMenu()
    })
    const dialog = await screen.findByRole('dialog', { name: 'Related functions' })
    const first = within(dialog).getAllByRole('menuitem')[0] as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(first))
    fireEvent.keyDown(first, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const panel = panelEl('home-gp')
    expect(panel?.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('Cancel closes the menu and lands focus back on the panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => {
      ref.current?.openRelatedMenu()
    })
    const dialog = await screen.findByRole('dialog', { name: 'Related functions' })
    const cancel = within(dialog).getByRole('button', { name: /Cancel/ })
    act(() => cancel.click())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const panel = panelEl('home-gp')
    expect(panel?.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('choosing a row (openInPanel) lands focus back on the panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    act(() => {
      ref.current?.openRelatedMenu()
    })
    const dialog = await screen.findByRole('dialog', { name: 'Related functions' })
    const gip = within(dialog).getAllByRole('menuitem').find((m) => /\bGIP\b/.test(m.textContent ?? ''))
    act(() => gip?.click())
    await waitFor(() => expect(panelTitles()[0]).toBe('NQ GIP'))
    expect(screen.queryByRole('dialog')).toBeNull()
    const panel = panelEl('home-gp')
    await waitFor(() => expect(panel?.contains(document.activeElement)).toBe(true))
    expect(document.activeElement).not.toBe(document.body)
  })
})

describe('G12: a grid-row Enter drill (a replace in the panel that had real focus) restores focus', () => {
  function StubGp({ params }: ScreenProps) {
    return (
      <button type="button" data-roving="">
        {`stub row for ${params.code}`}
      </button>
    )
  }

  it('lands focus back inside panel 1 once the new screen replaces it', async () => {
    const { ref } = renderWorkspace({ screens: { GP: StubGp } })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const row = screen.getByRole('button', { name: 'stub row for GP' })
    act(() => row.focus())
    expect(document.activeElement).toBe(row)
    act(() => {
      ref.current?.run(command('RUNS'), 'replace')
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('RUNS'))
    const panel = panelEl('home-gp')
    await waitFor(() => expect(panel?.contains(document.activeElement)).toBe(true))
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keeps waiting when the first frame runs before the replace has committed (a lazy screen on its first load), then lands focus in the panel', async () => {
    const { ref } = renderWorkspace({ screens: { GP: StubGp } })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const row = screen.getByRole('button', { name: 'stub row for GP' })
    act(() => row.focus())
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
    const flushFrames = () => {
      for (const cb of frames.splice(0)) cb(performance.now())
    }
    try {
      act(() => {
        ref.current?.run(command('RUNS'), 'replace')
        // React has not committed the replace yet: the old row still has focus when the first frame runs.
        expect(document.activeElement).toBe(row)
        flushFrames()
      })
      await waitFor(() => expect(panelTitles()[0]).toBe('RUNS'))
      act(() => flushFrames())
      await waitFor(() => expect(panelEl('home-gp')?.contains(document.activeElement)).toBe(true))
      expect(document.activeElement).not.toBe(document.body)
    } finally {
      raf.mockRestore()
    }
  })

  it('does nothing extra when the replaced panel did not have real focus', async () => {
    const { ref } = renderWorkspace({ screens: { GP: StubGp } })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => {
      ref.current?.run(command('RUNS'), 'replace')
    })
    await waitFor(() => expect(panelTitles()[0]).toBe('RUNS'))
    // No real focus before the command: nothing to restore, and it must not crash.
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true)
  })

  it('keeps focus on an input outside the workspace (the command line) when run() replaces the last-focused panel', async () => {
    const { ref } = renderWorkspace({ screens: { GP: StubGp } })
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    const row = screen.getByRole('button', { name: 'stub row for GP' })
    act(() => row.focus())
    expect(document.activeElement).toBe(row)
    const input = document.createElement('input')
    input.setAttribute('aria-label', 'line')
    document.body.appendChild(input)
    try {
      act(() => input.focus())
      expect(document.activeElement).toBe(input)
      act(() => {
        ref.current?.run(command('RUNS'), 'replace')
      })
      await waitFor(() => expect(panelTitles()[0]).toBe('RUNS'))
      await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))))
      expect(document.activeElement).toBe(input)
    } finally {
      input.remove()
    }
  })
})

describe('G13: a panel hidden by maximise is never silently focused or addressed', () => {
  function maximiseGp(): void {
    const gp = screen.getByRole('region', { name: 'NQ GP 1d' })
    act(() => within(gp).getByRole('button', { name: 'Maximise panel' }).click())
  }

  it('Alt+N on a panel hidden by maximise restores the layout and focuses it', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    maximiseGp()
    let ok = false
    act(() => {
      ok = ref.current?.focusPanelNumber(2) ?? false
    })
    expect(ok).toBe(true)
    const mon = panelEl('home-mon')
    await waitFor(() => expect(mon?.contains(document.activeElement)).toBe(true))
    const gp = screen.getByRole('region', { name: 'NQ GP 1d' })
    expect(within(gp).getByRole('button', { name: 'Maximise panel' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('a command run while a panel is maximised replaces the maximised panel, never a hidden one', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    // Real focus stays on the panel that is about to be maximised (the ordinary case: a user maximises
    // the panel they are already working in), not on a different, hidden one (finding: focusPanelNumber
    // no longer being a no-op while maximised changed what that used to set up).
    act(() => screen.getByRole('group', { name: 'NQ GP 1d content' }).focus())
    maximiseGp()
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => {
      ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace')
    })
    await waitFor(() => {
      expect(panelTitles()).toContain('27F MON')
      expect(panelTitles()).toContain('ES GP')
    })
  })

  it('a command replaces the maximised panel even when real focus was left in a now-hidden panel', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => screen.getByRole('group', { name: '27F MON content' }).focus())
    // A jsdom click does not itself move focus, so real focus stays inside MON, now hidden by maximise.
    maximiseGp()
    const es = { kind: 'instrument' as const, value: 'ES' }
    act(() => {
      ref.current?.run(command('GP', { context: es, contextSource: 'typed', canonical: 'ES GP' }), 'replace')
    })
    // Must go RED if visibleId is ever removed from focusedId: run() would then anchor on the hidden
    // MON panel (real DOM focus) instead of the maximised GP one.
    await waitFor(() => {
      expect(panelTitles()).toContain('27F MON')
      expect(panelTitles()).toContain('ES GP')
    })
  })

  it('focusPanelNumber still focuses the maximised panel itself', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    maximiseGp()
    let ok = false
    act(() => {
      ok = ref.current?.focusPanelNumber(1) ?? false
    })
    expect(ok).toBe(true)
    expect(panelEl('home-gp')?.contains(document.activeElement)).toBe(true)
  })

  it('focusPanelShowing restores the layout and focuses a panel hidden by maximise', async () => {
    const { ref } = renderWorkspace()
    await waitFor(() => expect(panelTitles()).toHaveLength(4))
    act(() => {
      ref.current?.run(command('HELP'), 'new-panel')
    })
    await waitFor(() => expect(panelTitles()).toContain('HELP'))
    maximiseGp()
    let ok = false
    act(() => {
      ok = ref.current?.focusPanelShowing('HELP') ?? false
    })
    expect(ok).toBe(true)
    const helpPanel = document.querySelector('[data-nqt-title="HELP"]')
    await waitFor(() => expect(helpPanel?.contains(document.activeElement)).toBe(true))
    const gp = screen.getByRole('region', { name: 'NQ GP 1d' })
    expect(within(gp).getByRole('button', { name: 'Maximise panel' }).getAttribute('aria-pressed')).toBe('false')
  })
})
