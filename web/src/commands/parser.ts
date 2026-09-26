// Command-line parser for UI_SPEC section 5:
//   <context> <FUNCTION> [args]
//   context := instrument | hypothesis | run id | 27F | omitted (the focused panel's link-group context)
// Pure and total: every input gives a command or a coded error; nothing throws.
import { pickContext, resolveContext } from './contexts'
import { findMnemonic, TIMEFRAMES, type MnemonicDef } from './registry'
import type { CommandIndexData, ResolvedContext } from './types'

export const MAX_LINE = 200
const TOKEN = /^[A-Za-z0-9_.-]+$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export type ParseErrorCode =
  | 'empty'
  | 'too-long'
  | 'bad-character'
  | 'unknown-command'
  | 'unknown-function'
  | 'unknown-context'
  | 'index-unavailable'
  | 'missing-function'
  | 'missing-context'
  | 'context-not-accepted'
  | 'no-context-taken'
  | 'missing-argument'
  | 'bad-argument'
  | 'too-many-arguments'

export interface ParseError {
  readonly code: ParseErrorCode
  readonly token?: string
  readonly mnemonic?: MnemonicDef
}

export interface CommandArgs {
  readonly date?: string
  readonly timeframe?: string
}

export type ContextSource = 'typed' | 'link-group' | 'none'

export interface ParsedCommand {
  readonly mnemonic: MnemonicDef
  readonly context: ResolvedContext | null
  readonly contextSource: ContextSource
  readonly args: CommandArgs
  /** The command written back in canonical form, for history and the status line. */
  readonly canonical: string
}

export type ParseResult =
  | { readonly ok: true; readonly command: ParsedCommand }
  | { readonly ok: false; readonly error: ParseError }

export interface ParseOptions {
  readonly index: CommandIndexData | null
  /** The focused panel's link-group context, used when the line names none. */
  readonly fallbackContext?: ResolvedContext | string | null
}

type Step<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ParseError }

const fail = (code: ParseErrorCode, token?: string, mnemonic?: MnemonicDef): { ok: false; error: ParseError } => ({
  ok: false,
  error: { code, ...(token === undefined ? {} : { token }), ...(mnemonic ? { mnemonic } : {}) },
})

export function isCalendarDate(text: string): boolean {
  const m = ISO_DATE.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

function parseArgs(mnemonic: MnemonicDef, tokens: readonly string[]): Step<CommandArgs> {
  const [first, second] = tokens
  if (mnemonic.argument === 'none') {
    return first === undefined ? { ok: true, value: {} } : fail('bad-argument', first, mnemonic)
  }
  if (second !== undefined) return fail('too-many-arguments', second, mnemonic)
  if (mnemonic.argument === 'date') {
    if (first === undefined) return fail('missing-argument', undefined, mnemonic)
    return isCalendarDate(first) ? { ok: true, value: { date: first } } : fail('bad-argument', first, mnemonic)
  }
  if (first === undefined) return { ok: true, value: {} }
  const timeframe = TIMEFRAMES.find((t) => t === first.toLowerCase())
  return timeframe ? { ok: true, value: { timeframe } } : fail('bad-argument', first, mnemonic)
}

function typedContext(mnemonic: MnemonicDef, token: string, index: CommandIndexData | null): Step<ResolvedContext> {
  if (mnemonic.accepts.length === 0) return fail('no-context-taken', token, mnemonic)
  const candidates = resolveContext(token, index)
  if (candidates.length === 0) return fail(index ? 'unknown-context' : 'index-unavailable', token, mnemonic)
  const picked = pickContext(candidates, mnemonic.accepts)
  return picked ? { ok: true, value: picked } : fail('context-not-accepted', token, mnemonic)
}

function linkGroupContext(mnemonic: MnemonicDef, options: ParseOptions): Step<ResolvedContext | null> {
  if (mnemonic.accepts.length === 0) return { ok: true, value: null }
  const fallback = options.fallbackContext
  if (!fallback) return fail('missing-context', mnemonic.code, mnemonic)
  if (typeof fallback !== 'string') {
    return mnemonic.accepts.includes(fallback.kind)
      ? { ok: true, value: fallback }
      : fail('context-not-accepted', fallback.value, mnemonic)
  }
  return typedContext(mnemonic, fallback, options.index)
}

interface Split {
  readonly mnemonic: MnemonicDef
  readonly contextToken: string | null
  readonly argTokens: readonly string[]
}

function split(tokens: readonly string[], index: CommandIndexData | null): Step<Split> {
  const [first = '', second] = tokens
  const leading = findMnemonic(first)
  if (leading) return { ok: true, value: { mnemonic: leading, contextToken: null, argTokens: tokens.slice(1) } }
  const known = resolveContext(first, index).length > 0
  if (second === undefined) {
    if (known) return fail('missing-function', first)
    return fail(index ? 'unknown-command' : 'index-unavailable', first)
  }
  const fn = findMnemonic(second)
  if (!fn) return known || !index ? fail('unknown-function', second) : fail('unknown-context', first)
  return { ok: true, value: { mnemonic: fn, contextToken: first, argTokens: tokens.slice(2) } }
}

function canonical(context: ResolvedContext | null, mnemonic: MnemonicDef, args: CommandArgs): string {
  return [context?.value, mnemonic.code, args.date ?? args.timeframe].filter((part) => part !== undefined).join(' ')
}

export function parseCommand(input: string, options: ParseOptions): ParseResult {
  if (input.length > MAX_LINE) return fail('too-long')
  const tokens = input.trim().split(/\s+/).filter((t) => t !== '')
  if (tokens.length === 0) return fail('empty')
  const bad = tokens.find((t) => !TOKEN.test(t))
  if (bad !== undefined) return fail('bad-character', bad)

  const parts = split(tokens, options.index)
  if (!parts.ok) return parts
  const { mnemonic, contextToken, argTokens } = parts.value

  const args = parseArgs(mnemonic, argTokens)
  if (!args.ok) return args
  const context =
    contextToken === null ? linkGroupContext(mnemonic, options) : typedContext(mnemonic, contextToken, options.index)
  if (!context.ok) return context

  const contextSource: ContextSource = contextToken !== null ? 'typed' : context.value ? 'link-group' : 'none'
  return {
    ok: true,
    command: {
      mnemonic,
      context: context.value,
      contextSource,
      args: args.value,
      canonical: canonical(context.value, mnemonic, args.value),
    },
  }
}
