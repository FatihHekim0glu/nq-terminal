// The panel's export (roadmap 15): the Options rows "Grab as image" and "Copy image", and the runner
// behind them and behind GRAB <GO>; and, for a panel whose screen registered a dossier, the rows "Evidence
// pack (HTML)" (roadmap 15 part 2) and "Print dossier" (roadmap 15 part 3). The Workspace is the one
// importer of this file, so it loads with the Workspace chunk and never with the first paint. The grab
// itself (src/export/grab/run.ts, with its compose and caption code), the pack (src/export/pack/run.ts,
// with the dossier model and the HTML writer) and the print dossier (src/export/print/run.tsx, with its
// page and stylesheet) are reached only through the dynamic imports below, never a static one. Copy image
// needs the clipboard write to start inside the click (Safari refuses it after an await), and the grab is
// synchronous up to that write, so its chunk is warmed when the Options rows are built (the menu opening)
// and a click on a warm runner calls it at once; the pack chunk is warmed the same way, so its download
// also starts inside the click. The print chunk is not warmed: the print runner waits for the page to
// paint before it opens the dialog, so no click is needed for it, and its stylesheet then loads only when
// a dossier is printed, never because a menu opened. Nothing here makes a request: the health answer is
// read from the cache the status line already fills.
import type { QueryClient } from '@tanstack/react-query'
import { getBridge } from '../bridge'
import { apiQueryKey } from '../api/queryKey'
import type { SuccessOf } from '../api/types'
import { DOSSIER } from '../copy/dossier'
import { GRAB } from '../copy/grab'
import { fillCopy } from '../copy/workspace'
import type { HealthLite } from '../export/grab/run'
import type { MenuEntry } from './FunctionBar.menu'
import { postMessage } from './MessageLine.store'
import { panelDossier } from './panelSources'

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

/** A lazily imported runner: warm once its chunk has loaded, so a click can call it at once. */
interface LazyRunner<T> {
  /** The module once its chunk has loaded, else null. */
  current(): T | null
  /** The load in flight or done; cleared when it fails, so the next attempt imports again. */
  load(): Promise<T>
  /** Forgets the loaded module and any load in flight (tests). */
  reset(): void
}

function lazyRunner<T>(importer: () => Promise<T>): LazyRunner<T> {
  let loaded: T | null = null
  let loading: Promise<T> | null = null
  return {
    current: () => loaded,
    load() {
      if (loading === null) {
        const attempt: Promise<T> = importer().then(
          (m) => {
            loaded = m
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
    },
    reset() {
      loaded = null
      loading = null
    },
  }
}

const grabRunner = lazyRunner(() => import('../export/grab/run'))
const packRunner = lazyRunner(() => import('../export/pack/run'))
const printRunner = lazyRunner(() => import('../export/print/run'))

/** Forgets the loaded grab runner and any load in flight (tests). */
export function resetGrabRunner(): void {
  grabRunner.reset()
}

/** Forgets the loaded pack runner and any load in flight (tests). */
export function resetPackRunner(): void {
  packRunner.reset()
}

/** Forgets the loaded print runner and any load in flight (tests). */
export function resetPrintRunner(): void {
  printRunner.reset()
}

/**
 * Calls `call` on the runner and says on the message line (with `failed`) when the chunk cannot load or the
 * runner breaks. Resolves when done and never rejects. With the runner already loaded, `call` runs before
 * this function returns.
 */
function runWith<T>(lazy: LazyRunner<T>, call: (runner: T) => Promise<unknown>, failed: string): Promise<void> {
  let pending: Promise<unknown>
  try {
    const warm = lazy.current()
    pending = warm ? call(warm) : lazy.load().then(call)
  } catch (error) {
    pending = Promise.reject(error)
  }
  return pending.then(
    () => undefined,
    (error: unknown) => postMessage(fillCopy(failed, { detail: reason(error) }), 'error'),
  )
}

/**
 * Grabs the panel through the lazy runner and says what happened on the message line (the runner does, and
 * this does when the chunk cannot load or the runner breaks). Resolves when done and never rejects. With the
 * runner already loaded, grabPanel is called before this function returns.
 */
export function runGrab(target: PanelExportTarget, health: HealthLite | null, where: GrabTarget): Promise<void> {
  const request = { ...target, health, target: where }
  return runWith(grabRunner, (m) => m.grabPanel(request), GRAB.failed)
}

/**
 * Saves the panel's evidence pack through the lazy runner (which says what happened on the message line, as
 * this does when the chunk cannot load or the runner breaks). Resolves when done and never rejects. With the
 * runner already loaded, packPanel is called before this function returns.
 */
export function runPack(target: PanelExportTarget, health: HealthLite | null): Promise<void> {
  const request = { panelId: target.panelId, health }
  return runWith(packRunner, (m) => m.packPanel(request), DOSSIER.failed)
}

/**
 * Opens the print dialog for the panel's dossier through the lazy runner (which says what happened on the
 * message line, as this does when the chunk cannot load or the runner breaks). Resolves when done and never
 * rejects. With the runner already loaded, printPanel is called before this function returns.
 */
export function runPrint(target: PanelExportTarget, health: HealthLite | null): Promise<void> {
  const request = { panelId: target.panelId, health }
  return runWith(printRunner, (m) => m.printPanel(request), DOSSIER.failed)
}

/**
 * The Options rows for one panel: Grab as image, Copy image where the browser can, and, where the panel's
 * screen registered a dossier, Evidence pack (HTML) and Print dossier after it. `health` is read when a row
 * is chosen, so the caption carries the server clock as it is then. Where Copy image or the pack is offered,
 * its chunk is warmed now (a failure is silent here; the click that follows loads it again and reports).
 * The print chunk is loaded only when its row is chosen.
 */
export function panelExportEntries(target: PanelExportTarget, health: () => HealthLite | null): MenuEntry[] {
  const entries: MenuEntry[] = [{ label: GRAB.menuImage, onSelect: () => void runGrab(target, health(), 'file') }]
  // Copy image needs a clipboard that takes images (asked of the bridge); a browser without one shows only Grab as image.
  if (getBridge().canCopyImage()) {
    entries.push({ label: GRAB.menuCopy, onSelect: () => void runGrab(target, health(), 'clipboard') })
    void grabRunner.load().catch(() => undefined)
  }
  if (panelDossier(target.panelId) !== null) {
    entries.push({ label: DOSSIER.menuPack, onSelect: () => void runPack(target, health()) })
    void packRunner.load().catch(() => undefined)
    entries.push({ label: DOSSIER.menuPrint, onSelect: () => void runPrint(target, health()) })
  }
  return entries
}
