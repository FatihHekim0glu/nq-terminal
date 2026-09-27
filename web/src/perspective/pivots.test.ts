import { describe, expect, it, vi } from 'vitest'
import { PAGE_ROWS, readAllPages } from './pivots'

function pages(total: number) {
  const all = Array.from({ length: total }, (_, i) => i)
  return vi.fn(async (offset: number) => ({ items: all.slice(offset, offset + PAGE_ROWS), total }))
}

describe('readAllPages (the pivot reads every page)', () => {
  it('reads 8,411 rows as two pages, in order', async () => {
    const read = pages(8411)
    const rows = await readAllPages(read)
    expect(rows).toHaveLength(8411)
    expect(rows[5000]).toBe(5000)
    expect(read.mock.calls.map(([o]) => o)).toEqual([0, 5000])
  })

  it('reads one page for a small run and one empty page for none', async () => {
    expect(await readAllPages(pages(11))).toHaveLength(11)
    const none = pages(0)
    expect(await readAllPages(none)).toEqual([])
    expect(none).toHaveBeenCalledTimes(1)
  })

  it('stops when a page comes back empty, even if the total says more', async () => {
    const short = vi.fn(async (offset: number) => ({ items: offset === 0 ? [1, 2] : [], total: 10 }))
    expect(await readAllPages(short)).toEqual([1, 2])
  })

  it('born failing: a server that never ends is cut off instead of looping', async () => {
    const endless = vi.fn(async () => ({ items: [1], total: Number.MAX_SAFE_INTEGER }))
    await expect(readAllPages(endless)).rejects.toThrow(/rows/)
  })
})
