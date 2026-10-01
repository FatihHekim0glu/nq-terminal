// The first-run orientation line (N03) shows on HOME for a viewer who has not dismissed it and adds a row of its
// own (29 px) and four Tab stops between the command line and the first panel. The specs that measure the bare
// HOME frame (the frame stack, the MON row budget, the Ctrl+K then Tab walk to the first panel) start with it
// dismissed, the way a returning viewer has it. The specs about the line itself (home.spec.ts, shell.spec.ts)
// do not use this. A spec cannot import from src, so the key is restated here and
// src/screens/home/orientationE2eKey.test.ts pins it to src/screens/home/HomeOrientation.tsx.
import type { Page } from '@playwright/test'

export const ORIENTATION_KEY = 'nqt.orientation'
export const ORIENTATION_DISMISSED = '1'

/** Mark the line dismissed in this page's storage before any page script runs (every load of the page). */
export async function dismissOrientation(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Storage blocked: the line shows, which is the viewer's default.
      }
    },
    [ORIENTATION_KEY, ORIENTATION_DISMISSED] as const,
  )
}
