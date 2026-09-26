// The panel, bar, tab, field, menu, tooltip and workspace stylesheets read as text
// (look spec 2, 4.3 to 4.12, 8.5 d and e): tokens only, square corners, hard-cut states, the
// 5px tab slant, and 24px targets for every control that is not a table row (decision D1).
import { describe, expect, it } from 'vitest'
import fieldCss from './Field.css?raw'
import functionBarCss from './FunctionBar.css?raw'
import panelCss from './PanelChrome.css?raw'
import quoteCss from './QuoteHeader.css?raw'
import relatedCss from './RelatedMenu.css?raw'
import tabsCss from './TabStrip.css?raw'
import tooltipCss from './Tooltip.css?raw'
import workspaceCss from './Workspace.css?raw'
import gridCss from '../grids/grid.css?raw'

const SHEETS: Readonly<Record<string, string>> = {
  'Field.css': fieldCss,
  'FunctionBar.css': functionBarCss,
  'PanelChrome.css': panelCss,
  'QuoteHeader.css': quoteCss,
  'RelatedMenu.css': relatedCss,
  'TabStrip.css': tabsCss,
  'Tooltip.css': tooltipCss,
  'Workspace.css': workspaceCss,
  'grid.css': gridCss,
}

function rule(css: string, selector: string): string {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

describe('panel stylesheets', () => {
  it('reads every sheet (a sheet that failed to load would pass the scans below)', () => {
    for (const [name, css] of Object.entries(SHEETS)) expect(css.length, name).toBeGreaterThan(100)
  })

  it.each(Object.entries(SHEETS))('%s: every colour is a token (no hex, rgb or hsl literal)', (_name, css) => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(withoutComments).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/)
  })

  it.each(Object.entries(SHEETS))('%s: no colour or background transition (8.5 e)', (_name, css) => {
    for (const m of css.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
      expect(m[1]).toMatch(/^(none|(opacity|transform)[^,]*)(,\s*(opacity|transform)[^,]*)*$/)
    }
  })

  it.each(Object.entries(SHEETS))('%s: square corners only (8.5 d)', (_name, css) => {
    for (const m of css.matchAll(/border-radius\s*:\s*([^;]+);/g)) expect(m[1]?.trim()).toBe('0')
  })

  it('slants the top tabs 5px on the right with clip-path (screens_b-31)', () => {
    const tab = rule(tabsCss, '.tabs-top .tab')
    expect(tab).toMatch(/clip-path:\s*polygon\(0 0, calc\(100% - 5px\) 0, 100% 100%, 0 100%\)/)
    expect(tab).toMatch(/background:\s*var\(--tab-bg\)/)
    expect(rule(tabsCss, '.tabs-top .tab[aria-selected="true"]')).toMatch(/background:\s*var\(--tab-on\)/)
    expect(rule(tabsCss, '.tabs-top .tab:hover')).toMatch(/background:\s*var\(--tab-hover\)/)
  })

  it('keeps every control that is not a table row at least 24px (D1, WCAG 2.5.8)', () => {
    const targets: ReadonlyArray<readonly [string, string]> = [
      [panelCss, '.ptitle-btn'],
      [functionBarCss, '.fn-btn'],
      [functionBarCss, '.menu-item'],
      [tabsCss, '.tab'],
      [fieldCss, '.field'],
      [fieldCss, '.field-list [role="option"]'],
      [fieldCss, '.btn-grey'],
      [fieldCss, '.btn-toggle'],
      [relatedCss, '.related-row'],
      [relatedCss, '.related-cancel'],
    ]
    for (const [css, selector] of targets) {
      const decls = rule(css, selector)
      const height = Number(/min-height:\s*(\d+)px/.exec(decls)?.[1] ?? 0)
      const width = Number(/min-width:\s*(\d+)px/.exec(decls)?.[1] ?? 0)
      expect(height, selector).toBeGreaterThanOrEqual(24)
      expect(width, selector).toBeGreaterThanOrEqual(24)
    }
  })

  it('draws the title bar in the frame grey with black text, and the function bar flat red', () => {
    const title = rule(panelCss, '.ptitle')
    expect(title).toMatch(/background:\s*var\(--frame-bg\)/)
    expect(title).toMatch(/color:\s*var\(--frame-fg\)/)
    const bar = rule(functionBarCss, '.fn-bar')
    expect(bar).toMatch(/background:\s*var\(--fn-bar\)/)
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--fn-edge\)/)
    expect(rule(functionBarCss, '.fn-btn:hover')).toMatch(/background:\s*var\(--fn-hover\)/)
    expect(rule(functionBarCss, '.fn-btn[aria-expanded="true"]')).toMatch(/background:\s*var\(--fn-press\)/)
    expect(rule(functionBarCss, '.fn-btn[aria-disabled="true"]')).toMatch(/color:\s*var\(--fn-off\)/)
  })

  // Changed after visual review round 3: every reference ends each red-bar button, and the amber
  // field, with a 2px dark divider, so a lone `96) Actions` still shows its extent at rest.
  it('ends every red-bar button and the amber field with a 2px --fn-div divider', () => {
    expect(rule(functionBarCss, '.fn-cell')).toMatch(/border-right:\s*2px solid var\(--fn-div\)/)
    expect(rule(functionBarCss, '.fn-field')).toMatch(/border-right:\s*2px solid var\(--fn-div\)/)
    expect(() => rule(functionBarCss, '.fn-cell + .fn-cell')).toThrow()
    expect(rule(functionBarCss, '.fn-right')).not.toMatch(/border/)
  })

  // Changed after the visual review: an outline on the panel was painted over by the red bar, the
  // header and the body, so the line showed only round the title bar. It is now an overlay above them.
  it('marks the focused panel with a 1px command-blue line drawn above its content, and keyboard focus with a 2px white ring', () => {
    const line = rule(panelCss, '.nqt-panel[data-focused="true"]::after')
    expect(line).toMatch(/border:\s*1px solid var\(--cmd-border\)/)
    expect(line).toMatch(/position:\s*absolute/)
    expect(line).toMatch(/inset:\s*0/)
    expect(line).toMatch(/pointer-events:\s*none/)
    expect(line).toMatch(/z-index:\s*\d+/)
    expect(() => rule(panelCss, '.nqt-panel[data-focused="true"]')).toThrow()
    const ring = rule(panelCss, '.nqt-panel .nqt-panel-body:focus-visible')
    expect(ring).toMatch(/outline:\s*2px solid var\(--focus\)/)
  })

  it('dims only the owning panel body with --dim', () => {
    const dim = rule(relatedCss, '.menu-dim')
    expect(dim).toMatch(/position:\s*absolute/)
    expect(dim).toMatch(/inset:\s*0/)
    expect(dim).toMatch(/background:\s*var\(--dim\)/)
  })

  it('draws amber fields with a 1px blue focus outline offset by 1px', () => {
    const field = rule(fieldCss, '.field')
    expect(field).toMatch(/background:\s*var\(--field-bg\)/)
    expect(field).toMatch(/color:\s*var\(--field-fg\)/)
    const focus = rule(fieldCss, '.field:focus-visible')
    expect(focus).toMatch(/outline:\s*1px solid var\(--field-focus\)/)
    expect(focus).toMatch(/outline-offset:\s*1px/)
  })

  it('born failing: has no fixed minimum width for the workspace, so 320 CSS px needs no sideways scroll (1.4.10)', () => {
    expect(workspaceCss).not.toMatch(/min-width:\s*[1-9]\d*px/)
    const narrow = /@media \(max-width: 700px\) \{([\s\S]*?)\n\}/.exec(workspaceCss)?.[1] ?? ''
    expect(narrow).toMatch(/\.nqt-workspace \.dv-view\b/)
    expect(rule(narrow, '.nqt-workspace .dv-groupview')).toMatch(/width:\s*auto/)
  })

  it('uses classic scrollbars in every panel body', () => {
    expect(rule(workspaceCss, '.nqt-workspace ::-webkit-scrollbar')).toMatch(/width:\s*var\(--sb-w\)/)
  })
})
