// Gallery entry /__gallery/Heatmap.corr (TASKS 5.3): CORR 27 by 27 matrix, from seeded fixture data.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { Heatmap } from './Heatmap'
import { corrFixture } from './galleryFixtures'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'

export default function HeatmapCorrGallery() {
  const data = useMemo(corrFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.corr}>
        <Heatmap data={data} chartId="corr" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
