// Sector keys and generic tickers (spec 5.1 items 1 and 2). A sector key may follow an instrument
// context (`NQ INDEX GP`); the equity futures take INDEX, the FX futures CURNCY and every other future
// COMDTY. Generic tickers (`NQ1`, `TY1`, `C 1`) are aliases of the roots the backend serves; the table
// lives here because the backend's /api/commands carries no alias field (the backend is not changed).
import { SECTOR_TITLES } from '../copy/commands'
import type { CommandIndexData, ResolvedContext } from './types'

export type SectorCode = 'INDEX' | 'COMDTY' | 'CURNCY' | 'EQUITY' | 'GOVT' | 'CORP'

const SECTOR_WORDS: Readonly<Record<string, SectorCode>> = {
  INDEX: 'INDEX',
  COMDTY: 'COMDTY',
  CMDTY: 'COMDTY',
  CURNCY: 'CURNCY',
  CRNCY: 'CURNCY',
  EQUITY: 'EQUITY',
  GOVT: 'GOVT',
  CORP: 'CORP',
}

/** The keys F8 to F11 insert (KB4 legends). */
export const SECTOR_KEYS = { EQUITY: 'F8', COMDTY: 'F9', INDEX: 'F10', CURNCY: 'F11' } as const
export type KeyedSector = keyof typeof SECTOR_KEYS

/** The futures sectors a context can carry, in menu order. */
export const FUTURES_SECTORS = ['INDEX', 'COMDTY', 'CURNCY'] as const

const EQUITY_ROOTS: ReadonlySet<string> = new Set(['ES', 'NQ', 'YM', 'RTY'])

// Generic tickers from secondary sources (spec 5.1 item 2); only CL1 is documented officially.
const GENERIC: Readonly<Record<string, string>> = {
  NQ: 'NQ1', ES: 'ES1', YM: 'DM1', ZN: 'TY1', ZB: 'US1', ZT: 'TU1', ZF: 'FV1',
  '6E': 'EC1', '6J': 'JY1', '6B': 'BP1', '6A': 'AD1', '6C': 'CD1', '6S': 'SF1',
  RB: 'XB1', ZC: 'C 1', ZS: 'S 1', ZW: 'W 1', ZL: 'BO1', ZM: 'SM1', LE: 'LC1', HE: 'LH1',
}

const SPACED_FIRST: ReadonlySet<string> = new Set(['C', 'S', 'W'])

/** The sector a token names, in any case, or null. */
export function sectorWord(token: string): SectorCode | null {
  return SECTOR_WORDS[token.toUpperCase()] ?? null
}

/** The sector key an instrument root takes, from the index's asset class when it is known. */
export function sectorForRoot(root: string, index: CommandIndexData | null): SectorCode {
  // Optional chaining on the list too: a malformed body must never break the chrome that shows it.
  const assetClass = index?.instruments?.find((i) => i.root === root)?.sector
  if (assetClass === 'equity' || (!assetClass && EQUITY_ROOTS.has(root))) return 'INDEX'
  if (assetClass === 'fx' || (!assetClass && root.startsWith('6'))) return 'CURNCY'
  return 'COMDTY'
}

/** The generic ticker for a root: its listed alias, else the root plus 1 (CL1, GC1). */
export function genericFor(root: string): string {
  return GENERIC[root] ?? `${root}1`
}

/** The root a generic ticker stands for, or undefined. Needs the index for the root-plus-1 form. */
export function rootForGeneric(token: string, index: CommandIndexData | null): string | undefined {
  const upper = token.toUpperCase().replace(/\s+/g, ' ')
  const listed = Object.entries(GENERIC).find(([, alias]) => alias === upper)?.[0]
  if (listed) return listed
  if (!upper.endsWith('1') || upper.length < 2) return undefined
  const root = upper.slice(0, -1)
  return index?.instruments?.find((i) => i.root.toUpperCase() === root)?.root
}

/** Joins `C 1`, `S 1` and `W 1` into one token each; returns a new array. */
export function mergeGenericTokens(tokens: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    if (SPACED_FIRST.has(token.toUpperCase()) && tokens[i + 1] === '1') {
      out.push(`${token} 1`)
      i += 1
    } else {
      out.push(token)
    }
  }
  return out
}

/** `NQ1 Index`, `TY1 Comdty`, `EC1 Curncy`. */
export function displayInstrument(root: string, index: CommandIndexData | null): string {
  return `${genericFor(root)} ${SECTOR_TITLES[sectorForRoot(root, index)]}`
}

/** A context as the chrome shows it: instruments as generic tickers, the rest by name; `-` for none. */
export function displayContext(context: ResolvedContext | null, index: CommandIndexData | null): string {
  if (!context) return '-'
  return context.kind === 'instrument' ? displayInstrument(context.value, index) : context.value
}

export interface InsertedLine {
  readonly line: string
  /** Where the caret goes: just after the inserted word. */
  readonly caret: number
}

/**
 * The line after an F8 to F11 key puts its sector word at the caret: one space between the word and the
 * text on either side, none at the start of the line. Pure.
 */
export function insertSectorWord(line: string, at: number, word: string): InsertedLine {
  const caret = Math.min(Math.max(0, at), line.length)
  const before = line.slice(0, caret).replace(/\s+$/, '')
  const after = line.slice(caret).replace(/^\s+/, '')
  const head = before === '' ? word.trim() : `${before} ${word.trim()}`
  return { line: after === '' ? head : `${head} ${after}`, caret: head.length }
}
