// Gallery entry /__gallery/Heatmap (TASKS 5.3): MRET heat map, from seeded fixture data.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { Heatmap } from './Heatmap'
import { mretFixture } from './galleryFixtures'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'

export default function HeatmapGallery() {
  const data = useMemo(mretFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.mret}>
        <Heatmap data={data} chartId="mret" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
