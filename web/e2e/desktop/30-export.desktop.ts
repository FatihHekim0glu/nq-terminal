// A blob export and a text copy in the app (04 D5.2; 03 sections 4.5 and 15.4).
//
// Export: the page makes an object-URL link and clicks it (src/bridge saveFile); the shell's DownloadStarting handler takes
// the download, writes it into `--save-dir` with no dialog and cancels the engine's own save, so the file lands only there.
// The owner's Downloads folder must not change. Copy: the page's Copy button puts the ledger command on the Windows
// clipboard through the Clipboard API; the test reads the clipboard back with PowerShell and gives the owner's own text back.
import fs from 'node:fs'
import path from 'node:path'
import { readClipboardText, writeClipboardText } from './clipboard.ts'
import { expect, test } from './fixtures.ts'
import { expectClean, open, openHome, watch, withFocusEmulation } from './app.ts'

const EXPORT_LINE = 'smoke_2015_01 EQ'
const EXPORT_NAME = 'smoke_2015_01_EQ.csv'
const EXPORT_HEADER = 'date,equity,bench,perf_diff'
const COPY_LINE = 'nt_dtsmom_v0_fixture_ts1 RUN'
const COPIED_WORDS = 'Ledger command copied.'
const SAVE_WAIT_MS = 20_000

const downloadsFolder = (): string => path.join(process.env.USERPROFILE ?? '', 'Downloads')

function listing(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort()
  } catch {
    return []
  }
}

test.describe('export and copy', () => {
  test('a blob export lands in --save-dir and nowhere else', async ({ page, run }) => {
    const w = watch(page)
    const ownerBefore = listing(downloadsFolder())
    await openHome(page)
    const eq = await open(page, EXPORT_LINE)
    await expect(eq.getByText(/Lower pane: performance difference/)).toBeVisible()
    await eq.getByRole('button', { name: /98\) Export/ }).click()
    const saved = path.join(run.saveDir, EXPORT_NAME)
    await expect.poll(() => fs.existsSync(saved), { message: `${saved} written`, timeout: SAVE_WAIT_MS }).toBe(true)
    const text = fs.readFileSync(saved, 'utf8')
    expect(text.split('\r\n')[0]).toBe(EXPORT_HEADER)
    expect(listing(run.saveDir), 'what --save-dir holds').toEqual([EXPORT_NAME])
    expect(listing(downloadsFolder()), "the owner's Downloads folder").toEqual(ownerBefore)
    expectClean(w, run.origin)
  })

  test('a text copy puts the ledger command on the Windows clipboard', async ({ page, run }) => {
    const w = watch(page)
    const owners = readClipboardText()
    try {
      await openHome(page)
      const body = await open(page, COPY_LINE)
      const command = (await body.getByTestId('ledger-command').textContent())?.trim() ?? ''
      expect(command, 'the ledger command on screen').not.toBe('')
      writeClipboardText('')
      await withFocusEmulation(page, async () => {
        await body.getByRole('button', { name: 'Copy the ledger command' }).click()
        await expect(page.locator('.msg-line[role="status"]')).toHaveText(COPIED_WORDS)
      })
      await expect.poll(() => readClipboardText(), { message: 'the clipboard text', timeout: 10_000 }).toBe(command)
    } finally {
      writeClipboardText(owners)
    }
    expectClean(w, run.origin)
  })
})
