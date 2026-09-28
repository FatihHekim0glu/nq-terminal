// Gallery entry /__gallery/TearSv7 (ANALYTICS_CATALOG SV7): the RET tab view of the fixture hypothesis
// volmanaged_v0 with its Sharpe difference (m - BH) card inside the statistics' own scroll box, drawn from
// the captured fixture response (HYP_ANALYTICS) inside a panel, so the card is checked in the gallery build
// with no backend.
import PanelChrome from '../../chrome/PanelChrome'
import { TEAR_GALLERY } from '../../copy/tear'
import { HYP_ANALYTICS } from './tearP1.fixtures'
import { TearView } from './TearViews'
import './tear.css'

const NAME = HYP_ANALYTICS.context.name

export default function TearSv7Gallery() {
  return (
    <>
      <h1 className="sr-only">{TEAR_GALLERY.sv7Title}</h1>
      <PanelChrome panelId="tear-sv7-gallery" number={1} code="RET" title={`${NAME} RET`} subject={NAME} group="B">
        <div className="tear">
          <div className="tear-body">
            <div className="tear-screen">
              <div className="tear-view">
                <TearView tab="RET" data={HYP_ANALYTICS} name={NAME} link="B" />
              </div>
            </div>
          </div>
        </div>
      </PanelChrome>
    </>
  )
}
