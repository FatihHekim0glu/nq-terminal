// Workspace.css read as text (look spec 8.5 e: every state change is a hard cut, no eased
// transitions). A focused file next to Workspace.css rather than an addition to the shared
// PanelChrome.styles.test.ts, which several other owners' stylesheets also run through.
import { describe, expect, it } from 'vitest'
import workspaceCss from './Workspace.css?raw'

function rule(css: string, selector: string): string {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

describe('Workspace.css: dockview overrides', () => {
  // dockview-react ships .dv-scrollable .dv-scrollbar with `transition: background-color 1s`
  // (dockview.css); nq-lab overrides every scrollbar look here (classic, square, 15px), so the
  // motion needs cutting here too rather than left to the library default (G22).
  it('cuts the dockview scrollbar background-color transition to a hard cut, not the library default 1s', () => {
    expect(rule(workspaceCss, '.nqt-workspace .dv-scrollbar')).toMatch(/transition:\s*none/)
  })
})
