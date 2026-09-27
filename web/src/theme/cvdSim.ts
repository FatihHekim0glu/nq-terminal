// Colour-vision simulation for the CVD themes (look spec section 2.3). A theme exists so that gain and
// loss stay distinguishable for its reader, which a contrast ratio against the background cannot show:
// the default bars #00851C and #C31834 both pass 3:1 on black yet look the same to a deuteranope.
// Colours are simulated with the Machado, Oliveira and Fernandes (2009) matrices at severity 1 in linear
// RGB and compared as CIE76 differences in CIELAB (D65). Pure; tokens come from readTokens.
import type { CvdTheme, TokenMap } from './contrast'

type Vec3 = readonly [number, number, number]
type Mat3 = readonly [Vec3, Vec3, Vec3]

const MACHADO: Readonly<Record<CvdTheme, Mat3>> = {
  prot: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deut: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
}

/** Gain and loss colours that must stay apart; every pair is checked in both themes. */
export const CVD_SIGN_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['bar-pos', 'bar-neg'],
  ['perf-pos', 'perf-neg'],
  ['c-up', 'c-down'],
]

/** CIE76 difference the simulated pair must keep (about half of the untouched default red and green bars). */
export const MIN_SIGN_DELTA_E = 50

export interface CvdSignFailure {
  readonly pair: readonly [string, string]
  /** NaN when a token is missing or not a 6-digit hex colour */
  readonly deltaE: number
}

const HEX = /^#([0-9A-Fa-f]{6})$/
const WHITE_D65: Vec3 = [0.95047, 1, 1.08883]

function linear(hex: string): Vec3 {
  const match = HEX.exec(hex)
  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = Number.parseInt(match[1]!, 16)
  const ch = (v: number): number => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [ch((n >> 16) & 0xff), ch((n >> 8) & 0xff), ch(n & 0xff)]
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** The colour as the named reader sees it, in linear RGB (0 to 1). */
export function simulateCvd(hex: string, kind: CvdTheme): Vec3 {
  const [r, g, b] = linear(hex)
  const m = MACHADO[kind]
  const row = (i: 0 | 1 | 2): number => clamp01(m[i][0] * r + m[i][1] * g + m[i][2] * b)
  return [row(0), row(1), row(2)]
}

function toLab([r, g, b]: Vec3): Vec3 {
  const xyz: Vec3 = [
    0.4124 * r + 0.3576 * g + 0.1805 * b,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    0.0193 * r + 0.1192 * g + 0.9505 * b,
  ]
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(xyz[0] / WHITE_D65[0]), f(xyz[1] / WHITE_D65[1]), f(xyz[2] / WHITE_D65[2])]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIE76 difference between two colours as the named reader sees them. */
export function cvdDeltaE(a: string, b: string, kind: CvdTheme): number {
  const la = toLab(simulateCvd(a, kind))
  const lb = toLab(simulateCvd(b, kind))
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

function pairDelta(tokens: TokenMap, [a, b]: readonly [string, string], kind: CvdTheme): number {
  const fa = tokens[a]
  const fb = tokens[b]
  if (!fa || !fb || !HEX.test(fa) || !HEX.test(fb)) return Number.NaN
  return cvdDeltaE(fa, fb, kind)
}

/** The sign pairs that the theme's reader cannot tell apart, or whose tokens are missing. [] means all pass. */
export function auditCvdSigns(tokens: TokenMap, kind: CvdTheme): CvdSignFailure[] {
  return CVD_SIGN_PAIRS
    .map((pair) => ({ pair, deltaE: pairDelta(tokens, pair, kind) }))
    .filter((r) => !(r.deltaE >= MIN_SIGN_DELTA_E))
}
