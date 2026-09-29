import { describe, expect, it, vi } from 'vitest'
import { createSearchIndexLoader, loadSearchIndex, loadedSearchIndex } from './searchIndexLoader'
import type { SearchIndex } from './searchIndex'

const fake = (): SearchIndex => ({ entries: [], search: () => [] })

/** A stand-in for the dynamic import of ./searchIndex, so the test controls when it succeeds. */
function importer(index: SearchIndex = fake()) {
  const build = vi.fn(() => index)
  const load = vi.fn(async () => ({ buildSearchIndex: build }))
  return { load, build, index }
}

describe('the search index loader', () => {
  it('has nothing loaded until the first load', () => {
    const { load } = importer()
    const loader = createSearchIndexLoader(load)
    expect(loader.loaded()).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('loads once: the index is built one time however often load is called', async () => {
    const { load, build, index } = importer()
    const loader = createSearchIndexLoader(load)
    await expect(loader.load()).resolves.toBe(index)
    expect(loader.loaded()).toBe(index)
    await expect(loader.load()).resolves.toBe(index)
    await expect(loader.load()).resolves.toBe(index)
    expect(load).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('shares one import between calls made before it finishes', async () => {
    const { load, build, index } = importer()
    const loader = createSearchIndexLoader(load)
    const results = await Promise.all([loader.load(), loader.load(), loader.load()])
    expect(results).toEqual([index, index, index])
    expect(load).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('stays null after a failed import and retries on the next call', async () => {
    const index = fake()
    const load = vi.fn<() => Promise<{ buildSearchIndex: () => SearchIndex }>>()
    load.mockRejectedValueOnce(new Error('chunk failed to load'))
    load.mockResolvedValue({ buildSearchIndex: () => index })
    const loader = createSearchIndexLoader(load)
    await expect(loader.load()).resolves.toBeNull()
    expect(loader.loaded()).toBeNull()
    await expect(loader.load()).resolves.toBe(index)
    expect(loader.loaded()).toBe(index)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries after a build that throws, and never rejects to its caller', async () => {
    const index = fake()
    const build = vi.fn<() => SearchIndex>()
    build.mockImplementationOnce(() => {
      throw new Error('bad index')
    })
    build.mockReturnValue(index)
    const loader = createSearchIndexLoader(async () => ({ buildSearchIndex: build }))
    await expect(loader.load()).resolves.toBeNull()
    expect(loader.loaded()).toBeNull()
    await expect(loader.load()).resolves.toBe(index)
  })

  it('does not start a second import while a retry is running', async () => {
    let fail = true
    const gate: { open: () => void } = { open: () => undefined }
    const load = vi.fn(async () => {
      if (fail) {
        fail = false
        throw new Error('offline')
      }
      await new Promise<void>((resolve) => {
        gate.open = resolve
      })
      return { buildSearchIndex: fake }
    })
    const loader = createSearchIndexLoader(load)
    await loader.load()
    const a = loader.load()
    const b = loader.load()
    gate.open()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe(rb)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the shared loader', () => {
  it('loads the real index: functions, metrics, instruments and help text', async () => {
    expect(loadedSearchIndex()).toBeNull()
    const index = await loadSearchIndex()
    expect(index).not.toBeNull()
    expect(loadedSearchIndex()).toBe(index)
    expect(new Set(index?.entries.map((e) => e.group))).toEqual(new Set(['function', 'word', 'metric', 'instrument', 'help']))
    expect(index?.search('calmar')[0]?.entry.label).toBe('EQ')
    await expect(loadSearchIndex()).resolves.toBe(index)
  })
})
