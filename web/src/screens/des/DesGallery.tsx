// Gallery frame for the DES entries (gallery builds only): the screen inside real panel chrome, reading
// the fixture-mode backend through the gallery's shared query client, as a workspace panel shows it.
import PanelChrome from '../../chrome/PanelChrome'
import type { ResolvedContext } from '../../commands/types'
import type { PanelLink } from '../../state/linkGroups'
import DesScreen from './DesScreen'
import './DesGallery.css'

export interface DesGalleryProps {
  readonly context: ResolvedContext
  readonly title: string
  readonly group?: PanelLink
}

export default function DesGallery({ context, title, group = '-' }: DesGalleryProps) {
  return (
    <div className="des-gallery">
      <PanelChrome panelId="gallery-DES" number={1} code="DES" title={title} subject={context.value} group={group}>
        <DesScreen params={{ code: 'DES', context, args: {}, group }} context={context} />
      </PanelChrome>
    </div>
  )
}
