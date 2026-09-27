// Mechanical copy rules from UI_SPEC section 10, run over every module in src/copy/.
// The fuller house style lint (a local tool, not in this repo) runs over the same files outside the test suite.

export interface CopyViolation {
  readonly path: string
  readonly rule: string
}

const DASHES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\u2014/, 'em dash'],
  [/\u2013/, 'en dash'],
]

/** US forms the spec bans, each named by the UK form to write instead (the source itself stays clean
 * under the house style lint, which reads this file too). */
const US_SPELLINGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bnormaliz/i, 'normalise'],
  [/\bcolor/i, 'colour'],
  [/\banalyz/i, 'analyse'],
  [/\bbehavior/i, 'behaviour'],
  [/\bcenter(ed|s)?\b/i, 'centre'],
  [/\bfavorite/i, 'favourite'],
  [/\boptimiz/i, 'optimise'],
  [/\bsummariz/i, 'summarise'],
]

function checkString(path: string, text: string): CopyViolation[] {
  const dashes = DASHES.filter(([re]) => re.test(text)).map(([, rule]) => ({ path, rule }))
  const spelling = US_SPELLINGS.filter(([re]) => re.test(text)).map(([, uk]) => ({
    path,
    rule: `US spelling, write ${uk}`,
  }))
  return [...dashes, ...spelling]
}

/** Every string reachable from `value` (objects, arrays, nesting) checked against the copy rules. */
export function findCopyViolations(value: unknown, path = ''): CopyViolation[] {
  if (typeof value === 'string') return checkString(path, value)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    findCopyViolations(child, path ? `${path}.${key}` : key),
  )
}
