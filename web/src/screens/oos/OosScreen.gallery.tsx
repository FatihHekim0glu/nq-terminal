// Gallery entry /__gallery/OosScreen (TASKS 7.3): the OOS screen in its panel, reading the fixture
// backend's access log and openings (the E2E run's fixture mode).
import GalleryScreens from './galleryFrame'
import OosScreen from './OosScreen'

const PARAMS = { code: 'OOS', context: null, args: {}, group: '-' } as const

export default function OosScreenGallery() {
  return <GalleryScreens screens={[{ code: 'OOS', title: 'OOS', node: <OosScreen params={PARAMS} context={null} /> }]} />
}
