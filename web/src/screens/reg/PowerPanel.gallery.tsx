// Gallery entry /__gallery/PowerPanel (SV9 on MT, roadmap #11): the power table over the captured SV3 view
// (deflatedFixtures.ts) and the captured family (regFixtures.ts), backend free, in the real panel chrome.
import { POWER } from '../../copy/power'
import GalleryPanel from '../runs/galleryPanel'
import { DEFLATED_REAL } from './deflatedFixtures'
import { powerView } from './powerModel'
import { PowerTable } from './PowerPanel'
import { MULTIPLE_TESTING } from './regFixtures'

const VIEW = powerView(DEFLATED_REAL, { alpha: MULTIPLE_TESTING.alpha, k: MULTIPLE_TESTING.k })

export default function PowerPanelGallery() {
  return (
    <GalleryPanel code="MT" title={POWER.gallery.title} group="-">
      <div className="reg-screen" data-screen="MT">
        <PowerTable power={VIEW} />
      </div>
    </GalleryPanel>
  )
}
