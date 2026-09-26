import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import {
  COMPONENT_MIN,
  CONTRAST_PAIRS,
  TEXT_MIN,
  auditContrast,
  contrastRatio,
  readTokens,
} from './contrast'

// UI_SPEC section 3, verbatim. The tokens file must carry exactly these values.
const SPEC_TOKENS: Record<string, string> = {
  bg: '#070A0E',
  surface: '#0F1318',
  raised: '#171C22',
  text: '#EFF2F5',
  data: '#FFB000',
  muted: '#8D9399',
  accent: '#94D53C',
  'accent-2': '#E8AA4E',
  'c-up': '#23C987',
  'c-down': '#FF5C5C',
  'cvd-up': '#4DA3FF',
  'border-int': '#646C77',
  'sel-bg': '#2A1F00',
  fence: '#FFB000',
  'sec-equity': '#6CB6FF',
  'sec-rates': '#B39DFF',
  'sec-fx': '#38C7E8',
  'sec-energy': '#FF8A3D',
  'sec-metals': '#E0C060',
  'sec-grains': '#9CCC65',
  'sec-livestock': '#F48FB1',
  'sec-benchmark': '#8D9399',
}

const SIGNAL_DOWN = '#E64343'
const SIGNAL_BORDER = '#4A505A'

function swapToken(css: string, name: string, value: string): string {
  const pattern = new RegExp(`(--${name}\\s*:\\s*)#[0-9A-Fa-f]{6}`)
  expect(pattern.test(css), `--${name} present in tokens.css`).toBe(true)
  return css.replace(pattern, `$1${value}`)
}

describe('WCAG contrast formula', () => {
  it('gives 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10)
    expect(contrastRatio('#171C22', '#171C22')).toBeCloseTo(1, 10)
  })

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#FFB000', '#171C22')).toBeCloseTo(contrastRatio('#171C22', '#FFB000'), 12)
  })

  it('reproduces the ratios printed in UI_SPEC section 3', () => {
    const raised = SPEC_TOKENS.raised!
    const surface = SPEC_TOKENS.surface!
    expect(contrastRatio(SPEC_TOKENS.text!, raised)).toBeCloseTo(15.25, 2)
    expect(contrastRatio(SPEC_TOKENS.data!, surface)).toBeCloseTo(10.17, 2)
    expect(contrastRatio(SPEC_TOKENS.muted!, raised)).toBeCloseTo(5.52, 2)
    expect(contrastRatio(SPEC_TOKENS['c-down']!, raised)).toBeCloseTo(5.66, 2)
    expect(contrastRatio(SPEC_TOKENS['border-int']!, raised)).toBeCloseTo(3.23, 2)
    expect(contrastRatio(SPEC_TOKENS['border-int']!, surface)).toBeCloseTo(3.51, 2)
  })

  it('rejects a malformed colour instead of guessing', () => {
    expect(() => contrastRatio('#FFF', '#000000')).toThrow(/hex/i)
    expect(() => contrastRatio('oklch(1 0 0)', '#000000')).toThrow(/hex/i)
  })
})

describe('tokens.css', () => {
  const tokens = readTokens(tokensCss)

  it('defines every UI_SPEC section 3 token with its exact value', () => {
    for (const [name, value] of Object.entries(SPEC_TOKENS)) {
      expect(tokens[name], `--${name}`).toBe(value)
    }
  })

  it('keeps the decorative SIGNAL border as the 9% white alpha', () => {
    expect(tokensCss).toMatch(/--border\s*:\s*oklch\(1 0 0 \/ 9%\)/)
  })

  it('passes every text pair at 4.5:1 and every component pair at 3.0:1', () => {
    expect(auditContrast(tokens)).toEqual([])
  })

  it('checks both kinds of pair with the WCAG thresholds', () => {
    const kinds = new Set(CONTRAST_PAIRS.map((pair) => pair.min))
    expect(kinds).toEqual(new Set([TEXT_MIN, COMPONENT_MIN]))
    expect(TEXT_MIN).toBe(4.5)
    expect(COMPONENT_MIN).toBe(3)
    const covered = new Set(CONTRAST_PAIRS.flatMap((pair) => [pair.fg, pair.bg]))
    for (const name of Object.keys(SPEC_TOKENS)) {
      expect(covered.has(name), `--${name} is checked by some pair`).toBe(true)
    }
  })
})

describe('born-failing cases (rule 5): the audit must reject SIGNAL values', () => {
  it("fails SIGNAL's #E64343 over #171C22 as text", () => {
    const ratio = contrastRatio(SIGNAL_DOWN, '#171C22')
    expect(ratio).toBeLessThan(TEXT_MIN)
    expect(ratio).toBeCloseTo(4.28, 2)

    const broken = readTokens(swapToken(tokensCss, 'c-down', SIGNAL_DOWN))
    const failures = auditContrast(broken)
    expect(failures).toContainEqual(
      expect.objectContaining({ fg: 'c-down', bg: 'raised', min: TEXT_MIN }),
    )
  })

  it('fails #4A505A as an interactive border on raised and surface', () => {
    expect(contrastRatio(SIGNAL_BORDER, '#171C22')).toBeLessThan(COMPONENT_MIN)
    expect(contrastRatio(SIGNAL_BORDER, '#0F1318')).toBeLessThan(COMPONENT_MIN)

    const broken = readTokens(swapToken(tokensCss, 'border-int', SIGNAL_BORDER))
    const failed = auditContrast(broken).filter((f) => f.fg === 'border-int')
    expect(failed.map((f) => f.bg).sort()).toEqual(expect.arrayContaining(['raised', 'surface']))
    expect(failed.every((f) => f.min === COMPONENT_MIN)).toBe(true)
  })

  it('reports a token that is missing from the file instead of skipping it', () => {
    const withoutData = tokensCss.replace(/--data\s*:[^;]+;/, '')
    const failures = auditContrast(readTokens(withoutData))
    expect(failures).toContainEqual(expect.objectContaining({ fg: 'data', ratio: null }))
  })
})
