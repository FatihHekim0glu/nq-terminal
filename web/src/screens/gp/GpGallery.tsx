// Gallery frame for the GP and GIP entries (gallery builds only): the screen inside real panel chrome,
// reading the fixture-mode backend through the shared query client, as a workspace panel shows it.
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import PanelChrome from '../../chrome/PanelChrome'
import { ApiProvider } from '../../api/ApiProvider'
import { GpScreen } from './GpScreen'
import './GpGallery.css'

export interface GpGalleryProps {
  readonly params: PanelParams
  readonly title: string
  readonly subject: string
}

export default function GpGallery({ params, title, subject }: GpGalleryProps) {
  return (
    <ApiProvider>
      <div className="gp-gallery">
        <PanelChrome panelId={`gallery-${params.code}`} number={1} code={params.code} title={title} subject={subject} group={params.group}>
          <GpScreen mode={params.code === 'GIP' ? 'GIP' : 'GP'} params={params} context={params.context} />
        </PanelChrome>
      </div>
    </ApiProvider>
  )
}
