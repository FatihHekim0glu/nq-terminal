// Gallery entry /__gallery/Expectation (LV6 and LV6b): the LIVE expectation card from views the fixture backend
// served (expectationFixtures.ts), backend free, in the real panel chrome: the view over a seeded synthetic 40-session
// paper book (not project data), with both cones and the toggle, opening on the backtest start. No request is made.
// One card only, so the page holds one region of that name.
import { EXPECTATION } from '../../copy/expectation'
import GalleryPanel from '../runs/galleryPanel'
import { ServedExpectation } from './ExpectationPanel'
import { PAPER_EXPECTATION_LIVE } from './expectationFixtures'
import './live.css'

export default function ExpectationGallery() {
  return (
    <GalleryPanel code="LIVE" title={EXPECTATION.gallery.title} group="-">
      <div className="live-screen" data-screen="LIVE">
        <p className="live-message">{EXPECTATION.gallery.note}</p>
        <ServedExpectation served={PAPER_EXPECTATION_LIVE} />
      </div>
    </GalleryPanel>
  )
}
