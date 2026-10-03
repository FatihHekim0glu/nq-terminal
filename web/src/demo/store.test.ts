// The demo build and the workspace store (D3.3): the demo's route table answers the two store routes (no store is
// held in the dataset, so the honest answer is the 404 "not in the demo dataset"), and a page that reads the store
// through the demo's fetch falls back to localStorage alone: no error, no write attempted, no backend.
import { describe, expect, it, vi } from 'vitest'
import { DEMO_DETAIL } from './data/text'
import { createDemoFetch } from './fetch'
import { DEMO_ROUTES, answerDemo } from './routes'
import { createRemoteStore } from '../state/remoteStore'
import { DOC_NAMES } from '../state/remoteStore.keys'
import { createFetchTransport } from '../state/remoteStore.transport'
import { createSafeStorage, memoryStorage } from '../state/safeStorage'

const ORIGIN = 'http://127.0.0.1:4173'

describe('the demo answers the workspace store routes', () => {
  it('has a handler for the list and for one document', () => {
    expect(Object.keys(DEMO_ROUTES)).toEqual(expect.arrayContaining(['/api/workspaces', '/api/workspaces/{doc}']))
  })

  it.each(['/api/workspaces', ...DOC_NAMES.map((doc) => `/api/workspaces/${doc}`)])('answers %s with the demo\'s 404, never a body of another route', (path) => {
    const answer = answerDemo(path, new URLSearchParams())
    expect(answer.status).toBe(404)
    expect(JSON.stringify(answer.body)).toContain(DEMO_DETAIL.notInDemo)
  })
})

describe('a page in the demo build', () => {
  it('reads the store through the demo fetch, finds none, and keeps its keys in localStorage alone', async () => {
    const passThrough = vi.fn()
    const demoFetch = createDemoFetch({ passThrough, origin: ORIGIN })
    const transport = createFetchTransport(() => demoFetch)
    const backing = memoryStorage()
    backing.setItem('nqt.theme', 'amber-classic')
    const written = vi.spyOn(transport, 'write')
    const store = createRemoteStore({ transport, cache: createSafeStorage(() => backing), origin: ORIGIN })
    expect(await store.start()).toBe('off')
    store.note('nqt.theme', 'standard')
    await store.flush()
    expect(written).not.toHaveBeenCalled()
    expect(passThrough).not.toHaveBeenCalled()
    expect(backing.getItem('nqt.theme')).toBe('amber-classic')
    expect(backing.getItem('nqt.remote')).toBeNull()
  })

  it('cannot write through the demo fetch at all: it answers GET only, and the transport reports no answer', async () => {
    const demoFetch = createDemoFetch({ passThrough: vi.fn(), origin: ORIGIN })
    const reply = await createFetchTransport(() => demoFetch).write('prefs', 0, {})
    expect(reply.status).toBe(0)
  })
})
