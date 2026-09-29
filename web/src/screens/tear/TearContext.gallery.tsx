// Gallery entry /__gallery/TearContext (roadmap 12, part B): the EQ tab of the fixture hypothesis volmanaged_v0
// with its Market context shown, inside a panel, so the bands and the strip are checked in the gallery build
// with no backend. The captured /extended body (HYP_EXTENDED) sits outside every stress window and before
// RG1's 252-session minimum, so the real body draws no band and no cell: this entry places five windows and
// the regime labels by hand around the fixture's 39 sessions (2011-04-25 to 2011-06-17) to draw the layers.
// Three windows fall inside the series (one recovered, one spent, one still open, which ends at its trough),
// two lie outside it (the T table lists them as not in view), and the first eight sessions carry no label.
// Everything about the data is stated on the page (TEAR_GALLERY.contextNote): it is not a served result.
import PanelChrome from '../../chrome/PanelChrome'
import { TEAR_GALLERY } from '../../copy/tear'
import { HYP_ANALYTICS, HYP_EXTENDED } from './tearP1.fixtures'
import type { Extended } from './tearQueries'
import { TearView } from './TearViews'
import './tear.css'

const NAME = HYP_ANALYTICS.context.name

type StressRow = Extended['stress']['rows'][number]
type Regimes = NonNullable<Extended['regimes']>
type State = NonNullable<Regimes['regime'][number]>

const WINDOWS: ReadonlyArray<Pick<StressRow, 'label' | 'peak' | 'trough' | 'recovery' | 'spent'>> = [
  { label: 'Window A', peak: '2011-04-27', trough: '2011-05-03', recovery: '2011-05-12', spent: false },
  { label: 'Window B', peak: '2011-05-16', trough: '2011-05-20', recovery: '2011-05-27', spent: true },
  { label: 'Window C', peak: '2011-06-01', trough: '2011-06-15', recovery: null, spent: false },
  { label: 'Window D', peak: '2011-03-01', trough: '2011-03-15', recovery: '2011-04-01', spent: false },
  { label: 'Window E', peak: '2011-07-22', trough: '2011-08-08', recovery: '2012-01-18', spent: false },
]

/** Sessions with no label first (RG1 needs earlier sessions), then runs of each state. */
const RUNS: ReadonlyArray<readonly [State | null, number]> = [[null, 8], ['mid', 8], ['high', 10], ['low', 7], ['mid', 6]]

const isoOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)

/** HYP_EXTENDED with the five hand placed windows and the labelled sessions of the fixture series. */
export function contextExtended(): Extended {
  const t = HYP_ANALYTICS.equity.t
  const regime = RUNS.flatMap(([state, count]) => Array<State | null>(count).fill(state))
  const base = HYP_EXTENDED.stress.rows[0]!
  const served = HYP_EXTENDED.regimes!
  const count = (state: State) => regime.filter((r) => r === state).length
  return {
    ...HYP_EXTENDED,
    stress: { ...HYP_EXTENDED.stress, rows: WINDOWS.map((w) => ({ ...base, ...w })) },
    regimes: {
      ...served,
      t: [...t],
      date: t.map(isoOf),
      regime,
      unlabelled: regime.filter((r) => r === null).length,
      rows: served.rows.map((row) => ({ ...row, n: count(row.regime) })),
    },
  }
}

const EXTENDED = contextExtended()

export default function TearContextGallery() {
  return (
    <>
      <h1 className="sr-only">{TEAR_GALLERY.contextTitle}</h1>
      <PanelChrome panelId="tear-context-gallery" number={1} code="EQ" title={`${NAME} EQ`} subject={NAME} group="B">
        <div className="tear">
          <div className="tear-body">
            <div className="tear-screen">
              <div className="tear-view">
                <p className="tear-note">{TEAR_GALLERY.contextNote}</p>
                <TearView tab="EQ" data={HYP_ANALYTICS} name={NAME} link="B" extended={EXTENDED} extendedError={null} />
              </div>
            </div>
          </div>
        </div>
      </PanelChrome>
    </>
  )
}
