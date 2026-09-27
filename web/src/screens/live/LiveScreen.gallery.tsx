// Gallery entry /__gallery/LiveScreen (TASKS 7.3): the LIVE layout (LIVE above JRNL), each in its panel,
// reading the fixture backend's live folder (the E2E run's fixture mode).
import GalleryScreens from '../oos/galleryFrame'
import JrnlScreen from './JrnlScreen'
import LiveScreen from './LiveScreen'

const LIVE_PARAMS = { code: 'LIVE', context: null, args: {}, group: '-' } as const
const JRNL_PARAMS = { code: 'JRNL', context: null, args: {}, group: '-' } as const

export default function LiveScreenGallery() {
  return (
    <GalleryScreens
      screens={[
        { code: 'LIVE', title: 'LIVE', node: <LiveScreen params={LIVE_PARAMS} context={null} /> },
        { code: 'JRNL', title: 'JRNL', node: <JrnlScreen params={JRNL_PARAMS} context={null} /> },
      ]}
    />
  )
}
