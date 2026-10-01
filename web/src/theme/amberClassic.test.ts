// The amber-classic theme (TASKS Phase 12): an optional all-amber-on-black look that overrides token
// values only. Every WCAG pair of the default theme still passes with it, alone and with either CVD
// theme, and so does the wider set of surfaces the amber text now sits on (AMBER_CLASSIC_PAIRS).
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import { CONTRAST_PAIRS, CVD_PAIRS, TEXT_MIN, COMPONENT_MIN, auditContrast, contrastRatio, readTokens } from './contrast'
import { auditCvdSigns } from './cvdSim'
import {
  AMBER_CLASSIC_PAIRS,
  AMBER_CLASSIC_SELECTOR,
  AMBER_CLASSIC_THEME,
  amberClassicOverrides,
  auditAmberClassicStructure,
  readAmberClassicTokens,
} from './amberClassic'

// Vitest stubs every stylesheet except tokens.css (vite.config.ts), so the theme file is read from disk.
// The app tsconfig carries browser types only, so the Node built-in is typed here by hand.
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }
const amberCss = fs.readFileSync(new URL('./amberClassic.css', import.meta.url), 'utf8')

const amber = readAmberClassicTokens(tokensCss, amberCss)
const base = readTokens(tokensCss)

function swap(css: string, name: string, value: string): string {
  const pattern = new RegExp(`(--${name}\\s*:\\s*)#[0-9A-Fa-f]{6}`)
  expect(pattern.test(css), `--${name} present in amberClassic.css`).toBe(true)
  return css.replace(pattern, `$1${value}`)
}

// The values this theme sets, verbatim. Anything not listed keeps its default value.
const AMBER_VALUES: Record<string, string> = {
  text: '#FFC266',
  muted: '#C9A77A',
  'muted-hover': '#D4AE7C',
  'th-fg': '#FFA028',
  'tab-fg': '#FFA028',
  'frame-tab-fg': '#FFA028',
  'minibar-fg': '#FFA028',
  'msg-fg': '#FFA028',
  'chart-axis': '#FFA028',
  'sb-arrow': '#FFA028',
  border: '#4A3210',
  'border-int': '#B8761C',
  'list-border': '#E0962A',
  'menu-border': '#E0962A',
  'dialog-border': '#FFA028',
  'th-rule': '#6B4A18',
  'box-border': '#6B4A18',
  'chrome-div': '#8A5E1E',
  'frame-tab-edge': '#5A3A10',
  'chart-grid': '#5A3A10',
  'sb-thumb': '#9A6A26',
  'tab-bg': '#3A2A10',
  'tab-on': '#C77A12',
  'tab-hover': '#E0901E',
  'fn-bar': '#7A4A00',
  'fn-hover': '#9A5E00',
  'fn-press': '#5E3900',
  'fn-edge': '#2A1800',
  'fn-off': '#B08A50',
}

describe('amberClassic.css: a token set and nothing else', () => {
  it('is one block on the root element under data-theme="amber-classic"', () => {
    expect(AMBER_CLASSIC_THEME).toBe('amber-classic')
    expect(AMBER_CLASSIC_SELECTOR).toBe(':root[data-theme="amber-classic"]')
    expect(auditAmberClassicStructure(tokensCss, amberCss)).toEqual([])
  })

  it('sets exactly the listed values', () => {
    expect(amberClassicOverrides(amberCss)).toEqual(AMBER_VALUES)
  })

  it('leaves the labels, the fields, the sign colours, the selection and the command line as they are', () => {
    for (const name of ['data', 'field-bg', 'fence', 'c-up', 'c-down', 'sel-bg', 'cmd-border', 'focus', 'white', 'flag-bg', 'bg']) {
      expect(amber[name], `--${name}`).toBe(base[name])
    }
  })

  it('makes the number text amber: red channel full, blue channel the lowest', () => {
    const hex = amber.text!
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    expect(r).toBe(255)
    expect(g).toBeGreaterThan(b!)
    expect(b).toBeLessThan(128)
  })
})

describe('contrast with amber-classic (look spec 8.2 plus the amber surfaces)', () => {
  it('passes every default-theme pair', () => {
    expect(auditContrast(amber, CONTRAST_PAIRS)).toEqual([])
  })

  it('passes every amber-classic pair', () => {
    expect(AMBER_CLASSIC_PAIRS.length).toBeGreaterThan(80)
    expect(auditContrast(amber, AMBER_CLASSIC_PAIRS)).toEqual([])
  })

  // The default pairs on a CVD theme alone already fail one pair outside this theme: --cvd-up #3399FF on
  // --hover-cell (3.75), which the CVD suite does not check. Amber-classic must add no failure to that.
  it.each(['deut', 'prot'] as const)('adds no failure when combined with the %s theme', (cvd) => {
    const combined = readAmberClassicTokens(tokensCss, amberCss, cvd)
    const cvdAlone = readTokens(tokensCss, cvd)
    expect(auditContrast(combined, CONTRAST_PAIRS)).toEqual(auditContrast(cvdAlone, CONTRAST_PAIRS))
    expect(auditContrast(combined, CONTRAST_PAIRS).map((f) => `${f.fg}/${f.bg}`)).toEqual(['c-up/hover-cell'])
    expect(auditContrast(combined, CVD_PAIRS)).toEqual([])
    expect(auditContrast(combined, AMBER_CLASSIC_PAIRS)).toEqual([])
    expect(auditCvdSigns(combined, cvd)).toEqual([])
  })

  it('checks the amber text on every dark surface it can sit on', () => {
    const has = (fg: string, bg: string, min: number) =>
      AMBER_CLASSIC_PAIRS.some((p) => p.fg === fg && p.bg === bg && p.min === min)
    for (const bg of ['bg', 'raised', 'chrome', 'th-bg', 'sel-bg', 'hover-row', 'hover-cell', 'hover-menu', 'list-sel',
      'tab-bg', 'btn-grey', 'field-btn', 'ro-box', 'band', 'cfg-head', 'stats-band', 'toggle-hover', 'tape-bg']) {
      expect(has('text', bg, TEXT_MIN), `text on ${bg}`).toBe(true)
      expect(has('data', bg, TEXT_MIN), `data on ${bg}`).toBe(true)
    }
    expect(has('muted', 'hover-menu', TEXT_MIN)).toBe(true)
    expect(has('muted-hover', 'hover-cell', TEXT_MIN)).toBe(true)
    expect(has('white', 'fn-bar', TEXT_MIN)).toBe(true)
    expect(has('black', 'tab-on', TEXT_MIN)).toBe(true)
    expect(has('border-int', 'raised', COMPONENT_MIN)).toBe(true)
    expect(has('sb-thumb', 'sb-track', COMPONENT_MIN)).toBe(true)
  })

  it('reproduces the key ratios', () => {
    expect(contrastRatio(amber.text!, amber['hover-cell']!)).toBeCloseTo(6.91, 2)
    expect(contrastRatio(amber.muted!, amber['hover-menu']!)).toBeCloseTo(5.27, 2)
    expect(contrastRatio(amber.white!, amber['fn-bar']!)).toBeCloseTo(7.48, 2)
    expect(contrastRatio(amber['border-int']!, amber.raised!)).toBeCloseTo(4.48, 2)
    expect(contrastRatio(amber['sb-thumb']!, amber['sb-track']!)).toBeCloseTo(3.38, 2)
  })
})

describe('born-failing cases (rule 5): the checks must reject these', () => {
  it('fails a bright amber function bar under the white screen title (2.04)', () => {
    const broken = readAmberClassicTokens(tokensCss, swap(amberCss, 'fn-bar', '#FFA028'))
    expect(contrastRatio('#FFFFFF', '#FFA028')).toBeCloseTo(2.04, 2)
    expect(auditContrast(broken, CONTRAST_PAIRS)).toContainEqual(expect.objectContaining({ fg: 'white', bg: 'fn-bar' }))
  })

  it('fails a darker amber for the number text inside a hovered cell (3.82)', () => {
    const broken = readAmberClassicTokens(tokensCss, swap(amberCss, 'text', '#C88C40'))
    expect(auditContrast(broken, AMBER_CLASSIC_PAIRS)).toContainEqual(
      expect.objectContaining({ fg: 'text', bg: 'hover-cell', min: TEXT_MIN }))
  })

  it('fails a muted amber that is too dark on the menu hover (4.13)', () => {
    const broken = readAmberClassicTokens(tokensCss, swap(amberCss, 'muted', '#C88C40'))
    expect(auditContrast(broken, AMBER_CLASSIC_PAIRS)).toContainEqual(
      expect.objectContaining({ fg: 'muted', bg: 'hover-menu', min: TEXT_MIN }))
  })

  it('fails a scrollbar thumb below 3:1 on its track', () => {
    const broken = readAmberClassicTokens(tokensCss, swap(amberCss, 'sb-thumb', '#5A3A10'))
    expect(auditContrast(broken, AMBER_CLASSIC_PAIRS)).toContainEqual(
      expect.objectContaining({ fg: 'sb-thumb', bg: 'sb-track', min: COMPONENT_MIN }))
  })

  it('refuses a token the default theme does not declare', () => {
    const extra = amberCss.replace(/\}\s*$/, '  --amber-new: #FFA028;\n}\n')
    expect(auditAmberClassicStructure(tokensCss, extra)).toContainEqual(expect.stringMatching(/--amber-new/))
  })

  it('refuses a token a CVD theme owns, so the two stay independent', () => {
    const clash = amberCss.replace(/\}\s*$/, '  --c-up: #FFA028;\n}\n')
    expect(auditAmberClassicStructure(tokensCss, clash)).toContainEqual(expect.stringMatching(/--c-up/))
  })

  it('refuses a size or a font (only colours may change)', () => {
    const size = amberCss.replace(/\}\s*$/, '  --row-h: 24px;\n}\n')
    expect(auditAmberClassicStructure(tokensCss, size)).toContainEqual(expect.stringMatching(/--row-h/))
  })

  it('refuses a colour that is not a 6-digit hex or a known token', () => {
    const odd = swap(amberCss, 'border', '#4A3210').replace('--border: #4A3210', '--border: rgb(74, 50, 16)')
    expect(auditAmberClassicStructure(tokensCss, odd)).toContainEqual(expect.stringMatching(/--border/))
  })

  it('refuses a second block or any other selector', () => {
    const second = `${amberCss}\n.x { color: red; }\n`
    expect(auditAmberClassicStructure(tokensCss, second).length).toBeGreaterThan(0)
    const wrong = amberCss.replace(':root[data-theme="amber-classic"]', '[data-theme="amber-classic"]')
    expect(auditAmberClassicStructure(tokensCss, wrong).length).toBeGreaterThan(0)
  })
})
