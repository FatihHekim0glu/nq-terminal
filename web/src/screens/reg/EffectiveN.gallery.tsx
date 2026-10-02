// Gallery entry /__gallery/EffectiveN (MT 87) Effective trials, roadmap #19 slice 2): the full view over the served-shaped
// synthetic view of effectiveN.fixtures.ts (the backend's effective_n for the seeded golden panel: nine daily trials in
// planted blocks plus two monthly books), backend free, in the real panel chrome. NOT RESEARCH DATA, and the page says so.
import { EFFECTIVE_N } from '../../copy/effectiveN'
import '../../grids/grid.css' // the app loads it through MonitorGrid; the plain tables below are styled by it
import GalleryPanel from '../runs/galleryPanel'
import { SYNTHETIC_VIEW } from './effectiveN.fixtures'
import { EffectiveNBody } from './EffectiveNPanel'

export default function EffectiveNGallery() {
  return (
    <GalleryPanel code="MT" title="MT 87) Effective trials" group="-">
      <div className="reg-screen" data-screen="MT">
        <div className="mt-view">
          <p className="reg-msg reg-warn">{EFFECTIVE_N.gallery.note}</p>
          <EffectiveNBody view={SYNTHETIC_VIEW} />
        </div>
      </div>
    </GalleryPanel>
  )
}
