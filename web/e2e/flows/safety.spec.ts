// Safety flows (TASKS 8.1; ARCHITECTURE section 9, "Order placement" and "Cross-site requests"):
// - a tour of every mnemonic in the command index: READ ONLY and NO ORDER PATH stay in view on every
//   screen, no control reads as an order ticket, no form exists, and every request the page makes is
//   a same-origin GET with no console error;
// - no route or component name matches order|submit|cancel|modify: the backend's routes, operation
//   ids and schemas (the served OpenAPI document and contract/openapi.json), and on the front end the
//   API routes it calls, the built chunks it loads (named after their modules), the mnemonics and the
//   screen and panel names in the page. The matcher's born-failing cases are in scan.spec.ts;
// - the backend answers every write method with 405 and refuses a cross-site read with 403 (these
//   requests come from the test, not the page, which only ever sends GET).
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { actionNames, chunkName, openApiNames, ticketControls, writeOperations, type OpenApiDoc } from './scan.ts'
import { expectCleanFlow, message, openTerminal, runLine, settle, status, watchFlow, type FlowWatch } from './support.ts'

const CONTRACT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'contract', 'openapi.json')
const RUN = 'nt_volmanaged_v0_fixture_m1'
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

// A context from the fixture index for each context rule of GET /api/commands.
const CONTEXTS: Readonly<Record<string, readonly string[]>> = {
  none: [''],
  instrument: ['NQ'],
  hypothesis: ['volmanaged_v0'],
  run: [RUN],
  universe: ['27F'],
  'hypothesis or instrument': ['volmanaged_v0', 'NQ'],
  'instrument or hypothesis': ['NQ', 'volmanaged_v0'],
  'run or hypothesis': [RUN, 'volmanaged_v0'],
}
const ARGUMENTS: Readonly<Record<string, string>> = { GIP: '2019-03-14' }
// Attributes that name a screen, panel, tab, key-toolbar key or chrome part. Styling hooks (classes)
// and data field keys (a guard list's `data-key`, which mirrors an API field such as the status
// route's `order_path`, the NO ORDER PATH check) are not route or component names.
const NAME_SELECTORS: ReadonlyArray<readonly [string, string]> = [
  ['[data-screen]', 'data-screen'],
  ['[data-nqt-panel]', 'data-nqt-panel'],
  ['[data-tab]', 'data-tab'],
  ['[data-tab-panel-id]', 'data-tab-panel-id'],
  ['[data-chrome="keys"] [data-key]', 'data-key'],
  ['[data-placeholder]', 'data-placeholder'],
  ['[data-pane]', 'data-pane'],
  ['[data-chrome]', 'data-chrome'],
]

interface CommandIndex {
  readonly mnemonics: ReadonlyArray<{ readonly code: string; readonly context: string }>
}

interface TourFacts {
  readonly lines: string[]
  readonly names: Array<readonly [string, string]>
  readonly controls: Set<string>
  readonly forms: string[]
  readonly unsafe: string[]
}

async function apiJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url)
  expect(response.ok(), url).toBe(true)
  return (await response.json()) as T
}

function tourLines(index: CommandIndex): Array<{ line: string; code: string }> {
  return index.mnemonics.flatMap(({ code, context }) =>
    (CONTEXTS[context] ?? ['']).map((ctx) => ({ line: [ctx, code, ARGUMENTS[code] ?? ''].filter(Boolean).join(' '), code })),
  )
}

/** What the page shows that could name or offer a trading action, and whether the safety labels show. */
async function screenFacts(page: Page): Promise<{ names: string[][]; controls: string[]; forms: number }> {
  return page.evaluate((selectors) => {
    const names: string[][] = []
    for (const [selector, attr] of selectors) {
      for (const el of Array.from(document.querySelectorAll(selector))) names.push([attr, el.getAttribute(attr) ?? ''])
    }
    const sel = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], input[type="submit"], input[type="button"]'
    const controls = Array.from(document.querySelectorAll<HTMLElement>(sel)).map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim())
    return { names, controls, forms: document.querySelectorAll('form, input[type="submit"], button[type="submit"]').length }
  }, NAME_SELECTORS)
}

async function safetyLabelsShow(page: Page, line: string): Promise<string[]> {
  const problems: string[] = []
  const safety = page.getByRole('group', { name: 'Safety' })
  for (const label of ['READ ONLY', 'NO ORDER PATH']) {
    if (!(await safety.getByText(label, { exact: true }).isVisible())) problems.push(`${line}: frame strip lacks ${label}`)
    if (!((await status(page).textContent()) ?? '').includes(label)) problems.push(`${line}: status line lacks ${label}`)
  }
  if (!(await safety.isVisible()) || !(await status(page).isVisible())) problems.push(`${line}: safety labels out of view`)
  return problems
}

/** Open every mnemonic in the command index, one after another, and gather what each screen shows. */
async function tour(page: Page): Promise<TourFacts> {
  const index = await apiJson<CommandIndex>(page, '/api/commands')
  const facts: TourFacts = { lines: [], names: [], controls: new Set(), forms: [], unsafe: [] }
  for (const m of index.mnemonics) facts.names.push(['mnemonic', m.code])
  for (const { line, code } of tourLines(index)) {
    await runLine(page, line)
    await expect(message(page), line).not.toHaveAttribute('data-tone', 'error')
    await expect(status(page), line).toContainText(`Screen ${code}`)
    await settle(page)
    const seen = await screenFacts(page)
    for (const [attr, value] of seen.names) facts.names.push([attr ?? '', value ?? ''])
    for (const c of seen.controls) facts.controls.add(c)
    if (seen.forms > 0) facts.forms.push(line)
    facts.unsafe.push(...(await safetyLabelsShow(page, line)))
    facts.lines.push(line)
  }
  return facts
}

/** API routes and built chunks the page asked for, as names. */
function requestNames(watch: FlowWatch): Array<readonly [string, string]> {
  return watch.requests.map((r) => new URL(r.url()).pathname).map((p) =>
    p.startsWith('/api/') ? (['api route', p] as const) : (['chunk', chunkName(p)] as const),
  )
}

test.describe('safety flows', () => {
  test.describe.configure({ timeout: 180_000 })

  test('every screen in the command index: safety labels in view, no order ticket, no form, GET only', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    const facts = await tour(page)
    expect(facts.lines.length).toBeGreaterThanOrEqual(30)
    expect(facts.unsafe).toEqual([])
    expect(facts.forms).toEqual([])
    expect(ticketControls([...facts.controls])).toEqual([])
    // The CANCEL key is the terminal's Esc key, and it says so.
    expect([...facts.controls].filter((c) => /cancel/i.test(c)).every((c) => /\bEsc\b/.test(c))).toBe(true)
    await expectCleanFlow(page, watch)
  })

  test('no front-end route, chunk, mnemonic, screen or panel name matches order|submit|cancel|modify', async ({ page }) => {
    const watch = await watchFlow(page)
    await openTerminal(page)
    const facts = await tour(page)
    const named = [...facts.names, ...requestNames(watch)]
    expect(named.filter(([source]) => source === 'chunk').length).toBeGreaterThan(5)
    expect(named.filter(([source]) => source === 'api route').length).toBeGreaterThan(10)
    expect(actionNames(named)).toEqual([])
  })

  test('no backend route, operation or schema name matches order|submit|cancel|modify, and every route is GET', async ({ page }) => {
    const served = await apiJson<OpenApiDoc>(page, '/api/openapi.json')
    const contract = JSON.parse(fs.readFileSync(CONTRACT, { encoding: 'utf-8' })) as OpenApiDoc
    expect(Object.keys(served.paths).sort()).toEqual(Object.keys(contract.paths).sort())
    expect(Object.keys(served.paths).length).toBeGreaterThan(20)
    expect(writeOperations(served)).toEqual([])
    expect(writeOperations(contract)).toEqual([])
    expect(actionNames(openApiNames(served))).toEqual([])
    expect(actionNames(openApiNames(contract))).toEqual([])
  })

  test('the backend answers every write method with 405 on every route, and refuses a cross-site read', async ({ page }) => {
    const served = await apiJson<OpenApiDoc>(page, '/api/openapi.json')
    const answers: string[] = []
    for (const route of Object.keys(served.paths)) {
      const url = route.replace(/\{[^}]+\}/g, 'x')
      for (const method of WRITE_METHODS) {
        const response = await page.request.fetch(url, { method, data: '{}', headers: { 'content-type': 'application/json' } })
        if (response.status() !== 405) answers.push(`${method} ${url}: ${response.status()}`)
      }
    }
    expect(answers).toEqual([])
    const crossSite = await page.request.get('/api/runs', { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(crossSite.status()).toBe(403)
    const otherOrigin = await page.request.get('/api/health', { headers: { origin: 'http://attacker.example' } })
    expect(otherOrigin.status()).toBe(403)
    const sameOrigin = await page.request.get('/api/health', { headers: { 'sec-fetch-site': 'same-origin' } })
    expect(sameOrigin.status()).toBe(200)
  })
})
