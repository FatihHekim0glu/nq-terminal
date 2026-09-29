// Gallery entry /__gallery/DesRobustness (roadmap #4 DES robustness, slice 2 of 3): ScreenEvidence over
// the fixture backend's own volmanaged_v0 card and screen file, and ForkCurveView fed by forkPoint over
// the captured hypothesis and run analytics fixtures (HYP_ANALYTICS, RUN_ANALYTICS); backend free. Not
// wired into DES yet (roadmap #4 slice 3 links it from the tear sheet's own related functions).
import PanelChrome from '../../chrome/PanelChrome'
import { ForkCurveView, ScreenEvidence } from './DesRobustness'
import { VOLMANAGED } from './desTestData'
import { forkPoint, type ForkPoint, type ForkSpec } from './forkModel'
import { VOLMANAGED_SCREEN } from './robustness.fixtures'
import { HYP_ANALYTICS } from '../tear/tearP1.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import './des.css'

const NAME = VOLMANAGED.card.name

const SCREEN_SPEC: ForkSpec = { id: 'screen:1', engine: 'screen', name: NAME, cost: 1, freq: null, basis: 'A', registered: true, flags: [] }
const RUN_SPEC: ForkSpec = { id: 'run:nt_volmanaged_v0_fixture_m1:D', engine: 'run', name: 'nt_volmanaged_v0_fixture_m1', cost: null, freq: 'D', basis: 'B', registered: false, flags: [] }

const POINTS: ForkPoint[] = [forkPoint(SCREEN_SPEC, HYP_ANALYTICS, null), forkPoint(RUN_SPEC, RUN_ANALYTICS, null)]

export default function DesRobustnessGallery() {
  return (
    <PanelChrome panelId="des-robustness-gallery" number={1} code="DES" title={`${NAME} DES robustness`} subject={NAME} group="B">
      <div className="des-page des-robustness">
        <ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />
        <ForkCurveView points={POINTS} skipped={[]} name={NAME} panelId="des-robustness-gallery" />
      </div>
    </PanelChrome>
  )
}
