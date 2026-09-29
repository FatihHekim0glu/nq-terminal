// Gallery entry /__gallery/ExpoComposition (roadmap #13 slice 2, ANALYTICS_CATALOG EX1 by instrument): the
// run books' exposure card in each of its three views, on a SEEDED 27-instrument book (composition.fixtures)
// that is not a run and not a result. Totals is the gross, net and turnover stack; By instrument is the
// heat grid under seven sector band rows; By sector is the stack coloured by sector with the API's Gross and
// Net lines over it. The instrument index is passed in, so the entry makes no request.
import { ExposureCard } from './RunBooks'
import { COMPOSITION_EXPOSURE, COMPOSITION_INDEX, COMPOSITION_RUN } from './composition.fixtures'
import './tear.css'

const HEADING = 'Exposure card views on a seeded 27 instrument fixture, not a run'

export default function ExpoCompositionGallery() {
  return (
    <>
      <h1 className="sr-only">{HEADING}</h1>
      <section className="tear-books" aria-label={HEADING}>
        <div className="tear-books-grid">
          <ExposureCard exposure={COMPOSITION_EXPOSURE} runId={COMPOSITION_RUN} link="-" index={COMPOSITION_INDEX} />
          <ExposureCard exposure={COMPOSITION_EXPOSURE} runId={COMPOSITION_RUN} link="-" index={COMPOSITION_INDEX} initialView="heat" />
          <ExposureCard exposure={COMPOSITION_EXPOSURE} runId={COMPOSITION_RUN} link="-" index={COMPOSITION_INDEX} initialView="stack" />
        </div>
      </section>
    </>
  )
}
