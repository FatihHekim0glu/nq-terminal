// The key actions on demand (v2.1 polish, SHELL-DIET-4). What a toolbar button, the nav toolbar or a global key does
// (KeyToolbar.actions.ts: help, back, page, panel focus, the favourites list) runs only when someone presses a key or clicks,
// so that module loads as a chunk of its own and the first-paint shell carries this small facade instead. The facade
// fetches the module once, after the first idle moment (preload) or at the first key, whichever comes first, and builds the
// actions from it once. A key pressed after that runs at once, in the same tick, exactly as before. A key pressed before
// it runs as soon as the module has arrived, in the order pressed, so none is lost. A chunk that cannot be fetched is
// reported on the message line and the next key tries again; the terminal stays up. Nothing here reads, places or changes
// anything: it only forwards to the module that does the (read-only) work.
import { MESSAGES } from '../copy/chrome'
import type { GlobalKeyAction } from './CommandLine.keys'
import type { ChromeActions, ChromeEnv } from './KeyToolbar.actions'
import type { KeyId } from './KeyToolbar'
import { postMessage } from './MessageLine.store'
import type { NavAction } from './NavToolbar'

type ActionsModule = typeof import('./KeyToolbar.actions')

/** The module, fetched once; a failed fetch is forgotten so the next key tries again. */
let moduleLoad: Promise<ActionsModule> | null = null
let loaded: ActionsModule | null = null

/** Starts (or joins) the fetch of the key actions module. */
export function loadKeyActions(): Promise<ActionsModule> {
  moduleLoad ??= import('./KeyToolbar.actions').then(
    (m) => (loaded = m),
    (error: unknown) => {
      moduleLoad = null
      throw error
    },
  )
  return moduleLoad
}

/** What the frame's components ask of the chrome's actions; each runs now if the module is here, else once it arrives. */
export interface LazyChrome {
  /** A key toolbar button (runKey). */
  key(key: KeyId): void
  /** A nav toolbar control (runNav). */
  nav(action: NavAction): void
  /** A global key (runGlobalKey). */
  global(action: GlobalKeyAction): void
  /** Run a line through the command line and give it focus (a frame strip action). */
  runAndFocus(line: string): void
  /** BACK or FORWARD in the focused panel. */
  back(forward: boolean): void
  /** Start fetching the module (the first idle moment); a failure here is silent, the first key reports it. */
  preload(): void
}

export function createLazyChrome(env: ChromeEnv): LazyChrome {
  let actions: ChromeActions | null = null
  let waiting = 0
  let chain: Promise<void> = Promise.resolve()
  const actionsOf = (m: ActionsModule): ChromeActions => (actions ??= m.createChromeActions(env))
  const use = (run: (m: ActionsModule, a: ChromeActions) => void): void => {
    if (loaded !== null && waiting === 0) {
      run(loaded, actionsOf(loaded))
      return
    }
    waiting += 1
    chain = chain.then(async () => {
      const m = await loadKeyActions().catch(() => null)
      try {
        if (m === null) postMessage(MESSAGES.keysFailed)
        else run(m, actionsOf(m))
      } catch (error: unknown) {
        // A failure in the action itself reaches the console as it would from an event handler, and the queue goes on.
        setTimeout(() => {
          throw error
        })
      } finally {
        waiting -= 1
      }
    })
  }
  return {
    key: (key) => use((m, a) => m.runKey(a, env, key)),
    nav: (action) => use((m, a) => m.runNav(a, env, action)),
    global: (action) => use((m, a) => m.runGlobalKey(a, env, action)),
    runAndFocus: (line) => use((_m, a) => a.runAndFocus(line)),
    back: (forward) => use((_m, a) => a.back(forward)),
    preload: () => void loadKeyActions().catch(() => undefined),
  }
}
