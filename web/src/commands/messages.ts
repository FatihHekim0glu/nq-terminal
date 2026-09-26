// Parse errors to sentences, from the templates in src/copy/commands.ts.
import { ARGUMENT_NAMES, CONTEXT_KIND_NAMES, PARSE_MESSAGES, SECTOR_PHRASES } from '../copy/commands'
import type { ParseError } from './parser'
import { SECTOR_KEYS, type KeyedSector } from './sectors'

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
}

function sectorKey(sector: ParseError['sector']): string {
  return sector && sector in SECTOR_KEYS ? SECTOR_KEYS[sector as KeyedSector] : ''
}

export function describeError(error: ParseError): string {
  const mnemonic = error.mnemonic
  return fill(PARSE_MESSAGES[error.code], {
    token: error.token ?? '',
    code: mnemonic?.code ?? '',
    kinds: (mnemonic?.accepts ?? []).map((kind) => CONTEXT_KIND_NAMES[kind]).join(' or '),
    value: ARGUMENT_NAMES[mnemonic?.argument ?? 'none'],
    sector: error.sector ?? '',
    phrase: error.sector ? SECTOR_PHRASES[error.sector] : '',
    key: sectorKey(error.sector),
  })
}

/** Fill a `{value}` template from the copy files. */
export function withValue(template: string, value: string): string {
  return fill(template, { value })
}
