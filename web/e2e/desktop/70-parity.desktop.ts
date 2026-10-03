// The app-launched fixture backend serves the same synthetic prices as the browser fixture backend (04 D5.2; 03 section
// 15.3). GP's bars are read from the app's own page (the request the page itself makes) and again, by the same path and
// query, from the browser fixture backend (backend/tests/fixture_app.py under uvicorn on its table port); the bar series must
// be equal. The first test is the check; the second is its born-failing twin: the same smoke build started WITHOUT --fixture
// runs the plain backend, whose answer must NOT match, so a `--fixture` that spawned plain nq_terminal cannot pass.
import { startBrowserFixture, type BrowserFixture } from './browserFixture.ts'
import { attach, expect, test } from './fixtures.ts'
import { apiGet, open, openHome, watch, type Watch } from './app.ts'
import { launchApp, newRunDir } from './launch.ts'

const BARS_PATH = '/api/bars'

interface Health {
  readonly fixture_mode: boolean
}

/** The path and query of the bars request the GP screen made, as the page sent it. */
function gpBarsRequest(w: Watch): string {
  const request = w.requests.map((r) => new URL(r.url())).find((u) => u.pathname === BARS_PATH && u.searchParams.get('symbol')?.startsWith('NQ'))
  if (request === undefined) throw new Error(`GP made no ${BARS_PATH} request; it made: ${w.requests.map((r) => new URL(r.url()).pathname).filter((p) => p.startsWith('/api/')).join(' ')}`)
  return `${request.pathname}${request.search}`
}

/** The served bars without the gate's own bookkeeping (a read count follows the process, not the data). */
function barSeries(body: string): unknown {
  const parsed = JSON.parse(body) as Record<string, unknown>
  const { gate: _gate, ...rest } = parsed
  return rest
}

test.describe('fixture parity', () => {
  let browserBackend: BrowserFixture

  test.beforeAll(async () => { browserBackend = await startBrowserFixture() })
  test.afterAll(() => { browserBackend?.stop() })

  test("GP's bars from the app-launched fixture backend equal the browser fixture backend's", async ({ page }) => {
    const w = watch(page)
    await openHome(page)
    await open(page, 'NQ GP')
    const request = gpBarsRequest(w)
    const fromApp = await apiGet(page, request)
    const fromBrowser = await browserBackend.get(request)
    expect(fromApp.status, `app ${request}`).toBe(200)
    expect(fromBrowser.status, `browser fixture ${request}`).toBe(200)
    expect(JSON.parse((await apiGet(page, '/api/health')).text) as Health).toMatchObject({ fixture_mode: true })
    const app = barSeries(fromApp.text) as { bars?: unknown; t?: unknown }
    expect(Object.keys(app).length, 'the answer has content').toBeGreaterThan(0)
    expect(barSeries(fromApp.text), 'the bar series').toEqual(barSeries(fromBrowser.text))
  })

  test('born failing: the same build started without --fixture is the plain backend, and its answer does not match', async ({ run }) => {
    const plain = await launchApp({ exe: run.exe, fixture: false, lab: run.lab, runDir: newRunDir('plain'), size: '1366x768' })
    const { browser, page } = await attach(plain.cdpUrl, plain.origin)
    try {
      const health = JSON.parse((await apiGet(page, '/api/health')).text) as Health
      expect(health.fixture_mode, 'a build started without --fixture is not in fixture mode').toBe(false)
      const request = `${BARS_PATH}?symbol=NQ.V.0&timeframe=1d`
      const fromPlain = await apiGet(page, request)
      const fromBrowser = await browserBackend.get(request)
      const same = fromPlain.status === fromBrowser.status && JSON.stringify(barSeries(fromPlain.text)) === JSON.stringify(barSeries(fromBrowser.text))
      expect(same, 'the plain backend answered like the fixture backend; the parity check would not tell them apart').toBe(false)
    } finally {
      await browser.close().catch(() => undefined)
      const stopped = await plain.stop()
      expect(stopped.backendGone, 'the plain backend is gone').toBe(true)
    }
  })
})
