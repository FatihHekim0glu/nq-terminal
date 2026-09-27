// Gallery entry /__gallery/BalanceCheck (TASKS 5.4): the balance checks of three backend fixture
// runs: a sized book with its MTM check, coverage and an identical anchor; a run without MTM
// snapshots; and the unbalanced run, marked [UNUSABLE: BALANCE].
import { TILE_GALLERY as T } from '../copy/tiles'
import BalanceCheck from './BalanceCheck'
import { BALANCE_FIXTURES } from './gallery.fixtures'
import './tiles.gallery.css'

export default function BalanceCheckGallery() {
  return (
    <section className="tile-gallery" aria-labelledby="bal-title">
      <h2 id="bal-title">{T.balanceTitle}</h2>
      <div className="tile-gallery-cards">
        {BALANCE_FIXTURES.map((f) => (
          <BalanceCheck key={f.runId} runId={f.runId} check={f.check} coverage={f.coverage} anchor={f.anchor} />
        ))}
      </div>
    </section>
  )
}
