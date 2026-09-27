// The tear sheet inside a panel for the gallery entries (gallery builds only: nothing but
// *.gallery.tsx imports this). The E2E run serves the gallery against the fixture-mode backend, so the
// screen reads real fixture responses through /api, exactly as in the workspace, and its red bar and
// tabs land in the panel's slots.
import PanelChrome from '../../chrome/PanelChrome'
import type { MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'
import TearSheet from './TearSheet'

export interface TearGalleryProps {
  readonly code: MnemonicCode
  readonly context: ResolvedContext
  readonly heading: string
}

export default function TearGallery({ code, context, heading }: TearGalleryProps) {
  const title = `${context.value} ${code}`
  return (
    <>
      <h1 className="sr-only">{heading}</h1>
      <PanelChrome panelId="tear-gallery" number={1} code={code} title={title} subject={context.value} group="B">
        <TearSheet params={{ code, context, args: {}, group: 'B' }} context={context} />
      </PanelChrome>
    </>
  )
}
