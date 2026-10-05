// The global job indicator, the finish notice and the anchor re-run badge (release 0.2.0), through the gallery entry
// /__gallery/JobsBar. The job list and the anchor comparison are answered by this spec (page.route), so every state is
// deterministic and no real backtest runs; the page itself sends GETs only (the stand-in launcher makes no request).
// Checked: each state of the indicator in words, the elapsed and typical times, the finish notice (a live region, no
// pop-up) with Open in RUN, a failed-checks and an error notice, and MATCH and MISMATCH with the first differing
// field; axe WCAG 2.2 AA clean, no console errors, same-origin GET only. No screenshot baseline is taken here.
import { expect, test, type Page } from '@playwright/test'
import { expectGalleryClean, openGallery, watchGallery } from './gallery.ts'

const NEW_RUN = 't_base_regress_r1'
const SECOND_MS = 1000

interface World {
  jobs: unknown[]
  detail: unknown
}

const iso = (secondsAgo: number): string => new Date(Date.now() - secondsAgo * SECOND_MS).toISOString()

function makeJob(id: string, state: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    run_id: `t_${id}`,
    spec: { strategy: 'tsmom', params: {}, variant: 'vendor', start: '2010-06-01', end: '2022-01-01', run_id: `t_${id}` },
    state,
    exit_code: state === 'ok' ? 0 : state === 'failed' ? 1 : state === 'error' ? 2 : null,
    created: iso(60),
    started: null,
    finished: null,
    message: '',
    log_tail: [],
    ...patch,
  }
}

const past = (id: string, seconds: number, ago: number): Record<string, unknown> =>
  makeJob(id, 'ok', { started: iso(ago + seconds), finished: iso(ago) })
const running = (id: string): Record<string, unknown> => makeJob(id, 'running', { created: iso(20), started: iso(12) })
const queued = (id: string): Record<string, unknown> => makeJob(id, 'queued', { created: iso(8) })
const finished = (id: string, state: string, seconds: number): Record<string, unknown> =>
  makeJob(id, state, { created: iso(40), started: iso(seconds + 2), finished: iso(2) })

/** The exact comparison the re-run region reads (GET /api/jobs/actions/anchors/{run_id}). */
const CHECK_MATCH = {
  anchor: NEW_RUN, base: 't_base', base_found: true, job_state: 'ok', verdict: 'MATCH', first_difference: null, note: '',
  checks: [
    { field: 'n_trades', anchor: 12, base: 12, equal: true },
    { field: 'pnl_total', anchor: 1500.5, base: 1500.5, equal: true },
    { field: 'fees_total', anchor: 24, base: 24, equal: true },
    { field: 'sharpe', anchor: 0.4644, base: 0.4644, equal: true },
  ],
}
const CHECK_MISMATCH = {
  ...CHECK_MATCH, verdict: 'MISMATCH', first_difference: 'pnl_total',
  checks: CHECK_MATCH.checks.map((c) => (c.field === 'pnl_total' ? { ...c, anchor: 1499.5, equal: false } : c)),
}

async function serve(page: Page, world: World): Promise<void> {
  await page.route((url) => url.pathname === '/api/jobs', (route) => {
    const running_ = world.jobs.filter((j) => (j as { state: string }).state === 'running').length
    const queued_ = world.jobs.filter((j) => (j as { state: string }).state === 'queued').length
    return route.fulfill({ json: { jobs: world.jobs, queue_cap: 10, queued: queued_, running: running_, enabled: true } })
  })
  await page.route((url) => url.pathname === `/api/jobs/actions/anchors/${NEW_RUN}`, (route) => route.fulfill({ json: world.detail }))
}

const bar = (page: Page) => page.locator('[data-chrome="jobs"]')

test.describe('job indicator', () => {
  test('is silent while nothing runs', async ({ page }) => {
    const watch = await watchGallery(page)
    await serve(page, { jobs: [past('old', 20, 600)], detail: {} })
    await openGallery(page, 'JobsBar')
    await expect(bar(page)).toHaveAttribute('data-state', 'none')
    await expect(bar(page).getByRole('group')).toHaveCount(0)
    await expectGalleryClean(page, watch)
  })

  test('running: words, elapsed and typical time; then a finish notice with Open in RUN', async ({ page }) => {
    const watch = await watchGallery(page)
    const world: World = { jobs: [running('run'), queued('wait'), past('p1', 10, 900), past('p2', 20, 800)], detail: {} }
    await serve(page, world)
    await openGallery(page, 'JobsBar')
    await expect(bar(page)).toHaveAttribute('data-state', 'running')
    const row = bar(page).getByRole('group', { name: 'Backtest jobs' })
    await expect(row).toContainText('RUNNING')
    await expect(row).toContainText('t_run (tsmom)')
    await expect(row).toContainText(/elapsed \d+ s/)
    await expect(row).toContainText('typical 15 s')
    await expect(row).toContainText('1 more in the queue')
    await expectGalleryClean(page, watch)

    world.jobs = [finished('run', 'ok', 14), queued('wait'), past('p1', 10, 900), past('p2', 20, 800)]
    await expect(bar(page)).toHaveAttribute('data-state', 'finished', { timeout: 15_000 })
    const live = bar(page).getByRole('status')
    await expect(live).toHaveText('Finished: t_run (tsmom), OK in 14 s.')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectGalleryClean(page, watch)
    await bar(page).getByRole('button', { name: 'Open in RUN, t_run' }).click()
    await expect(page.getByTestId('opened')).toHaveText('Opened line: t_run RUN')
    await expect(bar(page).getByRole('group', { name: 'Finished backtest jobs' })).toHaveCount(0)
  })

  test('failed checks and an error end are told in words; only the first can be opened', async ({ page }) => {
    const watch = await watchGallery(page)
    const world: World = { jobs: [running('chk'), running('bad')], detail: {} }
    await serve(page, world)
    await openGallery(page, 'JobsBar')
    await expect(bar(page)).toHaveAttribute('data-state', 'running')
    world.jobs = [finished('chk', 'failed', 9), makeJob('bad', 'error', { created: iso(40), started: iso(5), finished: iso(1) })]
    await expect(bar(page)).toHaveAttribute('data-state', 'failed', { timeout: 15_000 })
    const notice = bar(page).getByRole('group', { name: 'Finished backtest jobs' })
    await expect(notice).toContainText('ended with an error (exit 2)')
    await expect(notice).toContainText('and 1 earlier')
    await expect(notice.getByRole('button', { name: /Open in RUN, t_bad/ })).toHaveCount(0)
    await expectGalleryClean(page, watch)
    await notice.getByRole('button', { name: 'Dismiss the finish notice' }).click()
    await expect(bar(page)).toHaveAttribute('data-state', 'none')
  })
})

test.describe('anchor re-run', () => {
  async function rerun(page: Page, detail: unknown): Promise<void> {
    const world: World = { jobs: [makeJob('anchor', 'running', { id: 'j-anchor', run_id: NEW_RUN, created: iso(5), started: iso(3) })], detail }
    await serve(page, world)
    await openGallery(page, 'JobsBar')
    await page.getByRole('button', { name: 'Re-run anchor, t_base' }).click()
    const status = page.getByRole('group', { name: 'Anchor re-run of t_base' }).getByRole('status')
    await expect(status).toContainText(`Anchor re-run ${NEW_RUN} is running.`)
    world.jobs = [makeJob('anchor', 'ok', { id: 'j-anchor', run_id: NEW_RUN, created: iso(30), started: iso(25), finished: iso(2) })]
  }

  test('MATCH', async ({ page }) => {
    const watch = await watchGallery(page)
    await rerun(page, CHECK_MATCH)
    const badge = page.getByRole('group', { name: 'Anchor re-run result' })
    await expect(badge).toContainText('MATCH', { timeout: 15_000 })
    await expect(badge).not.toContainText('MISMATCH')
    await expectGalleryClean(page, watch)
    await page.getByRole('group', { name: 'Anchor re-run of t_base' }).getByRole('button', { name: `Open in RUN, ${NEW_RUN}` }).click()
    await expect(page.getByTestId('opened')).toHaveText(`Opened line: ${NEW_RUN} RUN`)
  })

  test('MISMATCH names the first differing field', async ({ page }) => {
    const watch = await watchGallery(page)
    await rerun(page, CHECK_MISMATCH)
    const badge = page.getByRole('group', { name: 'Anchor re-run result' })
    await expect(badge).toContainText('MISMATCH', { timeout: 15_000 })
    await expect(badge).toContainText('total P&L')
    await expectGalleryClean(page, watch)
  })
})
