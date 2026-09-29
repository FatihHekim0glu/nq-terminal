// Section 8.2 of the look spec in docs/: every text pair at 4.5:1, every graphic pair at 3:1, in the
// default theme and in both CVD themes, plus the negative cases that must fail the checker.
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import {
  COMPONENT_MIN,
  CONTRAST_PAIRS,
  CVD_PAIRS,
  RAMP_STEPS,
  TEXT_MIN,
  auditContrast,
  bestTextRatio,
  contrastRatio,
  mixHex,
  readTokens,
  type ContrastPair,
} from './contrast'

const tokens = readTokens(tokensCss)

function swapToken(css: string, name: string, value: string): string {
  const pattern = new RegExp(`(--${name}\\s*:\\s*)#[0-9A-Fa-f]{6}`)
  expect(pattern.test(css), `--${name} present in tokens.css`).toBe(true)
  return css.replace(pattern, `$1${value}`)
}

function ratioOf(fg: string, bg: string, set = tokens): number {
  const a = set[fg]
  const b = set[bg]
  if (!a || !b) throw new Error(`missing token --${a ? bg : fg}`)
  return contrastRatio(a, b)
}

function hasPair(fg: string, bg: string, min: number, pairs: readonly ContrastPair[] = CONTRAST_PAIRS): boolean {
  return pairs.some((p) => p.fg === fg && p.bg === bg && p.min === min)
}

describe('WCAG contrast formula', () => {
  it('gives 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10)
    expect(contrastRatio('#1E1E1E', '#1E1E1E')).toBeCloseTo(1, 10)
  })

  it('is symmetric in its arguments', () => {
    expect(contrastRatio('#FFA028', '#1E1E1E')).toBeCloseTo(contrastRatio('#1E1E1E', '#FFA028'), 12)
  })

  it('reproduces the ratios printed in section 2', () => {
    expect(ratioOf('text', 'bg')).toBeCloseTo(14.59, 2)
    expect(ratioOf('data', 'bg')).toBeCloseTo(10.31, 2)
    expect(ratioOf('muted', 'raised')).toBeCloseTo(6.77, 2)
    expect(ratioOf('c-down', 'bg')).toBeCloseTo(5.71, 2)
    expect(ratioOf('c-down', 'raised')).toBeCloseTo(4.53, 2)
    expect(ratioOf('c-down-raised', 'th-bg')).toBeCloseTo(5.05, 2)
    expect(ratioOf('c-down-raised', 'sel-bg')).toBeCloseTo(4.62, 2)
    expect(ratioOf('c-down-hover', 'hover-cell')).toBeCloseTo(4.89, 2)
    expect(ratioOf('muted-hover', 'hover-cell')).toBeCloseTo(5.32, 2)
    expect(ratioOf('fn-fg', 'fn-bar')).toBeCloseTo(9.92, 2)
    expect(ratioOf('sb-thumb', 'sb-track')).toBeCloseTo(3.6, 2)
    expect(ratioOf('frame-fg', 'frame-bg')).toBeCloseTo(13.21, 2)
  })

  it('rejects a malformed colour instead of guessing', () => {
    expect(() => contrastRatio('#FFF', '#000000')).toThrow(/hex/i)
    expect(() => contrastRatio('oklch(1 0 0)', '#000000')).toThrow(/hex/i)
  })
})

describe('tokens.css passes section 8.2', () => {
  it('passes every default-theme pair', () => {
    expect(auditContrast(tokens)).toEqual([])
  })

  it('passes every CVD pair in the deuteranopia theme', () => {
    expect(auditContrast(readTokens(tokensCss, 'deut'), CVD_PAIRS)).toEqual([])
  })

  it('passes every CVD pair in the protanomaly theme', () => {
    expect(auditContrast(readTokens(tokensCss, 'prot'), CVD_PAIRS)).toEqual([])
  })

  it('checks the text tokens on each of the five dark surfaces', () => {
    for (const fg of ['text', 'data', 'muted', 'white', 'c-up', 'link']) {
      for (const bg of ['bg', 'raised', 'chrome', 'th-bg', 'sel-bg']) {
        expect(hasPair(fg, bg, TEXT_MIN), `${fg} on ${bg}`).toBe(true)
      }
    }
  })

  it('checks --c-down only where it passes, and the raised and hover variants elsewhere', () => {
    for (const bg of ['bg', 'raised', 'chrome']) expect(hasPair('c-down', bg, TEXT_MIN)).toBe(true)
    for (const bg of ['th-bg', 'sel-bg', 'hover-cell']) expect(hasPair('c-down', bg, TEXT_MIN)).toBe(false)
    expect(hasPair('c-down-raised', 'th-bg', TEXT_MIN)).toBe(true)
    expect(hasPair('c-down-raised', 'sel-bg', TEXT_MIN)).toBe(true)
    expect(hasPair('c-down-hover', 'hover-cell', TEXT_MIN)).toBe(true)
    expect(hasPair('muted-hover', 'hover-cell', TEXT_MIN)).toBe(true)
  })

  it('checks black labels on the light fills and white labels on the dark fills', () => {
    for (const bg of ['field-bg', 'frame-bg', 'tab-on', 'tab-hover', 'key-cancel', 'key-go', 'key-sector',
      'key-panel', 'field-off', 'datatip-bg', 'heat-up-2', 'heat-up-1', 'heat-dn-2']) {
      expect(hasPair('black', bg, TEXT_MIN), `black on ${bg}`).toBe(true)
    }
    for (const bg of ['fn-bar', 'fn-hover', 'fn-press', 'sel-list', 'sel-toggle', 'flag-bg', 'heat-dn-1',
      'corr-dn-2', 'corr-dn-1', 'corr-0', 'corr-up-1', 'corr-up-2', 'corr-diag', 'list-sel']) {
      expect(hasPair('white', bg, TEXT_MIN), `white on ${bg}`).toBe(true)
    }
  })

  it('checks the graphic pairs at 3:1', () => {
    for (const fg of ['cmd-border', 'cmd-cursor', 'border-int', 'field-focus']) {
      for (const bg of ['bg', 'raised', 'chrome']) expect(hasPair(fg, bg, COMPONENT_MIN), `${fg} on ${bg}`).toBe(true)
    }
    expect(hasPair('sb-thumb', 'sb-track', COMPONENT_MIN)).toBe(true)
    expect(hasPair('list-border', 'list-bg', COMPONENT_MIN)).toBe(true)
    for (const fg of ['chart-s1', 'accent-2', 'chart-vol', 'candle-dn', 'bar-pos', 'bar-neg']) {
      expect(hasPair(fg, 'bg', COMPONENT_MIN), `${fg} on bg`).toBe(true)
    }
  })

  it('checks the three regime ramp steps as 3:1 chart marks on the black background', () => {
    for (const fg of ['regime-low', 'regime-mid', 'regime-high']) {
      expect(hasPair(fg, 'bg', COMPONENT_MIN), `${fg} on bg`).toBe(true)
      expect(ratioOf(fg, 'bg'), `${fg} on bg`).toBeGreaterThanOrEqual(COMPONENT_MIN)
    }
    expect(ratioOf('regime-low', 'bg')).toBeCloseTo(3.95, 1)
  })

  it('checks the regime steps in both CVD themes too, where the blocks leave them unchanged', () => {
    for (const cvd of ['deut', 'prot'] as const) {
      const themed = readTokens(tokensCss, cvd)
      const pairs = CONTRAST_PAIRS.filter((p) => p.fg.startsWith('regime-'))
      expect(pairs).toHaveLength(3)
      expect(auditContrast(themed, pairs), cvd).toEqual([])
    }
  })

  it('checks the CVD up and down colours on the four surfaces', () => {
    for (const fg of ['c-up', 'c-down-raised']) {
      for (const bg of ['bg', 'raised', 'th-bg', 'sel-bg']) {
        expect(hasPair(fg, bg, TEXT_MIN, CVD_PAIRS), `${fg} on ${bg}`).toBe(true)
      }
    }
    expect(ratioOf('cvd-up', 'sel-bg')).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(ratioOf('c-down', 'sel-bg', readTokens(tokensCss, 'prot'))).toBeCloseTo(5.3, 1)
  })
})

describe('print tokens (the evidence pack and the print dossier)', () => {
  it('checks the print text tokens on the print paper at 4.5:1', () => {
    for (const fg of ['print-fg', 'print-muted', 'print-label']) {
      expect(hasPair(fg, 'print-bg', TEXT_MIN), `${fg} on print-bg`).toBe(true)
    }
  })

  it('checks the print rule on the print paper at 3:1, as a graphic', () => {
    expect(hasPair('print-rule', 'print-bg', COMPONENT_MIN)).toBe(true)
    expect(hasPair('print-rule', 'print-bg', TEXT_MIN)).toBe(false)
  })

  it('reads the ratios the palette was chosen for', () => {
    expect(ratioOf('print-fg', 'print-bg')).toBeCloseTo(21, 10)
    expect(ratioOf('print-muted', 'print-bg')).toBeCloseTo(8.45, 2)
    expect(ratioOf('print-label', 'print-bg')).toBeCloseTo(6.8, 1)
    expect(ratioOf('print-rule', 'print-bg')).toBeCloseTo(3.36, 2)
  })

  it('passes in the default theme and, being theme independent, in both colour-vision themes', () => {
    const pairs = CONTRAST_PAIRS.filter((p) => p.bg === 'print-bg')
    expect(pairs).toHaveLength(4)
    for (const cvd of [undefined, 'deut', 'prot'] as const) {
      expect(auditContrast(readTokens(tokensCss, cvd), pairs), cvd ?? 'default').toEqual([])
    }
  })

  it('fails a print label that sinks under 4.5:1 (a light amber #C98A2E is 2.9)', () => {
    const broken = readTokens(swapToken(tokensCss, 'print-label', '#C98A2E'))
    expect(auditContrast(broken)).toContainEqual(expect.objectContaining({ fg: 'print-label', bg: 'print-bg', min: TEXT_MIN }))
  })

  it('fails a print rule that sinks under 3:1 (a pale grey #BFBFBF is 1.8)', () => {
    const broken = readTokens(swapToken(tokensCss, 'print-rule', '#BFBFBF'))
    expect(auditContrast(broken)).toContainEqual(expect.objectContaining({ fg: 'print-rule', bg: 'print-bg', min: COMPONENT_MIN }))
  })
})

describe('SEAG heat ramp (MRET): black or white text passes at every one of 101 steps', () => {
  const ramps = [
    { name: 'green', from: 'mret-up-floor', to: 'mret-up-max', worst: 4.6 },
    { name: 'red', from: 'mret-dn-floor', to: 'mret-dn-max', worst: 4.91 },
  ] as const

  for (const ramp of ramps) {
    it(`${ramp.name} ramp stays at or above 4.5`, () => {
      const from = tokens[ramp.from]!
      const to = tokens[ramp.to]!
      const ratios = Array.from({ length: RAMP_STEPS }, (_, i) =>
        bestTextRatio(mixHex(from, to, i / (RAMP_STEPS - 1)), [tokens.black!, tokens.white!]))
      expect(ratios).toHaveLength(101)
      const worst = Math.min(...ratios)
      expect(worst).toBeGreaterThanOrEqual(TEXT_MIN)
      expect(worst).toBeCloseTo(ramp.worst, 1)
    })
  }

  it('mixes channel by channel in sRGB', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000')
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF')
    expect(mixHex('#014D10', '#18BD39', 0.5)).toBe('#0D8525')
  })
})

describe('born-failing cases (rule 5): the checker must reject these reference values', () => {
  it('fails #FF2C4A on the #232323 table header (4.27)', () => {
    const ratio = contrastRatio('#FF2C4A', '#232323')
    expect(ratio).toBeCloseTo(4.27, 2)
    const failures = auditContrast(tokens, [{ fg: 'c-down', bg: 'th-bg', min: TEXT_MIN }])
    expect(failures).toContainEqual(expect.objectContaining({ fg: 'c-down', bg: 'th-bg' }))
  })

  it('fails #FF1E3E as text on #1E1E1E (4.37)', () => {
    expect(contrastRatio('#FF1E3E', '#1E1E1E')).toBeCloseTo(4.37, 2)
    const broken = readTokens(swapToken(tokensCss, 'c-down', '#FF1E3E'))
    expect(auditContrast(broken)).toContainEqual(expect.objectContaining({ fg: 'c-down', bg: 'raised', min: TEXT_MIN }))
  })

  it('fails black on the #BA152D heat step (3.23)', () => {
    expect(contrastRatio('#000000', '#BA152D')).toBeCloseTo(3.23, 2)
    const failures = auditContrast(tokens, [{ fg: 'black', bg: 'heat-dn-1', min: TEXT_MIN }])
    expect(failures).toHaveLength(1)
  })

  it('fails --muted #A5A5A5 inside a hovered cell (4.48)', () => {
    expect(contrastRatio('#A5A5A5', '#3C3C3C')).toBeCloseTo(4.48, 2)
    const failures = auditContrast(tokens, [{ fg: 'muted', bg: 'hover-cell', min: TEXT_MIN }])
    expect(failures).toHaveLength(1)
  })

  it("fails the reference #646464 scrollbar thumb on #222222 (2.69)", () => {
    expect(contrastRatio('#646464', '#222222')).toBeCloseTo(2.69, 2)
    const broken = readTokens(swapToken(tokensCss, 'sb-thumb', '#646464'))
    expect(auditContrast(broken)).toContainEqual(
      expect.objectContaining({ fg: 'sb-thumb', bg: 'sb-track', min: COMPONENT_MIN }))
  })

  it("fails the reference #731010 histogram bar on black (1.81)", () => {
    expect(contrastRatio('#731010', '#000000')).toBeCloseTo(1.81, 2)
    const broken = readTokens(swapToken(tokensCss, 'bar-neg', '#731010'))
    expect(auditContrast(broken)).toContainEqual(
      expect.objectContaining({ fg: 'bar-neg', bg: 'bg', min: COMPONENT_MIN }))
  })

  it("fails the deuteranopia swatch #0089E9 on the header and the selection", () => {
    const broken = readTokens(swapToken(tokensCss, 'cvd-up', '#0089E9'), 'deut')
    const bgs = auditContrast(broken, CVD_PAIRS).filter((f) => f.fg === 'c-up').map((f) => f.bg).sort()
    expect(bgs).toEqual(['sel-bg', 'th-bg'])
  })

  it('fails a regime step that sinks under 3:1 on black (a dark blue #1F3A5A is 1.7)', () => {
    const broken = readTokens(swapToken(tokensCss, 'regime-low', '#1F3A5A'))
    expect(contrastRatio('#1F3A5A', '#000000')).toBeLessThan(COMPONENT_MIN)
    expect(auditContrast(broken)).toContainEqual(
      expect.objectContaining({ fg: 'regime-low', bg: 'bg', min: COMPONENT_MIN }))
  })

  it('reports a token that is missing from the file instead of skipping it', () => {
    const withoutData = tokensCss.replace(/--data\s*:[^;]+;/, '')
    expect(auditContrast(readTokens(withoutData))).toContainEqual(expect.objectContaining({ fg: 'data', ratio: null }))
  })

  it('reports an alias that points at nothing', () => {
    const dangling = tokensCss.replace(/--cmd-border\s*:[^;]+;/, '')
    expect(readTokens(dangling).accent).toBeUndefined()
  })
})
