// Gallery entry /__gallery/MonHome (TASKS 7.2, look spec 7 row budget): MON at the size of one panel of
// the 2x2 HOME at 1920x1080, where the parameter row folds away and 19 grid rows must show.
import MarketGallery from './galleryFrame'
import MonScreen from './MonScreen'

const PARAMS = { code: 'MON', context: { kind: 'universe', value: '27F' }, args: {}, group: 'A' } as const

export default function MonHomeGallery() {
  return (
    <MarketGallery code="MON" title="27F MON" size="home" group="A">
      <MonScreen params={PARAMS} context={PARAMS.context} />
    </MarketGallery>
  )
}
