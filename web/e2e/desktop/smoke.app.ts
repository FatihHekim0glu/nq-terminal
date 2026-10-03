// The real-data smoke run in app mode (04 D5.2; 03 section 15.1, "Real-data smoke: plus an app mode (hidden window)"): run only by
// terminal/scripts/smoke_real.ps1 -Mode App, through playwright.desktop.config.ts with NQT_DESKTOP_MODE=real. The hidden smoke build
// starts the real backend (no --fixture) over the real lab, with a temporary state folder, a temporary WebView2 profile and
// config folder, and NQT_JOBS=off; Playwright attaches to its page over the debugging protocol. Like e2e/perf/smoke.real.ts, which
// is the browser mode, every P0 screen and every Phase 11 screen (VCONE, SEAS, EVT, ROLL, DQ, each showing its [POST HOC] label,
// with the DQ record anchors) opens on real files with no error state, no console error, no failed API answer and only same-origin
// GETs, and no served price or market date lies past 2021-12-31. The script itself checks, around this run, that every new
// oos_access_log.jsonl line has caller "terminal" and ends at or before 2022-01-01 and that ledger.csv, registry.csv and
// oos_openings.json are byte for byte unchanged. The performance budgets are not measured here: the desktop harness does that.
// Not a `*.desktop.ts` file, so the fixture project never picks it up.
import { expect, test } from './fixtures.ts'
import { apiGet, failedAnswers, openHome, panel, runLine, settle, watch, type Watch } from './app.ts'
import { FENCE_DATE, FENCE_S, HOME_READY, offOriginOrNotGet } from '../perf/pages.ts'
import type { Page } from '@playwright/test'

const GIP_DATE = '2019-03-14'
const LOAD_TIMEOUT = 180_000
/** A screen still loading after this long is reported as stuck, and the run moves on. */
const SCREEN_TIMEOUT = 60_000
const EXPECTED_FILLS_RUN_KINDS = ['intraday', 'sized', 'book']

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

async function apiJson<T>(page: Page, path: string): Promise<T> {
  const answer = await apiGet(page, path)
  expect(answer.status, path).toBe(200)
  return JSON.parse(answer.text) as T
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

/** Opens one line in the focused panel and waits for it; returns what went wrong on it (and, with `mustShow`, when the panel does not show that text). */
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

async function pickRuns(page: Page): Promise<readonly string[]> {
  const runs = (await apiJson<RunRow[]>(page, '/api/runs')).filter((r) => r.readable && r.usable && !r.is_probe)
  return EXPECTED_FILLS_RUN_KINDS.flatMap((kind) => runs.filter((r) => r.kind === kind).slice(0, 1).map((r) => r.run_id))
}

const P11_LINES = ['NQ VCONE', 'NQ SEAS', 'volmanaged_v0 SEAS', 'NQ EVT', 'NQ ROLL', 'NQ DQ', 'HO DQ']
const P11_FROM = '2011-01-01'

interface DqDayRow { readonly date: string; readonly state: string }
interface DqCal { readonly days: readonly DqDayRow[]; readonly symbol: { readonly counts: Readonly<Record<string, number>> } }
interface SeasPanelRow { readonly id: string; readonly excluded_sessions: number | null; readonly buckets: ReadonlyArray<{ readonly n: number }> }
interface EvtRowLite { readonly used: boolean; readonly reason: string | null }

/** The record anchors (ANALYTICS RI4, RI5) and the checks that rebuilt NQ sessions stay in SEAS and EVT. */
async function p11Anchors(page: Page): Promise<string[]> {
  const failures: string[] = []
  const nq = await apiJson<DqCal>(page, '/api/dq/calendar/NQ.V.0')
  const ho = await apiJson<DqCal>(page, '/api/dq/calendar/HO.V.0')
  const guards = await apiJson<{ ok: number; mismatch: number; no_record: number }>(page, '/api/dq/guards')
  const expectEq = (name: string, got: number, want: number) => { if (got !== want) failures.push(`${name}: ${got}, expected ${want}`) }
  expectEq('NQ rebuilt', nq.symbol.counts.rebuilt ?? -1, 487)
  expectEq('NQ unrepairable', nq.symbol.counts.unrepairable ?? -1, 11)
  expectEq('HO rebuilt', ho.symbol.counts.rebuilt ?? -1, 740)
  expectEq('HO unrepairable', ho.symbol.counts.unrepairable ?? -1, 222)
  expectEq('guards OK', guards.ok, 13)
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
  return failures
}

// In file order on one worker, on one app; each test starts from a fresh HOME so one failure does not skip the rest.
test.describe('real-data smoke run, app mode', () => {
  test('the app-launched backend reads the real files, not fixtures', async ({ page }, info) => {
    const health = await apiJson<Health>(page, '/api/health')
    expect(health.fixture_mode).toBe(false)
    expect(health.fence).toEqual({ is_start: '2010-01-01', is_end: FENCE_DATE })
    info.annotations.push({ type: 'backend-before', description: JSON.stringify({ gate_reads_this_process: health.gate_reads_this_process }) })
  })

  test('every P0 screen opens on real files', async ({ page, run }, info) => {
    const w = watch(page)
    const byKind = await pickRuns(page)
    await openHome(page)
    await settle(page, LOAD_TIMEOUT)
    const problems: string[] = []
    for (const [title, selectors] of HOME_READY) {
      for (const s of selectors) {
        await expect(panel(page, title).locator(s).first()).toBeAttached({ timeout: LOAD_TIMEOUT })
          .catch(() => problems.push(`HOME ${title}: nothing matches ${s}`))
      }
    }
    const lines = [
      'NQ GP', `NQ GIP ${GIP_DATE}`, 'NQ DES', 'ZN DES', 'REG', 'MT', 'RUNS',
      ...byKind.flatMap((runId) => [`${runId} RUN`, `${runId} EQ`]),
      'volmanaged_v0 DES', 'volmanaged_v0 EQ', 'volmanaged_v0 DD', 'volmanaged_v0 RET', 'volmanaged_v0 RR', 'volmanaged_v0 MRET',
      '27F MON', '27F CORR', 'LEDG', 'OOS', 'LIVE', 'JRNL', 'HELP',
    ]
    for (const line of lines) problems.push(...(await openScreen(page, line)))
    info.annotations.push({ type: 'screens', description: JSON.stringify({ opened: lines.length + 1, runs: byKind }) })
    expect.soft(problems).toEqual([])
    expect.soft(failedAnswers(w)).toEqual([])
    expect.soft(await pastFence(w)).toEqual([])
    expect.soft(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, run.origin)).toEqual([])
  })

  test('DES and EQ open for every registered hypothesis', async ({ page, run }, info) => {
    const w = watch(page)
    const cards = await apiJson<Array<{ readonly name: string }>>(page, '/api/hypotheses')
    expect(cards.length).toBeGreaterThan(20)
    await openHome(page)
    const problems: string[] = []
    for (const { name } of cards) {
      problems.push(...(await openScreen(page, `${name} DES`)))
      problems.push(...(await openScreen(page, `${name} EQ`)))
    }
    info.annotations.push({ type: 'hypotheses', description: JSON.stringify({ opened: cards.length }) })
    expect.soft(problems).toEqual([])
    expect.soft(failedAnswers(w)).toEqual([])
    expect.soft(await pastFence(w)).toEqual([])
    expect.soft(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, run.origin)).toEqual([])
  })

  test('every Phase 11 screen opens on real files, with the record anchors', async ({ page, run }, info) => {
    const w = watch(page)
    await openHome(page)
    const problems: string[] = []
    for (const line of P11_LINES) {
      problems.push(...(await openScreen(page, line, '[POST HOC]')))
    }
    const anchors = await p11Anchors(page)
    info.annotations.push({ type: 'p11-screens', description: JSON.stringify({ opened: P11_LINES.length, anchors }) })
    expect.soft(problems).toEqual([])
    expect.soft(anchors).toEqual([])
    expect.soft(failedAnswers(w)).toEqual([])
    expect.soft(await pastFence(w)).toEqual([])
    expect.soft(w.errors).toEqual([])
    expect(offOriginOrNotGet(w, run.origin)).toEqual([])
  })

  test('the backend served every price through the gate', async ({ page }, info) => {
    const health = await apiJson<Health>(page, '/api/health')
    info.annotations.push({ type: 'backend-after', description: JSON.stringify({ gate_reads_this_process: health.gate_reads_this_process }) })
    expect(health.gate_reads_this_process).toBeGreaterThan(0)
  })
})
