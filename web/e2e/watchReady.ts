// The record watch's segment joins the status line once HOME's own queries have gone quiet (W5C D5: no fetch in flight for
// 500 ms, then an idle moment, at the latest 12 s after the reader mounts), and the segments after it move along. A
// baseline of a whole page was taken with the segment in place, so the spec waits for it before the screenshot instead of
// relying on how fast the page happened to load.
import { expect, type Page } from '@playwright/test'

/** The longest the spec waits: the reader's own ceiling (12 s) plus the load and the idle moment before it. */
const WATCH_TIMEOUT_MS = 30_000

/** Waits until the status line shows the record watch segment (WATCH and its state, in any state). */
export async function expectWatchSegment(page: Page, timeout: number = WATCH_TIMEOUT_MS): Promise<void> {
  await expect(page.getByRole('contentinfo').locator('.seg', { hasText: /^WATCH/ })).toBeVisible({ timeout })
}
