// HELP's third-party notices in the app. The shell denies every new window except the chart library's attribution link, so the
// notices are an in-page disclosure: activating it by keyboard shows the generated file in a labelled region, same-origin,
// with no new window, no dialog and no failed request (WCAG 4.1.3, 3.2.2). The component test is
// src/screens/help/HelpScreen.platform.test.tsx.
import { expect, test } from './fixtures.ts'
import { expectClean, open, openHome, watch } from './app.ts'

test.describe('HELP third-party notices', () => {
  test('the notices button shows the file in the page, with no new window', async ({ page, run }) => {
    const w = watch(page)
    await openHome(page, { dismissed: true })
    const help = await open(page, 'HELP')
    const button = help.getByRole('button', { name: 'Third-party notices (text file)' })
    await button.scrollIntoViewIfNeeded()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    const popups: string[] = []
    page.context().on('page', (p) => popups.push(p.url()))
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const region = help.getByRole('region', { name: 'Third-party notices text' })
    await expect(region).toBeVisible()
    await expect(region).toContainText('PACKAGES')
    expect(popups, 'no window opened').toEqual([])
    expectClean(w, run.origin)
  })
})
