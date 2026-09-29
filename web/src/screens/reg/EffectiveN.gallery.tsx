// Gallery entry /__gallery/EffectiveN (MT 87) Effective trials, roadmap #19 slice 2): the full view over the seeded
// synthetic panel of effectiveN.fixtures.ts (nine daily trials in planted blocks plus two monthly books, and a served-
// shaped SV3 view built from them), backend free, in the real panel chrome. NOT RESEARCH DATA, and the page says so.
import { EFFECTIVE_N } from '../../copy/effectiveN'
import '../../grids/grid.css' // the app loads it through MonitorGrid; the plain tables below are styled by it
import GalleryPanel from '../runs/galleryPanel'
import { SYNTHETIC_VIEW, syntheticPanel } from './effectiveN.fixtures'
import { computeEffectiveN } from './effectiveNModel'
import { EffectiveNBody } from './EffectiveNPanel'

const RESULT = computeEffectiveN({ view: SYNTHETIC_VIEW, series: syntheticPanel(), failed: new Map() })

export default function EffectiveNGallery() {
  return (
    <GalleryPanel code="MT" title="MT 87) Effective trials" group="-">
      <div className="reg-screen" data-screen="MT">
        <div className="mt-view">
          <p className="reg-msg reg-warn">{EFFECTIVE_N.gallery.note}</p>
          <EffectiveNBody result={RESULT} view={SYNTHETIC_VIEW} />
        </div>
      </div>
    </GalleryPanel>
  )
}
