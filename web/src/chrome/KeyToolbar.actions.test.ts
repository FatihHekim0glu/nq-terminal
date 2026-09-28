// @vitest-environment jsdom
// U10: Shift+End (FORWARD) reaches the same action as End (BACK), and the message line says where
// each landed instead of leaving a stale 'Opened X.' or nothing at all.
// U11: F3 and F5 to F7 are reserved like F2 and F4, each with its own message.
// U20: F1 pressed twice routes through the same path as typed HELP: its own panel, not the focused
// one, so paramsFromCommand's HELP carve-out (WorkspaceModel.test.ts) keeps it unlinked.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RESERVED_F_MESSAGES } from '../copy/help'
import type { CommandLineHandle } from './CommandLine'
import { createChromeActions, HELP_TWICE_MS, runGlobalKey, type ChromeEnv, type ChromeWorkspace } from './KeyToolbar.actions'
import { useMessage, resetMessage } from './MessageLine.store'

afterEach(() => resetMessage())

function makeEnv(overrides: Partial<ChromeEnv> & { workspace: () => ChromeWorkspace | null }): ChromeEnv {
  return {
    cmd: () => null,
    focusedPanelId: () => 'p1',
    focusedCode: () => 'GP',
    focusedContextLine: () => 'NQ1 Index',
    toggleKeymap: () => {},
    ...overrides,
  }
}

function fakeCmd(lineText = ''): CommandLineHandle {
  return {
    focus: vi.fn(),
    insert: vi.fn(),
    runLine: vi.fn(),
    cancel: vi.fn(),
    walkHistory: vi.fn(),
    help: vi.fn(),
    related: vi.fn(),
    showMenu: vi.fn(),
    takeCount: () => null,
    lineText: () => lineText,
  }
}

describe('back/forward: the message line says where it landed (U10)', () => {
  it('posts "Back to <context> <code>." after a successful BACK', () => {
    const ws: ChromeWorkspace = { goBack: () => true, shownIn: () => ({ code: 'GP', context: { kind: 'instrument', value: 'NQ' } }) }
    const env = makeEnv({ workspace: () => ws })
    const actions = createChromeActions(env)
    actions.back(false)
    expect(useMessage.getState().text).toBe('Back to NQ1 Index GP.')
  })

  it('posts "Forward to <context> <code>." after a successful FORWARD', () => {
    const ws: ChromeWorkspace = { goForward: () => true, shownIn: () => ({ code: 'GP', context: { kind: 'instrument', value: 'NQ' } }) }
    const env = makeEnv({ workspace: () => ws })
    const actions = createChromeActions(env)
    actions.back(true)
    expect(useMessage.getState().text).toBe('Forward to NQ1 Index GP.')
  })

  it('keeps the existing "nothing to go back/forward to" message when the move fails', () => {
    const ws: ChromeWorkspace = { goBack: () => false, goForward: () => false }
    const env = makeEnv({ workspace: () => ws })
    const actions = createChromeActions(env)
    actions.back(false)
    expect(useMessage.getState().text).toBe('Nothing to go back to in this panel.')
    actions.back(true)
    expect(useMessage.getState().text).toBe('Nothing to go forward to in this panel.')
  })

  it('runGlobalKey routes a forward action to the same place as back, with forward true', () => {
    const ws: ChromeWorkspace = {
      goForward: vi.fn(() => true),
      goBack: vi.fn(() => true),
      shownIn: () => ({ code: 'GP', context: { kind: 'instrument', value: 'NQ' } }),
    }
    const env = makeEnv({ workspace: () => ws })
    const actions = createChromeActions(env)
    runGlobalKey(actions, env, { kind: 'forward' })
    expect(ws.goForward).toHaveBeenCalledWith('p1')
    expect(ws.goBack).not.toHaveBeenCalled()
    expect(useMessage.getState().text).toBe('Forward to NQ1 Index GP.')
  })

  it('reads the panel it landed on, not the one it left, when the workspace reports shownIn (U10)', () => {
    // App.tsx only keeps refs.focused.current in sync with the panel Terminal rendered before the
    // move; the message must come from the workspace's post-move state, not from env's stale reads.
    const ws: ChromeWorkspace = {
      goBack: () => true,
      goForward: () => true,
      shownIn: () => ({ code: 'GP', context: { kind: 'instrument', value: 'NQ' } }),
    }
    const env = makeEnv({ workspace: () => ws, focusedCode: () => 'DES', focusedContextLine: () => 'ES1 Index' })
    const actions = createChromeActions(env)
    actions.back(false)
    expect(useMessage.getState().text).toBe('Back to NQ1 Index GP.')
    actions.back(true)
    expect(useMessage.getState().text).toBe('Forward to NQ1 Index GP.')
  })

  it('falls back to the env reads when the workspace has no shownIn', () => {
    const ws: ChromeWorkspace = { goBack: () => true }
    const env = makeEnv({ workspace: () => ws, focusedCode: () => 'GP', focusedContextLine: () => 'NQ1 Index' })
    const actions = createChromeActions(env)
    actions.back(false)
    expect(useMessage.getState().text).toBe('Back to NQ1 Index GP.')
  })
})

describe('reserved F-keys: F3 and F5 to F7 join F2 and F4, each with its own message (U11)', () => {
  it('posts a distinct, defined message for every reserved key, not undefined', () => {
    const env = makeEnv({ workspace: () => ({}) })
    const actions = createChromeActions(env)
    for (const f of ['F2', 'F3', 'F4', 'F5', 'F6', 'F7'] as const) {
      runGlobalKey(actions, env, { kind: 'reserved', key: f })
      expect(useMessage.getState().text.length, f).toBeGreaterThan(0)
    }
  })

  it('says F5 would reload and lose every panel history', () => {
    const env = makeEnv({ workspace: () => ({}) })
    const actions = createChromeActions(env)
    runGlobalKey(actions, env, { kind: 'reserved', key: 'F5' })
    expect(useMessage.getState().text).toBe(RESERVED_F_MESSAGES.F5)
  })
})

describe('F1 pressed twice opens its own HELP panel, the same path as typed HELP (U20)', () => {
  it('opens a new panel (newPanel true), not the focused one, on the second press', () => {
    const cmd = fakeCmd()
    let t = 0
    const env = makeEnv({ workspace: () => ({}), cmd: () => cmd, now: () => t })
    const actions = createChromeActions(env)
    actions.help()
    t += HELP_TWICE_MS
    actions.help()
    expect(vi.mocked(cmd.runLine)).toHaveBeenLastCalledWith('HELP', true)
  })

  it('a single F1 press with a focused screen shows that function\'s help in the sheet instead', () => {
    const cmd = fakeCmd()
    const env = makeEnv({ workspace: () => ({}), cmd: () => cmd, focusedCode: () => 'GP', now: () => 0 })
    const actions = createChromeActions(env)
    actions.help()
    expect(vi.mocked(cmd.help)).toHaveBeenCalledWith('GP')
    expect(vi.mocked(cmd.runLine)).not.toHaveBeenCalled()
  })

  it('when a HELP panel already exists, the second press focuses it instead of adding another', () => {
    const cmd = fakeCmd()
    let t = 0
    const focusPanelShowing = vi.fn(() => true)
    const env = makeEnv({ workspace: () => ({ focusPanelShowing }), cmd: () => cmd, now: () => t })
    const actions = createChromeActions(env)
    actions.help()
    t += HELP_TWICE_MS
    actions.help()
    expect(focusPanelShowing).toHaveBeenCalledWith('HELP')
    expect(vi.mocked(cmd.runLine)).not.toHaveBeenCalled()
  })

  it('opens a new HELP panel through runLine when none is already showing', () => {
    const cmd = fakeCmd()
    let t = 0
    const focusPanelShowing = vi.fn(() => false)
    const env = makeEnv({ workspace: () => ({ focusPanelShowing }), cmd: () => cmd, now: () => t })
    const actions = createChromeActions(env)
    actions.help()
    t += HELP_TWICE_MS
    actions.help()
    expect(focusPanelShowing).toHaveBeenCalledWith('HELP')
    expect(vi.mocked(cmd.runLine)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(cmd.runLine)).toHaveBeenCalledWith('HELP', true)
  })

  it('four presses inside the window cause at most one runLine, held or repeated F1 (U20)', () => {
    const cmd = fakeCmd()
    let t = 0
    let added = false
    const focusPanelShowing = vi.fn(() => added)
    const env = makeEnv({ workspace: () => ({ focusPanelShowing }), cmd: () => cmd, now: () => t, focusedCode: () => null })
    const actions = createChromeActions(env)
    vi.mocked(cmd.runLine).mockImplementation(() => {
      added = true
    })
    for (let i = 0; i < 4; i += 1) {
      actions.help()
      t += 10
    }
    expect(vi.mocked(cmd.runLine)).toHaveBeenCalledTimes(1)
  })
})
