// HL search finds LV6 (the paper book against its backtest expectation), which LIVE shows as a card since
// ROADMAP 17 step 1. searchMetrics.ts holds one row per catalogue metric that a built screen shows.
import { describe, expect, it } from 'vitest'
import { buildSearchIndex, searchEntries, type SearchHit } from './searchIndex'

const index = buildSearchIndex()
const hits = (query: string): readonly SearchHit[] => searchEntries(index, query)

describe('searchEntries: LV6', () => {
  it('ranks the catalogue id 1 and opens LIVE', () => {
    for (const query of ['LV6', 'lv6']) {
      const first = hits(query)[0]
      expect(first, query).toMatchObject({ rank: 1, entry: { group: 'metric', label: 'LIVE', act: { kind: 'run', line: 'LIVE' } } })
      expect(first?.entry.detail).toContain('(LV6)')
    }
  })

  it('finds it by its wording and its aliases', () => {
    for (const query of ['expectation', 'expectation cone', 'paper expectation']) {
      const found = hits(query).filter((h) => h.entry.group === 'metric' && h.entry.detail.includes('(LV6)'))
      expect(found.length, query).toBeGreaterThan(0)
      expect(found[0]?.entry.label).toBe('LIVE')
    }
  })

  it('finds LV6b (the live-start cone) on LIVE', () => {
    expect(hits('LV6b')[0]).toMatchObject({ rank: 1, entry: { group: 'metric', label: 'LIVE' } })
    const found = hits('live-start cone').filter((h) => h.entry.group === 'metric' && h.entry.detail.includes('(LV6b)'))
    expect(found[0]?.entry.label).toBe('LIVE')
  })

  it('leaves LV5 where it was', () => {
    const lv5 = hits('LV5')[0]
    expect(lv5).toMatchObject({ rank: 1, entry: { group: 'metric', label: 'LIVE' } })
    expect(lv5?.entry.detail).toContain('(LV5)')
  })
})
