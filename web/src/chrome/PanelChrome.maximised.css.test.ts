// A maximised panel keeps every control (WCAG 2.2 SC 1.4.4 Resize Text and SC 1.4.10 Reflow; decision D5.4 of the desktop
// roadmap). Several screens fold their parameter rows, criteria and rails away when their panel body is short (the 2 x 2 HOME,
// the stacked layout of a 200% window): that is for a panel that shares the workspace, and a panel the person has maximised is
// the one place they have asked for all of it. The panel is marked, with no script, by its own pressed maximise toggle (the shell
// chunk has no byte to spare for an attribute), and each fold rule applies only inside `@container not style(--panel-maximised: 1)`.
// The e2e/reflow-200.spec.ts survey proves the outcome in a browser; this test pins the stylesheet so the rules cannot drift apart.
import { describe, expect, it } from 'vitest'
import { PANEL } from '../copy/workspace'
import desCss from '../screens/des/des.css?raw'
import gpCss from '../screens/gp/GpScreen.css?raw'
import monCss from '../screens/mon/market.css?raw'
import regCss from '../screens/reg/reg.css?raw'
import panelCss from './PanelChrome.css?raw'
import workspaceCss from './Workspace.css?raw'

const NOT_MAXIMISED = '@container not style(--panel-maximised: 1) {'

/** The text between the braces of the first block whose header contains `header`, nested blocks included. */
function blockOf(css: string, header: string): string {
  const start = css.indexOf(header)
  if (start < 0) throw new Error(`no block headed ${header}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let at = open; at < css.length; at += 1) {
    if (css[at] === '{') depth += 1
    if (css[at] === '}') depth -= 1
    if (depth === 0) return css.slice(open + 1, at)
  }
  throw new Error(`unterminated block headed ${header}`)
}

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('PanelChrome.css marks a maximised panel', () => {
  const css = withoutComments(panelCss)

  it('sets --panel-maximised: 1 on the panel whose maximise toggle (named by the toggle copy) is pressed', () => {
    const block = blockOf(css, `.nqt-panel:has(> .ptitle [aria-label="${PANEL.maximise}"][aria-pressed="true"])`)
    expect(block).toMatch(/--panel-maximised:\s*1\s*;/)
  })
})

describe('the fold rules of a short panel leave a maximised panel alone', () => {
  const folds: ReadonlyArray<readonly [string, string, string, string]> = [
    ['GpScreen.css', gpCss, '@container gp (max-height: 300px)', '.gp-screen > .gp-rangerow'],
    ['market.css (MON parameter row)', monCss, '@container mkt (max-height: 480px)', '.mon-params'],
    ['reg.css (criteria)', regCss, '@container reg (max-height: 460px)', '.reg-criteria'],
    ['reg.css (round rail)', regCss, '@container reg (max-width: 720px)', '.reg-rail'],
    ['reg.css (criteria heading)', regCss, '@container reg (max-height: 560px)', '.reg-crit-head'],
    ['reg.css (universe line)', regCss, '@container reg (max-height: 560px)', '.reg-universe'],
    ['reg.css (confirmation header row)', regCss, '@container reg (max-height: 560px)', '.reg-confirm-table thead'],
  ]

  it.each(folds)('%s: the fold applies only inside the not-maximised query', (_name, sheet, header, selector) => {
    const outer = blockOf(withoutComments(sheet), header)
    const inner = outer.indexOf(NOT_MAXIMISED)
    expect(inner, `${header} has no ${NOT_MAXIMISED}`).toBeGreaterThanOrEqual(0)
    const nested = blockOf(outer, NOT_MAXIMISED)
    expect(nested, `${selector} is not inside the not-maximised query`).toContain(selector)
    expect(outer.slice(0, inner), `${selector} also appears outside the not-maximised query`).not.toContain(selector)
  })
})

/** Every `@container <name> (max-...)` size block of a sheet, as its header and body (a style-only query is not a size fold). */
function sizeContainerBlocks(css: string): ReadonlyArray<readonly [string, string]> {
  const headers = [...css.matchAll(/@container\s+(?!not\b|style\()[^{]*\(m(?:ax|in)-(?:height|width)[^{]*\{/g)]
  return headers.map((match) => [match[0].slice(0, -1).trim(), blockOf(css, match[0])] as const)
}

/** The block body with its nested not-maximised query cut out. */
function outsideNotMaximised(body: string): string {
  const at = body.indexOf(NOT_MAXIMISED)
  if (at < 0) return body
  const nested = blockOf(body, NOT_MAXIMISED)
  return body.slice(0, at) + body.slice(body.indexOf(nested, at) + nested.length + 1)
}

describe('no size-container fold hides content from a maximised panel', () => {
  const sheets: ReadonlyArray<readonly [string, string]> = [
    ['reg.css', regCss],
    ['GpScreen.css', gpCss],
    ['market.css', monCss],
  ]

  it.each(sheets)('%s: every display: none in a size-container block sits inside the not-maximised query', (_name, sheet) => {
    const blocks = sizeContainerBlocks(withoutComments(sheet))
    expect(blocks.length).toBeGreaterThan(0)
    for (const [header, body] of blocks) {
      expect(outsideNotMaximised(body), `${header} hides content from a maximised panel`).not.toMatch(/display:\s*none/)
    }
  })
})

describe('the stacked layout of a narrow window gives a maximised panel the whole viewport', () => {
  it('Workspace.css makes the group of a pressed maximise toggle as tall as the viewport, not the stacked 80dvh', () => {
    const stacked = blockOf(withoutComments(workspaceCss), '@media (max-width: 700px)')
    const header = `.nqt-workspace .dv-groupview:has(.ptitle [aria-label="${PANEL.maximise}"][aria-pressed="true"])`
    expect(blockOf(stacked, header)).toMatch(/height:\s*max\(16rem,\s*100dvh\)\s*!important/)
  })
})

describe('a maximised panel gets room where a short one is cramped', () => {
  it('GpScreen.css gives a maximised GP chart a floor of 240px (three readable panes), the base floor staying 160px', () => {
    const maximised = blockOf(withoutComments(gpCss), '@container style(--panel-maximised: 1)')
    expect(maximised).toMatch(/\.gp-screen > \.gp-chart\s*\{[^}]*min-height:\s*240px/)
    expect(withoutComments(gpCss)).toMatch(/\.gp-chart\s*\{[^}]*min-height:\s*160px/)
  })

  it('des.css lets the robustness cards be as narrow as the panel (no 560px column in a 512px window)', () => {
    expect(withoutComments(desCss)).toMatch(/\.des-robustness-sections\s*\{[^}]*minmax\(min\(560px,\s*100%\),\s*1fr\)/)
  })

  it('reg.css stacks a maximised, narrow REG rail above the grid instead of hiding it', () => {
    const narrow = blockOf(withoutComments(regCss), '@container reg (max-width: 720px)')
    const stacked = blockOf(narrow, '@container style(--panel-maximised: 1)')
    expect(stacked).toMatch(/\.reg-body\s*\{[^}]*flex-direction:\s*column/)
  })
})
