// V031: the registry staleness banner's pure parts. The backend serves `stale`, `generated_at` and `newest_input_at` on
// GET /api/registry; an older backend serves none of them, and that must read as a fresh registry (no banner).
import { describe, expect, it } from 'vitest'
import { REGISTRY } from './regFixtures'
import { formatStaleTime, registryStaleness, staleLine } from './regStale'

const STALE = {
  ...REGISTRY,
  stale: true,
  generated_at: '2026-10-05T09:15:30Z',
  newest_input_at: '2026-10-06T07:42:10Z',
  newest_input_path: 'results/nt_new_run/summary.json',
}

describe('registryStaleness', () => {
  it('reads a stale registry with its path and both times', () => {
    expect(registryStaleness(STALE)).toEqual({
      generatedAt: '2026-10-05 09:15 UTC',
      newestAt: '2026-10-06 07:42 UTC',
      newestPath: 'results/nt_new_run/summary.json',
    })
  })

  it('reads nothing from a fresh registry', () => {
    expect(registryStaleness({ ...STALE, stale: false })).toBeNull()
  })

  it('reads nothing when the backend serves none of the fields (the registry before this release)', () => {
    expect(registryStaleness(REGISTRY)).toBeNull()
  })

  it('reads nothing from a null, an undefined or a non-object answer', () => {
    expect(registryStaleness(null)).toBeNull()
    expect(registryStaleness(undefined)).toBeNull()
    expect(registryStaleness('stale')).toBeNull()
    expect(registryStaleness(7)).toBeNull()
  })

  it('counts only a real true as stale', () => {
    expect(registryStaleness({ stale: 'true' })).toBeNull()
    expect(registryStaleness({ stale: 1 })).toBeNull()
    expect(registryStaleness({ stale: null })).toBeNull()
  })

  it('still reads a stale registry whose times and path are missing or empty', () => {
    expect(registryStaleness({ stale: true })).toEqual({ generatedAt: null, newestAt: null, newestPath: null })
    expect(registryStaleness({ stale: true, generated_at: '', newest_input_at: null, newest_input_path: '  ' })).toEqual({
      generatedAt: null,
      newestAt: null,
      newestPath: null,
    })
  })

  it('takes the path from newest_input when newest_input_path is absent', () => {
    expect(registryStaleness({ stale: true, newest_input: 'experiments/x.json' })?.newestPath).toBe('experiments/x.json')
  })
})

describe('formatStaleTime', () => {
  it('writes an ISO time to the minute, with UTC when the string says Z or +00:00', () => {
    expect(formatStaleTime('2026-10-06T07:42:10Z')).toBe('2026-10-06 07:42 UTC')
    expect(formatStaleTime('2026-10-06T07:42:10.123456+00:00')).toBe('2026-10-06 07:42 UTC')
    expect(formatStaleTime('2026-10-06 07:42:10Z')).toBe('2026-10-06 07:42 UTC')
  })

  it('does not claim UTC for a time with no zone, and leaves another zone to its own offset', () => {
    expect(formatStaleTime('2026-10-06T07:42:10')).toBe('2026-10-06 07:42')
    expect(formatStaleTime('2026-10-06T07:42:10+01:00')).toBe('2026-10-06 07:42 +01:00')
  })

  it('returns what it cannot read as it came, trimmed, and null for nothing', () => {
    expect(formatStaleTime(' yesterday ')).toBe('yesterday')
    expect(formatStaleTime('')).toBeNull()
    expect(formatStaleTime(null)).toBeNull()
    expect(formatStaleTime(undefined)).toBeNull()
    expect(formatStaleTime(12)).toBeNull()
  })
})

describe('staleLine', () => {
  const stale = registryStaleness(STALE)!

  it('names the newest result, its time and the way to rebuild, then when the registry was built', () => {
    expect(staleLine(stale)).toBe(
      'Registry is older than the newest result (results/nt_new_run/summary.json, 2026-10-06 07:42 UTC); rebuild it with scripts/registry.py. Registry built 2026-10-05 09:15 UTC.',
    )
  })

  it('leaves the path out when none is served', () => {
    expect(staleLine({ ...stale, newestPath: null })).toBe(
      'Registry is older than the newest result (2026-10-06 07:42 UTC); rebuild it with scripts/registry.py. Registry built 2026-10-05 09:15 UTC.',
    )
  })

  it('leaves the path and the time out when neither is served', () => {
    expect(staleLine({ generatedAt: null, newestAt: null, newestPath: null })).toBe(
      'Registry is older than the newest result; rebuild it with scripts/registry.py.',
    )
  })

  it('names the path alone when only the time is missing', () => {
    expect(staleLine({ generatedAt: null, newestAt: null, newestPath: 'a/b.json' })).toBe(
      'Registry is older than the newest result (a/b.json); rebuild it with scripts/registry.py.',
    )
  })
})
