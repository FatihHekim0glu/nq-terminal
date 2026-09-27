// Gallery entry /__gallery/SpecCard (TASKS 5.4): registration cards from the registry values of
// rebal_v0 (with the opening of its frozen pass bar), volmanaged_v0 and the unregistered za_v0 C3
// check, so [FAIL] and [CHECK] badges and both [PRE-REG] and [POST HOC] tags show.
import { TILE_GALLERY as T } from '../copy/tiles'
import { REBAL_PASS_BAR, SPEC_FIXTURES } from './gallery.fixtures'
import SpecCard from './SpecCard'
import './tiles.gallery.css'

export default function SpecCardGallery() {
  return (
    <section className="tile-gallery" aria-labelledby="spec-title">
      <h2 id="spec-title">{T.specTitle}</h2>
      <div className="tile-gallery-cards">
        {SPEC_FIXTURES.map((card) => (
          <SpecCard key={card.name} card={card} passBar={card.name === 'rebal_v0' ? REBAL_PASS_BAR : null} />
        ))}
      </div>
    </section>
  )
}
