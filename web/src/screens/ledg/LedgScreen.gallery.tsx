// Gallery entry /__gallery/LedgScreen (TASKS 6.3): LEDG in panel chrome at the full workspace size,
// reading the fixture backend (the E2E run's fixture mode).
import GalleryPanel from '../runs/galleryPanel'
import LedgScreen from './LedgScreen'

const PARAMS = { code: 'LEDG', context: null, args: {}, group: '-' } as const

export default function LedgScreenGallery() {
  return (
    <GalleryPanel code="LEDG" title="LEDG" group="-">
      <LedgScreen params={PARAMS} context={null} />
    </GalleryPanel>
  )
}
