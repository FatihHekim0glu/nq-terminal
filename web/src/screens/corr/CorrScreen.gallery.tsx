// Gallery entry /__gallery/CorrScreen (TASKS 7.2): CORR as its own screen, the whole workspace at
// 1920x1080, reading the fixture backend's universe and pair series (the E2E run's fixture mode).
import MarketGallery from '../mon/galleryFrame'
import CorrScreen from './CorrScreen'

const PARAMS = { code: 'CORR', context: { kind: 'universe', value: '27F' }, args: {}, group: 'A' } as const

export default function CorrScreenGallery() {
  return (
    <MarketGallery code="CORR" title="27F CORR" size="full" group="A">
      <CorrScreen params={PARAMS} context={PARAMS.context} />
    </MarketGallery>
  )
}
