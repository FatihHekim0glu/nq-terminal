// @vitest-environment jsdom
// DES inside the real workspace, registered the way the merge step will register it (the Workspace's
// `screens` prop stands in for BUILT_SCREENS): the red bar and the tabs land in the panel's slots, the
// panel stays one Tab stop, and the tabs, boxes and red-bar buttons answer Number <GO>.
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { activateNumbered, numberedItems } from '../../chrome/NumberedActions'
import Workspace, { type WorkspaceHandle } from '../../chrome/Workspace'
import { panelTabStops } from '../../chrome/WorkspaceFocus'
import { BUILT_SCREENS } from '../../chrome/WorkspaceScreens'
import type { ParsedCommand } from '../../commands/parser'
import { findMnemonic } from '../../commands/registry'
import { createLayoutsStore } from '../../state/layouts'
import { createLinkGroupsStore } from '../../state/linkGroups'
import type { SafeStorage } from '../../state/safeStorage'
import { DES } from '../../copy/des'
import DesScreen from './index'
import { CONFIRMATION, OVERNIGHT, PANEL } from './desTestData'

vi.mock('../../charts/LineStack', () => ({ default: () => <div data-testid="des-linestack" /> }))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://127.0.0.1').pathname
    if (path === '/api/confirmations') return json([CONFIRMATION])
    if (path === '/api/sealed') return json([])
    if (path === '/api/hypotheses') return json([OVERNIGHT.card])
    if (path === '/api/hypotheses/overnight_v0') return json(OVERNIGHT)
    if (path.endsWith('/panel')) return json(PANEL)
    return json({ detail: 'not in this test' }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function desCommand(): ParsedCommand {
  const mnemonic = findMnemonic('DES')
  if (!mnemonic) throw new Error('DES')
  return { mnemonic, context: { kind: 'hypothesis', value: 'overnight_v0' }, contextSource: 'typed', args: {}, canonical: 'overnight_v0 DES' }
}

describe('DES in the workspace', () => {
  it('fills the panel chrome slots, keeps one Tab stop and answers Number <GO>', async () => {
    const ref = createRef<WorkspaceHandle>()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <ApiProvider client={client}>
        <div style={{ width: 1600, height: 900 }}>
          <Workspace
            ref={ref}
            layouts={createLayoutsStore(memoryStorage())}
            linkGroups={createLinkGroupsStore(memoryStorage())}
            screens={{ ...BUILT_SCREENS, DES: DesScreen }}
          />
        </div>
      </ApiProvider>,
    )
    await waitFor(() => expect(document.querySelectorAll('[data-nqt-title]').length).toBeGreaterThan(0))
    act(() => ref.current?.run(desCommand(), 'replace'))
    const panel = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-nqt-title="overnight_v0 DES"]')
      if (!el) throw new Error('no DES panel yet')
      return el
    })
    await screen.findByRole('heading', { name: 'overnight_v0', level: 3 }, { timeout: 5000 })
    expect(panel.querySelector('.pslot-bar .fn-bar')).not.toBeNull()
    expect(panel.querySelector('.pslot-tabs [role="tablist"]')).not.toBeNull()
    expect(panelTabStops(panel)).toHaveLength(1)
    const id = panel.getAttribute('data-nqt-panel') ?? ''
    await waitFor(() => expect(numberedItems(id).map((i) => i.n)).toEqual(expect.arrayContaining([1, 2, 3, 4, 8, 10, 14, 96, 99])))
    act(() => {
      activateNumbered(id, 2)
    })
    await screen.findByRole('table', { name: new RegExp(`Pass checks of overnight_v0`) })
    expect(screen.getByRole('tab', { name: `2) ${DES.tabs.checks}` }).getAttribute('aria-selected')).toBe('true')
  })
})
