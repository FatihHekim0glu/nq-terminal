// Gallery entry /__gallery/Expectation (LV6, roadmap #17 step 1): the LIVE expectation card from captured fixtures,
// backend free, in the real panel chrome. The paper and model paths are TRACKING_POPULATED (the terminal's own
// paper-tracking response over the fixture journal), the cone is HYP_BOOTSTRAP (volmanaged_v0 at 1 tick per side)
// and K is RUN_ANALYTICS.capital, the served capital of nt_volmanaged_v0_fixture_m1. It shows the pure view: no
// request is made, and the paper book here is a fixture, not a live book.
import { EXPECTATION } from '../../copy/expectation'
import GalleryPanel from '../runs/galleryPanel'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import { ExpectationCard } from './ExpectationPanel'
import { expectationView } from './expectationModel'
import { TRACKING_POPULATED } from './trackingFixtures'
import './live.css'

const VIEW = expectationView({
  tracking: TRACKING_POPULATED,
  boot: HYP_BOOTSTRAP,
  capital: RUN_ANALYTICS.capital,
  runId: RUN_ANALYTICS.context.name,
  hypothesis: HYP_BOOTSTRAP.context.name,
  cost: HYP_BOOTSTRAP.context.cost,
})

export default function ExpectationGallery() {
  return (
    <GalleryPanel code="LIVE" title={EXPECTATION.gallery.title} group="-">
      <div className="live-screen" data-screen="LIVE">
        <p className="live-message">{EXPECTATION.gallery.note}</p>
        <ExpectationCard state={VIEW} />
      </div>
    </GalleryPanel>
  )
}
