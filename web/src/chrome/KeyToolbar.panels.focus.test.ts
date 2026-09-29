// @vitest-environment jsdom
// Alt+N focuses panel N through the roving Tab stop (SHELL-DIET). KeyToolbar.panels.ts is part of the
// first-paint shell and must not import WorkspaceFocus.ts (about 1.2 kB gzip of roving-focus code that only
// the Workspace chunk and the screens need); WorkspaceFocus registers its syncRoving with the panels module
// when it loads, which is always before a panel exists to focus.
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  document.body.replaceChildren()
  vi.resetModules()
})

/** Two panels, each with a default item and a second item, in the markup the Workspace renders. */
function mountPanels(): void {
  document.body.innerHTML = [1, 2]
    .map(
      (n) =>
        `<section data-nqt-panel="p${n}"><button data-roving data-roving-default id="p${n}-a">a</button><button data-roving id="p${n}-b">b</button></section>`,
    )
    .join('')
}

describe('focusPanelAt', () => {
  it('focuses the Tab stop of panel n once WorkspaceFocus has loaded, and leaves one stop in the panel', async () => {
    const panels = await import('./KeyToolbar.panels')
    await import('./WorkspaceFocus')
    mountPanels()
    expect(panels.focusPanelAt(2)).toBe(true)
    expect(document.activeElement?.id).toBe('p2-a')
    expect(document.getElementById('p2-b')?.getAttribute('tabindex')).toBe('-1')
  })

  it('is false when there is no such panel', async () => {
    const panels = await import('./KeyToolbar.panels')
    await import('./WorkspaceFocus')
    mountPanels()
    expect(panels.focusPanelAt(3)).toBe(false)
    expect(panels.focusPanelAt(0)).toBe(false)
  })

  it('does nothing, and does not throw, before WorkspaceFocus has loaded', async () => {
    const panels = await import('./KeyToolbar.panels')
    mountPanels()
    expect(panels.focusPanelAt(1)).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the shell rule', () => {
  const sources = import.meta.glob<string>(['/src/chrome/KeyToolbar.panels.ts', '/src/chrome/WorkspaceFocus.ts'], { query: '?raw', import: 'default', eager: true })

  it('KeyToolbar.panels.ts does not import WorkspaceFocus; WorkspaceFocus registers with the panels', () => {
    const panels = sources['/src/chrome/KeyToolbar.panels.ts'] ?? ''
    const focus = sources['/src/chrome/WorkspaceFocus.ts'] ?? ''
    expect(panels.length).toBeGreaterThan(0)
    expect(/^import\b[^\n]*from\s+['"]\.\/WorkspaceFocus['"]/m.test(panels)).toBe(false)
    expect(/^import\b[^\n]*from\s+['"]\.\/KeyToolbar\.panels['"]/m.test(focus)).toBe(true)
  })
})
