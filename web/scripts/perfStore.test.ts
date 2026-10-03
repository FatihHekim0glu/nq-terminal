// The HOME first-render budget (1.5 s, e2e/perf/budgets.spec.ts) must be measured on the path production runs. The shipped
// page always starts the workspace store before it boots (src/main.tsx: the store chunk, GET meta, then the six document
// reads, waiting up to 1.5 s), but the gallery build the E2E run serves starts it only when a spec sets
// window.__NQT_STORE__. The budget run never set it, so it skipped that serial step. HOME's loads now set the flag.
// Born failing: a HOME measurement whose context does not set the flag before the page script runs, and an init script
// that leaves the flag unset or false.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { enableStoreInit, startStoreInContext, type InitScriptHost } from '../e2e/perf/storeOn.ts'

const PAGES = readFileSync(fileURLToPath(new URL('../e2e/perf/pages.ts', import.meta.url)), 'utf8')
const MAIN = readFileSync(fileURLToPath(new URL('../src/main.tsx', import.meta.url)), 'utf8')

/** The source of one exported async function of pages.ts, up to the next top-level export. */
function bodyOf(name: string): string {
  const start = PAGES.indexOf(`export async function ${name}(`)
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0)
  const next = PAGES.indexOf('\nexport ', start + 1)
  return PAGES.slice(start, next < 0 ? undefined : next)
}

describe('HOME budget runs with the workspace store on', () => {
  it('the init script sets the flag the gallery build reads', () => {
    const scope = globalThis as { __NQT_STORE__?: boolean }
    delete scope.__NQT_STORE__
    try {
      enableStoreInit()
      expect(scope.__NQT_STORE__).toBe(true)
    } finally {
      delete scope.__NQT_STORE__
    }
  })

  it('born failing: a scope the script was never run in has no flag', () => {
    const scope: { __NQT_STORE__?: boolean } = {}
    expect(scope.__NQT_STORE__).not.toBe(true)
  })

  it('registers the script on the context it is given', async () => {
    const added: unknown[] = []
    const host: InitScriptHost = { addInitScript: async (script) => void added.push(script) }
    await startStoreInContext(host)
    expect(added).toEqual([enableStoreInit])
  })

  it('measureHome starts the store in its context before it opens the page', () => {
    const body = bodyOf('measureHome')
    const enable = body.indexOf('startStoreInContext(context)')
    expect(enable, 'measureHome enables the store').toBeGreaterThanOrEqual(0)
    expect(enable).toBeLessThan(body.indexOf('page.goto('))
  })

  it('born failing: a measureHome without the call is caught', () => {
    const without = bodyOf('measureHome').replace('startStoreInContext(context)', '')
    expect(without.indexOf('startStoreInContext(context)')).toBe(-1)
  })

  it('reads the same flag as main.tsx', () => {
    expect(MAIN).toContain('__NQT_STORE__')
  })
})
