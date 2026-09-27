// Gallery entry /__gallery/PScatter (TASKS 5.3): MT p-values against rank, from seeded fixture data.
import { useMemo } from 'react'
import { ECHARTS_GALLERY as G } from '../../copy/echarts'
import { PScatter } from './PScatter'
import { pScatterFixture } from './galleryFixtures'
import { GalleryPanel, GalleryPanels } from './GalleryPanels'

export default function PscatterGallery() {
  const data = useMemo(pScatterFixture, [])
  return (
    <GalleryPanels>
      <GalleryPanel title={G.titles.pScatter}>
        <PScatter data={data} chartId="p-scatter" />
      </GalleryPanel>
    </GalleryPanels>
  )
}
