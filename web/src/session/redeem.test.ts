// The launch page (03 sections 2.1 and 4.2): the code is read from the fragment, the fragment is removed from the
// address bar and the history, the code goes in a header (never a URL), and the page leaves for the terminal only
// when the backend says yes. Born failing: a page that leaves the fragment in place, puts the code in the request
// address or goes on after a refusal fails here.
import { describe, expect, it } from 'vitest'
import sessionHtml from '../../session.html?raw'
import * as copy from './copy.ts'
import { CODE_HEADER, REDEEM_PATH, codeFromHash, redeem, type PageEnv } from './redeem.ts'

const CODE = 'cd'.repeat(32)

interface Trace {
  readonly addresses: string[]
  readonly requests: Array<{ path: string; init: RequestInit }>
  readonly visited: string[]
  readonly order: string[]
}

function page(hash: string, answer: () => Promise<{ status: number }>): { env: PageEnv; trace: Trace } {
  const trace: Trace = { addresses: [], requests: [], visited: [], order: [] }
  const env: PageEnv = {
    hash,
    address: '/session.html',
    replaceAddress: (address) => {
      trace.addresses.push(address)
      trace.order.push('replace')
    },
    request: (path, init) => {
      trace.requests.push({ path, init })
      trace.order.push('request')
      return answer()
    },
    go: (path) => {
      trace.visited.push(path)
      trace.order.push('go')
    },
  }
  return { env, trace }
}

describe('codeFromHash', () => {
  it('takes 64 lowercase hex characters, with or without the #', () => {
    expect(codeFromHash(`#${CODE}`)).toBe(CODE)
    expect(codeFromHash(CODE)).toBe(CODE)
  })
  it('takes nothing else', () => {
    for (const bad of ['', '#', '#abc', `#${CODE.toUpperCase()}`, `#${CODE}0`, `#${CODE.slice(1)}`, `#${CODE}&x=1`, '#go=GP/NQ']) {
      expect(codeFromHash(bad)).toBeNull()
    }
  })
})

describe('redeem', () => {
  it('sends the code in a header, to the redeem route, with the cookie allowed back, then goes to /', async () => {
    const { env, trace } = page(`#${CODE}`, async () => ({ status: 200 }))
    expect(await redeem(env)).toEqual({ kind: 'opened' })
    expect(trace.requests).toHaveLength(1)
    const sent = trace.requests[0]!
    expect(sent.path).toBe(REDEEM_PATH)
    expect(sent.path).not.toContain(CODE)
    expect(sent.init.headers).toEqual({ [CODE_HEADER]: CODE })
    expect(sent.init.credentials).toBe('same-origin')
    expect(sent.init.cache).toBe('no-store')
    expect(trace.visited).toEqual(['/'])
  })

  it('removes the fragment before the request is made, so no outcome leaves the code in the history', async () => {
    const { env, trace } = page(`#${CODE}`, async () => ({ status: 200 }))
    await redeem(env)
    expect(trace.addresses).toEqual(['/session.html'])
    expect(trace.order).toEqual(['replace', 'request', 'go'])
    expect(trace.addresses.join()).not.toContain('#')
    expect(trace.addresses.join()).not.toContain(CODE)
  })

  it('removes the fragment and stays on the page when the backend refuses the code', async () => {
    const { env, trace } = page(`#${CODE}`, async () => ({ status: 401 }))
    expect(await redeem(env)).toEqual({ kind: 'refused', status: 401 })
    expect(trace.addresses).toEqual(['/session.html'])
    expect(trace.visited).toEqual([])
  })

  it('treats any answer but 200 as a refusal', async () => {
    for (const status of [204, 301, 400, 403, 404, 500]) {
      const { env, trace } = page(`#${CODE}`, async () => ({ status }))
      expect(await redeem(env)).toEqual({ kind: 'refused', status })
      expect(trace.visited).toEqual([])
    }
  })

  it('says unreachable when the request fails, and still removes the fragment', async () => {
    const { env, trace } = page(`#${CODE}`, async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await redeem(env)).toEqual({ kind: 'unreachable' })
    expect(trace.addresses).toEqual(['/session.html'])
    expect(trace.visited).toEqual([])
  })

  it('makes no request without a well-formed code, and removes whatever fragment there was', async () => {
    const { env, trace } = page('#go=GP/NQ', async () => ({ status: 200 }))
    expect(await redeem(env)).toEqual({ kind: 'no-code' })
    expect(trace.requests).toEqual([])
    expect(trace.addresses).toEqual(['/session.html'])
    const bare = page('', async () => ({ status: 200 }))
    expect(await redeem(bare.env)).toEqual({ kind: 'no-code' })
    expect(bare.trace.requests).toEqual([])
    expect(bare.trace.addresses).toEqual([]) // nothing to remove
  })

  it('does not follow a redirect: the code goes to this origin only', async () => {
    const { env, trace } = page(`#${CODE}`, async () => ({ status: 200 }))
    await redeem(env)
    expect(trace.requests[0]!.init.redirect).toBe('error')
  })
})

describe('session.html', () => {
  it('loads one module script from the origin and has no inline script, which the backend policy would refuse', () => {
    const scripts = [...sessionHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    expect(scripts).toHaveLength(1)
    expect(scripts[0]![1]).toContain('type="module"')
    expect(scripts[0]![1]).toContain('src="/src/session/main.ts"')
    expect((scripts[0]![2] ?? '').trim()).toBe('')
    expect(sessionHtml).not.toMatch(/\son[a-z]+\s*=/i) // no inline event handlers
  })

  it('is a British English page with a title, one h1 and a polite status region', () => {
    expect(sessionHtml).toContain('<html lang="en-GB"')
    expect(sessionHtml).toMatch(/<title>[^<]+<\/title>/)
    expect([...sessionHtml.matchAll(/<h1\b/g)]).toHaveLength(1)
    expect(sessionHtml).toMatch(/id="session-status"[^>]*role="status"[^>]*aria-live="polite"/)
  })

  it('never puts a code or a token in the markup', () => {
    expect(sessionHtml).not.toMatch(/[0-9a-f]{64}/)
  })
})

describe('the words of the page', () => {
  const texts = Object.values(copy).flatMap((value) => (typeof value === 'string' ? [value] : [value.status, value.hint]))
  it('use no em or en dashes', () => {
    for (const text of [...texts, sessionHtml]) expect(text).not.toMatch(/[\u2013\u2014]/)
  })
  it('say what to do after a failure', () => {
    for (const message of [copy.NO_CODE, copy.REFUSED, copy.UNREACHABLE]) {
      expect(message.status.length).toBeGreaterThan(0)
      expect(message.hint).toMatch(/start/i)
    }
  })
})
