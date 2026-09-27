import { describe, expect, it, vi } from 'vitest'
import { mountViewer, releaseViewer, withTimeout, type MountEngine, type MountProps, type MountViewerElement } from './mount'

const PROPS: MountProps = {
  name: 'Fills of r',
  schema: { price: 'float' },
  data: { price: [1, 2] },
  preset: { columns: ['price'], columns_config: { when: { date_format: { timeZone: 'UTC' } } } },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function fakes() {
  const table = { update: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) }
  const engine: MountEngine = { client: { table: vi.fn(async () => table) } }
  const viewer: MountViewerElement = {
    load: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
  }
  return { table, engine, viewer }
}

describe('mountViewer (the pivot never leaves a table behind)', () => {
  it('makes, fills and shows a table while the grid is mounted', async () => {
    const { table, engine, viewer } = fakes()
    const done = await mountViewer(viewer, PROPS, () => true, async () => engine)
    expect(done).not.toBeNull()
    expect(table.update).toHaveBeenCalledWith(PROPS.data)
    expect(viewer.flush).toHaveBeenCalled()
    expect(table.delete).not.toHaveBeenCalled()
    // the preset's per-column styling reaches the viewer (the UTC zone of every datetime column)
    expect(viewer.restore).toHaveBeenCalledWith(expect.objectContaining({ columns_config: { when: { date_format: { timeZone: 'UTC' } } } }))
  })

  it('makes no table when the grid unmounts while the engine is still starting', async () => {
    const { engine, viewer } = fakes()
    const start = deferred<MountEngine>()
    let alive = true
    const mounting = mountViewer(viewer, PROPS, () => alive, () => start.promise)
    alive = false
    start.resolve(engine)
    expect(await mounting).toBeNull()
    expect(engine.client.table).not.toHaveBeenCalled()
  })

  it('deletes the table it made when the grid unmounts while the table is being filled', async () => {
    const { table, engine, viewer } = fakes()
    let alive = true
    table.update.mockImplementation(async () => { alive = false })
    expect(await mountViewer(viewer, PROPS, () => alive, async () => engine)).toBeNull()
    expect(table.delete).toHaveBeenCalledTimes(1)
    expect(viewer.load).not.toHaveBeenCalled()
  })

  it('deletes the table when showing it fails, and passes the failure on', async () => {
    const { table, engine, viewer } = fakes()
    vi.mocked(viewer.restore).mockRejectedValue(new Error('bad config'))
    await expect(mountViewer(viewer, PROPS, () => true, async () => engine)).rejects.toThrow('bad config')
    expect(table.delete).toHaveBeenCalledTimes(1)
  })
})

describe('releaseViewer (teardown never throws)', () => {
  it('born failing: a viewer the engine never upgraded (no delete method) is removed without an error', async () => {
    // With the WebAssembly refused the custom element is never defined, so the element is a plain one; the
    // old cleanup called viewer.delete() on it, threw "delete is not a function" and took the panel down.
    const el = { remove: vi.fn() }
    const table = { update: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) }
    await expect(releaseViewer(el, table)).resolves.toBeUndefined()
    expect(el.remove).toHaveBeenCalledTimes(1)
    expect(table.delete).toHaveBeenCalledTimes(1)
  })

  it('a delete that throws at once or rejects still removes the element and deletes the table', async () => {
    for (const bad of [() => { throw new Error('boom') }, () => Promise.reject(new Error('later'))]) {
      const el = { remove: vi.fn(), delete: vi.fn(bad) }
      const table = { update: vi.fn(async () => undefined), delete: vi.fn(async () => { throw new Error('gone') }) }
      await expect(releaseViewer(el, table)).resolves.toBeUndefined()
      expect(el.remove).toHaveBeenCalledTimes(1)
      expect(table.delete).toHaveBeenCalledTimes(1)
    }
  })

  it('deletes a started viewer before removing it, with no table when none was made', async () => {
    const order: string[] = []
    const el = { remove: vi.fn(() => order.push('remove')), delete: vi.fn(async () => { order.push('delete') }) }
    await releaseViewer(el, null)
    expect(order).toEqual(['delete', 'remove'])
  })
})

describe('withTimeout (an engine that never starts counts as one that failed)', () => {
  it('born failing: a start that never settles rejects after the limit, naming it', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<number>(() => undefined)
      const raced = withTimeout(never, 20_000, 'the pivot engine did not start within 20 s')
      const seen = expect(raced).rejects.toThrow('the pivot engine did not start within 20 s')
      await vi.advanceTimersByTimeAsync(20_000)
      await seen
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes a value or an error through untouched when it comes first', async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, 'late')).resolves.toBe(7)
    await expect(withTimeout(Promise.reject(new Error('wasm')), 1_000, 'late')).rejects.toThrow('wasm')
  })
})
