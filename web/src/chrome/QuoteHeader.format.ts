// Number formats for headers and grids (look spec 3.4; decision D5 for Treasuries).
// - Levels: fixed decimals, no thousands separator, no plus.
// - Changes and returns: `+` or an ASCII hyphen-minus, never parentheses; `%` attached.
// - Volume and money: thousands separators; dense columns shorten to k, M, B.
// - Missing: `--` (ASCII).
// - Treasury futures: whole points, a hyphen, two-digit 32nds, then `+` for a half 32nd and ¼ or ¾
//   for quarters (`130-06+`), since the terminal fonts have no 1/32 and 1/64 glyphs.

export const MISSING = '--'

const TREASURY_ROOTS: ReadonlySet<string> = new Set(['ZT', 'ZF', 'ZN', 'ZB', 'UB', 'TN', 'TU1', 'FV1', 'TY1', 'US1', 'WN1', 'UXY1'])

const QUARTER_MARKS = ['', '¼', '+', '¾'] as const

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** `-0.00` never shows: a change that rounds to zero prints as zero. */
function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

export function formatLevel(value: number | null | undefined, decimals: number): string {
  return usable(value) ? fixed(value, decimals) : MISSING
}

export function formatSignedChange(value: number | null | undefined, decimals: number): string {
  if (!usable(value)) return MISSING
  const text = fixed(value, decimals)
  return value > 0 && Number(text) !== 0 ? `+${text}` : text
}

export function formatPercentChange(value: number | null | undefined, decimals: number): string {
  const text = formatSignedChange(value, decimals)
  return text === MISSING ? text : `${text}%`
}

export function formatPercent(value: number | null | undefined, decimals: number): string {
  return usable(value) ? `${fixed(value, decimals)}%` : MISSING
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatThousands(value: number | null | undefined): string {
  if (!usable(value)) return MISSING
  const whole = Math.round(Math.abs(value))
  return `${value < 0 && whole !== 0 ? '-' : ''}${groupThousands(String(whole))}`
}

const COMPACT: ReadonlyArray<readonly [number, string]> = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
]

export function formatCompact(value: number | null | undefined): string {
  if (!usable(value)) return MISSING
  const size = Math.abs(value)
  const step = COMPACT.find(([base]) => size >= base)
  return step ? `${fixed(value / step[0], 2)}${step[1]}` : String(Math.round(value))
}

export function isTreasury(root: string): boolean {
  return TREASURY_ROOTS.has(root.trim().toUpperCase())
}

/** A tick-decimals count (priceDecimals) finer than 1/128 (7 decimals): ZT and ZF's 1/256 tick needs 8. */
const EIGHTH_TICK_DECIMALS = 8
const GRID_EPSILON = 1e-6

/** True when `value` sits on the 1/128-point grid (quarter-32nd resolution) within floating tolerance. */
function onQuarterGrid(value: number): boolean {
  const n = Math.abs(value) * 128
  return Math.abs(n - Math.round(n)) < GRID_EPSILON
}

/** The CME third-digit table, indexed by an eighth of a 32nd (0-7): not the raw index, since the same
 *  digit set already names quarters of a 32nd (0, 2, +('5'), 7 for 0, ¼, ½, ¾, i.e. QUARTER_MARKS), so
 *  an eighth reuses 2, 5 and 7 for its own quarter-of-a-32nd points and only 1, 3, 6, 8 are new: digit
 *  '4' is never printed. */
const CME_EIGHTH_DIGIT = ['0', '1', '2', '3', '5', '6', '7', '8'] as const

/** points-32nds-eighths, e.g. 109.23046875 (109 + 7.375/32) as '109-073': the CME third-digit notation
 *  (CME_EIGHTH_DIGIT) for a 1/256 tick, where the terminal's quarter marks (¼, +, ¾) have no
 *  eighth-of-a-32nd glyph. */
function formatEighths(value: number): string {
  const eighths256 = Math.round(Math.abs(value) * 256)
  const whole = Math.floor(eighths256 / 256)
  const rest = eighths256 - whole * 256
  const thirtySeconds = Math.floor(rest / 8)
  const eighth = rest % 8
  return `${whole}-${String(thirtySeconds).padStart(2, '0')}${CME_EIGHTH_DIGIT[eighth]}`
}

/**
 * Treasury futures print in 32nds (a hyphen, two-digit 32nds, then a quarter mark). Rounding to
 * quarters of a 32nd (1/128 point) loses resolution on a finer tick (ZT and ZF, 1/256): pass `decimals`
 * (mon/model.ts priceDecimals(tick)) so a value that does not sit on the 1/128 grid prints its eighth of
 * a 32nd instead of the nearest quarter mark, up to 1/256 point (about $7.81 a contract) away (D21).
 */
export function formatTreasury(value: number | null | undefined, decimals?: number): string {
  if (!usable(value)) return MISSING
  const sign = value < 0 ? '-' : ''
  if (decimals !== undefined && decimals >= EIGHTH_TICK_DECIMALS && !onQuarterGrid(value)) {
    return `${sign}${formatEighths(value)}`
  }
  const quarters = Math.round(Math.abs(value) * 128)
  const whole = Math.floor(quarters / 128)
  const rest = quarters - whole * 128
  const thirtySeconds = Math.floor(rest / 4)
  const mark = QUARTER_MARKS[rest % 4] ?? ''
  return `${sign}${whole}-${String(thirtySeconds).padStart(2, '0')}${mark}`
}

/** A price as the instrument quotes it: 32nds for Treasury futures, a level otherwise. */
export function formatPrice(root: string, value: number | null | undefined, decimals: number): string {
  return isTreasury(root) ? formatTreasury(value, decimals) : formatLevel(value, decimals)
}
