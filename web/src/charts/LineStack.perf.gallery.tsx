// Gallery entry /__gallery/LineStack.perf (TASKS 5.1 acceptance: 250k points render under 100 ms).
// Two panes of 250,000 one-minute points each. LineStack's onRender gives the time from building the
// options (plus cleaning the data on the first build) to every pane drawn; each build is listed in
// data-render-ms, so the E2E run can read the first (cold) build and the rebuilds the Log toggle makes.
import { useCallback, useMemo, useState } from 'react'
import { LINE_STACK_GALLERY as G } from '../copy/lineStack'
import { fillCopy } from '../copy/workspace'
import LineStack from './LineStack'
import { PERF_POINTS, perfStack } from './LineStack.galleryData'
import './LineStack.gallery.css'

export default function LineStackPerfGallery() {
  const { t, panes } = useMemo(perfStack, [])
  const [runs, setRuns] = useState<readonly number[]>([])
  const onRender = useCallback((ms: number) => setRuns((r) => [...r, ms]), [])
  const last = runs.at(-1)
  return (
    <div className="linestack-gallery">
      <p className="chart-name">{fillCopy(G.perfName, { count: PERF_POINTS.toLocaleString('en-GB') })}</p>
      <p className="linestack-gallery-status" data-testid="render-ms" data-render-ms={runs.map((ms) => ms.toFixed(1)).join(',')}>
        {last === undefined ? G.perfPending : fillCopy(G.perfResult, { n: runs.length, ms: last.toFixed(1) })}
      </p>
      <div className="linestack-gallery-body">
        <LineStack title={G.perfTitle} t={t} panes={panes} onRender={onRender} />
      </div>
    </div>
  )
}
