// Gallery entry /__gallery/TearDd (roadmap 10, phase 1): the DD tab of the fixture hypothesis volmanaged_v0
// with its episode lanes under the underwater curve, inside a panel, so the lanes and their cross-highlight
// with the top drawdowns table are checked in the gallery build with no backend. The captured response
// (HYP_ANALYTICS) serves one open row whose trough is the last session, so its lane is a fall only, with no
// recovery to hatch or label. This entry therefore keeps every curve of the fixture and its captured /extended
// body (HYP_EXTENDED) and places four disjoint episodes by hand over its 39 sessions: one from the first
// session (a null peak), two recovered and one still open, so the fall, the recovery, the hatch and the depth
// are all drawn. Everything about the data is stated on the page (TEAR_GALLERY.ddNote): it is not a served result.
import PanelChrome from '../../chrome/PanelChrome'
import { TEAR_GALLERY } from '../../copy/tear'
import type { Analytics } from './tearKpis'
import { HYP_ANALYTICS, HYP_EXTENDED } from './tearP1.fixtures'
import { TearView } from './TearViews'
import './tear.css'

const NAME = HYP_ANALYTICS.context.name
const DATES = HYP_ANALYTICS.drawdown.date
const LAST = DATES.length - 1

type Row = Analytics['drawdown_table'][number]

interface Placed {
  /** Session indexes; a null peak is the starting value, one session before the first. */
  readonly peak: number | null
  readonly trough: number
  readonly recovery: number | null
  readonly depth: number
}

/** Served order: deepest first. The episodes do not overlap, as the API's do not. */
const PLACED: readonly Placed[] = [
  { peak: 26, trough: 32, recovery: null, depth: -0.0949 },
  { peak: 15, trough: 20, recovery: 26, depth: -0.052 },
  { peak: null, trough: 4, recovery: 8, depth: -0.041 },
  { peak: 8, trough: 12, recovery: 15, depth: -0.02 },
]

function rowOf(p: Placed): Row {
  const from = p.peak ?? -1
  const to = p.recovery ?? LAST
  return {
    peak: p.peak === null ? null : (DATES[p.peak] ?? null),
    trough: DATES[p.trough] ?? '',
    recovery: p.recovery === null ? null : (DATES[p.recovery] ?? null),
    depth: p.depth,
    peak_to_trough: p.trough - from,
    trough_to_recovery: p.recovery === null ? null : p.recovery - p.trough,
    length: to - from,
    open: p.recovery === null,
  }
}

const DATA: Analytics = { ...HYP_ANALYTICS, drawdown_table: PLACED.map(rowOf) }

export default function TearDdGallery() {
  return (
    <>
      <h1 className="sr-only">{TEAR_GALLERY.ddTitle}</h1>
      <PanelChrome panelId="tear-dd-gallery" number={1} code="DD" title={`${NAME} DD`} subject={NAME} group="B">
        <div className="tear">
          <div className="tear-body">
            <div className="tear-screen">
              <div className="tear-view">
                <p className="tear-note">{TEAR_GALLERY.ddNote}</p>
                <TearView tab="DD" data={DATA} name={NAME} link="B" extended={HYP_EXTENDED} extendedError={null} />
              </div>
            </div>
          </div>
        </div>
      </PanelChrome>
    </>
  )
}
