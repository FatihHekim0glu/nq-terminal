// Gallery support for MON and CORR (gallery builds only; imported by *.gallery.tsx files): a screen in
// the real panel chrome at a fixed panel size, so the E2E run can check it against the fixture backend
// before the merge step registers it with the workspace. `home` is one panel of the 2x2 HOME at
// 1920x1080 (959 x 457 px); `full` is the whole workspace (1920 x 917 px).
import type { ReactNode } from 'react'
import PanelChrome from '../../chrome/PanelChrome'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { MnemonicCode } from '../../commands/registry'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import './galleryFrame.css'

export interface MarketGalleryProps {
  readonly code: MnemonicCode
  readonly title: string
  readonly size: 'home' | 'full'
  readonly group: LinkGroup
  readonly children: ReactNode
}

function actionsFor(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

export default function MarketGallery({ code, title, size, group, children }: MarketGalleryProps) {
  const panelId = `gallery-${code.toLowerCase()}`
  return (
    <div className={`mkt-gallery mkt-gallery-${size}`} data-testid="market-gallery">
      <PanelActionsContext value={actionsFor(panelId)}>
        <PanelChrome panelId={panelId} number={1} code={code} title={title} group={group}>
          {children}
        </PanelChrome>
      </PanelActionsContext>
    </div>
  )
}
