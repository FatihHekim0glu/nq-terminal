// Real-data smoke run (TASKS 8.3), run only by terminal/scripts/smoke_real.ps1 through real.config.ts:
// a second backend on a spare port reads the real nq-lab files (not fixture mode). Every P0 screen, and every
// Phase 11 screen (VCONE, SEAS, EVT, ROLL, DQ, each showing its [POST HOC] label, with the DQ record anchors),
// opens on real files with no error state, no console error, no failed API answer and only same-origin GETs;
// no served price or market date lies past 2021-12-31; then the performance budgets are measured again on
// real data (HOME, GIP pan and zoom, and the real 8,411-fill run). The script itself checks, around this
// run, that the new oos_access_log.jsonl lines all have caller "terminal" and end at or before 2022-01-01,
// and that ledger.csv, registry.csv and oos_openings.json are byte for byte unchanged.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { BUDGETS } from './trace.ts'
import {
  canvasPrint, FENCE_DATE, FENCE_S, HOME_READY, measureFills, measureHome, measurePanZoom, median, offOriginOrNotGet,
  panel, report, runLine, settle, watch, type Watch,
} from './pages.ts'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const GIP_DATE = '2019-03-14'
const LOAD_TIMEOUT = 180_000
/** A screen still loading after this long is reported as stuck, and the run moves on. */
const SCREEN_TIMEOUT = 60_000
const HOME_LOADS = 3

interface Health {
  readonly fixture_mode: boolean
  readonly fence: { readonly is_start: string; readonly is_end: string }
  readonly gate_reads_this_process: number
}

interface RunRow {
  readonly run_id: string
  readonly kind: string
  readonly usable: boolean
  readonly readable: boolean
  readonly is_probe: boolean
}

interface Fills {
  readonly total: number
}

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const reply = await page.request.get(path, { timeout: LOAD_TIMEOUT })
  expect(reply.status(), path).toBe(200)
  return (await reply.json()) as T
}

/** Every API answer that failed, as `<status> <path>`. */
function failedAnswers(w: Watch): string[] {
  return w.responses
    .filter((r) => new URL(r.url()).pathname.startsWith('/api/') && r.status() >= 400)
    .map((r) => `${r.status()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`)
}

/** Answers that carry served prices or session dates (the Phase 11 views included). */
const FENCED_PREFIXES = ['/api/market/', '/api/seasonality/', '/api/events/', '/api/dq/']

/** Price or market values past the fence in any served bars or market answer. */
async function pastFence(w: Watch): Promise<string[]> {
  const found: string[] = []
  const scan = (value: unknown, key: string, where: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v) => scan(v, key, where))
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) scan(v, k, where)
    } else if (key === 't' && typeof value === 'number' && value >= FENCE_S) {
      found.push(`${where}: t ${value}`)
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && value.slice(0, 10) > FENCE_DATE) {
      found.push(`${where}: ${key} ${value}`)
    }
  }
  for (const r of w.responses) {
    const path = new URL(r.url()).pathname
    if (r.status() !== 200 || !(path === '/api/bars' || FENCED_PREFIXES.some((p) => path.startsWith(p)))) continue
    scan(await r.json().catch(() => null), '', path)
  }
  return found
}

/** Opens one line in the focused panel and waits for it; returns what went wrong on it (and, with `mustShow`,
 *  when the panel does not show that text). */
async function openScreen(page: Page, line: string, mustShow?: string): Promise<string[]> {
  const target = await runLine(page, line)
  const problems: string[] = []
  try {
    await settle(page, SCREEN_TIMEOUT)
  } catch {
    const busy = await page.locator('[aria-busy="true"]').allTextContents()
    return [`${line}: still loading after ${SCREEN_TIMEOUT / 1000} s (${busy.map((b) => b.trim()).join(' | ')})`]
  }
  const alerts = await target.locator('[role="alert"]').allTextContents()
  if (alerts.length > 0) problems.push(`${line}: alert ${alerts.map((a) => a.trim()).join(' | ')}`)
  if (await target.locator('[data-placeholder]').count() > 0) problems.push(`${line}: placeholder screen`)
  if (mustShow && !((await target.textContent()) ?? '').includes(mustShow)) problems.push(`${line}: no ${mustShow}`)
  return problems
}

async function axeIds(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return result.violations.map((v) => `${v.id} (${v.nodes.length})`)
}

async function pickRuns(page: Page): Promise<{ readonly fills: string; readonly byKind: readonly string[] }> {
  const runs = (await apiJson<RunRow[]>(page, '/api/runs')).filter((r) => r.readable && r.usable && !r.is_probe)
  const byKind = ['intraday', 'sized', 'book'].flatMap((kind) => runs.filter((r) => r.kind === kind).slice(0, 1).map((r) => r.run_id))
  let fills = ''
  for (const r of runs.filter((x) => x.kind === 'book')) {
    const page1 = await apiJson<Fills>(page, `/api/runs/${r.run_id}/fills?limit=1`)
    if (page1.total === BUDGETS.fillsRows) { fills = r.run_id; break }
  }
  return { fills, byKind }
}

const P11_LINES = ['NQ VCONE', 'NQ SEAS', 'volmanaged_v0 SEAS', 'NQ EVT', 'NQ ROLL', 'NQ DQ', 'HO DQ']
const P11_FROM = '2011-01-01'

interface DqDayRow { readonly date: string; readonly state: string }
interface DqCal { readonly days: readonly DqDayRow[]; readonly symbol: { readonly counts: Readonly<Record<string, number>> } }
interface SeasPanelRow { readonly id: string; readonly excluded_sessions: number | null; readonly buckets: ReadonlyArray<{ readonly n: number }> }
interface EvtRowLite { readonly used: boolean; readonly reason: string | null }

/** The record anchors (ANALYTICS RI4, RI5) and the checks that rebuilt NQ sessions stay in SEAS and EVT. */
async function p11Anchors(page: Page): Promise<{ readonly failures: string[]; readonly values: Record<string, number> }> {
  const failures: string[] = []
  const nq = await apiJson<DqCal>(page, '/api/dq/calendar/NQ.V.0')
  const ho = await apiJson<DqCal>(page, '/api/dq/calendar/HO.V.0')
  const guards = await apiJson<{ ok: number; mismatch: number; no_record: number }>(page, '/api/dq/guards')
  const expectEq = (name: string, got: number, want: number) => { if (got !== want) failures.push(`${name}: ${got}, expected ${want}`) }
  expectEq('NQ rebuilt', nq.symbol.counts.rebuilt ?? -1, 487)
  expectEq('NQ unrepairable', nq.symbol.counts.unrepairable ?? -1, 11)
  expectEq('HO rebuilt', ho.symbol.counts.rebuilt ?? -1, 740)
  expectEq('HO unrepairable', ho.symbol.counts.unrepairable ?? -1, 222)
  expectEq('guards OK', guards.ok, 12)
  expectEq('guards mismatch', guards.mismatch, 0)
  const later = nq.days.filter((d) => d.date >= P11_FROM)
  const eligible = later.length
  const unrepairable = later.filter((d) => d.state === 'unrepairable').length
  const seas = await apiJson<{ panels: SeasPanelRow[] }>(page, '/api/seasonality/instrument/NQ?start_year=2011&end_year=2021')
  const intraday = seas.panels.find((p) => p.id === 'intraday')
  const used = Math.max(0, ...(intraday?.buckets ?? []).map((b) => b.n))
  expectEq('SEAS NQ 30-minute sessions used', used, eligible - unrepairable)
  expectEq('SEAS NQ used plus left out', used + (intraday?.excluded_sessions ?? 0), eligible)
  const evt = await apiJson<{ events: EvtRowLite[]; n_used: number }>(page, '/api/events/study?symbol=NQ.V.0&event=FOMC&mode=intraday&pre=60&post=120')
  const noPrice = evt.events.filter((e) => !e.used && (e.reason ?? '').startsWith('no finite price')).length
  expectEq('EVT NQ FOMC intraday voids for want of a raw close', noPrice, 0)
  return { failures, values: { eligible, unrepairable, seasUsed: used, evtUsed: evt.n_used } }
}

// In file order on one worker; each test opens its own page, so one failure does not skip the rest.
test.describe('real-data smoke run', () => {
  test('the backend reads the real files, not fixtures; HOME on a cold backend', async ({ browser, page }, info) => {
    const health = await apiJson<Health>(page, '/api/health')
    expect(health.fixture_mode).toBe(false)
    expect(health.fence).toEqual({ is_start: '2010-01-01', is_end: FENCE_DATE })
    report(info, 'backend-before', { gate_reads_this_process: health.gate_reads_this_process })
    const cold = await measureHome(browser, info, 'home-cold-backend', LOAD_TIMEOUT)
    report(info, 'home-cold-backend', { frameMs: Math.round(cold.frameMs), readyMs: Math.round(cold.readyMs), settledMs: Math.round(cold.settledMs), slowest: cold.slowest })
  })

  test('every P0 screen opens on real files', async ({ page, baseURL }, info) => {
    const w = watch(page)
    const { fills, byKind } = await pickRuns(page)
    expect(fills, 'a run with 8,411 fills').not.toBe('')
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(HOME_READY.length)
    await settle(page, LOAD_TIMEOUT)
    const problems: string[] = []
    for (const [title, selectors] of HOME_READY) {
      for (const s of selectors) {
        await expect(panel(page, title).locator(s).first()).toBeAttached({ timeout: LOAD_TIMEOUT })
          .catch(() => problems.push(`HOME ${title}: nothing matches ${s}`))
      }
    }
    const axe: Record<string, string[]> = { HOME: await axeIds(page) }
    const lines = [
      'NQ GP', `NQ GIP ${GIP_DATE}`, 'NQ DES', 'ZN DES', 'REG', 'MT', 'RUNS',
      ...byKind.flatMap((run) => [`${run} RUN`, `${run} EQ`]),
      'volmanaged_v0 DES', 'volmanaged_v0 EQ', 'volmanaged_v0 DD', 'volmanaged_v0 RET', 'volmanaged_v0 RR', 'volmanaged_v0 MRET',
      '27F MON', '27F CORR', 'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP',
    ]
    for (const line of lines) {
      problems.push(...(await openScreen(page, line)))
      axe[line] = await axeIds(page)
    }
    const fence = await pastFence(w)
    report(info, 'screens', { opened: lines.length + 1, runs: byKind, fillsRun: fills })
    report(info, 'axe-real-data', Object.fromEntries(Object.entries(axe).filter(([, v]) => v.length > 0)))
    expect.soft(problems).toEqual([])
    expect.soft(failedAnswers(w)).toEqual([])
    expect.soft(fence).toEqual([])
    expect.soft(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, new URL(baseURL ?? '').origin)).toEqual([])
  })

  test('DES and EQ open for every registered hypothesis', async ({ page, baseURL }, info) => {
    const w = watch(page)
    const cards = await apiJson<Array<{ readonly name: string }>>(page, '/api/hypotheses')
    expect(cards.length).toBeGreaterThan(20)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(HOME_READY.length)
    const problems: string[] = []
    for (const { name } of cards) {
      problems.push(...(await openScreen(page, `${name} DES`)))
      problems.push(...(await openScreen(page, `${name} EQ`)))
    }
    report(info, 'hypotheses', { opened: cards.length, names: cards.map((c) => c.name) })
    expect.soft(problems).toEqual([])
    expect.soft(failedAnswers(w)).toEqual([])
    expect.soft(await pastFence(w)).toEqual([])
    expect.soft(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, new URL(baseURL ?? '').origin)).toEqual([])
  })

  test('every Phase 11 screen opens on real files, with the record anchors', async ({ page, baseURL }, info) => {
    const w = watch(page)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(HOME_READY.length)
    const problems: string[] = []
    const axe: Record<string, string[]> = {}
    for (const line of P11_LINES) {
      problems.push(...(await openScreen(page, line, '[POST HOC]')))
      axe[line] = await axeIds(page)
    }
    const anchors = await p11Anchors(page)
    report(info, 'p11-screens', { opened: P11_LINES.length, anchors })
    report(info, 'axe-real-data-p11', Object.fromEntries(Object.entries(axe).filter(([, v]) => v.length > 0)))
    expect.soft(problems).toEqual([])
    expect.soft(anchors.failures).toEqual([])
    expect.soft(failedAnswers(w)).toEqual([])
    expect.soft(await pastFence(w)).toEqual([])
    expect.soft(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, new URL(baseURL ?? '').origin)).toEqual([])
  })

  test('budgets on real data: HOME, GIP pan and zoom, the 8,411-fill run', async ({ browser, page }, info) => {
    const loads = []
    for (let i = 0; i < HOME_LOADS; i += 1) loads.push(await measureHome(browser, info, `home-real-${i + 1}`, LOAD_TIMEOUT))
    const ready = median(loads.map((l) => l.readyMs))
    report(info, 'home-first-render-real', { budgetMs: BUDGETS.homeFirstRenderMs, medianReadyMs: Math.round(ready), loads: loads.map((l) => ({ frameMs: Math.round(l.frameMs), readyMs: Math.round(l.readyMs), settledMs: Math.round(l.settledMs), slowest: l.slowest })) })

    const w = watch(page)
    const { fills } = await pickRuns(page)
    await page.goto('/')
    await expect(page.locator('[data-nqt-title]')).toHaveCount(HOME_READY.length)
    const gip = await runLine(page, `NQ GIP ${GIP_DATE}`)
    await settle(page, LOAD_TIMEOUT)
    const chart = gip.getByRole('img', { name: /^NQ1 Index: \d+ 1-minute bars/ })
    const before = await canvasPrint(chart)
    const gesture = await measurePanZoom(browser, page, info, chart, 'gip-real')
    report(info, 'gip-pan-zoom-real', { zoom: { ...gesture.zoom.stats, longTasks: gesture.zoom.long }, pan: { ...gesture.pan.stats, longTasks: gesture.pan.long } })
    expect.soft(await canvasPrint(chart)).not.toBe(before)

    const run = await runLine(page, `${fills} RUN`)
    await settle(page, LOAD_TIMEOUT)
    const t = await measureFills(browser, page, info, run, fills, 'fills-real')
    report(info, 'fills-grid-real', { run: fills, budgetMs: BUDGETS.fillsGridMs, ...t })

    expect.soft(ready).toBeLessThan(BUDGETS.homeFirstRenderMs)
    expect.soft(gesture.zoom.failures).toEqual([])
    expect.soft(gesture.pan.failures).toEqual([])
    expect.soft(t.firstPageRows + t.secondPageRows).toBe(BUDGETS.fillsRows)
    expect.soft(t.openMs).toBeLessThan(BUDGETS.fillsGridMs)
    expect.soft(t.sortMs).toBeLessThan(BUDGETS.fillsGridMs)
    expect.soft(t.pageMs).toBeLessThan(BUDGETS.fillsGridMs)
    expect(w.errors).toEqual([])
  })

  test('the backend served every price through the gate', async ({ page }, info) => {
    const health = await apiJson<Health>(page, '/api/health')
    report(info, 'backend-after', { gate_reads_this_process: health.gate_reads_this_process })
    expect(health.gate_reads_this_process).toBeGreaterThan(0)
  })
})
