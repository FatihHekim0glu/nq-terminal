// Where a screen's quote header, red function bar and tab strip land inside its panel. PanelChrome
// owns three slot elements above the scrolling body; the header parts render into them through a
// portal, so a screen writes them next to its content and they still sit fixed above the body
// (look spec 4.3: title bar, quote header, red bar, tabs, body). Outside a panel they render
// in place.
import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PanelSlots {
  readonly quote: HTMLElement | null
  readonly bar: HTMLElement | null
  readonly tabs: HTMLElement | null
}

export const PanelSlotsContext = createContext<PanelSlots | null>(null)

export function useSlot(name: keyof PanelSlots): (node: ReactNode) => ReactNode {
  const slots = useContext(PanelSlotsContext)
  const target = slots?.[name] ?? null
  return (node) => (target ? createPortal(node, target) : node)
}
