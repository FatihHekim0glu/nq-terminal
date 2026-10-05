// Pure rules of the Start from flow: what a seed, a draft and a parameter mean, how a draft is checked and what body it
// becomes. The window, variant and run id rules are the JOBS form's own (screens/jobs/rules.ts, which mirror the
// server's JobSpec); the parameter rules mirror JobSpec's value checks (small finite scalars, short safe text, short
// lists) plus the range, choices and required flags the presets route describes. The server checks all of it again;
// these rules only say what is wrong in words, next to the field.
import { LAUNCH } from '../../copy/launch'
import { fillCopy } from '../../copy/workspace'
import type { LedgerRow } from '../ledg/model'
import { STRATEGIES, checkDraft } from '../jobs/rules'
import type { RunDetail } from '../runs/runModel'
import type { LaunchRequest, LaunchSeed, ParamKind, ParamSpec, Preset, StrategySpec } from './types'

const E = LAUNCH.errors
const H = LAUNCH.hint
const MAX_RUN_ID_BODY = 80
const MAX_LIST_ITEMS = 64
const MAX_FLOAT = 1e15
const SAFE_TEXT = /^[A-Za-z0-9_.:+-]{1,64}$/
const WHOLE = /^[+-]?\d+$/
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const RUN_ID_UNSAFE = /[^A-Za-z0-9_.-]+/g

type Params = Readonly<Record<string, unknown>>

/** One form state: the window, the variant, the run id and every parameter as the text the owner sees. */
export interface LaunchDraft {
  readonly variant: string
  readonly start: string
  readonly end: string
  readonly runId: string
  readonly values: Readonly<Record<string, string>>
}

export type ParamResult = { readonly value: unknown } | { readonly omit: true } | { readonly error: string }

/** Problems by field: `variant`, `start`, `end`, `runId`, `strategy` or `param:<name>`. */
export type LaunchErrors = Readonly<Record<string, string>>

export interface LaunchCheck {
  /** The exact body the actions route takes, or null while any problem remains. */
  readonly request: LaunchRequest | null
  readonly errors: LaunchErrors
  /** The parameters whose value differs from the preset. */
  readonly changed: readonly string[]
  /** Anything differs from the preset: a parameter, the variant or the window. A warning, never a block. */
  readonly offSpec: boolean
}

export const paramKey = (name: string): string => `param:${name}`

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  const other = b as Record<string, unknown>
  return keys.length === Object.keys(b).length && keys.every((k) => k in other && deepEqual((a as Record<string, unknown>)[k], other[k]))
}

/** The text a value is shown and edited as: a flag as true or false, a list as compact JSON. */
export function valueText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function inferKind(value: unknown): ParamKind {
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  if (Array.isArray(value)) return 'list'
  return 'text'
}

/** The parameters a form shows: the ones the server describes, then any the seed carries that it does not. */
export function fieldsOf(seed: LaunchSeed, spec: StrategySpec | undefined): readonly ParamSpec[] {
  const known = spec?.params ?? []
  const names = new Set(known.map((p) => p.name))
  const extra = Object.entries(seed.params)
    .filter(([name]) => !names.has(name))
    .map(([name, value]): ParamSpec => ({ name, kind: inferKind(value), default: null, min: null, max: null, choices: null, required: false, note: LAUNCH.paramNote }))
  return [...known, ...extra]
}

/** A run id `t_<exp id>_<n>` (the source run id when there is no exp id) with the first n that is not taken. */
export function suggestRunId(expId: string | null, sourceRunId: string, taken: ReadonlySet<string>): string {
  const named = (expId ?? '').trim()
  const raw = named !== '' ? named : sourceRunId.replace(/^t_/, '')
  const body = raw.replace(RUN_ID_UNSAFE, '_').replace(/^_+|_+$/g, '') || 'run'
  for (let n = 1; ; n += 1) {
    const suffix = `_${n}`
    const id = `t_${body.slice(0, MAX_RUN_ID_BODY - suffix.length)}${suffix}`
    if (!taken.has(id)) return id
  }
}

/** The form state a seed starts from: its values, the parameters it sets, defaults for the rest, a fresh run id. */
export function initialDraft(seed: LaunchSeed, spec: StrategySpec | undefined, taken: ReadonlySet<string>): LaunchDraft {
  const values = Object.fromEntries(
    fieldsOf(seed, spec).map((p) => [p.name, p.name in seed.params ? valueText(seed.params[p.name]) : p.default !== null && p.default !== undefined ? valueText(p.default) : '']),
  )
  return { variant: seed.variant, start: seed.start, end: seed.end, runId: suggestRunId(seed.expId, seed.sourceRunId, taken), values }
}

function rangeError(spec: ParamSpec, value: number): string | null {
  const slots = { name: spec.name, min: spec.min ?? '', max: spec.max ?? '' }
  const open = spec.exclusiveMin === true
  const low = spec.min !== null && (open ? value <= spec.min : value < spec.min)
  const high = spec.max !== null && value > spec.max
  if (!low && !high) return null
  if (spec.min !== null && spec.max !== null) return fillCopy(open ? E.aboveAtMost : E.between, slots)
  return fillCopy(low ? (open ? E.above : E.atLeast) : E.atMost, slots)
}

function parseNumber(spec: ParamSpec, text: string): ParamResult {
  const whole = spec.kind === 'int'
  if (!(whole ? WHOLE : DECIMAL).test(text)) return { error: fillCopy(whole ? E.wholeNumber : E.number, { name: spec.name }) }
  const value = Number(text)
  const bad = !Number.isFinite(value) || Math.abs(value) > MAX_FLOAT || (whole && !Number.isSafeInteger(value))
  if (bad) return { error: fillCopy(whole ? E.wholeNumber : E.number, { name: spec.name }) }
  const outside = rangeError(spec, value)
  return outside === null ? { value } : { error: outside }
}

function parseText(spec: ParamSpec, text: string): ParamResult {
  if (spec.choices !== null) {
    const hit = spec.choices.find((c) => String(c) === text)
    return hit === undefined ? { error: fillCopy(E.oneOf, { name: spec.name, choices: spec.choices.join(', ') }) } : { value: hit }
  }
  return SAFE_TEXT.test(text) ? { value: text } : { error: fillCopy(E.text, { name: spec.name }) }
}

function isScalar(item: unknown): boolean {
  if (typeof item === 'boolean') return true
  if (typeof item === 'number') return Number.isFinite(item) && Math.abs(item) <= MAX_FLOAT
  return typeof item === 'string' && SAFE_TEXT.test(item)
}

function parseList(spec: ParamSpec, text: string): ParamResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: fillCopy(E.list, { name: spec.name }) }
  }
  if (!Array.isArray(parsed)) return { error: fillCopy(E.list, { name: spec.name }) }
  if (parsed.length > MAX_LIST_ITEMS) return { error: fillCopy(E.listLong, { name: spec.name }) }
  return parsed.every(isScalar) ? { value: parsed } : { error: fillCopy(E.listItems, { name: spec.name }) }
}

/** Reads the text of one parameter: its value, `omit` when it is empty and not required, or the problem in words. */
export function parseParam(spec: ParamSpec, raw: string): ParamResult {
  const text = raw.trim()
  if (text === '') return spec.required ? { error: fillCopy(E.needsValue, { name: spec.name }) } : { omit: true }
  switch (spec.kind) {
    case 'int':
    case 'float':
      return parseNumber(spec, text)
    case 'bool':
      return text === 'true' || text === 'false' ? { value: text === 'true' } : { error: fillCopy(E.flag, { name: spec.name }) }
    case 'list':
      return parseList(spec, text)
    default:
      return parseText(spec, text)
  }
}

export function shownValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? LAUNCH.yes : LAUNCH.no
  return valueText(value)
}

function kindWord(spec: ParamSpec): string {
  if (spec.kind === 'text' && spec.choices !== null) return fillCopy(H.oneOf, { choices: spec.choices.join(', ') })
  return H[spec.kind]
}

function rangeWord(spec: ParamSpec): string {
  if (spec.kind !== 'int' && spec.kind !== 'float') return ''
  const slots = { min: spec.min ?? '', max: spec.max ?? '' }
  const open = spec.exclusiveMin === true
  if (spec.min !== null && spec.max !== null) return fillCopy(open ? H.rangeAboveAtMost : H.rangeBetween, slots)
  if (spec.min !== null) return fillCopy(open ? H.rangeAbove : H.rangeAtLeast, slots)
  return spec.max !== null ? fillCopy(H.rangeAtMost, slots) : H.rangeNone
}

/** The line under a field: its type, the allowed range, whether it is required or its default, and the server's note. */
export function rangeHint(spec: ParamSpec): string {
  const hasDefault = spec.default !== null && spec.default !== undefined
  const tail = spec.required ? H.required : hasDefault ? fillCopy(H.defaultIs, { value: shownValue(spec.default) }) : H.defaultNone
  return [`${kindWord(spec)}${rangeWord(spec)}.`, tail, spec.note ?? ''].filter((part) => part !== '').join(' ')
}

/** The one place that shapes the body of POST /api/jobs/actions for a backtest. */
export function toRequest(spec: { readonly presetId: string; readonly params: Params; readonly start: string | null; readonly end: string | null; readonly runId: string }): LaunchRequest {
  return { kind: 'backtest', preset_id: spec.presetId, params: { ...spec.params }, start: spec.start, end: spec.end, run_id: spec.runId }
}

interface ParamOutcome {
  readonly errors: Record<string, string>
  readonly sent: Record<string, unknown>
  readonly changed: string[]
}

function readParams(draft: LaunchDraft, seed: LaunchSeed, fields: readonly ParamSpec[]): ParamOutcome {
  const out: ParamOutcome = { errors: {}, sent: {}, changed: [] }
  for (const field of fields) {
    const result = parseParam(field, draft.values[field.name] ?? '')
    if ('error' in result) {
      out.errors[paramKey(field.name)] = result.error
      continue
    }
    const value = 'value' in result ? result.value : undefined
    const changedNow = !deepEqual(value, presetValue(seed, field))
    if (changedNow) out.changed.push(field.name)
    if (value !== undefined && changedNow) out.sent[field.name] = value
  }
  return out
}

/** Checks a draft against the rules above; `taken` holds every run id a job or a run already uses. */
export function checkLaunch(draft: LaunchDraft, seed: LaunchSeed, spec: StrategySpec | undefined, taken: ReadonlySet<string>, presetId: string | null = null): LaunchCheck {
  const window = checkDraft({ strategy: seed.strategy, variant: seed.variant, start: draft.start, end: draft.end, runId: draft.runId, paramsText: '{}' }, taken)
  const { paramsText: _json, strategy: _unused, ...windowErrors } = window.errors
  const params = readParams(draft, seed, fieldsOf(seed, spec))
  const known = (STRATEGIES as readonly string[]).includes(seed.strategy)
  const errors: LaunchErrors = { ...windowErrors, ...params.errors, ...(known ? {} : { strategy: E.strategy }) }
  const start = draft.start.trim()
  const end = draft.end.trim()
  const moved = start !== seed.start || end !== seed.end
  const request = Object.keys(errors).length === 0 && presetId !== null
    ? toRequest({ presetId, params: params.sent, start: start === seed.start ? null : start, end: end === seed.end ? null : end, runId: draft.runId.trim() })
    : null
  return { request, errors, changed: params.changed, offSpec: moved || params.changed.length > 0 }
}

function recordedParams(row: Pick<LedgerRow, 'params' | 'params_json'>): Params {
  if (row.params !== null && typeof row.params === 'object') return row.params
  if (row.params_json === null || row.params_json === '') return {}
  try {
    const parsed: unknown = JSON.parse(row.params_json)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Params) : {}
  } catch {
    return {}
  }
}

interface Recorded {
  readonly strategy: string | null
  readonly variant: string | null
  readonly start: string | null
  readonly end: string | null
}

function complete(r: Recorded): r is { strategy: string; variant: string; start: string; end: string } {
  return [r.strategy, r.variant, r.start, r.end].every((v) => typeof v === 'string' && v !== '')
}

/** The configuration of a ledger row, or null when the row does not record its strategy, variant and window. */
export function seedFromLedgerRow(row: LedgerRow): LaunchSeed | null {
  if (!complete(row)) return null
  return { sourceRunId: row.run_id, expId: row.exp_id === null || row.exp_id === '' ? null : row.exp_id, strategy: row.strategy as string, variant: row.variant as string, start: row.start as string, end: row.end as string, params: recordedParams(row) }
}

/** The configuration of the run on screen, or null when its summary does not record it. */
export function seedFromRun(detail: RunDetail): LaunchSeed | null {
  const s = detail.summary
  if (!complete(s)) return null
  return { sourceRunId: s.run_id, expId: s.ledger?.exp_id ?? null, strategy: s.strategy as string, variant: s.variant as string, start: s.start as string, end: s.end as string, params: s.params }
}

export function seedFromPreset(preset: Preset): LaunchSeed {
  return { sourceRunId: preset.source_run_id, expId: preset.exp_id, strategy: preset.strategy, variant: preset.variant, start: preset.start, end: preset.end, params: preset.params }
}

/** The preset that is this run's own ledger row, else the one that holds exactly this configuration, or null. */
export function matchPreset(seed: LaunchSeed, presets: readonly Preset[]): Preset | null {
  return presets.find((p) => p.source_run_id === seed.sourceRunId) ?? presets.find((p) => p.strategy === seed.strategy && p.variant === seed.variant && p.start === seed.start && p.end === seed.end && deepEqual(p.params, seed.params)) ?? null
}

/** How a seed is named in a title and a list: its exp id or run id, strategy, variant and window. */
export function seedLabel(seed: LaunchSeed): string {
  return fillCopy(LAUNCH.presetText, { name: seed.expId ?? seed.sourceRunId, strategy: seed.strategy, variant: seed.variant, start: seed.start, end: seed.end })
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The field a server refusal names, read from its words (run id, start, end or a quoted parameter), or null when it names none. */
export function serverFieldKey(detail: string, paramNames: readonly string[]): string | null {
  const text = detail.replace(/^Value error, /, '')
  if (/\brun[_ ]id\b/i.test(text)) return 'runId'
  const lead = /^(start|end)\b/i.exec(text)
  if (lead !== null) return (lead[1] ?? '').toLowerCase()
  const named = paramNames.find((name) => new RegExp(`['"]${escapeRegex(name)}['"]|params\\.${escapeRegex(name)}\\b|^${escapeRegex(name)}\\b`).test(text))
  return named === undefined ? null : paramKey(named)
}

/** What a parameter holds in the preset: the preset's own value, else the strategy default, else undefined. */
export function presetValue(seed: LaunchSeed, field: ParamSpec): unknown {
  return field.name in seed.params ? seed.params[field.name] : (field.default ?? undefined)
}
