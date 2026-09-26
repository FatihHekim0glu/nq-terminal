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

const US_SPELLINGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bnormaliz/i, 'normalize'],
  [/\bcolor/i, 'color'],
  [/\banalyz/i, 'analyze'],
  [/\bbehavior/i, 'behavior'],
  [/\bcenter(ed|s)?\b/i, 'center'],
  [/\bfavorite/i, 'favorite'],
  [/\boptimiz/i, 'optimize'],
  [/\bsummariz/i, 'summarize'],
]

function checkString(path: string, text: string): CopyViolation[] {
  const dashes = DASHES.filter(([re]) => re.test(text)).map(([, rule]) => ({ path, rule }))
  const spelling = US_SPELLINGS.filter(([re]) => re.test(text)).map(([, word]) => ({
    path,
    rule: `US spelling: ${word}`,
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
