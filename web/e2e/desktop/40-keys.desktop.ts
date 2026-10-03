// F1 and F8 to F11 in the app (04 D5.2; 03 section 11): sent over the debugging protocol, each reaches the page, the page
// prevents its default and does what the key is for, and the engine does nothing of its own (the shell turns the browser's
// accelerators off): the page is the same, no new target, no full screen, no dialog. F8 to F11 put Equity, Comdty, Index
// and Curncy in the command line; F1 once opens the focused screen's help, twice quickly the HELP index (the same checks as
// e2e/keys.spec.ts, in the app).
//
// Keys sent over the protocol do not take the host's own accelerator path (W0A P1), so the real-keyboard effect of the 16
// keys stays the owner's check (desktop-v0.1 G2); the shell's key-to-zoom mapping is covered by its unit tests.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'
import { commandLine, expectClean, openHome, watch } from './app.ts'

const SECTOR_KEYS = [['F8', ' Equity'], ['F9', ' Comdty'], ['F10', ' Index'], ['F11', ' Curncy']] as const
const NO_EQUITIES = 'No equities in nq-lab: Equity is accepted but matches nothing.'

interface KeySeen {
  readonly key: string
  readonly prevented: boolean
}

async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: KeySeen[] = []
    Object.defineProperty(window, '__nqtKeys', { value: seen, configurable: true })
    window.addEventListener('keydown', (e) => seen.push({ key: e.key, prevented: e.defaultPrevented }))
  })
}

const lastKey = (page: Page): Promise<KeySeen | undefined> =>
  page.evaluate(() => (window as unknown as { __nqtKeys: KeySeen[] }).__nqtKeys.at(-1))

async function focusFirstPanel(page: Page): Promise<void> {
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-nqt-panel]').first().locator(':focus')).toHaveCount(1)
}

/** Everything the engine has open: the page targets' addresses, as they are now. */
const targets = (page: Page): string[] => page.context().pages().map((p) => p.url()).sort()

async function expectNoEngineAction(page: Page, before: string[], dialogs: string[]): Promise<void> {
  expect(targets(page), 'the engine opened or navigated a page').toEqual(before)
  expect(await page.evaluate(() => document.fullscreenElement), 'full screen').toBeNull()
  expect(dialogs, 'a dialog').toEqual([])
}

test.describe('F-keys', () => {
  for (const [key, suffix] of SECTOR_KEYS) {
    test(`${key} inserts${suffix}, prevented, with no action of the engine`, async ({ page, run }) => {
      const w = watch(page)
      const dialogs: string[] = []
      const onDialog = (d: { message(): string; dismiss(): Promise<void> }): void => { dialogs.push(d.message()); void d.dismiss() }
      page.on('dialog', onDialog)
      try {
        await openHome(page, { dismissed: true })
        await recordKeys(page)
        const before = targets(page)
        await page.keyboard.press('Control+k')
        await page.keyboard.type('nq1')
        await page.keyboard.press(key)
        expect(await lastKey(page), `${key} as the page saw it`).toEqual({ key, prevented: true })
        await expect(commandLine(page)).toHaveValue(`NQ1${suffix}`)
        await expect(commandLine(page)).toBeFocused()
        if (key === 'F8') await expect(page.locator('.msg-line[role="status"]')).toHaveText(NO_EQUITIES)
        await expectNoEngineAction(page, before, dialogs)
      } finally {
        page.off('dialog', onDialog)
      }
      expectClean(w, run.origin)
    })
  }

  test('F1 once opens the focused screen help; twice opens the HELP index', async ({ page, run }) => {
    const w = watch(page)
    await openHome(page, { dismissed: true })
    await focusFirstPanel(page)
    await recordKeys(page)
    const before = targets(page)
    await page.keyboard.press('F1')
    expect(await lastKey(page), 'F1 as the page saw it').toEqual({ key: 'F1', prevented: true })
    await expect(page.getByRole('listbox', { name: /^GP/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('F1')
    await page.keyboard.press('F1')
    // The HELP index opens as its own panel beside the HOME ones, so the screen label stays HOME.
    await expect(page.locator('[data-nqt-title="HELP"]')).toHaveCount(1)
    await expect(page.getByRole('contentinfo')).toContainText('Screen HOME')
    await expectNoEngineAction(page, before, [])
    expectClean(w, run.origin)
  })
})
