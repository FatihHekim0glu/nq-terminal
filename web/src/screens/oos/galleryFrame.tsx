// Gallery support for the Phase 7.3 screens (gallery builds only; imported by *.gallery.tsx files):
// one or more screens, each inside the real panel chrome, stacked to fill the gallery page, so the E2E
// run can check a screen against the fixture backend before it is registered with the workspace.
import type { ReactNode } from 'react'
import PanelChrome from '../../chrome/PanelChrome'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { MnemonicCode } from '../../commands/registry'
import './galleryFrame.css'

export interface GalleryScreen {
  readonly code: MnemonicCode
  /** The panel title, as the workspace would build it (for example "OOS"). */
  readonly title: string
  /** Share of the page height (default 1). */
  readonly weight?: number
  readonly node: ReactNode
}

function actionsFor(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

export default function GalleryScreens({ screens }: { readonly screens: readonly GalleryScreen[] }) {
  return (
    <div className="screen-gallery">
      {screens.map((s, i) => {
        const panelId = `gallery-${s.code.toLowerCase()}`
        return (
          <div key={panelId} className="screen-gallery-cell" style={{ flexGrow: s.weight ?? 1 }}>
            <PanelActionsContext value={actionsFor(panelId)}>
              <PanelChrome panelId={panelId} number={i + 1} code={s.code} title={s.title} group="-">
                {s.node}
              </PanelChrome>
            </PanelActionsContext>
          </div>
        )
      })}
    </div>
  )
}
