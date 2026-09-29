// Gallery entry /__gallery/CostBoard (93) Cost survival, roadmap #5, W2-R5b): the survival board over
// five fixture hypotheses (regFixtures.ts, des/desTestData.ts), backend free, in the real panel chrome
// so Number <GO> on a tile is checked before the merge step registers it.
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import GalleryPanel from '../runs/galleryPanel'
import CostBoard from './CostBoard'
import { buildCostBoard } from './costBoardModel'
import { buildRegRows } from './regModel'
import { HYPOTHESES, REGISTRY } from './regFixtures'
import type { HypothesisDetails } from './useHypothesisDetails'

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

// Only the rows with a fixture detail: the rest of the real registry has neither a stub nor a failure
// recorded, which would otherwise read as an endless "Reading" status line in the gallery.
const ROWS = buildRegRows(REGISTRY, HYPOTHESES).filter((r) => DETAILS.byName.has(r.name))

const VIEW = buildCostBoard(ROWS, DETAILS)
const PANEL_ID = 'gallery-reg'

export default function CostBoardGallery() {
  return (
    <GalleryPanel code="REG" title="REG 93) Cost survival" group="-">
      <CostBoard panelId={PANEL_ID} view={VIEW} />
    </GalleryPanel>
  )
}
