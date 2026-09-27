// Gallery entry /__gallery/MonScreen (TASKS 7.2): MON as its own screen, the whole workspace at
// 1920x1080, reading the fixture backend's universe (the E2E run's fixture mode).
import MarketGallery from './galleryFrame'
import MonScreen from './MonScreen'

const PARAMS = { code: 'MON', context: { kind: 'universe', value: '27F' }, args: {}, group: 'A' } as const

export default function MonScreenGallery() {
  return (
    <MarketGallery code="MON" title="27F MON" size="full" group="A">
      <MonScreen params={PARAMS} context={PARAMS.context} />
    </MarketGallery>
  )
}
