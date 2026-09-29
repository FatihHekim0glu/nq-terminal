// Gallery entry /__gallery/RegEvidence (92) Evidence, roadmap #5): the evidence matrix over the full
// registry, its five fixture hypothesis details (regFixtures.ts, deflatedFixtures.ts,
// des/desTestData.ts) and the rest read as still pending, backend free, in the real panel chrome.
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import GalleryPanel from '../runs/galleryPanel'
import { DEFLATED_REAL } from './deflatedFixtures'
import { buildEvidenceRows } from './evidenceModel'
import { buildRegRows } from './regModel'
import { CONFIRMATIONS, HYPOTHESES, REGISTRY } from './regFixtures'
import RegEvidence from './RegEvidence'
import type { HypothesisDetails } from './useHypothesisDetails'

const ROWS = buildRegRows(REGISTRY, HYPOTHESES)

const DETAILS: HypothesisDetails = {
  byName: new Map([
    ['overnight_v0', OVERNIGHT],
    ['volmanaged_v0', VOLMANAGED],
    ['rebal_v0', REBAL],
    ['za_v0', ZA],
    ['za_v0_C3_gao_momentum', ZA_C3],
  ]),
  failed: new Map(),
  pending: 0,
}

const ROWS_VIEW = buildEvidenceRows({ rows: ROWS, cards: HYPOTHESES, confirmations: CONFIRMATIONS, deflated: DEFLATED_REAL, details: DETAILS })

export default function RegEvidenceGallery() {
  return (
    <GalleryPanel code="REG" title="REG 92) Evidence" group="-">
      <RegEvidence rows={ROWS_VIEW} width={null} />
    </GalleryPanel>
  )
}
