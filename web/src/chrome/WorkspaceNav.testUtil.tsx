// Shared by the Workspace tests of Number <GO> (G03), the opened line (G14) and link group steps (U21): a
// Workspace on the shell screens (only HELP is built; the rest draw their placeholder) with in-memory stores.
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { vi } from 'vitest'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic } from '../commands/registry'
import { createLayoutsStore } from '../state/layouts'
import { createLinkGroupsStore } from '../state/linkGroups'
import type { SafeStorage } from '../state/safeStorage'
import Workspace, { type WorkspaceHandle } from './Workspace'
import { BUILT_SCREENS, type ScreenRegistry } from './WorkspaceScreens'

export class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Call from beforeAll: dockview measures its host with ResizeObserver, which jsdom lacks. */
export function stubResizeObserver(): void {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
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

/** A parsed command, as the command line would hand it to the Workspace. */
export function command(code: string, extra: Partial<ParsedCommand> = {}): ParsedCommand {
  const mnemonic = findMnemonic(code)
  if (!mnemonic) throw new Error(code)
  return { mnemonic, context: null, contextSource: 'none', args: {}, canonical: code, ...extra }
}

const SHELL_SCREENS: ScreenRegistry = { HELP: BUILT_SCREENS.HELP }

export function renderWorkspace() {
  const ref = createRef<WorkspaceHandle>()
  const layouts = createLayoutsStore(memoryStorage())
  const linkGroups = createLinkGroupsStore(memoryStorage())
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <Workspace ref={ref} screens={SHELL_SCREENS} layouts={layouts} linkGroups={linkGroups} />
    </div>,
  )
  return { ...utils, ref, layouts, linkGroups }
}

export function panelTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-title]')).map((h) => h.getAttribute('data-nqt-title') ?? '')
}

export function panelIds(): string[] {
  return Array.from(document.querySelectorAll('[data-nqt-panel]')).map((el) => el.getAttribute('data-nqt-panel') ?? '')
}
