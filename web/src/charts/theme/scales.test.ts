import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../theme/contrast'
import { DEFAULT_CHART_TOKENS, readChartTokens } from './chartTokens'
import { CORR_STRONG, CORR_WEAK, corrHeat, interpolateHex, monHeat, seagHeat, textOn } from './scales'

const C = DEFAULT_CHART_TOKENS.color
const BLACK = '#000000'
const WHITE = '#FFFFFF'
const STEPS = 101

describe('textOn: the better of black and white', () => {
  it('picks white on the dark red MON step, where black fails (3.23)', () => {
    expect(contrastRatio(BLACK, '#BA152D')).toBeLessThan(4.5)
    expect(textOn('#BA152D')).toBe(WHITE)
  })

  it('picks black on light fills', () => {
    expect(textOn('#51EE6C')).toBe(BLACK)
    expect(textOn('#FFA028')).toBe(BLACK)
    expect(textOn('#FFFFFF')).toBe(BLACK)
  })

  it('draws black and white from the tokens', () => {
    const t = readChartTokens({ getPropertyValue: (n) => (n === '--white' ? '#FEFEFE' : '') })
    expect(textOn('#000000', t)).toBe('#FEFEFE')
  })
})

describe('interpolateHex', () => {
  it('returns the ends at 0 and 1 and rounds each channel between', () => {
    expect(interpolateHex('#014D10', '#18BD39', 0)).toBe('#014D10')
    expect(interpolateHex('#014D10', '#18BD39', 1)).toBe('#18BD39')
    expect(interpolateHex('#000000', '#FFFFFF', 0.5)).toBe('#808080')
  })

  it('clamps t into [0, 1]', () => {
    expect(interpolateHex('#000000', '#FFFFFF', -1)).toBe('#000000')
    expect(interpolateHex('#000000', '#FFFFFF', 2)).toBe('#FFFFFF')
  })
})

describe('seagHeat: MRET ramp (look spec 2.2, 7.5)', () => {
  it('runs from the floor to the max on each side and never falls to black', () => {
    expect(seagHeat(0.001, 10).fill).toBe(C.seagUpFloor)
    expect(seagHeat(10, 10).fill).toBe(C.seagUpMax)
    expect(seagHeat(-0.001, 10).fill).toBe(C.seagDnFloor)
    expect(seagHeat(-10, 10).fill).toBe(C.seagDnMax)
    expect(seagHeat(0, 10).fill).toBe(C.seagUpFloor)
  })

  it('scales by |v| / max|v| and clamps beyond the max', () => {
    expect(seagHeat(5, 10).fill).toBe(interpolateHex(C.seagUpFloor, C.seagUpMax, 0.5))
    expect(seagHeat(-20, 10).fill).toBe(C.seagDnMax)
    expect(seagHeat(3, 0).fill).toBe(C.seagUpMax)
  })

  it('leaves missing and future months black with body text', () => {
    for (const v of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(seagHeat(v, 10)).toEqual({ fill: C.bg, text: C.text })
    }
  })

  it(`passes 4.5:1 text at each of ${STEPS} steps on both ramps (worst 4.60 green, 4.91 red)`, () => {
    let worstUp = Infinity
    let worstDn = Infinity
    for (let i = 0; i < STEPS; i++) {
      const v = i / (STEPS - 1)
      for (const [value, isUp] of [[v, true], [-v || -1e-9, false]] as const) {
        const cell = seagHeat(value, 1)
        const ratio = contrastRatio(cell.text, cell.fill)
        expect(ratio, `${value} on ${cell.fill}`).toBeGreaterThanOrEqual(4.5)
        if (isUp) worstUp = Math.min(worstUp, ratio)
        else worstDn = Math.min(worstDn, ratio)
      }
    }
    expect(worstUp).toBeCloseTo(4.6, 1)
    expect(worstDn).toBeCloseTo(4.91, 1)
  })
})

describe('monHeat: MON 4-step scale (look spec 2.2, 7.7)', () => {
  it('picks the strong step at or beyond the column threshold, the weak step below it', () => {
    expect(monHeat(2, 1)).toEqual({ fill: C.heatUp2, text: BLACK })
    expect(monHeat(1, 1)).toEqual({ fill: C.heatUp2, text: BLACK })
    expect(monHeat(0.3, 1)).toEqual({ fill: C.heatUp1, text: BLACK })
    expect(monHeat(-0.3, 1)).toEqual({ fill: C.heatDn1, text: WHITE })
    expect(monHeat(-1, 1)).toEqual({ fill: C.heatDn2, text: BLACK })
  })

  it('leaves zero and missing values unfilled with body text', () => {
    for (const v of [0, null, Number.NaN]) expect(monHeat(v, 1)).toEqual({ fill: C.bg, text: C.text })
  })

  it('passes 4.5:1 text on every step', () => {
    for (const v of [2, 0.5, -0.5, -2]) {
      const cell = monHeat(v, 1)
      expect(contrastRatio(cell.text, cell.fill), cell.fill).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('corrHeat: MOVERS scale (look spec 2.2, 7.8)', () => {
  it('uses neutral below 0.10, weak from 0.10 to 0.40, strong above 0.40', () => {
    expect(CORR_WEAK).toBe(0.1)
    expect(CORR_STRONG).toBe(0.4)
    expect(corrHeat(0.05).fill).toBe(C.corr0)
    expect(corrHeat(-0.0999).fill).toBe(C.corr0)
    expect(corrHeat(0.1).fill).toBe(C.corrUp1)
    expect(corrHeat(0.4).fill).toBe(C.corrUp1)
    expect(corrHeat(0.41).fill).toBe(C.corrUp2)
    expect(corrHeat(-0.1).fill).toBe(C.corrDn1)
    expect(corrHeat(-0.4).fill).toBe(C.corrDn1)
    expect(corrHeat(-0.95).fill).toBe(C.corrDn2)
  })

  it('shades the diagonal grey, and missing values black', () => {
    expect(corrHeat(1, { diagonal: true }).fill).toBe(C.corrDiag)
    expect(corrHeat(null)).toEqual({ fill: C.bg, text: C.text })
  })

  it('writes white text on every fill, each at least 8.72:1', () => {
    for (const r of [-0.9, -0.2, 0, 0.2, 0.9]) {
      const cell = corrHeat(r)
      expect(cell.text).toBe(WHITE)
      expect(contrastRatio(cell.text, cell.fill)).toBeGreaterThanOrEqual(8.7)
    }
    const diag = corrHeat(1, { diagonal: true })
    expect(diag.text).toBe(WHITE)
    expect(contrastRatio(diag.text, diag.fill)).toBeGreaterThanOrEqual(8.7)
  })
})

describe('the contrast checker is born failing on the pairs the spec rejects', () => {
  it('fails the reference dark red histogram bar and black on the dark red heat step', () => {
    expect(contrastRatio('#731010', BLACK)).toBeLessThan(3)
    expect(contrastRatio(BLACK, '#BA152D')).toBeLessThan(4.5)
  })
})
