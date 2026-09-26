// Tab strips (look spec 4.4). `top`: trapezoid tabs whose right edge slants out 5px, active
// grey with black text, inactive dark grey, on a black strip. `sub`: the flat sub-tab strip on the
// active-tab grey, active sub-tab in selection blue. Labels are numbered (`1) Equity`); each tab is a
// numbered item (Number <GO>) and a roving item of its panel, so Left and Right move between tabs.
// Inside a panel the strip renders into the panel's tab slot, under the red bar.
import type { KeyboardEvent } from 'react'
import { useNumbered } from './PanelChrome.numbers'
import { useSlot } from './PanelChrome.slots'
import { ROVING_ATTR } from './WorkspaceFocus'
import './TabStrip.css'

export interface TabDef {
  readonly id: string
  readonly label: string
}

export interface TabStripProps {
  readonly panelId: string
  /** Names the tablist. */
  readonly label: string
  readonly tabs: ReadonlyArray<TabDef>
  readonly selected: string
  readonly onSelect: (id: string) => void
  readonly variant?: 'top' | 'sub'
  /** The number of the first tab (sub-tab sets such as `85) All` start higher). */
  readonly start?: number
  /** The id of the element the tabs control. */
  readonly controls?: string
}

const roving = { [ROVING_ATTR]: '' }

export default function TabStrip(props: TabStripProps) {
  const { panelId, label, tabs, selected, onSelect, variant = 'top', start = 1, controls } = props
  const place = useSlot('tabs')
  useNumbered(
    panelId,
    `tabs-${start}`,
    tabs.map((tab, i) => ({ n: start + i, label: tab.label, run: () => onSelect(tab.id) })),
  )
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(id)
  }
  return place(
    <div role="tablist" aria-label={label} className={`tabs tabs-${variant}`}>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab.id === selected}
          aria-controls={controls}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(e) => onKeyDown(e, tab.id)}
          {...roving}
        >
          {`${start + i}) ${tab.label}`}
        </button>
      ))}
    </div>,
  )
}
