// The command line's numbered menus and suggestion sheet on demand (v2.1 polish, SHELL-DIET-4). The builders
// (CommandLine.menus.ts: a context's functions, the sector menus, LAST, MENU, one function's help and HL results), the menu
// sheet that draws a menu (CommandLine.menu.tsx) and the suggestion sheet (CommandLine.sheet.tsx) are needed only once
// someone opens one, so they load as chunks of their own and the first-paint shell carries this loader instead. The command line starts the fetch as it mounts (preloadMenus), so by
// the time anyone has typed a context and pressed Enter the code is here and a menu opens in the same tick, as before.
// A menu asked for before the chunk has arrived opens as soon as it does, in the order asked; a sheet is drawn as soon as it has arrived. A chunk that cannot be
// fetched is reported on the message line, the line stays as typed, and the next menu tries again.
import { useEffect, useState, type ComponentType } from 'react'
import { MESSAGES } from '../copy/chrome'
import type { MenuSheetProps } from './CommandLine.menu'
import type { SheetProps } from './CommandLine.sheet'
import { postMessage } from './MessageLine.store'

type MenusModule = typeof import('./CommandLine.menus')
type MenuSheetModule = typeof import('./CommandLine.menu')
type SuggestionSheetModule = typeof import('./CommandLine.sheet')

/** One fetched-once chunk: `load` starts or joins the fetch, `loaded` is the module once it is here. A failed fetch is forgotten. */
function onDemand<T>(fetchModule: () => Promise<T>) {
  let loaded: T | null = null
  let pending: Promise<T> | null = null
  const load = (): Promise<T> => {
    pending ??= fetchModule().then(
      (m) => (loaded = m),
      (error: unknown) => {
        pending = null
        throw error
      },
    )
    return pending
  }
  return { load, loaded: (): T | null => loaded }
}

const menus = onDemand<MenusModule>(() => import('./CommandLine.menus'))
const sheet = onDemand<MenuSheetModule>(() => import('./CommandLine.menu'))
const suggestions = onDemand<SuggestionSheetModule>(() => import('./CommandLine.sheet'))

/** The builders' module, fetched once. */
export const loadMenus = menus.load
export const loadMenuSheet = sheet.load
export const loadSuggestionSheet = suggestions.load

/** Starts the three fetches (as the command line mounts); a failure is silent here, the first menu asked for reports it. */
export function preloadMenus(): void {
  void menus.load().catch(() => undefined)
  void sheet.load().catch(() => undefined)
  void suggestions.load().catch(() => undefined)
}

/** Runs `run` with the builders: now when they are here, else as soon as they arrive. */
export function withMenus(run: (m: MenusModule) => void): void {
  const here = menus.loaded()
  if (here !== null) {
    run(here)
    return
  }
  menus.load().then(run, () => postMessage(MESSAGES.menusFailed))
}

/** A component of a chunk fetched on demand: null until it has loaded (the fetch starts at the first render that finds it missing). */
function useOnDemandComponent<T, P>(source: { load: () => Promise<T>; loaded: () => T | null }, pick: (m: T) => ComponentType<P>): ComponentType<P> | null {
  const [component, setComponent] = useState<ComponentType<P> | null>(() => {
    const here = source.loaded()
    return here === null ? null : pick(here)
  })
  useEffect(() => {
    if (component !== null) return undefined
    let live = true
    source.load().then(
      (m) => {
        if (live) setComponent(() => pick(m))
      },
      () => postMessage(MESSAGES.menusFailed),
    )
    return () => {
      live = false
    }
  }, [component, source, pick])
  return component
}

const pickMenuSheet = (m: MenuSheetModule): ComponentType<MenuSheetProps> => m.MenuSheet
const pickSuggestionSheet = (m: SuggestionSheetModule): ComponentType<SheetProps> => m.Sheet

/** The menu sheet component once it has loaded, else null. */
export const useMenuSheet = (): ComponentType<MenuSheetProps> | null => useOnDemandComponent(sheet, pickMenuSheet)

/** The suggestion sheet component once it has loaded, else null. */
export const useSuggestionSheet = (): ComponentType<SheetProps> | null => useOnDemandComponent(suggestions, pickSuggestionSheet)

/** Resolves once all three chunks are here (tests wait for it so a menu or a sheet is drawn in the same tick, as the app does after the first idle moment). */
export function loadCommandLineParts(): Promise<unknown> {
  return Promise.all([menus.load(), sheet.load(), suggestions.load()])
}
