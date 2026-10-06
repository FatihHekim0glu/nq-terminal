// Start from E2E (0.2.0, product-1): a run is launched from the terminal through the JOBS queue's actions route.
// Runs against the fixture-mode backend (playwright.config.ts), whose ledger holds nt_overnight_v0_fixture_open and whose runs
// include nt_dtsmom_v0_fixture_ts1. The presets route and the actions route are answered by the spec itself (page.route), so
// the spec needs neither the real runner nor a backend that has the routes: it holds the browser side to the contract (the
// request the form sends, its headers, what it shows). The shapes are the contract's (PresetList, BacktestAction,
// ActionResult). What it proves:
// - the Actions menu of LEDG opens the form from the newest ledger row; focus lands on the first parameter; the keys alone
//   (Enter and the arrow keys on the picker, Control with Enter) change a parameter and launch;
// - a change from the preset is marked in words, and the run is called off spec; a bad run id is shown next to its field,
//   Launch is disabled until it is fixed, and axe (WCAG 2.2 AA) is clean in the open, the invalid and the queued states;
// - the one write is a POST to /api/jobs/actions with the X-NQT header and a JSON body of kind backtest: the preset id, only the
//   parameters that changed, the window dates that changed and the run id;
// - the Actions menu of RUN opens the form from the run's own configuration, and Escape closes it with the focus back;
// - at 200% zoom in the two smallest windows nothing scrolls sideways, overlaps or is cut off in the maximised panel.
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { expectGalleryAxeClean, watchGallery } from './gallery.ts'
import { dismissOrientation } from './orientation.ts'
import { cutOffIn, overlapsIn, sidewaysIn } from './reflow.ts'

const OVERNIGHT = 'nt_overnight_v0_fixture_open'
const DTS = 'nt_dtsmom_v0_fixture_ts1'
const SPEC_SHA = 'c'.repeat(64) // a plain test value: the overnight preset is bound to a spec file, the dtsmom one is not

const FIELD = { default: null, required: false, minimum: null, maximum: null, exclusive_minimum: false, choices: null, feed_key: false }
const OFFERED = { ts_utc: '2026-09-30T10:00:00+00:00', runtime_s: 30, run_found: true, launchable: true, reasons: [] }
const PRESETS = {
  ledger_found: true,
  presets: [
    { ...OFFERED, preset_id: OVERNIGHT, exp_id: 'overnight_v0_fixture', spec_sha256: SPEC_SHA, strategy: 'overnight', variant: 'repaired', start: '2010-09-28', end: '2022-01-01', params: { exit_at: 'open_tick' } },
    { ...OFFERED, preset_id: DTS, exp_id: null, spec_sha256: null, strategy: 'dtsmom', variant: 'vendor', start: '2012-01-03', end: '2012-01-25', params: { ticks: 1 } },
  ],
  strategies: [
    { strategy: 'overnight', params: [{ ...FIELD, name: 'exit_at', kind: 'str', default: 'close', choices: ['close', 'open_tick'] }] },
    { strategy: 'dtsmom', params: [{ ...FIELD, name: 'ticks', kind: 'int', required: true, minimum: 0, maximum: 2, feed_key: true }] },
  ],
}
const JOBS_ON = { jobs: [], queue_cap: 10, queued: 0, running: 0, enabled: true }
const QUEUED_JOB = {
  id: 'j_000000000001',
  run_id: 't_overnight_v0_fixture_9',
  state: 'queued',
  spec: { strategy: 'overnight', params: { exit_at: 'close' }, variant: 'repaired', start: '2010-09-28', end: '2022-01-01', run_id: 't_overnight_v0_fixture_9' },
  created: '2026-10-05T00:00:00+00:00',
  started: null,
  finished: null,
  exit_code: null,
  message: '',
  log_tail: [],
}
const RESULT = {
  kind: 'backtest',
  job: QUEUED_JOB,
  action: { kind: 'backtest', preset_id: OVERNIGHT, params: { exit_at: 'close' }, start: '2010-09-28', end: '2022-01-01', run_id: 't_overnight_v0_fixture_9' },
  preset_id: OVERNIGHT,
  base_run_id: null,
  changed_params: ['exit_at'],
}

interface Posted {
  readonly method: string
  readonly path: string
  readonly header: string | undefined
  readonly contentType: string | undefined
  readonly body: unknown
}

const commandLine = (page: Page): Locator => page.getByRole('combobox', { name: 'Command line' })
const panel = (page: Page, title: string): Locator => page.locator(`[data-nqt-title="${title}"]`)

/** Answers the presets and the jobs list, and records every write; the actions route queues a fixed job. */
async function stubLaunchRoutes(page: Page): Promise<Posted[]> {
  const posted: Posted[] = []
  await page.route((url) => url.pathname === '/api/jobs/actions/presets', (route) => route.fulfill({ json: PRESETS }))
  await page.route((url) => url.pathname === '/api/jobs', (route) => route.fulfill({ json: JOBS_ON }))
  await page.route((url) => url.pathname === '/api/jobs/actions', async (route) => {
    const request: Request = route.request()
    posted.push({ method: request.method(), path: new URL(request.url()).pathname, header: request.headers()['x-nqt'], contentType: request.headers()['content-type'], body: request.postDataJSON() as unknown })
    await route.fulfill({ status: 201, json: RESULT })
  })
  return posted
}

async function runCommand(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(commandLine(page)).toBeFocused()
  await commandLine(page).fill(line)
  await commandLine(page).press('Enter')
}

async function openScreen(page: Page, line: string, title: string): Promise<Locator> {
  await page.goto('/')
  await expect(page.locator('[data-nqt-title]').first()).toBeVisible({ timeout: 45_000 })
  await runCommand(page, line)
  const target = panel(page, title)
  await expect(target).toBeVisible()
  return target
}

async function chooseAction(page: Page, target: Locator, item: RegExp): Promise<void> {
  const actions = target.getByRole('button', { name: /Actions/ })
  await actions.click()
  await page.getByRole('menuitem', { name: item }).click()
}

test.beforeEach(async ({ page }) => {
  await dismissOrientation(page)
})

test.describe('Start from in LEDG', () => {
  test('opens from the newest row, changes a parameter with the keys alone, launches with one POST and stays accessible', async ({ page }) => {
    const watch = await watchGallery(page)
    const posted = await stubLaunchRoutes(page)
    const target = await openScreen(page, 'LEDG', 'LEDG')
    await expect(target.getByRole('grid', { name: /Run ledger/ })).toBeVisible()
    await chooseAction(page, target, /Start a run from the newest row/)

    const form = target.getByRole('region', { name: /Start a run from overnight_v0_fixture, overnight, repaired, 2010-09-28 to 2022-01-01/ })
    await expect(form).toBeVisible()
    const exitAt = form.getByRole('combobox', { name: 'exit_at' })
    await expect(exitAt).toBeFocused()
    await expect(exitAt).toContainText('open_tick')
    await expect(form.getByText('Starting from overnight_v0_fixture.')).toBeVisible()
    await expect(form.getByText('On spec: this run repeats the preset exactly.')).toBeVisible()
    await expect(form.getByLabel('Run id', { exact: true })).toHaveValue('t_overnight_v0_fixture_1')
    await expect(form.getByRole('button', { name: 'Launch' })).toBeEnabled()
    await expectGalleryAxeClean(page)

    // The keys alone: Enter opens the picker, Up moves to close, Enter chooses it.
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(exitAt).toContainText('close')
    await expect(form.getByText('CHANGED from the preset (open_tick)')).toBeVisible()
    await expect(form.getByText(/^OFF SPEC: this run differs from the preset/)).toBeVisible()
    await expect(form.getByRole('button', { name: 'Launch' })).toBeEnabled()

    // A bad run id is named next to its field and holds Launch back until it is fixed.
    const runId = form.getByLabel('Run id', { exact: true })
    await runId.fill('x')
    await expect(runId).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByText(/The run id must be t_ followed by/)).toBeVisible()
    await expect(form.getByText('Fix 1 problem before the run can be launched.')).toBeVisible()
    await expect(form.getByRole('button', { name: 'Launch' })).toBeDisabled()
    await expectGalleryAxeClean(page)

    await runId.fill('t_overnight_v0_fixture_9')
    await expect(runId).not.toHaveAttribute('aria-invalid', 'true')
    await runId.press('Control+Enter')
    await expect(form.getByText('Queued t_overnight_v0_fixture_9. It runs in the backtest queue.')).toBeVisible()
    await expect(form.getByRole('button', { name: 'Open JOBS' })).toBeFocused()
    await expectGalleryAxeClean(page)

    expect(posted).toEqual([
      {
        method: 'POST',
        path: '/api/jobs/actions',
        header: '1',
        contentType: 'application/json',
        body: { kind: 'backtest', preset_id: OVERNIGHT, params: { exit_at: 'close' }, start: null, end: null, run_id: 't_overnight_v0_fixture_9' },
      },
    ])
    const writes = watch.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${new URL(r.url()).pathname}`)
    expect(writes).toEqual(['POST /api/jobs/actions'])
    expect(watch.errors).toEqual([])

    await form.getByRole('button', { name: 'Open JOBS' }).press('Enter')
    await expect(panel(page, 'JOBS')).toBeVisible()
  })

  test('Escape closes the form and hands the focus back to the Actions button', async ({ page }) => {
    await stubLaunchRoutes(page)
    const target = await openScreen(page, 'LEDG', 'LEDG')
    await chooseAction(page, target, /Start a run from the newest row/)
    const form = target.getByRole('region', { name: /Start a run from overnight_v0_fixture/ })
    await expect(form.getByRole('combobox', { name: 'exit_at' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(target.getByRole('button', { name: /Actions/ })).toBeFocused()
  })
})

test.describe('Start from in RUN', () => {
  test('opens from the run configuration and closes with Escape', async ({ page }) => {
    const posted = await stubLaunchRoutes(page)
    const target = await openScreen(page, `${DTS} RUN`, `${DTS} RUN`)
    await expect(target.getByTestId('balance-summary')).toBeVisible()
    await chooseAction(page, target, /Start a run from this run/)
    const form = target.getByRole('region', { name: new RegExp(`Start a run from ${DTS}, dtsmom, vendor`) })
    await expect(form).toBeVisible()
    await expect(form.getByLabel('ticks', { exact: true })).toHaveValue('1')
    await expect(form.getByLabel('Run id', { exact: true })).toHaveValue(`t_${DTS}_1`)
    await expect(form.getByText(/^OFF SPEC: no spec hash backs this preset/)).toBeVisible()
    await expectGalleryAxeClean(page)
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(target.getByRole('button', { name: /Actions/ })).toBeFocused()
    expect(posted).toEqual([])
  })
})

for (const win of [{ width: 683, height: 384 }, { width: 512, height: 320 }] as const) {
  test.describe(`200% zoom in a ${win.width * 2} x ${win.height * 2} window`, () => {
    test.use({ viewport: win, deviceScaleFactor: 2 })

    test('the open form scrolls nothing sideways, overlaps nothing and cuts nothing off', async ({ page }) => {
      await stubLaunchRoutes(page)
      const target = await openScreen(page, 'LEDG', 'LEDG')
      const id = await target.getAttribute('data-nqt-panel')
      const toggle = target.getByRole('button', { name: 'Maximise panel' })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await chooseAction(page, target, /Start a run from the newest row/)
      await expect(target.getByRole('region', { name: /Start a run from/ })).toBeVisible()
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
      const scope = `[data-nqt-panel="${id}"]`
      expect(await sidewaysIn(page, scope)).toEqual([])
      expect(await overlapsIn(page, scope)).toEqual([])
      expect(await cutOffIn(page, scope)).toEqual([])
    })
  })
}
