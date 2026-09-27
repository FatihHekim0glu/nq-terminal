// The row drill-down of the futures monitor (look spec 7.7: Enter on a row opens `1) GP  2) GIP  3) DES
// 4) CORR` for that symbol, in the Related Functions style of 4.7, dimming only this panel). A non-modal
// dialog (aria-modal="false") over the panel body: the command line stays usable, and while it is open
// its rows are the panel's numbered items (Number <GO>). A row runs its command line through the
// command bus, so it goes through the same parser and history as typing it. Arrows, Home and End move;
// Enter or Space runs; Escape, the cancel button or a click on the dim closes.
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { MENU_SOURCE, useNumbered } from '../../chrome/PanelChrome.numbers'
import { ROVING_ATTR, ROVING_OVERLAY_ATTR } from '../../chrome/WorkspaceFocus'
import { fillCopy } from '../../copy/workspace'
import '../../chrome/RelatedMenu.css'
import { MON } from './copy'

export interface DrillFunction {
  readonly n: number
  readonly code: string
  readonly title: string
  readonly line: string
}

/** The four functions for one root, numbered 1 to 4; CORR opens the universe matrix. */
export function drillFunctions(root: string): DrillFunction[] {
  return [
    { n: 1, code: 'GP', title: MON.drillGp, line: `${root} GP` },
    { n: 2, code: 'GIP', title: MON.drillGip, line: `${root} GIP` },
    { n: 3, code: 'DES', title: MON.drillDes, line: `${root} DES` },
    { n: 4, code: 'CORR', title: MON.drillCorr, line: '27F CORR' },
  ]
}

export interface FunctionsMenuProps {
  readonly panelId: string
  readonly root: string
  readonly ticker: string
  readonly onRun: (line: string) => void
  readonly onClose: () => void
}

const MOVES: Readonly<Record<string, (i: number, n: number) => number>> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
}

export default function FunctionsMenu({ panelId, root, ticker, onRun, onClose }: FunctionsMenuProps) {
  const fns = drillFunctions(root)
  const ref = useRef<HTMLDivElement>(null)
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  useEffect(() => {
    items()[0]?.focus()
  }, [root])
  useNumbered(panelId, MENU_SOURCE, fns.map((f) => ({ n: f.n, label: f.code, run: () => onRun(f.line) })))

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, fn: DrillFunction) => {
    const list = items()
    const move = MOVES[event.key]
    if (move) {
      list[move(list.indexOf(event.currentTarget), list.length)]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      onRun(fn.line)
    } else if (event.key === 'Escape') {
      onClose()
    } else {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const title = fillCopy(MON.drillTitle, { ticker })
  const columns = [fns.slice(0, 2), fns.slice(2)]
  return (
    <div className="menu-dim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        className="related"
        tabIndex={-1}
        {...{ [ROVING_OVERLAY_ATTR]: '', [ROVING_ATTR]: '' }}
      >
        <div className="related-head">
          <span className="menu-crumb">{fillCopy(MON.drillCrumb, { ticker })}</span>
          <button type="button" className="related-cancel" aria-label={fillCopy(MON.drillCancelLabel, { ticker })} onClick={onClose}>
            {MON.drillCancel} <span aria-hidden="true">X</span>
          </button>
        </div>
        <div role="menu" aria-label={title} className="related-cols">
          {columns.map((col, i) => (
            <div key={i} role="group" className="related-col">
              {col.map((fn) => (
                <button
                  key={fn.code}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="related-row related-function"
                  onClick={() => onRun(fn.line)}
                  onKeyDown={(e) => onKey(e, fn)}
                >
                  <span className="related-no">{`${fn.n})`}</span> <span className="related-mnem">{fn.code}</span>{' '}
                  <span className="related-title">{fn.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
