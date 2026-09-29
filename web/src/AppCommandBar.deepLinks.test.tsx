// @vitest-environment jsdom
// AppCommandBar loads the address bar's link reader on demand (shell diet 3, roadmap wave 9). The reader, its allowlist
// and its copy are not in the first-paint shell; a chunk that cannot be fetched must not take the command zone down.
import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import appCommandBarSource from './AppCommandBar.tsx?raw'
import CommandZone from './AppCommandBar'

vi.mock('./chrome/DeepLinks', () => {
  throw new Error('Failed to fetch dynamically imported module')
})
vi.mock('./api/queries', () => ({ useCommands: () => ({ status: 'success', data: null }), useHealth: () => ({ status: 'pending', data: undefined }) }))

beforeAll(() => {
  class NoResize {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoResize)
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => cleanup())

/** The module names a file imports or re-exports with a static statement, comments skipped. */
function staticSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
}

describe('the link reader is on demand', () => {
  it('AppCommandBar has no static import of the reader or the hook, and one dynamic import of the component', () => {
    const statics = staticSpecifiers(appCommandBarSource)
    expect(statics).not.toContain('./chrome/useDeepLinks')
    expect(statics).not.toContain('./chrome/DeepLinks')
    expect(statics).not.toContain('./chrome/deepLink')
    expect(appCommandBarSource).toContain("import('./chrome/DeepLinks')")
  })

  it('a reader chunk that cannot be fetched leaves the command line up and says nothing', async () => {
    render(<CommandZone commandRef={createRef()} focusedGroup={null} panelNumber={null} onRun={vi.fn(() => true)} />)
    await act(async () => {})
    expect(screen.getByRole('combobox', { name: 'Command line' })).toBeTruthy()
  })
})
