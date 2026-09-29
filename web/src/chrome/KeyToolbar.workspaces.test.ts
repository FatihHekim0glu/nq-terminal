// @vitest-environment jsdom
// Named workspaces in the chrome's menus (roadmap #14): LOAD on its own lists the saved workspaces, and the
// favourites list appends them after the three layouts. Each row runs LOAD NAME through the command line.
import { describe, expect, it, vi } from 'vitest'
import { NAV_TOOLBAR } from '../copy/chrome'
import { WORKSPACE_LINES } from '../copy/commands'
import { findCopyViolations } from '../copy/copyRules'
import { WORKSPACES } from '../copy/workspaces'
import type { CommandLineHandle } from './CommandLine'
import type { MenuModel } from './CommandLine.menus'
import { createChromeActions, runNav, workspaceMenu, type ChromeEnv, type SavedWorkspaces } from './KeyToolbar.actions'

const panel = (line: string) => ({ line, group: '-' as const, ref: null, direction: 'right' as const })
const SAVED: SavedWorkspaces = {
  ALPHA: { panels: [panel('NQ GP'), panel('volmanaged_v0 EQ')] },
  BRAVO: { panels: [panel('REG')] },
}

function fakeCmd() {
  const showMenu = vi.fn<CommandLineHandle['showMenu']>()
  const cmd: CommandLineHandle = {
    focus: vi.fn(),
    insert: vi.fn(),
    runLine: vi.fn(),
    cancel: vi.fn(),
    walkHistory: vi.fn(),
    help: vi.fn(),
    related: vi.fn(),
    showMenu,
    takeCount: () => null,
    lineText: () => '',
  }
  return { cmd, showMenu }
}

function env(cmd: CommandLineHandle, savedWorkspaces?: () => SavedWorkspaces): ChromeEnv {
  return { cmd: () => cmd, workspace: () => null, focusedPanelId: () => null, focusedCode: () => null, focusedContextLine: () => null, toggleKeymap: () => {}, savedWorkspaces }
}

describe('the shell copy for workspaces (copy/commands.ts)', () => {
  it('is the workspace copy word for word: the shell keeps two of its lines, the rest loads with the Workspace', () => {
    for (const key of Object.keys(WORKSPACE_LINES) as Array<keyof typeof WORKSPACE_LINES>) expect(WORKSPACE_LINES[key], key).toBe(WORKSPACES[key])
    expect(Object.keys(WORKSPACE_LINES).sort()).toEqual(['menuTitle', 'none'])
    expect(findCopyViolations(WORKSPACE_LINES)).toEqual([])
  })
})

describe('workspaceMenu (LOAD on its own)', () => {
  it('lists the saved workspaces in order, each row running LOAD NAME, with the first lines as its detail', () => {
    const menu = workspaceMenu(SAVED)
    expect(menu.key).toBe('workspaces')
    expect(menu.title).toBe(WORKSPACES.menuTitle)
    expect(menu.breadcrumb).toEqual([WORKSPACES.menuTitle])
    expect(menu.intro).toEqual([])
    expect(menu.items.map((i) => [i.n, i.label, i.detail, i.category, i.act])).toEqual([
      [1, 'ALPHA', 'NQ GP, volmanaged_v0 EQ', false, { kind: 'run', line: 'LOAD ALPHA' }],
      [2, 'BRAVO', 'REG', false, { kind: 'run', line: 'LOAD BRAVO' }],
    ])
  })

  it('with nothing saved, says how to save one and lists no row', () => {
    const menu = workspaceMenu({})
    expect(menu.items).toEqual([])
    expect(menu.intro).toEqual([WORKSPACES.none])
  })

  it('shows the first four lines of a big recipe only', () => {
    const many: SavedWorkspaces = { WIDE: { panels: ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'].map(panel) } }
    expect(workspaceMenu(many).items[0]?.detail).toBe('A1, B1, C1, D1')
  })
})

describe('the favourites list (nav toolbar)', () => {
  const opened = (showMenu: ReturnType<typeof fakeCmd>['showMenu']): MenuModel => {
    const menu = showMenu.mock.calls[0]?.[0]
    if (!menu) throw new Error('no menu was shown')
    return menu
  }

  it('keeps HOME, REG and LIVE first and appends the saved workspaces, numbered on', () => {
    const { cmd, showMenu } = fakeCmd()
    const e = env(cmd, () => SAVED)
    runNav(createChromeActions(e), e, 'favourites')
    const menu = opened(showMenu)
    expect(menu.title).toBe(NAV_TOOLBAR.favouritesTitle)
    expect(menu.items.map((i) => [i.n, i.label, i.act])).toEqual([
      [1, 'HOME', { kind: 'run', line: 'HOME' }],
      [2, 'RESEARCH', { kind: 'run', line: 'REG' }],
      [3, 'LIVE', { kind: 'run', line: 'LIVE' }],
      [4, 'ALPHA', { kind: 'run', line: 'LOAD ALPHA' }],
      [5, 'BRAVO', { kind: 'run', line: 'LOAD BRAVO' }],
    ])
  })

  it('is the three layouts alone when nothing is saved or the env knows no workspaces', () => {
    for (const savedWorkspaces of [undefined, () => ({})]) {
      const { cmd, showMenu } = fakeCmd()
      const e = env(cmd, savedWorkspaces)
      runNav(createChromeActions(e), e, 'favourites')
      expect(opened(showMenu).items.map((i) => i.label)).toEqual(['HOME', 'RESEARCH', 'LIVE'])
    }
  })

  it('reads the saved workspaces when it opens, not when the env was made', () => {
    const { cmd, showMenu } = fakeCmd()
    let saved: SavedWorkspaces = {}
    const e = env(cmd, () => saved)
    const actions = createChromeActions(e)
    saved = SAVED
    runNav(actions, e, 'favourites')
    expect(opened(showMenu).items.map((i) => i.label)).toEqual(['HOME', 'RESEARCH', 'LIVE', 'ALPHA', 'BRAVO'])
  })
})
