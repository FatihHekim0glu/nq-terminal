// The panel's image export (roadmap 15): the Options rows "Grab as image" and "Copy image", and the runner
// behind them and behind GRAB <GO>. The Workspace is the one importer of this file, so it loads with the
// Workspace chunk and never with the first paint. The grab itself (src/export/grab/run.ts, with its
// compose and caption code) is reached only through the dynamic import below, never a static one. Copy
// image needs the clipboard write to start inside the click (Safari refuses it after an await), and the
// grab is synchronous up to that write, so the chunk is warmed when the Options rows are built (the menu
// opening) and a click on a warm runner calls it at once. Nothing here makes a request: the health answer
// is read from the cache the status line already fills.
import type { QueryClient } from '@tanstack/react-query'
import { apiQueryKey } from '../api/queryKey'
import type { SuccessOf } from '../api/types'
import { GRAB } from '../copy/grab'
import { fillCopy } from '../copy/workspace'
import type { HealthLite } from '../export/grab/run'
import type { MenuEntry } from './FunctionBar.menu'
import { postMessage } from './MessageLine.store'

/** The panel a grab is for: its id, its mnemonic, its number in reading order (null when none) and its link group. */
export interface PanelExportTarget {
  readonly panelId: string
  readonly code: string
  readonly number: number | null
  readonly group: string
}

export type GrabTarget = 'file' | 'clipboard'

/** The target for a panel as the Workspace knows it: a number below 1 (a panel not yet in reading order) is no number. */
export function panelTarget(panelId: string, code: string, number: number, group: string): PanelExportTarget {
  return { panelId, code, number: number > 0 ? number : null, group }
}

/**
 * The cached /api/health answer as GRAB reads it (the server clock and the fixture flag), or null when the
 * cache holds none. A read of the cache only: it never fetches.
 */
export function readHealth(client: Pick<QueryClient, 'getQueryData'> | null | undefined): HealthLite | null {
  const health = client?.getQueryData<SuccessOf<'/api/health'>>(apiQueryKey('/api/health'))
  if (!health) return null
  return { now_utc: health.now_utc ?? null, fixture_mode: health.fixture_mode === true }
}

function reason(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message.trim().replace(/\.+$/, '') : String(error)
}

type GrabRunner = typeof import('../export/grab/run')

/** The runner once its chunk has loaded: a warm one is called inside the click, with nothing awaited. */
let runner: GrabRunner | null = null
/** The load in flight or done; cleared when it fails, so the next attempt imports again. */
let loading: Promise<GrabRunner> | null = null

function loadGrabRunner(): Promise<GrabRunner> {
  if (loading === null) {
    const attempt: Promise<GrabRunner> = import('../export/grab/run').then(
      (m) => {
        runner = m
        return m
      },
      (error: unknown) => {
        if (loading === attempt) loading = null
        throw error
      },
    )
    loading = attempt
  }
  return loading
}

/** Forgets the loaded runner and any load in flight (tests). */
export function resetGrabRunner(): void {
  runner = null
  loading = null
}

/**
 * Grabs the panel through the lazy runner and says what happened on the message line (the runner does, and
 * this does when the chunk cannot load or the runner breaks). Resolves when done and never rejects. With the
 * runner already loaded, grabPanel is called before this function returns.
 */
export function runGrab(target: PanelExportTarget, health: HealthLite | null, where: GrabTarget): Promise<void> {
  const request = { ...target, health, target: where }
  let pending: Promise<unknown>
  try {
    pending = runner ? runner.grabPanel(request) : loadGrabRunner().then((m) => m.grabPanel(request))
  } catch (error) {
    pending = Promise.reject(error)
  }
  return pending.then(
    () => undefined,
    (error: unknown) => postMessage(fillCopy(GRAB.failed, { detail: reason(error) }), 'error'),
  )
}

/** Copy image needs a clipboard that takes images; a browser without one shows only Grab as image. */
function canCopyImage(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'
}

/**
 * The Options rows for one panel: Grab as image, and Copy image where the browser can. `health` is read when
 * a row is chosen, so the caption carries the server clock as it is then. Where Copy image is offered, the
 * grab chunk is warmed now (a failure is silent here; the click that follows loads it again and reports).
 */
export function panelExportEntries(target: PanelExportTarget, health: () => HealthLite | null): MenuEntry[] {
  const entries: MenuEntry[] = [{ label: GRAB.menuImage, onSelect: () => void runGrab(target, health(), 'file') }]
  if (canCopyImage()) {
    entries.push({ label: GRAB.menuCopy, onSelect: () => void runGrab(target, health(), 'clipboard') })
    void loadGrabRunner().catch(() => undefined)
  }
  return entries
}
