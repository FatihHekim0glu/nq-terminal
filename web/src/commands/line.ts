// The whole command-line grammar of spec 5.1, on top of the command parser:
//   line := [NXTW] [context [SECTOR]] [FUNCTION [args]] [HELP]
//         | SECTOR | digits | MNEMONIC | HL [query] | NO | MENU | LAST
// parseLine says what a line asks for (an action); the command line carries it out. Pure and total.
import { CHROME_WORDS } from '../copy/commands'
import { resolveContext } from './contexts'
import { MAX_LINE, fail, parseTokens, stripSector, tokenise, type ParseError, type ParseOptions, type ParsedCommand, type Step } from './parser'
import { findMnemonic, type MnemonicCode } from './registry'
import { sectorWord, type SectorCode } from './sectors'
import type { ResolvedContext } from './types'

export type LineAction =
  | { readonly kind: 'run'; readonly command: ParsedCommand; readonly newPanel: boolean }
  | { readonly kind: 'context'; readonly context: ResolvedContext; readonly newPanel: boolean }
  | { readonly kind: 'sector'; readonly sector: SectorCode }
  | { readonly kind: 'number'; readonly n: number }
  | { readonly kind: 'help'; readonly code: MnemonicCode }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'last' }
  | { readonly kind: 'tape' }
  | { readonly kind: 'menu' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'watch' }
  | { readonly kind: 'watch-seen' }
  | { readonly kind: 'grab' }
  | { readonly kind: 'save'; readonly name: string }
  | { readonly kind: 'load'; readonly name: string | null }
  | { readonly kind: 'forget'; readonly name: string }

export type LineResult = { readonly ok: true; readonly action: LineAction } | { readonly ok: false; readonly error: ParseError }

export type ChromeWord = keyof typeof CHROME_WORDS

const DIGITS = /^\d{1,3}$/
const BARE_WORDS: Readonly<Record<string, LineAction>> = {
  LAST: { kind: 'last' },
  NO: { kind: 'tape' },
  MENU: { kind: 'menu' },
  RESET: { kind: 'reset' },
  UNDO: { kind: 'undo' },
  GRAB: { kind: 'grab' },
}
const ALIASES: Readonly<Record<string, string>> = { MAIN: 'HOME' }

const ok = (action: LineAction): LineResult => ({ ok: true, action })

/** A line in upper case with each sector key in title case (spec 3.3). Keeps the length, so the caret stays. */
export function displayLine(text: string): string {
  return text.replace(/\S+/g, (token) => {
    if (sectorWord(token)) return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    return Array.from(token, (c) => (c.toUpperCase().length === 1 ? c.toUpperCase() : c)).join('')
  })
}

const WORKSPACE_NAME = /^[A-Z][A-Z0-9_]{1,15}$/
/** An order ticket word at the start of a name or of a part after an underscore: a workspace has a tab in the frame
 * strip, and BUY, SELL, ORDER, SUBMIT, CANCEL, MODIFY or TRANSMIT there would read as an order control on a terminal
 * that has no order path. The same pattern is in state/workspaces.ts; a test keeps the two in step. */
const TICKET_NAME = /(^|_)(ORDER|SUBMIT|CANCEL|MODIF|TRANSMIT|BUY|SELL)/

/** The store's name rule (isWorkspaceName in state/workspaces.ts) without the store, which is not part of the first
 * paint: 2 to 16 of A-Z, 0-9 and _, starting with a letter, and no function, chrome word (SAVE, LOAD and FORGET are
 * ones), sector word or order ticket word. A test keeps the two in step. */
export function isSavableName(word: string): boolean {
  return WORKSPACE_NAME.test(word) && !TICKET_NAME.test(word) && !findMnemonic(word) && !Object.hasOwn(CHROME_WORDS, word) && sectorWord(word) === null
}

/** SAVE NAME, LOAD NAME, LOAD (alone: the menu) and FORGET NAME. The name is read in capitals, the way the command
 * line shows it. SAVE holds it to the name rule, since it makes the name; LOAD and FORGET take any word of the command
 * alphabet and the store answers "no workspace named ..." for one it does not hold. */
function workspaceAction(word: 'SAVE' | 'LOAD' | 'FORGET', rest: readonly string[]): LineResult {
  const [typed, ...more] = rest
  if (typed === undefined) return word === 'LOAD' ? ok({ kind: 'load', name: null }) : fail('missing-name', word)
  if (more.length > 0) return fail('extra-after-word', word)
  const name = typed.toUpperCase()
  if (word === 'SAVE') return isSavableName(name) ? ok({ kind: 'save', name }) : fail('bad-name', name)
  return ok(word === 'LOAD' ? { kind: 'load', name } : { kind: 'forget', name })
}

/** Digits, a chrome word, a bare sector or a `MNEM HELP` line; null when the line is none of these. */
function chromeAction(tokens: readonly string[]): LineResult | null {
  const [first = '', ...rest] = tokens
  const word = first.toUpperCase()
  if (tokens.length === 1 && DIGITS.test(first)) return ok({ kind: 'number', n: Number(first) })
  if (word === 'HL') return ok({ kind: 'search', query: rest.join(' ') })
  if (word === 'WATCH') {
    if (rest.length === 0) return ok({ kind: 'watch' })
    if (rest.length === 1 && rest[0]?.toUpperCase() === 'SEEN') return ok({ kind: 'watch-seen' })
    return fail('extra-after-word', word)
  }
  if (word === 'SAVE' || word === 'LOAD' || word === 'FORGET') return workspaceAction(word, rest)
  const bare = BARE_WORDS[word]
  if (bare) return rest.length === 0 ? ok(bare) : fail('extra-after-word', word)
  const sector = tokens.length === 1 ? sectorWord(first) : null
  if (sector) return ok({ kind: 'sector', sector })
  if (tokens.length >= 2 && tokens.at(-1)?.toUpperCase() === 'HELP') {
    const help = tokens.slice(0, -1).map((t) => findMnemonic(t)).find((m) => m !== undefined)
    if (help) return ok({ kind: 'help', code: help.code })
  }
  return null
}

/** A context on its own (with an optional sector key): load it and show its functions. */
function contextOnly(tokens: readonly string[], options: ParseOptions, newPanel: boolean): LineResult | null {
  const [first = ''] = tokens
  const alone = tokens.length === 1 || (tokens.length === 2 && sectorWord(tokens[1] ?? '') !== null)
  if (!alone || findMnemonic(first)) return null
  const checked = stripSector(tokens, options.index)
  if (!checked.ok) return checked
  const context = resolveContext(first, options.index)[0]
  return context ? ok({ kind: 'context', context, newPanel }) : null
}

function withAliases(tokens: readonly string[]): readonly string[] {
  const [first = '', ...rest] = tokens
  const alias = ALIASES[first.toUpperCase()]
  return alias ? [alias, ...rest] : tokens
}

function parseRest(tokens: readonly string[], options: ParseOptions, newPanel: boolean): LineResult {
  const menu = contextOnly(tokens, options, newPanel)
  if (menu) return menu
  const sectored: Step<readonly string[]> = stripSector(tokens, options.index)
  if (!sectored.ok) return sectored
  const parsed = parseTokens(withAliases(sectored.value), options)
  return parsed.ok ? ok({ kind: 'run', command: parsed.command, newPanel }) : parsed
}

/** HL's query is free text (spec 5.1 item HL): titles and search terms carry punctuation (`Analytics:
 * equity`, `P&L`, `[POST HOC]`), so it is read from the raw line before the command alphabet check
 * (D14) rather than tokenised like the rest of the grammar. */
const HL_LINE = /^\s*HL(?:\s+([\s\S]*))?$/i

export function parseLine(input: string, options: ParseOptions): LineResult {
  if (input.length > MAX_LINE) return fail('too-long')
  const hl = HL_LINE.exec(input)
  if (hl) return ok({ kind: 'search', query: (hl[1] ?? '').trim() })
  const typed = tokenise(input)
  if (!typed.ok) return typed
  const [first = '', ...rest] = typed.value
  if (first.toUpperCase() === 'NXTW') {
    if (rest.length === 0) return fail('missing-command', 'NXTW')
    return parseRest(rest, options, true)
  }
  return chromeAction(typed.value) ?? parseRest(typed.value, options, false)
}
