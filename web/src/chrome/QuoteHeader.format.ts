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

export function formatTreasury(value: number | null | undefined): string {
  if (!usable(value)) return MISSING
  const sign = value < 0 ? '-' : ''
  const quarters = Math.round(Math.abs(value) * 128)
  const whole = Math.floor(quarters / 128)
  const rest = quarters - whole * 128
  const thirtySeconds = Math.floor(rest / 4)
  const mark = QUARTER_MARKS[rest % 4] ?? ''
  return `${sign}${whole}-${String(thirtySeconds).padStart(2, '0')}${mark}`
}

/** A price as the instrument quotes it: 32nds for Treasury futures, a level otherwise. */
export function formatPrice(root: string, value: number | null | undefined, decimals: number): string {
  return isTreasury(root) ? formatTreasury(value) : formatLevel(value, decimals)
}
