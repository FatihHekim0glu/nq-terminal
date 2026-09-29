// Gallery entry /__gallery/EvidenceMap (94) Effect map, roadmap #5 slice 3, W8-R5c): the effect map over the
// captured SV3 view (deflatedFixtures.ts) and the captured registry (regFixtures.ts), backend free, in the real
// panel chrome so the points, the pinned mim_v0, the off-axis SR0 V line and Number <GO> are checked before the merge.
import GalleryPanel from '../runs/galleryPanel'
import { DEFLATED_REAL } from './deflatedFixtures'
import EvidenceMap from './EvidenceMap'
import { buildEvidenceMap } from './evidenceMapModel'
import { buildRegRows } from './regModel'
import { HYPOTHESES, REGISTRY } from './regFixtures'

const MAP = buildEvidenceMap(DEFLATED_REAL, buildRegRows(REGISTRY, HYPOTHESES))
const PANEL_ID = 'gallery-reg'

export default function EvidenceMapGallery() {
  return (
    <GalleryPanel code="REG" title="REG 94) Effect map" group="-">
      <div className="reg-screen" data-screen="REG">
        <EvidenceMap panelId={PANEL_ID} map={MAP} />
      </div>
    </GalleryPanel>
  )
}
