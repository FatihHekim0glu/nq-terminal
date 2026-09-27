// Gallery support for RUNS, RUN and LEDG (gallery builds only; imported by *.gallery.tsx files): a screen
// in the real panel chrome at the size the workspace gives one panel at 1920x1080 (1920 x 917 px), so the
// E2E run can check it against the fixture backend before the merge step registers it.
import type { ReactNode } from 'react'
import PanelChrome from '../../chrome/PanelChrome'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { LinkGroup } from '../../chrome/WorkspaceLayouts'
import type { MnemonicCode } from '../../commands/registry'
import './galleryPanel.css'

export interface GalleryPanelProps {
  readonly code: MnemonicCode
  readonly title: string
  readonly group: LinkGroup
  readonly children: ReactNode
}

function actionsFor(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

export default function GalleryPanel({ code, title, group, children }: GalleryPanelProps) {
  const panelId = `gallery-${code.toLowerCase()}`
  return (
    <div className="runs-gallery" data-testid="runs-gallery">
      <PanelActionsContext value={actionsFor(panelId)}>
        <PanelChrome panelId={panelId} number={1} code={code} title={title} group={group}>
          {children}
        </PanelChrome>
      </PanelActionsContext>
    </div>
  )
}

/** The `run` query parameter of the gallery URL, e.g. /__gallery/RunsScreens?run=nt_x. */
export function galleryParam(name: string): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get(name) ?? ''
}
