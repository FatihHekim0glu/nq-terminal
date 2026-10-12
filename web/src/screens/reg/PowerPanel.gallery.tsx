// Gallery entry /__gallery/PowerPanel (SV9 on MT, roadmap #11): the captured served power table
// (plan/powerTable.fixtures.ts, GET /api/analytics/power), backend free, in the real panel chrome.
import { POWER } from '../../copy/power'
import GalleryPanel from '../runs/galleryPanel'
import { POWER_TABLE_REAL } from '../plan/powerTable.fixtures'
import { PowerTable } from './PowerPanel'
import { powerViewFromServed } from './usePowerTable'

const VIEW = powerViewFromServed(POWER_TABLE_REAL)

export default function PowerPanelGallery() {
  return (
    <GalleryPanel code="MT" title={POWER.gallery.title} group="-">
      <div className="reg-screen" data-screen="MT">
        <PowerTable power={VIEW} />
      </div>
    </GalleryPanel>
  )
}
