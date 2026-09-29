// The regime strip under LineStack's time axis (roadmap 12): one blue ramp of three steps, low to high.
// Steps must be told apart by lightness alone (no hue), so a reader with any colour vision reads the
// strip: adjacent steps differ by at least 1.8:1 in the default theme and in both CVD themes, and each
// step is a 3:1 mark on the black chart background (WCAG 1.4.11).
import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import { COMPONENT_MIN, contrastRatio, readRawTokens, readTokens, type CvdTheme } from './contrast'

const STEPS = ['regime-low', 'regime-mid', 'regime-high'] as const
const RAMP_MIN = 1.8

const themes: readonly (readonly [string, CvdTheme | undefined])[] = [
  ['default', undefined],
  ['deut', 'deut'],
  ['prot', 'prot'],
]

describe('regime ramp tokens', () => {
  it('pins the three blues, dark to light', () => {
    const t = readTokens(tokensCss)
    expect(STEPS.map((name) => t[name])).toEqual(['#3A6EA5', '#5FA8E8', '#CFE8FF'])
  })

  for (const [label, cvd] of themes) {
    describe(`${label} theme`, () => {
      const t = readTokens(tokensCss, cvd)

      it('differs by at least 1.8:1 between adjacent steps', () => {
        for (let i = 1; i < STEPS.length; i += 1) {
          const ratio = contrastRatio(t[STEPS[i - 1]!]!, t[STEPS[i]!]!)
          expect(ratio, `${STEPS[i - 1]} to ${STEPS[i]}`).toBeGreaterThanOrEqual(RAMP_MIN)
        }
      })

      it('keeps the order low, mid, high by contrast with the black background', () => {
        const onBg = STEPS.map((name) => contrastRatio(t[name]!, t.bg!))
        expect(onBg[0]!).toBeLessThan(onBg[1]!)
        expect(onBg[1]!).toBeLessThan(onBg[2]!)
      })

      it('shows every step at 3:1 or better on the chart background', () => {
        for (const name of STEPS) {
          expect(contrastRatio(t[name]!, t.bg!), `${name} on bg`).toBeGreaterThanOrEqual(COMPONENT_MIN)
        }
      })
    })
  }

  it('needs no CVD override: the ramp is one hue, so both CVD blocks leave it alone', () => {
    const base = readRawTokens(tokensCss)
    for (const cvd of ['deut', 'prot'] as const) {
      const themed = readRawTokens(tokensCss, cvd)
      for (const name of STEPS) {
        expect(base[name], `default ${name}`).toMatch(/^#[0-9A-F]{6}$/)
        expect(themed[name], `${cvd} ${name}`).toBe(base[name])
      }
    }
  })

  it('born failing: a ramp step too close to its neighbour would fail the 1.8:1 rule', () => {
    // #5FA8E8 against a mid blue of similar lightness is the case the ramp test exists to catch.
    expect(contrastRatio('#5FA8E8', '#6AB0EE')).toBeLessThan(RAMP_MIN)
  })
})
