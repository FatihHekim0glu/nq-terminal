// Gallery entry /__gallery/LineStack.context (roadmap 12, part A): LineStack with its context layer on
// seeded fixture data. Five translucent windows with their chips across the panes, a 6px three-state
// strip under the time axis, and a lanes pane of six drawdown episodes, two of them open (hatched). The
// pointer over a lane outlines it (highlightLane), and data-hover-lane names it for the E2E run.
import { useMemo, useState } from 'react'
import { LINE_STACK_GALLERY as G } from '../copy/lineStack'
import LineStack from './LineStack'
import { contextStack } from './LineStack.contextData'
import './LineStack.gallery.css'

export default function LineStackContextGallery() {
  const { t, panes, spans, ribbon } = useMemo(contextStack, [])
  const [hovered, setHovered] = useState<number | null>(null)
  return (
    <div className="linestack-gallery" data-hover-lane={hovered ?? ''}>
      <p className="chart-name">{G.contextName}</p>
      <div className="linestack-gallery-body">
        <LineStack title={G.contextTitle} t={t} panes={panes} spans={spans} ribbon={ribbon} link="A" highlightLane={hovered} onLaneHover={setHovered} />
      </div>
    </div>
  )
}
