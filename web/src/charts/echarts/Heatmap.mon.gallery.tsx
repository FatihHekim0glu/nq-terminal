// Gallery entry /__gallery/Heatmap.mon (TASKS 5.3): MON 27F heat cells, from seeded fixture data.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { Heatmap } from './Heatmap'
import { monFixture } from './galleryFixtures'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'

export default function HeatmapMonGallery() {
  const data = useMemo(monFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.mon}>
        <Heatmap data={data} chartId="mon" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
