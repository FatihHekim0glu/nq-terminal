// The grid gallery fixtures: deterministic, in-sample dates only (2010 to 2021), and the shapes the
// entries need (sections that fit the 10) 11) numbering, 10,000 unique runs, both journals).
import { describe, expect, it } from 'vitest'
import { journalRows, monitorRows, runRows } from './gallery.fixtures'

const IN_SAMPLE = /^20(1\d|2[01])-\d{2}-\d{2}$/

describe('grid gallery fixtures', () => {
  it('builds the same monitor rows from the same seed, seven sectors of at most ten', () => {
    expect(monitorRows()).toEqual(monitorRows())
    const sectors = new Map<string, number>()
    for (const r of monitorRows()) sectors.set(r.sector, (sectors.get(r.sector) ?? 0) + 1)
    expect(sectors.size).toBe(7)
    expect(Math.max(...sectors.values())).toBeLessThanOrEqual(10)
  })

  it('builds 10,000 runs with unique ids', () => {
    const runs = runRows()
    expect(runs).toHaveLength(10_000)
    expect(new Set(runs.map((r) => r.id)).size).toBe(10_000)
  })

  it('dates every journal row in sample and mixes book and plumbing rows', () => {
    const rows = journalRows()
    expect(rows.every((r) => IN_SAMPLE.test(String(r.data.date)))).toBe(true)
    expect(rows.some((r) => r.plumbing) && rows.some((r) => !r.plumbing)).toBe(true)
    const epochs = rows.map((r) => r.data.decided_at_ns_epoch_s).filter((v): v is number => typeof v === 'number')
    expect(epochs.length).toBeGreaterThan(10)
    expect(epochs.every((s) => s < Date.UTC(2022, 0, 1) / 1000)).toBe(true)
  })
})
