// Gallery entry /__gallery/LineStack (TASKS 5.1): the EQ, DD and RR panes of look spec 7.5 on a
// fixture strategy and a same-exposure benchmark over the whole in-sample window, in link group A,
// with a missing fortnight in March 2020 (no line crosses it) and the fence at the right edge.
import { useMemo } from 'react'
import { LINE_STACK_GALLERY as G } from '../copy/lineStack'
import LineStack from './LineStack'
import { galleryStack } from './LineStack.galleryData'
import './LineStack.gallery.css'

export default function LineStackGallery() {
  const { t, panes } = useMemo(galleryStack, [])
  return (
    <div className="linestack-gallery">
      <p className="chart-name">{G.name}</p>
      <div className="linestack-gallery-body">
        <LineStack title={G.title} t={t} panes={panes} link="A" />
      </div>
    </div>
  )
}
