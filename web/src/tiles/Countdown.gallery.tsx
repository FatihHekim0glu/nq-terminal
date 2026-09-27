// Gallery entry /__gallery/Countdown (TASKS 5.4): the LIVE countdown on a fixed fixture clock
// (2021-11-10, MNQZ1, roll 2021-12-07) before the decision, between decision and order, and after the
// close. A fixed clock never ticks, so the screenshots are stable.
import { TILE_GALLERY as T } from '../copy/tiles'
import Countdown from './Countdown'
import { COUNTDOWN_NOWS, NEXT_FIXTURE } from './gallery.fixtures'
import './tiles.gallery.css'

const CASES = [
  ['before', T.before],
  ['between', T.between],
  ['after', T.after],
] as const

export default function CountdownGallery() {
  return (
    <section className="tile-gallery" aria-labelledby="cd-title">
      <h2 id="cd-title">{T.countdownTitle}</h2>
      {CASES.map(([key, heading]) => (
        <div key={key}>
          <h3 className="tile-gallery-sub">{heading}</h3>
          <Countdown next={NEXT_FIXTURE} now={COUNTDOWN_NOWS[key]} />
        </div>
      ))}
    </section>
  )
}
