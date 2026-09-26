// Number <GO> plumbing for one panel (look spec 5.1 item 5). The parts of a panel (red bar,
// tabs, the related functions menu) each offer numbered items; PanelChrome collects them and makes
// one registration per panel through the registrar in NumberingContext, which the Workspace wires to
// NumberedActions.registerNumbered. While the related functions menu is open its numbers shadow the
// rest, as the menu is what the user is reading. Outside a panel, a part registers directly.
import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react'

export interface NumberedItem {
  readonly n: number
  readonly label: string
  readonly run: () => void
}

export type Registrar = (panelId: string, items: ReadonlyArray<NumberedItem>) => () => void

const noRegistrar: Registrar = () => () => {}

export const NumberingContext = createContext<Registrar>(noRegistrar)

export interface NumberCollector {
  set(source: string, items: ReadonlyArray<NumberedItem> | null): void
}

export const CollectorContext = createContext<NumberCollector | null>(null)

export const MENU_SOURCE = 'menu'

/** One list for the panel: the menu's items while it is open, else every source's, first number wins. */
export function mergeNumbered(sources: ReadonlyMap<string, ReadonlyArray<NumberedItem>>): NumberedItem[] {
  const menu = sources.get(MENU_SOURCE)
  if (menu && menu.length > 0) return [...menu]
  const seen = new Set<number>()
  const out: NumberedItem[] = []
  for (const [source, items] of sources) {
    if (source === MENU_SOURCE) continue
    for (const item of items) {
      if (seen.has(item.n)) continue
      seen.add(item.n)
      out.push(item)
    }
  }
  return out.sort((a, b) => a.n - b.n)
}

function signature(items: ReadonlyArray<NumberedItem>): string {
  return items.map((i) => `${i.n}\u0000${i.label}`).join('\u0001')
}

/**
 * Offers `items` as the numbered items of `source` in panel `panelId`. The registration changes only
 * when the numbers or labels do; `run` always calls the latest closure.
 */
export function useNumbered(panelId: string, source: string, items: ReadonlyArray<NumberedItem>): void {
  const collector = useContext(CollectorContext)
  const registrar = useContext(NumberingContext)
  const latest = useRef(items)
  useLayoutEffect(() => {
    latest.current = items
  })
  const key = signature(items)
  useEffect(() => {
    const stable = latest.current.map((item) => ({
      n: item.n,
      label: item.label,
      run: () => latest.current.find((i) => i.n === item.n)?.run(),
    }))
    if (collector) {
      collector.set(source, stable)
      return () => collector.set(source, null)
    }
    if (stable.length === 0) return undefined
    return registrar(panelId, stable)
  }, [collector, registrar, panelId, source, key])
}
