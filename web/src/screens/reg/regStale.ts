// REG's registry staleness banner (V031), the pure parts. GET /api/registry says whether results/registry.md is older
// than the newest result or spec (`stale`), when it was built (`generated_at`) and the time of that newest input
// (`newest_input_at`), with the path of the input as `newest_input_path` (or `newest_input`). Read only: the terminal
// never rebuilds the registry, so the line names the script that does. A backend that serves none of the fields (an
// older one) reads as a fresh registry, and a field of the wrong type is ignored rather than guessed at.
import { fillCopy } from '../../copy/workspace'
import { REG_STALE } from '../../copy/regStale'

export interface RegistryStaleness {
  /** When the registry was built, formatted for the line; null when the backend did not say. */
  readonly generatedAt: string | null
  /** The time of the newest result or spec, formatted for the line; null when the backend did not say. */
  readonly newestAt: string | null
  /** The newest result or spec, as the backend names it; null when it did not say. */
  readonly newestPath: string | null
}

const ISO_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const UTC_OFFSETS = new Set(['Z', '+00:00', '+0000', '-00:00', '-0000'])

/** An ISO time to the minute (`2026-10-06 07:42 UTC`); UTC only when the string says so, another offset as written,
 *  and a string that is not an ISO time as it came, trimmed. Null for anything that is not a non-empty string. */
export function formatStaleTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  const m = ISO_TIME.exec(text)
  if (!m) return text
  const [, date, minute, zone] = m
  if (zone === undefined) return `${date} ${minute}`
  return `${date} ${minute} ${UTC_OFFSETS.has(zone) ? 'UTC' : zone}`
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** The staleness of a GET /api/registry answer, or null unless it says `stale` is true. Takes the answer as unknown so
 *  an older backend's answer (no such fields) and a mistyped one both read as fresh. */
export function registryStaleness(registry: unknown): RegistryStaleness | null {
  if (typeof registry !== 'object' || registry === null) return null
  const r = registry as Readonly<Record<string, unknown>>
  if (r.stale !== true) return null
  return {
    generatedAt: formatStaleTime(r.generated_at),
    newestAt: formatStaleTime(r.newest_input_at),
    newestPath: text(r.newest_input_path) ?? text(r.newest_input),
  }
}

/** The banner's sentence: what is newer (path and time, as far as they are served), how to rebuild, and when the
 *  registry was built. */
export function staleLine(s: RegistryStaleness): string {
  const where = [s.newestPath, s.newestAt].filter((part): part is string => part !== null).join(', ')
  const base = where === '' ? REG_STALE.lineBare : fillCopy(REG_STALE.line, { where })
  return s.generatedAt === null ? base : `${base} ${fillCopy(REG_STALE.built, { time: s.generatedAt })}`
}
