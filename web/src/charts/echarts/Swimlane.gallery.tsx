// Gallery entry /__gallery/Swimlane (TASKS 5.3): OOS gate reads, 2,790 spans, from seeded fixture data.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { Swimlane } from './Swimlane'
import { swimlaneFixture } from './galleryFixtures'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'

export default function SwimlaneGallery() {
  const data = useMemo(swimlaneFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.swimlane}>
        <Swimlane data={data} chartId="swimlane" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
